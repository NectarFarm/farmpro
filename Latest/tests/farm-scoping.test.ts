// ── Farm-scoped data tests (farm-scoped-data task) ──────────────────────────
// Integration tests that call the real route handlers directly against real
// Postgres (no HTTP server needed), same pattern as tests/batches.test.ts /
// tests/farms-crud.test.ts. Skips when DATABASE_URL is unset (CI has no
// database).
//
// The whole point of this task was that the farm switcher (NavContext.
// activeFarm) changed a label and NOTHING else — no route read a farmId, so
// switching farms never filtered any real data. These tests exist to prove
// the filter actually FILTERS, not merely that a `farmId` param is accepted
// without erroring: two farms in one tenant get genuinely different data,
// and every assertion below checks the results actually DIFFER per farm and
// that omitting farmId returns the union.
//
// Covers (per the task brief's "at minimum" list):
//   - KPIs differ per farm: revenue, active batches, mortality — and ALL
//     equals the sum/union.
//   - batches / records / sales filter correctly through the JOIN
//     (unitId -> production_units.farmId, and batchId -> that same join),
//     not through some denormalised column that doesn't exist on those
//     tables.
//   - tasks / inventory lots (via GET /api/inventory/items) / purchases /
//     employees filter by their new direct farm_id column.
//   - a farmId from ANOTHER tenant is rejected (404), never silently
//     ignored / falling back to unfiltered.
//   - rows with a NULL farm_id (simulating pre-migration / never-assigned
//     data) show up under the unfiltered/ALL view but NOT under any single
//     farm's filtered view — proving they're not silently invisible
//     everywhere, the failure mode the migration's backfill step was
//     designed to avoid.
//   - approval_requests: a farm filter returns that farm's batch-linked
//     approvals PLUS every tenant-level (batchId IS NULL) approval — the
//     documented decision in GET /api/approvals's header.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { inArray } from 'drizzle-orm'

vi.mock('server-only', () => ({}))

// Auth fix (fix/authenticate-all-apis): every route this file exercises now
// requires a real session and resolves tenant from it ONLY — the `tenantId`
// query/body param below is kept on every call (harmless: it always names
// the caller's OWN tenant here) but no longer does any work by itself. See
// tests/role-screens.test.ts / tests/farm-scoping.test.ts's sibling files for
// the same mockCookie pattern.
let mockCookie: string | undefined
vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({ get: () => (mockCookie ? { value: mockCookie } : undefined) })),
}))

import { GET as batchesGET } from '@/app/api/batches/route'
import { GET as recordsGET } from '@/app/api/records/route'
import { GET as salesGET } from '@/app/api/data/sales/route'
import { GET as tasksGET, POST as tasksPOST } from '@/app/api/tasks/route'
import { GET as purchasesGET, POST as purchasesPOST } from '@/app/api/purchases/route'
import { GET as employeesGET, POST as employeesPOST } from '@/app/api/employees/route'
import { GET as approvalsGET } from '@/app/api/approvals/route'
import { GET as inventoryItemsGET } from '@/app/api/inventory/items/route'
import { GET as kpisGET } from '@/app/api/dashboard/kpis/route'

import { db } from '@/db'
import {
  tenants, farms, productionUnits, batches, sales, employees, approvalRequests, records,
  tasks, purchases, inventoryItems, inventoryLots, users, sessions,
} from '@/db/schemas'
import { createSession, hashSecret } from '@/lib/auth'

const hasDb = !!process.env.DATABASE_URL
const run = hasDb ? describe : describe.skip

