// ── Reports backend tests (issue #263) ──────────────────────────────────────
// Integration tests that call the real route handlers against the real
// postgres when DATABASE_URL is set (local/dev); CI has no database, so the
// suite skips there — same pattern as tests/finance.test.ts / tests/people-worker.test.ts.
//
// Covers the issue's Definition of Done: each of the 4 real report types
// (P&L, Batch P&L, Mortality, Feed Consumption) returns real data for a
// seeded tenant, correctly filtered by `from`/`to` date range.
//
// Vet/auditor screens task: these 4 routes gained a role gate + session-only
// tenant resolution (see lib/reports.ts's REPORT_VIEWER_ROLES and each
// route's header) — every read below now goes through a real owner session
// instead of the old session-less `?tenantId=` fallback. tests/role-screens.test.ts
// covers the new 401/403 behaviour (unauthenticated, auditor, cross-tenant);
// this file keeps its original focus on report content correctness.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { inArray, eq } from 'drizzle-orm'

vi.mock('server-only', () => ({}))

let mockCookie: string | undefined
vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({ get: () => (mockCookie ? { value: mockCookie } : undefined) })),
}))

import { GET as plGET } from '@/app/api/reports/pl/route'
import { GET as batchPlGET } from '@/app/api/reports/batch-pl/route'
import { GET as mortalityGET } from '@/app/api/reports/mortality/route'
import { GET as feedGET } from '@/app/api/reports/feed-consumption/route'
import { POST as salesPOST } from '@/app/api/data/sales/route'
import { POST as purchasesPOST } from '@/app/api/purchases/route'
import { POST as recordsPOST } from '@/app/api/records/route'
import { db } from '@/db'
import {
  tenants,
  users,
  sessions,
  farms,
  productionUnits,
  batches,
  employees,
  records,
  sales,
  purchases,
  journalEntries,
  journalLines,
  inventoryItems,
  inventoryLots,
} from '@/db/schemas'
import { createSession, hashSecret } from '@/lib/auth'

const hasDb = !!process.env.DATABASE_URL
const run = hasDb ? describe : describe.skip

function getRequest(url: string): Request {
  return new Request(url)
}

