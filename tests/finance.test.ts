// ── Finance backend tests (issue #239) ──────────────────────────────────────
// Integration tests that call the real route handlers against the real
// postgres when DATABASE_URL is set (local/dev); CI has no database, so the
// suite skips there — same pattern as tests/inventory.test.ts / tests/batches.test.ts.
//
// Covers the issue's Definition of Done:
//   - sales and purchases together are the only real inputs to the trial
//     balance (no fabricated payroll/other postings)
//   - a trial balance for a seeded tenant, computed from real sales/purchases
//     data, balances (total debits = total credits)
//   - recording a real sale via POST /api/data/sales changes the trial
//     balance correctly
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { eq, inArray } from 'drizzle-orm'

vi.mock('server-only', () => ({}))
vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({ get: () => undefined })),
}))

import { GET as salesGET, POST as salesPOST } from '@/app/api/data/sales/route'
import { GET as accountsGET } from '@/app/api/gl/accounts/route'
import { GET as trialBalanceGET } from '@/app/api/gl/trial-balance/route'
import { POST as purchasesPOST } from '@/app/api/purchases/route'
import { db } from '@/db'
import {
  tenants,
  sales,
  journalEntries,
  journalLines,
  purchases,
  inventoryLots,
  inventoryItems,
  batches,
  productionUnits,
  farms,
} from '@/db/schemas'
import { ACCOUNT_CODES } from '@/lib/finance'

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

async function journalEntryIdsForTenant(tenantId: string): Promise<string[]> {
  const rows = await db.select({ id: journalEntries.id }).from(journalEntries).where(eq(journalEntries.tenantId, tenantId))
  return rows.map((r) => r.id)
}

async function cleanupTenant(tenantId: string) {
  const entryIds = await journalEntryIdsForTenant(tenantId)
  if (entryIds.length > 0) await db.delete(journalLines).where(inArray(journalLines.entryId, entryIds))
  await db.delete(journalEntries).where(eq(journalEntries.tenantId, tenantId))
  await db.delete(sales).where(eq(sales.tenantId, tenantId))
  await db.delete(purchases).where(eq(purchases.tenantId, tenantId))
  await db.delete(inventoryLots).where(eq(inventoryLots.tenantId, tenantId))
  await db.delete(inventoryItems).where(eq(inventoryItems.tenantId, tenantId))
  await db.delete(batches).where(eq(batches.tenantId, tenantId))
  await db.delete(productionUnits).where(eq(productionUnits.tenantId, tenantId))
  await db.delete(farms).where(eq(farms.tenantId, tenantId))
  await db.delete(tenants).where(eq(tenants.id, tenantId))
}

