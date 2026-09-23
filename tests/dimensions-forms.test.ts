// ── Forms supply required dimensions (forms-supply-required-dimensions fix,
// P0) ────────────────────────────────────────────────────────────────────
// The refusal itself (lib/dimensions.ts's attachLineDimensions: a posting
// that would leave a REQUIRED account dimension empty is rolled back,
// naming the account and the dimension) has always been correct — PR #426.
// The bug this file is the regression test for is the OTHER half: once an
// owner marked one account dimension Required, the sale/purchase/payroll
// forms had no way to comply — no derivation from what the transaction
// already knows, and no field anywhere to supply the rest — so that farm
// could no longer record money at all, through any form.
//
// Covers, through the real HTTP routes (not just the lib functions):
//   1. A sale against a batch satisfies a required Production Unit (UNIT)
//      automatically — the batch's own unit, via the batch -> unit -> farm
//      chain lib/dimensions.ts's masterChain already walks.
//   2. An ad-hoc sale (no batch) cannot derive UNIT and is correctly
//      refused — then succeeds once the caller supplies it explicitly
//      (what the new picker in components/farm/finance.tsx sends).
//   3. A purchase satisfies a required Farm automatically once a farm is
//      chosen, but can NEVER derive Production Unit (a purchase carries no
//      unit in this schema) — refused, then succeeds via the explicit
//      `dimensions` field.
//   4. POST /api/payroll/runs's dryRun preview now reports the one farm
//      every eligible employee shares (or null) — what the Run Payroll
//      sheet needs to preview/ask before confirming — and the real POST now
//      accepts the same explicit `dimensions` field the sale/purchase
//      routes do, so a run can satisfy a requirement the shared farm alone
//      can't cover.
//   5. Existing postings with no required dimensions are unaffected.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { and, eq, inArray } from 'drizzle-orm'

vi.mock('server-only', () => ({}))

let mockCookie: string | undefined
vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({ get: () => (mockCookie ? { value: mockCookie } : undefined) })),
}))

import { POST as salesPOST } from '@/app/api/data/sales/route'
import { POST as purchasesPOST } from '@/app/api/purchases/route'
import { POST as payrollRunsPOST } from '@/app/api/payroll/runs/route'
import { GET as unitsGET } from '@/app/api/units/route'
import { GET as batchesGET } from '@/app/api/batches/route'
import { db } from '@/db'
import {
  tenants, users, sessions, farms, productionUnits, batches, employees,
  accounts, dimensions, dimensionLevels, dimensionValues, defaultDimensions, documentDimensions,
  sales, purchases, inventoryItems, inventoryLots,
  journalEntries, journalLines, journalLineDimensions, payrollRuns, payslips,
} from '@/db/schemas'
import { createSession, hashSecret } from '@/lib/auth'
import { ensureSystemDimensions, projectFarm, projectUnit, projectBatch, SYSTEM_DIMENSION_CODES } from '@/lib/dimensions'
import { ensureAccountsSeeded, ACCOUNT_CODES } from '@/lib/finance'

const hasDb = !!process.env.DATABASE_URL
const run = hasDb ? describe : describe.skip
const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')