function postRequest(url: string, body: unknown): Request {
  return new Request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

async function readJson(res: Response) {
  return { status: res.status, payload: await res.json() }
}

run('reports: P&L, Batch P&L, Mortality, Feed Consumption (issue #263)', () => {
  const tenantId = `t-rep-${randomUUID()}`
  const farmId = `f-rep-${randomUUID()}`
  const unitId = `u-rep-${randomUUID()}`
  const batchAId = `b-rep-${randomUUID()}`
  const batchBId = `b-rep-${randomUUID()}`
  const employeeId = `e-rep-${randomUUID()}`
  const ownerId = randomUUID()
  const ownerEmail = `reports-owner-${randomUUID()}@test.ifms`
  let ownerSessionToken: string

  // Two dates: one inside the query window, one outside it.
  const inRange = new Date('2026-08-10T10:00:00Z')
  const outOfRange = new Date('2026-06-01T10:00:00Z')

  beforeAll(async () => {
    await db.insert(tenants).values({ id: tenantId, name: 'Reports Test Co.', active: true })
    const ownerSalt = `salt-${randomUUID()}`
    await db.insert(users).values({
      id: ownerId, tenantId, name: 'Reports Owner', email: ownerEmail,
      role: 'owner', passwordHash: hashSecret('irrelevant', ownerSalt), passwordSalt: ownerSalt, status: 'ACTIVE',
    })
    ownerSessionToken = await createSession(ownerId)
    // Every report read below authenticates as this tenant's owner — the
    // routes are now session-only for tenant resolution (see each route's
    // header comment) and role-gated (lib/reports.ts's REPORT_VIEWER_ROLES).
    mockCookie = ownerSessionToken
    await db.insert(farms).values({ id: farmId, tenantId, name: 'Farm R', location: 'Kiambu', code: 'FRM-KMB-001' })
    await db.insert(productionUnits).values({ id: unitId, tenantId, farmId, type: 'house', name: 'House R01', code: 'HSE-KMB-R01' })
    await db.insert(batches).values([
      { id: batchAId, tenantId, unitId, code: 'BRO-KMB-001', name: 'Broilers Aug Run', enterprise: 'broiler', acquisitionCostCents: 500000 },
      { id: batchBId, tenantId, unitId, code: 'BRO-KMB-002', name: 'Broilers Sep Run', enterprise: 'broiler', acquisitionCostCents: 200000 },
    ])
    await db.insert(employees).values({ id: employeeId, tenantId, name: 'Test Worker' })

    // Sales: one paid sale in range (attached to batch A), one out of range.
    await salesPOST(
      postRequest('http://localhost/api/data/sales', {
        tenantId, batchId: batchAId, item: 'Broilers x 50 birds', amountCents: 8000000, status: 'paid', soldAt: inRange.toISOString(),
      })
    )
    await salesPOST(
      postRequest('http://localhost/api/data/sales', {
        tenantId, batchId: batchAId, item: 'Broilers x 20 birds (old)', amountCents: 3000000, status: 'paid', soldAt: outOfRange.toISOString(),
      })
    )

    // Purchases: totalCostCents is in cents, no batch link (see purchases schema).
    // POST /api/purchases upserts the item by tenant+name via lib/inventory.ts's
    // recordPurchase (no itemId in the request body).
    await purchasesPOST(
      postRequest('http://localhost/api/purchases', {
        tenantId, supplier: 'Unga Ltd', itemName: 'Broiler Starter Mash', unit: 'kg',
        quantity: 100, unitCostCents: 100, totalCostCents: 10000, amountPaidCents: 10000,
      })
    )

    // Mortality + feeding records — createdAt defaults to now, so both land
    // "in range" relative to a wide from/to window used for the date-filter
    // assertions below; the narrow-window assertions use a from/to that
    // brackets "now".
    await recordsPOST(
      postRequest('http://localhost/api/records', {
        tenantId, batchId: batchAId, employeeId, type: 'mortality', data: { count: 4, cause: 'Heat stress' },
      })
    )
    await recordsPOST(
      postRequest('http://localhost/api/records', {
        tenantId, batchId: batchBId, employeeId, type: 'mortality', data: { count: 1, cause: 'Unknown' },
      })
    )
    await recordsPOST(
      postRequest('http://localhost/api/records', {
        tenantId, batchId: batchAId, employeeId, type: 'feeding',
        data: { feedItems: [{ item: 'Starter Mash', qtyKg: 25 }, { item: 'Grower Mash', qtyKg: 10 }] },
      })
    )
  })

  afterAll(async () => {
    const entryIds = (await db.select({ id: journalEntries.id }).from(journalEntries).where(eq(journalEntries.tenantId, tenantId))).map((e) => e.id)
    if (entryIds.length > 0) await db.delete(journalLines).where(inArray(journalLines.entryId, entryIds))
    await db.delete(journalEntries).where(eq(journalEntries.tenantId, tenantId))
    await db.delete(sales).where(eq(sales.tenantId, tenantId))
    await db.delete(purchases).where(eq(purchases.tenantId, tenantId))
    await db.delete(inventoryLots).where(eq(inventoryLots.tenantId, tenantId))
    await db.delete(inventoryItems).where(eq(inventoryItems.tenantId, tenantId))
    await db.delete(records).where(eq(records.tenantId, tenantId))
    await db.delete(employees).where(eq(employees.tenantId, tenantId))
    await db.delete(batches).where(eq(batches.tenantId, tenantId))
    await db.delete(productionUnits).where(eq(productionUnits.tenantId, tenantId))
    await db.delete(farms).where(eq(farms.tenantId, tenantId))
    await db.delete(sessions).where(eq(sessions.userId, ownerId))
    await db.delete(users).where(eq(users.id, ownerId))
    await db.delete(tenants).where(eq(tenants.id, tenantId))
    mockCookie = undefined
  })

  describe('GET /api/reports/pl', () => {
    it('401s unauthenticated (tenant now comes from the session only)', async () => {
      const saved = mockCookie
      mockCookie = undefined
      const res = await plGET(getRequest('http://localhost/api/reports/pl'))
      mockCookie = saved
      expect(res.status).toBe(401)
    })

    it('400s on an invalid date', async () => {
      const res = await plGET(getRequest('http://localhost/api/reports/pl?from=not-a-date'))
      expect(res.status).toBe(400)
    })

    it('includes the in-range sale/purchase and excludes the out-of-range sale, in a from/to window', async () => {
      const { status, payload } = await readJson(
        await plGET(getRequest(`http://localhost/api/reports/pl?tenantId=${tenantId}&from=2026-08-01&to=2026-08-31`))
      )
      expect(status).toBe(200)
      expect(payload.data.title).toBe('Profit & Loss Summary')
      expect(payload.data.columns).toEqual(['Date', 'Type', 'Description', 'Batch', 'Amount', 'Status'])

      const descriptions = payload.data.rows.map((r: unknown[]) => r[2])
      expect(descriptions).toContain('Broilers x 50 birds')
      expect(descriptions).not.toContain('Broilers x 20 birds (old)')
      expect(descriptions).toContain('Unga Ltd')

      expect(payload.data.meta.periodRevenue).toBe(80000)
      expect(payload.data.meta.periodExpense).toBe(100) // 10000 cents -> 100 whole units
      expect(payload.data.meta.periodNetIncome).toBe(80000 - 100)
      expect(typeof payload.data.meta.glTotalRevenue).toBe('number')
      expect(typeof payload.data.meta.glTotalExpense).toBe('number')
    })

    it('excludes everything outside a narrow out-of-window from/to', async () => {
      const { status, payload } = await readJson(
        await plGET(getRequest(`http://localhost/api/reports/pl?tenantId=${tenantId}&from=2025-01-01&to=2025-01-31`))
      )
      expect(status).toBe(200)
      expect(payload.data.rows.length).toBe(0)
      expect(payload.data.meta.periodRevenue).toBe(0)
    })
  })

  describe('GET /api/reports/batch-pl', () => {
    it('returns per-batch revenue (date-filtered) and cost (cumulative) with a real margin', async () => {
      const { status, payload } = await readJson(
        await batchPlGET(getRequest(`http://localhost/api/reports/batch-pl?tenantId=${tenantId}&from=2026-08-01&to=2026-08-31`))
      )
      expect(status).toBe(200)
      expect(payload.data.title).toBe('Batch P&L')
      const rowA = payload.data.rows.find((r: unknown[]) => r[0] === 'BRO-KMB-001')
      expect(rowA).toBeDefined()
      // revenue: only the in-range sale (80000); the out-of-range 30000 sale excluded.
      expect(rowA[3]).toBe(80000)
      // cost: acquisitionCostCents / 100 = 5000, cumulative regardless of date range.
      expect(rowA[4]).toBe(5000)
      expect(rowA[5]).toBe(80000 - 5000)

      const rowB = payload.data.rows.find((r: unknown[]) => r[0] === 'BRO-KMB-002')
      expect(rowB[3]).toBe(0) // no sales for batch B
      expect(rowB[4]).toBe(2000) // 200000 cents / 100
    })
  })

  describe('GET /api/reports/mortality', () => {
    it('returns real mortality records for this tenant with deaths + cause', async () => {
      const { status, payload } = await readJson(
        await mortalityGET(getRequest(`http://localhost/api/reports/mortality?tenantId=${tenantId}`))
      )
      expect(status).toBe(200)
      expect(payload.data.title).toBe('Mortality Report')
      expect(payload.data.columns).toEqual(['Date', 'Batch', 'Deaths', 'Cause'])
      expect(payload.data.rows.length).toBe(2)
      expect(payload.data.meta.totalDeaths).toBe(5)
      const heatStress = payload.data.rows.find((r: unknown[]) => r[3] === 'Heat stress')
      expect(heatStress[1]).toBe('BRO-KMB-001')
      expect(heatStress[2]).toBe(4)
    })

    it('excludes mortality records outside the date range', async () => {
      const { status, payload } = await readJson(
        await mortalityGET(getRequest(`http://localhost/api/reports/mortality?tenantId=${tenantId}&from=2020-01-01&to=2020-01-31`))
      )
      expect(status).toBe(200)
      expect(payload.data.rows.length).toBe(0)
    })
  })

  describe('GET /api/reports/feed-consumption', () => {
    it('flattens feedItems into one row per item, with a real totalKg', async () => {
      const { status, payload } = await readJson(
        await feedGET(getRequest(`http://localhost/api/reports/feed-consumption?tenantId=${tenantId}`))
      )
      expect(status).toBe(200)
      expect(payload.data.title).toBe('Feed Consumption')
      expect(payload.data.columns).toEqual(['Date', 'Batch', 'Feed Item', 'Qty (kg)'])
      expect(payload.data.rows.length).toBe(2)
      expect(payload.data.meta.totalKg).toBe(35)
      const starter = payload.data.rows.find((r: unknown[]) => r[2] === 'Starter Mash')
      expect(starter[1]).toBe('BRO-KMB-001')
      expect(starter[3]).toBe(25)
    })
  })
})