function getRequest(url: string): Request {
  return new Request(url)
}
function postRequest(url: string, body: unknown): Request {
  return new Request(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
}
async function readJson(res: Response) {
  return { status: res.status, payload: await res.json() }
}
// Deep-sorts by `id` so a farm's own row order never matters to `toEqual`.
function idsOf(rows: { id: string }[]): string[] {
  return rows.map((r) => r.id).sort()
}

run('farm-scoped data (farm-scoped-data task)', () => {
  const tenantId = `t-fscope-${randomUUID()}`
  const otherTenantId = `t-fscope-other-${randomUUID()}`

  const farmXId = `f-x-${randomUUID()}`
  const farmYId = `f-y-${randomUUID()}`
  const farmOtherId = `f-other-${randomUUID()}`

  const unitXId = `u-x-${randomUUID()}`
  const unitYId = `u-y-${randomUUID()}`

  const batchXId = `b-x-${randomUUID()}`
  const batchYId = `b-y-${randomUUID()}`

  const saleXId = `s-x-${randomUUID()}`
  const saleYId = `s-y-${randomUUID()}`
  const saleNoBatchId = `s-nb-${randomUUID()}`

  const empXId = `e-x-${randomUUID()}`
  const empYId = `e-y-${randomUUID()}`
  const empLegacyId = `e-legacy-${randomUUID()}`

  // Task ids are captured from their real POST /api/tasks responses below
  // (not pre-declared) — assigned in the describe block's beforeAll.
  let taskXId: string, taskYId: string, taskTenantId: string

  const approvalXId = `apr-x-${randomUUID()}`
  const approvalYId = `apr-y-${randomUUID()}`
  const approvalTenantId = `apr-tenant-${randomUUID()}`

  const recordXId = `rec-x-${randomUUID()}`
  const recordYId = `rec-y-${randomUUID()}`

  const allTenantIds = [tenantId, otherTenantId]
  const allFarmIds = [farmXId, farmYId, farmOtherId]

  // Every route this file exercises now requires a real session — one owner
  // on the primary tenant, authenticated for the whole suite (nothing here
  // tests unauthenticated behaviour; that's covered elsewhere, e.g.
  // tests/role-screens.test.ts).
  const ownerId = randomUUID()

  beforeAll(async () => {
    await db.insert(tenants).values([
      { id: tenantId, name: 'Farm Scoping Test Co.', active: true },
      { id: otherTenantId, name: 'Farm Scoping Test Co. (other tenant)', active: true },
    ])
    const salt = randomUUID()
    await db.insert(users).values({
      id: ownerId, tenantId, name: 'Farm Scoping Owner', email: `owner-fscope-${randomUUID()}@test.ifms`,
      role: 'owner', passwordHash: hashSecret('pw', salt), passwordSalt: salt, status: 'ACTIVE',
    })
    mockCookie = await createSession(ownerId)
    await db.insert(farms).values([
      { id: farmXId, tenantId, name: 'Farm X', location: 'Nakuru', code: 'FRM-X' },
      { id: farmYId, tenantId, name: 'Farm Y', location: 'Eldoret', code: 'FRM-Y' },
      // Different tenant entirely — used to prove a foreign-tenant farmId
      // is rejected (404), not silently ignored.
      { id: farmOtherId, tenantId: otherTenantId, name: 'Farm Other', location: 'Kisumu', code: 'FRM-OTHER' },
    ])
    await db.insert(productionUnits).values([
      { id: unitXId, tenantId, farmId: farmXId, type: 'house', name: 'Unit X', code: 'HSE-X-001', status: 'ACTIVE' },
      { id: unitYId, tenantId, farmId: farmYId, type: 'house', name: 'Unit Y', code: 'HSE-Y-001', status: 'ACTIVE' },
    ])
    // batchX: 100 -> 80 (20 deaths, 20% mortality). batchY: 50 -> 45 (5
    // deaths, 10% mortality). Pooled (ALL): (25/150) = 16.7%.
    await db.insert(batches).values([
      { id: batchXId, tenantId, unitId: unitXId, code: 'BAT-X-001', name: 'Batch X', enterprise: 'broiler', status: 'ACTIVE', initialQty: 100, currentQty: 80 },
      { id: batchYId, tenantId, unitId: unitYId, code: 'BAT-Y-001', name: 'Batch Y', enterprise: 'broiler', status: 'ACTIVE', initialQty: 50, currentQty: 45 },
    ])
    await db.insert(sales).values([
      { id: saleXId, tenantId, batchId: batchXId, item: 'Eggs X', amountCents: 100000, status: 'paid' },
      { id: saleYId, tenantId, batchId: batchYId, item: 'Eggs Y', amountCents: 30000, status: 'paid' },
      // No batch at all (a general/tenant-level sale) — has no farm
      // relationship through the join, so it must show under the
      // unfiltered/ALL view but never under a single farm's filtered view.
      { id: saleNoBatchId, tenantId, batchId: null, item: 'General sale', amountCents: 5000, status: 'paid' },
    ])
    await db.insert(employees).values([
      { id: empXId, tenantId, name: 'Employee X', role: 'worker', farmId: farmXId },
      { id: empYId, tenantId, name: 'Employee Y', role: 'worker', farmId: farmYId },
      // Simulates a pre-migration row the backfill couldn't/didn't assign
      // (e.g. a tenant with no farms at backfill time) — farmId stays NULL.
      { id: empLegacyId, tenantId, name: 'Employee Legacy', role: 'worker', farmId: null },
    ])
    await db.insert(approvalRequests).values([
      { id: approvalXId, tenantId, type: 'task_completion', title: 'Approval X', requestedBy: empXId, batchId: batchXId, entityId: 'n/a', status: 'pending' },
      { id: approvalYId, tenantId, type: 'task_completion', title: 'Approval Y', requestedBy: empYId, batchId: batchYId, entityId: 'n/a', status: 'pending' },
      // Tenant-level approval (no batch at all) — per GET /api/approvals's
      // documented decision, this must appear in EVERY farm's filtered view
      // AND the unfiltered view, never hidden behind a farm pick.
      { id: approvalTenantId, tenantId, type: 'task_completion', title: 'Approval Tenant', requestedBy: empXId, batchId: null, entityId: 'n/a', status: 'pending' },
    ])
    await db.insert(records).values([
      { id: recordXId, tenantId, batchId: batchXId, employeeId: empXId, type: 'mortality', data: { count: 5 } },
      { id: recordYId, tenantId, batchId: batchYId, employeeId: empYId, type: 'mortality', data: { count: 2 } },
    ])
  })

  afterAll(async () => {
    mockCookie = undefined
    await db.delete(sessions).where(inArray(sessions.userId, [ownerId]))
    await db.delete(users).where(inArray(users.id, [ownerId]))
    await db.delete(records).where(inArray(records.id, [recordXId, recordYId]))
    await db.delete(approvalRequests).where(inArray(approvalRequests.id, [approvalXId, approvalYId, approvalTenantId]))
    // tasks/purchases/inventory rows created via the real POST routes below
    // are cleaned up by tenant, same as employees/sales/batches/units/farms.
    await db.delete(purchases).where(inArray(purchases.tenantId, allTenantIds))
    await db.delete(inventoryLots).where(inArray(inventoryLots.tenantId, allTenantIds))
    await db.delete(inventoryItems).where(inArray(inventoryItems.tenantId, allTenantIds))
    await db.delete(tasks).where(inArray(tasks.tenantId, allTenantIds))
    await db.delete(sales).where(inArray(sales.id, [saleXId, saleYId, saleNoBatchId]))
    await db.delete(employees).where(inArray(employees.id, [empXId, empYId, empLegacyId]))
    await db.delete(batches).where(inArray(batches.id, [batchXId, batchYId]))
    await db.delete(productionUnits).where(inArray(productionUnits.id, [unitXId, unitYId]))
    await db.delete(farms).where(inArray(farms.id, allFarmIds))
    await db.delete(tenants).where(inArray(tenants.id, allTenantIds))
  })

  // ── batches: JOIN filter (unitId -> production_units.farmId) ─────────────
  describe('GET /api/batches — farmId is a JOIN filter', () => {
    it('farmId=X returns only farm X\'s batch; farmId=Y only farm Y\'s; no farmId returns the union', async () => {
      const x = await readJson(await batchesGET(getRequest(`http://localhost/api/batches?tenantId=${tenantId}&farmId=${farmXId}`)))
      expect(idsOf(x.payload.data)).toEqual([batchXId])

      const y = await readJson(await batchesGET(getRequest(`http://localhost/api/batches?tenantId=${tenantId}&farmId=${farmYId}`)))
      expect(idsOf(y.payload.data)).toEqual([batchYId])

      const all = await readJson(await batchesGET(getRequest(`http://localhost/api/batches?tenantId=${tenantId}`)))
      expect(idsOf(all.payload.data)).toEqual(idsOf([{ id: batchXId }, { id: batchYId }]))

      const allSentinel = await readJson(await batchesGET(getRequest(`http://localhost/api/batches?tenantId=${tenantId}&farmId=ALL`)))
      expect(idsOf(allSentinel.payload.data)).toEqual(idsOf(all.payload.data))
    })

    it('a farmId belonging to another tenant is rejected (404), not silently unfiltered', async () => {
      const res = await readJson(await batchesGET(getRequest(`http://localhost/api/batches?tenantId=${tenantId}&farmId=${farmOtherId}`)))
      expect(res.status).toBe(404)
    })

    it('an unknown/garbage farmId is rejected (404)', async () => {
      const res = await readJson(await batchesGET(getRequest(`http://localhost/api/batches?tenantId=${tenantId}&farmId=not-a-real-farm-id`)))
      expect(res.status).toBe(404)
    })
  })

  // ── records: two-hop JOIN filter (batchId -> unitId -> farmId) ───────────
  describe('GET /api/records — farmId is a two-hop JOIN filter', () => {
    it('filters mortality records to the requested farm, and unions them under ALL', async () => {
      const x = await readJson(await recordsGET(getRequest(`http://localhost/api/records?tenantId=${tenantId}&farmId=${farmXId}`)))
      expect(idsOf(x.payload.data)).toEqual([recordXId])

      const y = await readJson(await recordsGET(getRequest(`http://localhost/api/records?tenantId=${tenantId}&farmId=${farmYId}`)))
      expect(idsOf(y.payload.data)).toEqual([recordYId])

      const all = await readJson(await recordsGET(getRequest(`http://localhost/api/records?tenantId=${tenantId}`)))
      expect(idsOf(all.payload.data)).toEqual(idsOf([{ id: recordXId }, { id: recordYId }]))
    })
  })

  // ── sales: JOIN filter, plus the NULL-batchId "not silently invisible"
  // case ──────────────────────────────────────────────────────────────────
  describe('GET /api/data/sales — farmId is a JOIN filter; a batch-less sale is not silently dropped from ALL', () => {
    it('farm-filtered views show only that farm\'s sales; ALL includes the batch-less sale too', async () => {
      const x = await readJson(await salesGET(getRequest(`http://localhost/api/data/sales?tenantId=${tenantId}&farmId=${farmXId}`)))
      expect(idsOf(x.payload.data)).toEqual([saleXId])

      const y = await readJson(await salesGET(getRequest(`http://localhost/api/data/sales?tenantId=${tenantId}&farmId=${farmYId}`)))
      expect(idsOf(y.payload.data)).toEqual([saleYId])

      // The batch-less sale has no farm to reach through the join — it must
      // never appear in a farm-scoped view...
      expect(idsOf(x.payload.data)).not.toContain(saleNoBatchId)
      expect(idsOf(y.payload.data)).not.toContain(saleNoBatchId)

      // ...but it must still be visible somewhere: the unfiltered/ALL view.
      const all = await readJson(await salesGET(getRequest(`http://localhost/api/data/sales?tenantId=${tenantId}`)))
      expect(idsOf(all.payload.data)).toEqual(idsOf([{ id: saleXId }, { id: saleYId }, { id: saleNoBatchId }]))
    })
  })

  // ── tasks: direct farm_id column, plus a tenant-level (NULL) task ────────
  describe('GET/POST /api/tasks — farmId is a direct column', () => {
    beforeAll(async () => {
      const x = await readJson(await tasksPOST(postRequest('http://localhost/api/tasks', { tenantId, title: 'Task X', farmId: farmXId })))
      expect(x.status).toBe(201)
      taskXId = x.payload.data.id

      const y = await readJson(await tasksPOST(postRequest('http://localhost/api/tasks', { tenantId, title: 'Task Y', farmId: farmYId })))
      expect(y.status).toBe(201)
      taskYId = y.payload.data.id

      // No farmId at all — a legitimate tenant-level task (e.g. "renew
      // business license"), per POST /api/tasks's documented nullable farmId.
      const t = await readJson(await tasksPOST(postRequest('http://localhost/api/tasks', { tenantId, title: 'Task Tenant' })))
      expect(t.status).toBe(201)
      taskTenantId = t.payload.data.id
    })

    it('POST rejects a farmId from another tenant (404), not silently accepted', async () => {
      const res = await readJson(await tasksPOST(postRequest('http://localhost/api/tasks', { tenantId, title: 'Should fail', farmId: farmOtherId })))
      expect(res.status).toBe(404)
    })

    it('GET filters to each farm\'s own tasks; the tenant-level task shows only under ALL, never under a single farm', async () => {
      const x = await readJson(await tasksGET(getRequest(`http://localhost/api/tasks?tenantId=${tenantId}&farmId=${farmXId}`)))
      expect(idsOf(x.payload.data)).toEqual([taskXId])

      const y = await readJson(await tasksGET(getRequest(`http://localhost/api/tasks?tenantId=${tenantId}&farmId=${farmYId}`)))
      expect(idsOf(y.payload.data)).toEqual([taskYId])

      const all = await readJson(await tasksGET(getRequest(`http://localhost/api/tasks?tenantId=${tenantId}`)))
      expect(idsOf(all.payload.data)).toEqual(idsOf([{ id: taskXId }, { id: taskYId }, { id: taskTenantId }]))
    })
  })

  // ── purchases + inventory lots: direct farm_id columns on BOTH, always
  // set together by lib/inventory.ts's recordPurchase ──────────────────────
  describe('GET/POST /api/purchases and GET /api/inventory/items — farmId is a direct column on both purchases and lots', () => {
    let purchaseXId: string, purchaseYId: string, purchaseLegacyId: string

    beforeAll(async () => {
      const x = await readJson(await purchasesPOST(postRequest('http://localhost/api/purchases', {
        tenantId, supplier: 'Supplier X', itemName: 'Farm Scope Test Feed', unit: 'kg', quantity: 100, unitCostCents: 50, farmId: farmXId,
      })))
      expect(x.status).toBe(201)
      purchaseXId = x.payload.data.purchase.id

      const y = await readJson(await purchasesPOST(postRequest('http://localhost/api/purchases', {
        tenantId, supplier: 'Supplier Y', itemName: 'Farm Scope Test Feed', unit: 'kg', quantity: 50, unitCostCents: 50, farmId: farmYId,
      })))
      expect(y.status).toBe(201)
      purchaseYId = y.payload.data.purchase.id

      // No farmId — simulates a legacy/never-assigned purchase+lot (both
      // stay NULL, per lib/inventory.ts's recordPurchase).
      const legacy = await readJson(await purchasesPOST(postRequest('http://localhost/api/purchases', {
        tenantId, supplier: 'Supplier Legacy', itemName: 'Farm Scope Test Feed', unit: 'kg', quantity: 30, unitCostCents: 50,
      })))
      expect(legacy.status).toBe(201)
      purchaseLegacyId = legacy.payload.data.purchase.id
    })

    it('POST rejects a farmId from another tenant (404)', async () => {
      const res = await readJson(await purchasesPOST(postRequest('http://localhost/api/purchases', {
        tenantId, supplier: 'Should fail', itemName: 'Farm Scope Test Feed', unit: 'kg', quantity: 1, unitCostCents: 50, farmId: farmOtherId,
      })))
      expect(res.status).toBe(404)
    })

    it('GET /api/purchases filters to each farm; ALL includes the legacy NULL-farm purchase too', async () => {
      const x = await readJson(await purchasesGET(getRequest(`http://localhost/api/purchases?tenantId=${tenantId}&farmId=${farmXId}`)))
      expect(idsOf(x.payload.data)).toEqual([purchaseXId])

      const y = await readJson(await purchasesGET(getRequest(`http://localhost/api/purchases?tenantId=${tenantId}&farmId=${farmYId}`)))
      expect(idsOf(y.payload.data)).toEqual([purchaseYId])

      const all = await readJson(await purchasesGET(getRequest(`http://localhost/api/purchases?tenantId=${tenantId}`)))
      expect(idsOf(all.payload.data)).toEqual(idsOf([{ id: purchaseXId }, { id: purchaseYId }, { id: purchaseLegacyId }]))
    })

    it('GET /api/inventory/items filters the LOTS to the farm, not the catalogue item — qtyOnHand differs per farm, and ALL sums every lot including the legacy NULL-farm one', async () => {
      const x = await readJson(await inventoryItemsGET(getRequest(`http://localhost/api/inventory/items?tenantId=${tenantId}&farmId=${farmXId}`)))
      const itemX = x.payload.data.find((i: { name: string }) => i.name === 'Farm Scope Test Feed')
      expect(itemX.qtyOnHand).toBe(100)
      expect(itemX.lots).toHaveLength(1)

      const y = await readJson(await inventoryItemsGET(getRequest(`http://localhost/api/inventory/items?tenantId=${tenantId}&farmId=${farmYId}`)))
      const itemY = y.payload.data.find((i: { name: string }) => i.name === 'Farm Scope Test Feed')
      expect(itemY.qtyOnHand).toBe(50)
      expect(itemY.lots).toHaveLength(1)

      // Same catalogue item appears in BOTH farm views (it's tenant-wide —
      // db/schemas/inventory.ts's whole reason items/lots are split) but
      // with different qtyOnHand each time — the filter is real, not cosmetic.
      expect(itemX.id).toBe(itemY.id)

      const all = await readJson(await inventoryItemsGET(getRequest(`http://localhost/api/inventory/items?tenantId=${tenantId}`)))
      const itemAll = all.payload.data.find((i: { name: string }) => i.name === 'Farm Scope Test Feed')
      expect(itemAll.qtyOnHand).toBe(180) // 100 + 50 + 30 (legacy) — nothing silently dropped
      expect(itemAll.lots).toHaveLength(3)
    })
  })

  // ── employees: direct farm_id column, plus a legacy NULL-farm employee ──
  describe('GET/POST /api/employees — farmId is a direct column', () => {
    it('POST rejects a farmId from another tenant (404)', async () => {
      const res = await readJson(await employeesPOST(postRequest('http://localhost/api/employees', { tenantId, name: 'Should fail', farmId: farmOtherId })))
      expect(res.status).toBe(404)
    })

    it('GET filters to each farm\'s own staff; the legacy NULL-farm employee shows only under ALL', async () => {
      const x = await readJson(await employeesGET(getRequest(`http://localhost/api/employees?tenantId=${tenantId}&farmId=${farmXId}`)))
      expect(idsOf(x.payload.data)).toEqual([empXId])

      const y = await readJson(await employeesGET(getRequest(`http://localhost/api/employees?tenantId=${tenantId}&farmId=${farmYId}`)))
      expect(idsOf(y.payload.data)).toEqual([empYId])

      const all = await readJson(await employeesGET(getRequest(`http://localhost/api/employees?tenantId=${tenantId}`)))
      expect(idsOf(all.payload.data)).toEqual(idsOf([{ id: empXId }, { id: empYId }, { id: empLegacyId }]))
    })
  })

  // ── approval_requests: batch-linked JOIN filter PLUS the documented
  // tenant-level (batchId IS NULL) inclusion rule ──────────────────────────
  describe('GET /api/approvals — farm filter includes tenant-level (batchId IS NULL) approvals in every farm view', () => {
    it('farm X gets its own batch-linked approval plus the tenant-level one; same for farm Y; ALL has all three', async () => {
      const x = await readJson(await approvalsGET(getRequest(`http://localhost/api/approvals?tenantId=${tenantId}&status=pending&farmId=${farmXId}`)))
      expect(idsOf(x.payload.data)).toEqual(idsOf([{ id: approvalXId }, { id: approvalTenantId }]))

      const y = await readJson(await approvalsGET(getRequest(`http://localhost/api/approvals?tenantId=${tenantId}&status=pending&farmId=${farmYId}`)))
      expect(idsOf(y.payload.data)).toEqual(idsOf([{ id: approvalYId }, { id: approvalTenantId }]))

      const all = await readJson(await approvalsGET(getRequest(`http://localhost/api/approvals?tenantId=${tenantId}&status=pending`)))
      expect(idsOf(all.payload.data)).toEqual(idsOf([{ id: approvalXId }, { id: approvalYId }, { id: approvalTenantId }]))
    })

    it('a farmId from another tenant is rejected (404)', async () => {
      const res = await readJson(await approvalsGET(getRequest(`http://localhost/api/approvals?tenantId=${tenantId}&farmId=${farmOtherId}`)))
      expect(res.status).toBe(404)
    })
  })

  // ── dashboard KPIs: the centrepiece — revenue, active batches, and
  // mortality must all differ per farm, and ALL must equal the sum/union ──
  describe('GET /api/dashboard/kpis — farm-scoped metrics genuinely differ per farm', () => {
    it('activeBatches, revenue, and mortalityPct reflect only the selected farm', async () => {
      const x = await readJson(await kpisGET(getRequest(`http://localhost/api/dashboard/kpis?tenantId=${tenantId}&farmId=${farmXId}`)))
      expect(x.payload.data.farmId).toBe(farmXId)
      expect(x.payload.data.activeBatches).toBe(1)
      expect(x.payload.data.revenueCents).toBe(100000)
      expect(x.payload.data.mortalityPct).toBe(20)
      // farm X's own task + the tenant-level task are NOT counted here —
      // activeTasksCount is a direct-column filter, strict equality (see
      // GET /api/dashboard/kpis's header for why this differs from
      // approvals' inclusive rule).
      expect(x.payload.data.activeTasksCount).toBe(1)
      // Both approvalX (this farm's batch) and the tenant-level approval.
      expect(x.payload.data.pendingApprovals).toBe(2)

      const y = await readJson(await kpisGET(getRequest(`http://localhost/api/dashboard/kpis?tenantId=${tenantId}&farmId=${farmYId}`)))
      expect(y.payload.data.activeBatches).toBe(1)
      expect(y.payload.data.revenueCents).toBe(30000)
      expect(y.payload.data.mortalityPct).toBe(10)
      expect(y.payload.data.activeTasksCount).toBe(1)
      expect(y.payload.data.pendingApprovals).toBe(2)

      // Genuinely different results per farm — not just "didn't error".
      expect(x.payload.data.revenueCents).not.toBe(y.payload.data.revenueCents)
      expect(x.payload.data.mortalityPct).not.toBe(y.payload.data.mortalityPct)
    })

    it('ALL (no farmId) equals the sum/union across both farms', async () => {
      const all = await readJson(await kpisGET(getRequest(`http://localhost/api/dashboard/kpis?tenantId=${tenantId}`)))
      expect(all.payload.data.farmId).toBe('ALL')
      expect(all.payload.data.activeBatches).toBe(2)
      // 1000 (X) + 300 (Y) + 50 (the batch-less sale, only visible unfiltered).
      expect(all.payload.data.revenueCents).toBe(135000)
      // Pooled: (20 + 5 deaths) / (100 + 50 initial) = 16.7%.
      expect(all.payload.data.mortalityPct).toBe(16.7)
      // All three tasks (X, Y, and the tenant-level one).
      expect(all.payload.data.activeTasksCount).toBe(3)
      // All three approvals (X, Y, and the tenant-level one).
      expect(all.payload.data.pendingApprovals).toBe(3)
    })

    it('an unfiltered request lists unreadNotifications/productCount/avgFCR as tenant-wide', async () => {
      const res = await readJson(await kpisGET(getRequest(`http://localhost/api/dashboard/kpis?tenantId=${tenantId}&farmId=${farmXId}`)))
      expect(res.payload.data.tenantWideMetrics).toEqual(['unreadNotifications', 'productCount', 'avgFCR'])
    })

    it('a farmId from another tenant is rejected (404), not silently unfiltered', async () => {
      const res = await readJson(await kpisGET(getRequest(`http://localhost/api/dashboard/kpis?tenantId=${tenantId}&farmId=${farmOtherId}`)))
      expect(res.status).toBe(404)
    })
  })
})