run('finance: sales, chart of accounts, trial balance (issue #239)', () => {
  const tenantId = `t-fin-${randomUUID()}`

  beforeAll(async () => {
    await db.insert(tenants).values({ id: tenantId, name: 'Finance Test Co.', active: true })
  })

  afterAll(async () => {
    await cleanupTenant(tenantId)
  })

  describe('GET /api/gl/accounts: seeded standard chart of accounts', () => {
    it('returns the six standard farm accounts, including no payroll account', async () => {
      const { status, payload } = await readJson(await accountsGET())
      expect(status).toBe(200)
      const codes = payload.data.map((a: { code: string }) => a.code).sort()
      expect(codes).toEqual(['1001', '1002', '2001', '3001', '4001', '5001'])
      expect(payload.data.some((a: { name: string }) => /payroll/i.test(a.name))).toBe(false)

      const cash = payload.data.find((a: { code: string }) => a.code === ACCOUNT_CODES.CASH)
      expect(cash.class).toBe('ASSET')
      expect(cash.normalBalance).toBe('DEBIT')
      const revenue = payload.data.find((a: { code: string }) => a.code === ACCOUNT_CODES.SALES_REVENUE)
      expect(revenue.class).toBe('REVENUE')
      expect(revenue.normalBalance).toBe('CREDIT')
    })
  })

  describe('POST /api/data/sales: create + list, exact field shape', () => {
    it('rejects a sale with no item / non-positive amount / bad status (400)', async () => {
      expect((await salesPOST(postRequest('http://localhost/api/data/sales', { tenantId, amount: 100 }))).status).toBe(400)
      expect((await salesPOST(postRequest('http://localhost/api/data/sales', { tenantId, item: 'Eggs', amount: 0 }))).status).toBe(400)
      expect(
        (await salesPOST(postRequest('http://localhost/api/data/sales', { tenantId, item: 'Eggs', amount: 100, status: 'shipped' }))).status
      ).toBe(400)
    })

    it('creates a paid cash sale and lists it back', async () => {
      const { status, payload } = await readJson(
        await salesPOST(
          postRequest('http://localhost/api/data/sales', {
            tenantId,
            item: 'Tray eggs (30) x 120',
            amount: 36000,
            method: 'Mpesa',
            status: 'paid',
          })
        )
      )
      expect(status).toBe(201)
      expect(payload.data.tenantId).toBe(tenantId)
      expect(payload.data.item).toBe('Tray eggs (30) x 120')
      expect(payload.data.amount).toBe(36000)
      expect(payload.data.method).toBe('Mpesa')
      expect(payload.data.status).toBe('paid')
      expect(payload.data.soldAt).toBeDefined()

      const { status: listStatus, payload: listPayload } = await readJson(
        await salesGET(getRequest(`http://localhost/api/data/sales?tenantId=${tenantId}`))
      )
      expect(listStatus).toBe(200)
      expect(listPayload.data.some((s: { id: string }) => s.id === payload.data.id)).toBe(true)
    })

    it('404s when batchId does not belong to this tenant', async () => {
      const res = await salesPOST(
        postRequest('http://localhost/api/data/sales', { tenantId, item: 'Eggs', amount: 100, batchId: 'nonexistent-batch' })
      )
      expect(res.status).toBe(404)
    })
  })

  describe('GET /api/gl/trial-balance: derived from real sales + purchases only', () => {
    it('balances after a paid sale, a pending sale, a paid purchase and a partially-paid purchase', async () => {
      const before = await readJson(await trialBalanceGET(getRequest(`http://localhost/api/gl/trial-balance?tenantId=${tenantId}`)))
      expect(before.status).toBe(200)
      expect(before.payload.data.balanced).toBe(true)
      const cashBefore = before.payload.data.rows.find((r: { code: string }) => r.code === ACCOUNT_CODES.CASH).balance

      // A cash sale (already recorded above: 36000 paid). Add a pending sale.
      const pendingSale = await readJson(
        await salesPOST(
          postRequest('http://localhost/api/data/sales', { tenantId, item: 'Broilers x 80 birds', amount: 128000, status: 'pending' })
        )
      )
      expect(pendingSale.status).toBe(201)

      // A fully-paid purchase.
      const paidPurchase = await readJson(
        await purchasesPOST(
          postRequest('http://localhost/api/purchases', {
            tenantId,
            supplier: 'Unga Ltd',
            itemName: 'Broiler Starter Mash',
            unit: 'kg',
            quantity: 10,
            unitCostCents: 1000,
            totalCostCents: 10000,
            amountPaidCents: 10000,
          })
        )
      )
      expect(paidPurchase.status).toBe(201)

      // A partially-paid purchase (owes the remainder to Accounts Payable).
      const partialPurchase = await readJson(
        await purchasesPOST(
          postRequest('http://localhost/api/purchases', {
            tenantId,
            supplier: 'Agrovet',
            itemName: 'Oxymav B Antibiotic',
            unit: 'g',
            quantity: 5,
            unitCostCents: 3000,
            totalCostCents: 15000,
            amountPaidCents: 5000,
          })
        )
      )
      expect(partialPurchase.status).toBe(201)

      const after = await readJson(await trialBalanceGET(getRequest(`http://localhost/api/gl/trial-balance?tenantId=${tenantId}`)))
      expect(after.status).toBe(200)
      const tb = after.payload.data
      expect(tb.totalDebits).toBe(tb.totalCredits)
      expect(tb.balanced).toBe(true)

      const row = (code: string) => tb.rows.find((r: { code: string }) => r.code === code)

      // Cash: the first paid sale (36000) is already in `cashBefore` (recorded in an
      // earlier test); this test only adds -10000 (paid purchase) and -5000
      // (partial payment on the second purchase).
      expect(row(ACCOUNT_CODES.CASH).balance).toBe(cashBefore - 10000 - 5000)
      // Accounts Receivable: the pending sale's full amount.
      expect(row(ACCOUNT_CODES.ACCOUNTS_RECEIVABLE).balance).toBe(128000)
      // Accounts Payable: the unpaid remainder of the partial purchase (15000 - 5000).
      expect(row(ACCOUNT_CODES.ACCOUNTS_PAYABLE).balance).toBe(10000)
      // Sales Revenue: 36000 (paid) + 128000 (pending) = 164000.
      expect(row(ACCOUNT_CODES.SALES_REVENUE).balance).toBe(164000)
      // Purchases Expense: 10000 (paid) + 15000 (partial) = 25000.
      expect(row(ACCOUNT_CODES.PURCHASES_EXPENSE).balance).toBe(25000)
    })

    it('recording a real sale changes the trial balance correctly (before/after)', async () => {
      const before = await readJson(await trialBalanceGET(getRequest(`http://localhost/api/gl/trial-balance?tenantId=${tenantId}`)))
      const revenueBefore = before.payload.data.rows.find((r: { code: string }) => r.code === ACCOUNT_CODES.SALES_REVENUE).balance

      const sale = await readJson(
        await salesPOST(postRequest('http://localhost/api/data/sales', { tenantId, item: 'Pork x 45kg', amount: 27000, status: 'paid' }))
      )
      expect(sale.status).toBe(201)

      const after = await readJson(await trialBalanceGET(getRequest(`http://localhost/api/gl/trial-balance?tenantId=${tenantId}`)))
      const revenueAfter = after.payload.data.rows.find((r: { code: string }) => r.code === ACCOUNT_CODES.SALES_REVENUE).balance
      expect(revenueAfter).toBe(revenueBefore + 27000)
      expect(after.payload.data.balanced).toBe(true)
    })

    it("does not include any payroll postings — journal_entries only ever come from 'sale'/'purchase' sources", async () => {
      const entries = await db.select().from(journalEntries).where(eq(journalEntries.tenantId, tenantId))
      expect(entries.length).toBeGreaterThan(0)
      expect(entries.every((e) => e.sourceType === 'sale' || e.sourceType === 'purchase')).toBe(true)
    })
  })
})