function jsonRequest(url: string, method: string, body?: unknown): Request {
  return new Request(url, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
}
async function readJson(res: Response) {
  return { status: res.status, payload: await res.json() }
}

async function makeTenantWithOwner(name: string): Promise<{ tenantId: string; ownerId: string; cookie: string }> {
  const tenantId = `t-dimforms-${randomUUID()}`
  await db.insert(tenants).values({ id: tenantId, name, active: true })
  const ownerId = `usr-${randomUUID()}`
  const salt = randomUUID()
  await db.insert(users).values({
    id: ownerId, tenantId, name: 'Owner', email: `dimforms-${randomUUID()}@test.ifms`, role: 'owner',
    passwordHash: hashSecret('pw', salt), passwordSalt: salt, status: 'ACTIVE',
  })
  const cookie = await createSession(ownerId)
  return { tenantId, ownerId, cookie }
}

async function cleanupTenant(tenantId: string) {
  if (mockCookie !== undefined) mockCookie = undefined

  const entryRows = await db.select({ id: journalEntries.id }).from(journalEntries).where(eq(journalEntries.tenantId, tenantId))
  const entryIds = entryRows.map((r) => r.id)
  const lineRows = entryIds.length > 0
    ? await db.select({ id: journalLines.id }).from(journalLines).where(inArray(journalLines.entryId, entryIds))
    : []
  const lineIds = lineRows.map((l) => l.id)
  if (lineIds.length > 0) await db.delete(journalLineDimensions).where(inArray(journalLineDimensions.lineId, lineIds))

  const dimRows = await db.select({ id: dimensions.id }).from(dimensions).where(eq(dimensions.tenantId, tenantId))
  const dimIds = dimRows.map((d) => d.id)
  await db.delete(defaultDimensions).where(eq(defaultDimensions.tenantId, tenantId))
  await db.delete(documentDimensions).where(eq(documentDimensions.tenantId, tenantId))
  if (dimIds.length > 0) {
    const valueRows = await db.select({ id: dimensionValues.id }).from(dimensionValues).where(inArray(dimensionValues.dimensionId, dimIds))
    const valueIds = valueRows.map((v) => v.id)
    if (valueIds.length > 0) {
      await db.delete(journalLineDimensions).where(inArray(journalLineDimensions.valueId, valueIds))
      await db.delete(documentDimensions).where(inArray(documentDimensions.valueId, valueIds))
    }
    await db.delete(dimensionLevels).where(inArray(dimensionLevels.dimensionId, dimIds))
    await db.delete(dimensionValues).where(inArray(dimensionValues.dimensionId, dimIds))
  }
  await db.delete(dimensions).where(eq(dimensions.tenantId, tenantId))
  if (lineIds.length > 0) await db.delete(journalLines).where(inArray(journalLines.id, lineIds))
  await db.delete(journalEntries).where(eq(journalEntries.tenantId, tenantId))

  await db.delete(payslips).where(inArray(payslips.runId,
    (await db.select({ id: payrollRuns.id }).from(payrollRuns).where(eq(payrollRuns.tenantId, tenantId))).map((r) => r.id)))
  await db.delete(payrollRuns).where(eq(payrollRuns.tenantId, tenantId))
  await db.delete(employees).where(eq(employees.tenantId, tenantId))

  await db.delete(sales).where(eq(sales.tenantId, tenantId))
  await db.delete(purchases).where(eq(purchases.tenantId, tenantId))
  await db.delete(inventoryLots).where(eq(inventoryLots.tenantId, tenantId))
  await db.delete(inventoryItems).where(eq(inventoryItems.tenantId, tenantId))
  await db.delete(batches).where(eq(batches.tenantId, tenantId))
  await db.delete(productionUnits).where(eq(productionUnits.tenantId, tenantId))
  await db.delete(farms).where(eq(farms.tenantId, tenantId))

  const userRows = await db.select({ id: users.id }).from(users).where(eq(users.tenantId, tenantId))
  const userIds = userRows.map((u) => u.id)
  if (userIds.length > 0) await db.delete(sessions).where(inArray(sessions.userId, userIds))
  await db.delete(users).where(eq(users.tenantId, tenantId))
  await db.delete(tenants).where(eq(tenants.id, tenantId))
}

run('forms supply required dimensions (P0 fix)', () => {
  describe('sale: the batch\'s own unit satisfies a required Production Unit automatically', () => {
    let tenantId: string; let cookie: string
    let farmId: string; let unitId: string; let batchId: string; let unitCode: string
    let cashAccountId: string

    beforeAll(async () => {
      ({ tenantId, cookie } = await makeTenantWithOwner('DimForms Sale'))
      await ensureAccountsSeeded()
      const idByCode = await ensureSystemDimensions(tenantId)
      const unitDimId = idByCode.get(SYSTEM_DIMENSION_CODES.UNIT)!
      cashAccountId = (await db.select().from(accounts).where(eq(accounts.code, ACCOUNT_CODES.CASH)))[0].id

      farmId = `f-${randomUUID()}`
      unitId = `u-${randomUUID()}`
      batchId = `b-${randomUUID()}`
      unitCode = `UNT-SALE-${randomUUID().slice(0, 8)}`
      await db.insert(farms).values({ id: farmId, tenantId, name: 'Sale Farm', code: `FRM-SALE-${randomUUID().slice(0, 8)}` })
      await projectFarm(db, tenantId, { id: farmId, code: `FRM-SALE-${randomUUID().slice(0, 8)}`, name: 'Sale Farm' })
      await db.insert(productionUnits).values({ id: unitId, tenantId, farmId, type: 'poultry', name: 'Sale Unit', code: unitCode })
      await projectUnit(db, tenantId, { id: unitId, code: unitCode, name: 'Sale Unit' })
      await db.insert(batches).values({ id: batchId, tenantId, unitId, name: 'Sale Batch', code: `BAT-SALE-${randomUUID().slice(0, 8)}`, enterprise: 'broiler', status: 'ACTIVE', initialQty: 100, currentQty: 100 })
      await projectBatch(db, tenantId, { id: batchId, code: `BAT-SALE-${randomUUID().slice(0, 8)}`, name: 'Sale Batch', enterprise: 'broiler' })

      // The owner's exact reported scenario: Cash requires Production Unit.
      await db.insert(defaultDimensions).values({
        id: randomUUID(), tenantId, masterType: 'account', masterId: cashAccountId,
        dimensionId: unitDimId, dimensionValueId: null, requirement: 'required',
      })
    })
    afterAll(async () => { await cleanupTenant(tenantId) })

    it('posts automatically when the sale is against the batch — UNIT derives via batch -> unit', async () => {
      mockCookie = cookie
      const res = await readJson(await salesPOST(jsonRequest('http://x/api/data/sales', 'POST', {
        tenantId, item: 'Broilers x 10', amountCents: 200000, method: 'Cash', status: 'paid', batchId,
      })))
      mockCookie = undefined
      expect(res.status).toBe(201)

      const [entry] = await db.select().from(journalEntries).where(eq(journalEntries.sourceId, res.payload.data.id))
      const lines = await db.select().from(journalLines).where(eq(journalLines.entryId, entry.id))
      const cashLine = lines.find((l) => l.accountId === cashAccountId)!
      const lineDims = await db.select().from(journalLineDimensions).where(eq(journalLineDimensions.lineId, cashLine.id))
      const idByCode = await ensureSystemDimensions(tenantId)
      const unitDimId = idByCode.get(SYSTEM_DIMENSION_CODES.UNIT)!
      const unitDim = lineDims.find((d) => d.dimensionId === unitDimId)
      expect(unitDim).toBeTruthy()
      const [unitValue] = await db.select().from(dimensionValues).where(eq(dimensionValues.id, unitDim!.valueId))
      expect(unitValue.sourceId).toBe(unitId)
    })

    it('an ad-hoc sale with no batch cannot derive Production Unit and is refused, naming it', async () => {
      mockCookie = cookie
      const res = await readJson(await salesPOST(jsonRequest('http://x/api/data/sales', 'POST', {
        tenantId, item: 'Loose eggs, no batch', amountCents: 30000, method: 'Cash', status: 'paid',
      })))
      mockCookie = undefined
      expect(res.status).toBe(400)
      expect(res.payload.error).toMatch(/requires a value for/i)
      expect(res.payload.error).toMatch(/Production Unit/)

      const saleRows = await db.select().from(sales).where(eq(sales.tenantId, tenantId))
      expect(saleRows.find((s) => s.item === 'Loose eggs, no batch')).toBeUndefined()
    })

    it('the same ad-hoc sale succeeds once Production Unit is supplied explicitly (the new picker)', async () => {
      mockCookie = cookie
      const res = await readJson(await salesPOST(jsonRequest('http://x/api/data/sales', 'POST', {
        tenantId, item: 'Loose eggs, picked unit', amountCents: 30000, method: 'Cash', status: 'paid',
        dimensions: { [SYSTEM_DIMENSION_CODES.UNIT]: unitCode },
      })))
      mockCookie = undefined
      expect(res.status).toBe(201)
    })
  })

  describe('purchase: Farm derives from the chosen farm; Production Unit never can and needs the picker', () => {
    let tenantId: string; let cookie: string
    let farmId: string; let unitId: string; let unitCode: string
    let expenseAccountId: string

    beforeAll(async () => {
      ({ tenantId, cookie } = await makeTenantWithOwner('DimForms Purchase'))
      await ensureAccountsSeeded()
      const idByCode = await ensureSystemDimensions(tenantId)
      const unitDimId = idByCode.get(SYSTEM_DIMENSION_CODES.UNIT)!
      expenseAccountId = (await db.select().from(accounts).where(eq(accounts.code, ACCOUNT_CODES.PURCHASES_EXPENSE)))[0].id

      farmId = `f-${randomUUID()}`
      unitId = `u-${randomUUID()}`
      unitCode = `UNT-PUR-${randomUUID().slice(0, 8)}`
      const farmCode = `FRM-PUR-${randomUUID().slice(0, 8)}`
      await db.insert(farms).values({ id: farmId, tenantId, name: 'Purchase Farm', code: farmCode })
      await projectFarm(db, tenantId, { id: farmId, code: farmCode, name: 'Purchase Farm' })
      await db.insert(productionUnits).values({ id: unitId, tenantId, farmId, type: 'poultry', name: 'Purchase Unit', code: unitCode })
      await projectUnit(db, tenantId, { id: unitId, code: unitCode, name: 'Purchase Unit' })

      // Purchases Expense requires Production Unit — a dimension a purchase
      // (farm-only in this schema) can never derive on its own.
      await db.insert(defaultDimensions).values({
        id: randomUUID(), tenantId, masterType: 'account', masterId: expenseAccountId,
        dimensionId: unitDimId, dimensionValueId: null, requirement: 'required',
      })
    })
    afterAll(async () => { await cleanupTenant(tenantId) })

    it('a purchase against the chosen farm is refused for Production Unit — Farm alone cannot cover it', async () => {
      mockCookie = cookie
      const res = await readJson(await purchasesPOST(jsonRequest('http://x/api/purchases', 'POST', {
        tenantId, supplier: 'Agro', itemName: `Feed ${randomUUID()}`, unit: 'kg', quantity: 5, unitCostCents: 10000, farmId,
      })))
      mockCookie = undefined
      expect(res.status).toBe(400)
      expect(res.payload.error).toMatch(/requires a value for/i)
      expect(res.payload.error).toMatch(/Production Unit/)
    })

    it('the same purchase succeeds once Production Unit is supplied explicitly (the new picker)', async () => {
      mockCookie = cookie
      const res = await readJson(await purchasesPOST(jsonRequest('http://x/api/purchases', 'POST', {
        tenantId, supplier: 'Agro', itemName: `Feed ${randomUUID()}`, unit: 'kg', quantity: 5, unitCostCents: 10000, farmId,
        dimensions: { [SYSTEM_DIMENSION_CODES.UNIT]: unitCode },
      })))
      mockCookie = undefined
      expect(res.status).toBe(201)

      const purchaseId = (res.payload.data as { purchase?: { id?: string } }).purchase?.id
      expect(purchaseId).toBeTruthy()
      const [entry] = await db.select().from(journalEntries).where(eq(journalEntries.sourceId, purchaseId as string))
      const lines = await db.select().from(journalLines).where(eq(journalLines.entryId, entry.id))
      const expenseLine = lines.find((l) => l.accountId === expenseAccountId)!
      const lineDims = await db.select().from(journalLineDimensions).where(eq(journalLineDimensions.lineId, expenseLine.id))
      const idByCode = await ensureSystemDimensions(tenantId)
      const unitDimId = idByCode.get(SYSTEM_DIMENSION_CODES.UNIT)!
      expect(lineDims.find((d) => d.dimensionId === unitDimId)).toBeTruthy()
    })
  })

  describe('payroll: dryRun previews the derivable farm; the real run can now supply the rest', () => {
    let tenantId: string; let cookie: string
    let sharedFarmId: string; let otherFarmId: string
    let empSharedAId: string; let empSharedBId: string; let empOtherId: string
    let payrollExpenseAccountId: string

    beforeAll(async () => {
      ({ tenantId, cookie } = await makeTenantWithOwner('DimForms Payroll'))
      await ensureAccountsSeeded()
      payrollExpenseAccountId = (await db.select().from(accounts).where(eq(accounts.code, ACCOUNT_CODES.PAYROLL_EXPENSE)))[0].id

      sharedFarmId = `f-${randomUUID()}`
      otherFarmId = `f-${randomUUID()}`
      await db.insert(farms).values([
        { id: sharedFarmId, tenantId, name: 'Shared Farm', code: `FRM-PAY-A-${randomUUID().slice(0, 6)}` },
        { id: otherFarmId, tenantId, name: 'Other Farm', code: `FRM-PAY-B-${randomUUID().slice(0, 6)}` },
      ])
      await projectFarm(db, tenantId, { id: sharedFarmId, code: `FRM-PAY-A-${randomUUID().slice(0, 6)}`, name: 'Shared Farm' })
      await projectFarm(db, tenantId, { id: otherFarmId, code: `FRM-PAY-B-${randomUUID().slice(0, 6)}`, name: 'Other Farm' })

      empSharedAId = randomUUID(); empSharedBId = randomUUID(); empOtherId = randomUUID()
      await db.insert(employees).values([
        { id: empSharedAId, tenantId, userId: null, name: 'Shared A', phone: '', role: 'worker', monthlySalaryCents: 1000000, status: 'ACTIVE', farmId: sharedFarmId },
        { id: empSharedBId, tenantId, userId: null, name: 'Shared B', phone: '', role: 'worker', monthlySalaryCents: 1500000, status: 'ACTIVE', farmId: sharedFarmId },
        { id: empOtherId, tenantId, userId: null, name: 'Other', phone: '', role: 'worker', monthlySalaryCents: 2000000, status: 'ACTIVE', farmId: otherFarmId },
      ])
    })
    afterAll(async () => { await cleanupTenant(tenantId) })

    it('dryRun reports the shared farm when every eligible employee is on the same one', async () => {
      mockCookie = cookie
      const res = await readJson(await payrollRunsPOST(jsonRequest('http://x/api/payroll/runs', 'POST', {
        tenantId, periodStart: '2026-01-01', periodEnd: '2026-01-31', dryRun: true,
      })))
      mockCookie = undefined
      // This period's eligible set is all three employees (two farms) unless
      // scoped — assert against the actual eligible set the route computed.
      expect(res.status).toBe(200)
      expect(res.payload.data.farmId).toBe(null) // Shared + Other together: no single shared farm.
    })

    it('a run posts automatically once Farm is required and every eligible employee actually shares one', async () => {
      // Isolate to the two shared-farm employees only, by disabling the
      // other-farm employee for this period's run.
      await db.update(employees).set({ status: 'INACTIVE' }).where(eq(employees.id, empOtherId))

      const idByCode = await ensureSystemDimensions(tenantId)
      const farmDimId = idByCode.get(SYSTEM_DIMENSION_CODES.FARM)!
      await db.insert(defaultDimensions).values({
        id: randomUUID(), tenantId, masterType: 'account', masterId: payrollExpenseAccountId,
        dimensionId: farmDimId, dimensionValueId: null, requirement: 'required',
      })

      mockCookie = cookie
      const preview = await readJson(await payrollRunsPOST(jsonRequest('http://x/api/payroll/runs', 'POST', {
        tenantId, periodStart: '2026-02-01', periodEnd: '2026-02-28', dryRun: true,
      })))
      expect(preview.payload.data.farmId).toBe(sharedFarmId)

      const res = await readJson(await payrollRunsPOST(jsonRequest('http://x/api/payroll/runs', 'POST', {
        tenantId, periodStart: '2026-02-01', periodEnd: '2026-02-28',
      })))
      mockCookie = undefined
      expect(res.status).toBe(201)

      const [entry] = await db.select().from(journalEntries).where(eq(journalEntries.sourceId, res.payload.data.run.id))
      const lines = await db.select().from(journalLines).where(eq(journalLines.entryId, entry.id))
      const expenseLine = lines.find((l) => l.accountId === payrollExpenseAccountId)!
      const lineDims = await db.select().from(journalLineDimensions).where(eq(journalLineDimensions.lineId, expenseLine.id))
      expect(lineDims.find((d) => d.dimensionId === farmDimId)).toBeTruthy()

      await db.delete(defaultDimensions).where(and(eq(defaultDimensions.tenantId, tenantId), eq(defaultDimensions.masterId, payrollExpenseAccountId)))
      await db.update(employees).set({ status: 'ACTIVE' }).where(eq(employees.id, empOtherId))
    })

    it('a run spanning two farms is refused when Farm is required, then succeeds once supplied explicitly', async () => {
      const idByCode = await ensureSystemDimensions(tenantId)
      const farmDimId = idByCode.get(SYSTEM_DIMENSION_CODES.FARM)!
      await db.insert(defaultDimensions).values({
        id: randomUUID(), tenantId, masterType: 'account', masterId: payrollExpenseAccountId,
        dimensionId: farmDimId, dimensionValueId: null, requirement: 'required',
      })

      mockCookie = cookie
      const refused = await readJson(await payrollRunsPOST(jsonRequest('http://x/api/payroll/runs', 'POST', {
        tenantId, periodStart: '2026-03-01', periodEnd: '2026-03-31',
      })))
      expect(refused.status).toBe(400)
      expect(refused.payload.error).toMatch(/requires a value for/i)
      expect(refused.payload.error).toMatch(/Farm/)

      const [sharedFarmValue] = await db.select().from(dimensionValues).where(eq(dimensionValues.sourceId, sharedFarmId))
      const res = await readJson(await payrollRunsPOST(jsonRequest('http://x/api/payroll/runs', 'POST', {
        tenantId, periodStart: '2026-03-01', periodEnd: '2026-03-31',
        dimensions: { [SYSTEM_DIMENSION_CODES.FARM]: sharedFarmValue.code },
      })))
      mockCookie = undefined
      expect(res.status).toBe(201)

      await db.delete(defaultDimensions).where(and(eq(defaultDimensions.tenantId, tenantId), eq(defaultDimensions.masterId, payrollExpenseAccountId)))
    })
  })

  describe('cascade integrity: the data the Farm -> Unit -> Batch picker relies on never mixes parents', () => {
    // The picker itself (components/farm/ui-shared.tsx's
    // FarmUnitBatchDimensionFields) is a client component with no render
    // harness in this repo (see the source-level describe block below, same
    // convention as tests/dimension-policy-enforcement.test.ts) — but its
    // whole safety property rests on these two routes actually scoping by
    // parent, which IS testable end to end: GET /api/units?farmId= must
    // never return another farm's units, and GET /api/batches?unitId= must
    // never return another unit's batches. If either leaked, the picker
    // would offer exactly the mismatched child the fix exists to prevent.
    let tenantId: string; let cookie: string
    let farmAId: string; let farmBId: string
    let unitAId: string; let unitBId: string
    let batchAId: string; let batchBId: string

    beforeAll(async () => {
      ({ tenantId, cookie } = await makeTenantWithOwner('DimForms Cascade'))
      farmAId = `f-${randomUUID()}`; farmBId = `f-${randomUUID()}`
      unitAId = `u-${randomUUID()}`; unitBId = `u-${randomUUID()}`
      batchAId = `b-${randomUUID()}`; batchBId = `b-${randomUUID()}`
      await db.insert(farms).values([
        { id: farmAId, tenantId, name: 'Farm A', code: `FRM-CASC-A-${randomUUID().slice(0, 6)}` },
        { id: farmBId, tenantId, name: 'Farm B', code: `FRM-CASC-B-${randomUUID().slice(0, 6)}` },
      ])
      await db.insert(productionUnits).values([
        { id: unitAId, tenantId, farmId: farmAId, type: 'poultry', name: 'Unit A', code: `UNT-CASC-A-${randomUUID().slice(0, 6)}` },
        { id: unitBId, tenantId, farmId: farmBId, type: 'poultry', name: 'Unit B', code: `UNT-CASC-B-${randomUUID().slice(0, 6)}` },
      ])
      await db.insert(batches).values([
        { id: batchAId, tenantId, unitId: unitAId, name: 'Batch A', code: `BAT-CASC-A-${randomUUID().slice(0, 6)}`, enterprise: 'broiler', status: 'ACTIVE', initialQty: 50, currentQty: 50 },
        { id: batchBId, tenantId, unitId: unitBId, name: 'Batch B', code: `BAT-CASC-B-${randomUUID().slice(0, 6)}`, enterprise: 'broiler', status: 'ACTIVE', initialQty: 50, currentQty: 50 },
      ])
    })
    afterAll(async () => { await cleanupTenant(tenantId) })

    it('the unit list for farm A never contains farm B\'s units', async () => {
      mockCookie = cookie
      const res = await readJson(await unitsGET(new Request(`http://x/api/units?tenantId=${tenantId}&farmId=${farmAId}`)))
      mockCookie = undefined
      expect(res.status).toBe(200)
      const ids = res.payload.data.map((u: { id: string }) => u.id)
      expect(ids).toContain(unitAId)
      expect(ids).not.toContain(unitBId)
    })

    it('the batch list for unit A never contains unit B\'s batches', async () => {
      mockCookie = cookie
      const res = await readJson(await batchesGET(new Request(`http://x/api/batches?tenantId=${tenantId}&unitId=${unitAId}`)))
      mockCookie = undefined
      expect(res.status).toBe(200)
      const ids = res.payload.data.map((b: { id: string }) => b.id)
      expect(ids).toContain(batchAId)
      expect(ids).not.toContain(batchBId)
    })

    it('the batch list scoped by farm A alone (no unit chosen yet) still excludes farm B\'s batches', async () => {
      mockCookie = cookie
      const res = await readJson(await batchesGET(new Request(`http://x/api/batches?tenantId=${tenantId}&farmId=${farmAId}`)))
      mockCookie = undefined
      expect(res.status).toBe(200)
      const ids = res.payload.data.map((b: { id: string }) => b.id)
      expect(ids).toContain(batchAId)
      expect(ids).not.toContain(batchBId)
    })
  })

  describe('unaffected: every existing posting with no required dimensions still saves', () => {
    let tenantId: string; let cookie: string
    beforeAll(async () => { ({ tenantId, cookie } = await makeTenantWithOwner('DimForms Unaffected')); await ensureAccountsSeeded() })
    afterAll(async () => { await cleanupTenant(tenantId) })

    it('a plain sale and purchase save with zero dimension rules configured', async () => {
      mockCookie = cookie
      const sale = await readJson(await salesPOST(jsonRequest('http://x/api/data/sales', 'POST', {
        tenantId, item: 'Ad hoc eggs', amountCents: 50000, method: 'Cash',
      })))
      expect(sale.status).toBe(201)
      const purchase = await readJson(await purchasesPOST(jsonRequest('http://x/api/purchases', 'POST', {
        tenantId, supplier: 'Agro', itemName: `Feed ${randomUUID()}`, unit: 'kg', quantity: 5, unitCostCents: 10000,
      })))
      mockCookie = undefined
      expect(purchase.status).toBe(201)
    })
  })
})

describe('the sheets can now COMPLY, not just detect the refusal (source-level, UI)', () => {
  const shared = read('components/farm/ui-shared.tsx')
  const finance = read('components/farm/finance.tsx')
  const inventory = read('components/farm/inventory.tsx')

  it('ui-shared.tsx exports the required-dimensions preview hook and picker', () => {
    expect(shared).toMatch(/export function useRequiredDimensions\(/)
    expect(shared).toMatch(/export function RequiredDimensionFields\(/)
    expect(shared).toMatch(/export function missingDimensionErrors\(/)
    expect(shared).toMatch(/export function dimensionsForSubmit\(/)
    // Preview calls the exact same endpoint the real post is checked against.
    expect(shared).toMatch(/apiClient\.post<ResolvePreviewResponse>\('\/api\/dimensions\/resolve'/)
  })

  it('Record Sale, both Record Purchase sheets, and Run Payroll all wire the picker and send `dimensions`', () => {
    for (const src of [finance, inventory]) {
      expect(src).toMatch(/useRequiredDimensions\(/)
      expect(src).toMatch(/<RequiredDimensionFields/)
      expect(src).toMatch(/dimensions: dimensionsForSubmit\(requiredDims, dimPicks\)/)
    }
    // Both of Finance's posting sheets (sale + purchase) use it, not just one
    // — plus Run Payroll, which has its own gate on the confirm button.
    const financeMatches = finance.match(/<RequiredDimensionFields/g) ?? []
    expect(financeMatches.length).toBeGreaterThanOrEqual(3)
  })

  // ── Cascade / fill-upward / search reuse (owner review of PR #431) ───────
  it('Farm/Unit/Batch route through ONE cascading picker, not three independent flat selects', () => {
    expect(shared).toMatch(/function FarmUnitBatchDimensionFields\(/)
    // RequiredDimensionFields hands FARM/UNIT/BATCH to it, keeping every
    // other dimension (ENTERPRISE, a tenant's own) on the flat picker.
    expect(shared).toMatch(/HIERARCHICAL_CODES = new Set\(\['FARM', 'UNIT', 'BATCH'\]\)/)
    expect(shared).toMatch(/<FarmUnitBatchDimensionFields/)
  })

  it('picking a batch fills in its unit and farm — never left for the user to also pick', () => {
    // selectBatch resolves the batch's own unit, then that unit's own farm,
    // and hands BOTH to onPick without any picker action for either.
    const start = shared.indexOf('function selectBatch(')
    expect(start).toBeGreaterThan(-1)
    const selectBatchBody = shared.slice(start, shared.indexOf('const unitOptions =', start))
    expect(selectBatchBody).toMatch(/onPick\('UNIT', unit\.code\)/)
    expect(selectBatchBody).toMatch(/onPick\('FARM', farm\?\.code/)
    // And the resolved values are SHOWN, not silently applied.
    expect(shared).toMatch(/function ResolvedDimensionRow\(/)
  })

  it('choosing a farm narrows the unit list, and a unit change clears a now-stale batch', () => {
    expect(shared).toMatch(/const unitOptions = farmId \? units\.filter\(\(u\) => u\.farmId === farmId\) : units/)
    expect(shared).toMatch(/onPick\('BATCH', ''\)/) // cleared on both a farm and a unit change
  })

  it('the cascade is searchable by reusing MasterPicker, not a third picker widget', () => {
    expect(shared).toMatch(/function CodeSearchPicker\(/)
    expect(shared).toMatch(/<MasterPicker/)
    // Generalised once (onCreate/creating now optional) rather than forked.
    expect(shared).toMatch(/onCreate\?: \(\) => void;/)
  })

  it('a purchase (and Run Payroll, once a shared farm is known) tells the picker not to ask for Farm again', () => {
    expect(finance).toMatch(/knownFarmId=\{farmId\}/) // RecordPurchaseSheet
    expect(finance).toMatch(/knownFarmId=\{preview\.farmId \?\? undefined\}/) // RunPayrollSheet
    expect(inventory).toMatch(/knownFarmId=\{farmId\}/)
  })
})
