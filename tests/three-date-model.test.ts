// ── Three-date model, proven on real figures (item 18) ──────────────────────
// The guarantee this file exists to prove: repointing lib/reports.ts's P&L at
// posting_date does not move a single historical figure. Not proven by
// checking `posting_date = created_at` in the database (that proves the copy
// happened, not that the reports agree) — proven by seeding a deliberately
// BACKDATED sale and purchase (soldAt/receivedDate far from the moment the
// row is actually inserted, exactly the case where a naive backfill from the
// wrong column would silently move a figure), computing the P&L two ways —
// once via the real computePlReport, once by hand-filtering the same seeded
// rows on the exact columns the report used to read (sales.sold_at,
// purchases.created_at) — and asserting they agree, for the same period,
// every time this suite runs. This test is written to hold BOTH before and
// after lib/reports.ts is repointed: it is the proof that the repoint (a
// separate commit) changed nothing a report shows.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { eq, and, gte, lte, inArray } from 'drizzle-orm'

vi.mock('server-only', () => ({}))

let mockCookie: string | undefined
vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({ get: () => (mockCookie ? { value: mockCookie } : undefined) })),
}))

import { POST as salesPOST } from '@/app/api/data/sales/route'
import { POST as purchasesPOST } from '@/app/api/purchases/route'
import { computePlReport } from '@/lib/reports'
import { computeTrialBalance } from '@/lib/finance'
import { db } from '@/db'
import {
  tenants, users, sessions, farms, productionUnits, batches, sales, purchases,
  inventoryItems, inventoryLots, journalEntries, journalLines,
} from '@/db/schemas'
import { createSession, hashSecret } from '@/lib/auth'

const hasDb = !!process.env.DATABASE_URL
const run = hasDb ? describe : describe.skip

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

run('three-date model: the P&L agrees with itself across the repoint', () => {
  const tenantId = `t-three-date-${randomUUID()}`
  const farmId = `f-${randomUUID()}`
  const unitId = `u-${randomUUID()}`
  const batchId = `b-${randomUUID()}`
  const ownerId = `usr-owner-${randomUUID()}`
  let ownerSession: string

  // A deliberately old, closed window — real months that will never again be
  // "today" while this suite runs, so `now()` (what an un-backdated row gets)
  // can never accidentally land inside it.
  const windowFrom = new Date('2024-03-01T00:00:00.000Z')
  const windowTo = new Date('2024-03-31T23:59:59.999Z')
  const inWindowDate = new Date('2024-03-15T09:00:00.000Z')

  beforeAll(async () => {
    await db.insert(tenants).values({ id: tenantId, name: 'Three Date Co.', active: true })
    await db.insert(farms).values({ id: farmId, tenantId, name: 'Farm', location: 'Nakuru', code: 'FRM-3D' })
    await db.insert(productionUnits).values({ id: unitId, tenantId, farmId, type: 'house', name: 'House', code: 'HSE-3D' })
    await db.insert(batches).values({
      id: batchId, tenantId, unitId, code: 'BRO-3D', name: 'Broilers', enterprise: 'broiler',
      initialQty: 100, currentQty: 100,
    })
    const salt = randomUUID()
    await db.insert(users).values({
      id: ownerId, tenantId, name: 'Owner', email: `three-date-owner-${randomUUID()}@test.ifms`, role: 'owner',
      passwordHash: hashSecret('pw', salt), passwordSalt: salt, status: 'ACTIVE',
    })
    ownerSession = await createSession(ownerId)
  })

  afterAll(async () => {
    mockCookie = undefined
    const entryRows = await db.select({ id: journalEntries.id }).from(journalEntries).where(eq(journalEntries.tenantId, tenantId))
    const entryIds = entryRows.map((r) => r.id)
    if (entryIds.length > 0) await db.delete(journalLines).where(inArray(journalLines.entryId, entryIds))
    await db.delete(journalEntries).where(eq(journalEntries.tenantId, tenantId))
    await db.delete(sales).where(eq(sales.tenantId, tenantId))
    await db.delete(inventoryLots).where(eq(inventoryLots.tenantId, tenantId))
    await db.delete(purchases).where(eq(purchases.tenantId, tenantId))
    await db.delete(inventoryItems).where(eq(inventoryItems.tenantId, tenantId))
    await db.delete(batches).where(eq(batches.id, batchId))
    await db.delete(productionUnits).where(eq(productionUnits.tenantId, tenantId))
    await db.delete(farms).where(eq(farms.tenantId, tenantId))
    await db.delete(sessions).where(eq(sessions.userId, ownerId))
    await db.delete(users).where(eq(users.id, ownerId))
    await db.delete(tenants).where(eq(tenants.id, tenantId))
  })

  async function postSale(body: Record<string, unknown>) {
    mockCookie = ownerSession
    const res = await readJson(await salesPOST(jsonRequest('http://localhost/api/data/sales', 'POST', { tenantId, ...body })))
    mockCookie = undefined
    return res
  }
  async function postPurchase(body: Record<string, unknown>) {
    mockCookie = ownerSession
    const res = await readJson(await purchasesPOST(jsonRequest('http://localhost/api/purchases', 'POST', { tenantId, farmId, ...body })))
    mockCookie = undefined
    return res
  }

  it('a backdated sale and purchase land in the OLD window, an un-backdated one does not — and the P&L agrees exactly with a hand-filter on the old columns', async () => {
    // Backdated: soldAt / receivedDate explicitly inside the closed window,
    // even though the row is inserted "now" (today) — the exact case a naive
    // posting_date backfill/default from "now" would get wrong.
    const backdatedSale = await postSale({ item: 'Backdated Eggs', amountCents: 150000, method: 'Cash', soldAt: inWindowDate.toISOString() })
    expect(backdatedSale.status).toBe(201)

    const currentSale = await postSale({ item: 'Current Eggs', amountCents: 90000, method: 'Cash' })
    expect(currentSale.status).toBe(201)

    const backdatedPurchase = await postPurchase({
      supplier: 'Feed Co', itemName: `Feed ${randomUUID()}`, unit: 'kg',
      quantity: 20, unitCostCents: 40000, receivedDate: inWindowDate.toISOString(),
    })
    expect(backdatedPurchase.status).toBe(201)

    const currentPurchase = await postPurchase({
      supplier: 'Feed Co', itemName: `Feed ${randomUUID()}`, unit: 'kg',
      quantity: 5, unitCostCents: 20000,
    })
    expect(currentPurchase.status).toBe(201)

    // The hand-computed "old behaviour" ground truth: sales filtered by
    // sold_at, purchases filtered by created_at — exactly what lib/reports.ts
    // has always done, independent of whatever it reads today.
    const oldSales = await db.select().from(sales).where(and(eq(sales.tenantId, tenantId), gte(sales.soldAt, windowFrom), lte(sales.soldAt, windowTo)))
    const oldPurchases = await db.select().from(purchases).where(and(eq(purchases.tenantId, tenantId), gte(purchases.createdAt, windowFrom), lte(purchases.createdAt, windowTo)))
    const expectedRevenue = oldSales.reduce((sum, s) => sum + s.amountCents, 0) / 100
    const expectedPurchaseExpense = oldPurchases.reduce((sum, p) => sum + p.totalCostCents, 0) / 100

    // Only the backdated rows should be in the window — proves the fixture
    // itself is doing what it claims before trusting the report's answer.
    expect(oldSales.map((s) => s.item)).toEqual(['Backdated Eggs'])
    expect(oldPurchases).toHaveLength(1)

    const report = await computePlReport(tenantId, windowFrom, windowTo)
    expect(report.meta.periodRevenue).toBe(expectedRevenue)
    expect(report.meta.periodPurchaseExpense).toBe(expectedPurchaseExpense)
    expect(report.meta.periodRevenue).toBe(1500) // KSh 1,500.00 — the backdated sale alone
    expect(report.meta.periodPurchaseExpense).toBe(8000) // KSh 8,000.00 — the backdated purchase alone
  })

  it('the trial balance stays all-time and balanced regardless of any of this — it has never filtered by date', async () => {
    const tb = await computeTrialBalance(tenantId)
    expect(tb.balanced).toBe(true)
    expect(tb.totalDebitsCents).toBe(tb.totalCreditsCents)
    // All-time: both the backdated AND the current-dated postings are in
    // here together, unlike the windowed P&L above.
    const revenueRow = tb.rows.find((r) => r.class === 'REVENUE')
    expect(revenueRow).toBeTruthy()
    expect(revenueRow!.balanceCents).toBeGreaterThanOrEqual(150000 + 90000)
  })
})
