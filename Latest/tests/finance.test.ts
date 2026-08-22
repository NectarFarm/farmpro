// ── Finance backend tests (issue #239) ──────────────────────────────────────
// Integration tests that call the real route handlers against the real
// postgres when DATABASE_URL is set (local/dev); CI has no database, so the
// suite skips there — same pattern as tests/inventory.test.ts / tests/batches.test.ts.
//
// Covers the issue's Definition of Done:
//   - sales and purchases together are the only real inputs to the trial
//     balance (no fabricated postings — this suite's own tenant never runs
//     payroll, a real, separate posting source now covered by tests/payroll.test.ts)
//   - a trial balance for a seeded tenant, computed from real sales/purchases
//     data, balances (total debits = total credits)
//   - recording a real sale via POST /api/data/sales changes the trial
//     balance correctly
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { eq, inArray } from 'drizzle-orm'

vi.mock('server-only', () => ({}))

// Auth fix (fix/authenticate-all-apis): every route this file exercises now
// requires a real session — tenant comes from `session.tenantId` only, never
// a `tenantId` query/body param. `mockCookie` stands in for the session
// cookie; same pattern as tests/role-screens.test.ts / tests/farm-scoping.test.ts.
let mockCookie: string | undefined
vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({ get: () => (mockCookie ? { value: mockCookie } : undefined) })),
}))

import { GET as salesGET, POST as salesPOST } from '@/app/api/data/sales/route'
import { GET as accountsGET } from '@/app/api/gl/accounts/route'
import { GET as trialBalanceGET } from '@/app/api/gl/trial-balance/route'
import { POST as purchasesPOST } from '@/app/api/purchases/route'
import { db } from '@/db'
import {
  tenants,
  users,
  sessions,
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
import { createSession, hashSecret } from '@/lib/auth'

// Inserts an owner user for `tenantId` and returns a live session token —
// the shared "give me an authenticated caller for this tenant" helper every
// test below uses instead of a `tenantId` query/body param.
async function createOwnerSession(tenantId: string): Promise<{ userId: string; token: string }> {
  const userId = randomUUID()
  const salt = randomUUID()
  await db.insert(users).values({
    id: userId,
    tenantId,
    name: 'Finance Test Owner',
    email: `owner-fin-${randomUUID()}@test.ifms`,
    role: 'owner',
    passwordHash: hashSecret('pw', salt),
    passwordSalt: salt,
    status: 'ACTIVE',
  })
  const token = await createSession(userId)
  return { userId, token }
}

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

async function cleanupTenant(tenantId: string, userId?: string) {
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
  if (userId) {
    await db.delete(sessions).where(eq(sessions.userId, userId))
    await db.delete(users).where(eq(users.id, userId))
  }
  await db.delete(tenants).where(eq(tenants.id, tenantId))
}

run('finance: sales, chart of accounts, trial balance (issue #239)', () => {
  const tenantId = `t-fin-${randomUUID()}`
  let ownerUserId: string
  let ownerToken: string

  beforeAll(async () => {
    await db.insert(tenants).values({ id: tenantId, name: 'Finance Test Co.', active: true })
    const owner = await createOwnerSession(tenantId)
    ownerUserId = owner.userId
    ownerToken = owner.token
  })

  afterAll(async () => {
    await cleanupTenant(tenantId, ownerUserId)
  })

  describe('GET /api/gl/accounts: seeded standard chart of accounts', () => {
    // Updated by the payroll-and-gps task: a 7th account (5002 Payroll
    // Expense) now exists — payroll runs deliberately DO post to the ledger
    // (see db/schemas/finance.ts's chart-of-accounts comment and
    // lib/finance.ts's postPayrollJournal). This test's own tenant never
    // runs payroll, so the assertion below still proves the OTHER six are
    // exactly what a sale/purchase-only tenant posts against — it just no
    // longer asserts a payroll account doesn't exist globally, since one now
    // does (accounts are a single global, seeded taxonomy, not per-tenant).
    it('returns the seven standard farm accounts, including Payroll Expense', async () => {
      mockCookie = ownerToken
      const { status, payload } = await readJson(await accountsGET())
      expect(status).toBe(200)
      const codes = payload.data.map((a: { code: string }) => a.code).sort()
      expect(codes).toEqual(['1001', '1002', '2001', '3001', '4001', '5001', '5002'])
      expect(payload.data.some((a: { name: string }) => /payroll/i.test(a.name))).toBe(true)

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
      mockCookie = ownerToken
      expect((await salesPOST(postRequest('http://localhost/api/data/sales', { tenantId, amountCents: 10000 }))).status).toBe(400)
      expect((await salesPOST(postRequest('http://localhost/api/data/sales', { tenantId, item: 'Eggs', amountCents: 0 }))).status).toBe(400)
      expect(
        (await salesPOST(postRequest('http://localhost/api/data/sales', { tenantId, item: 'Eggs', amountCents: 10000, status: 'shipped' }))).status
      ).toBe(400)
    })

    it('creates a paid cash sale and lists it back', async () => {
      mockCookie = ownerToken
      const { status, payload } = await readJson(
        await salesPOST(
          postRequest('http://localhost/api/data/sales', {
            tenantId,
            item: 'Tray eggs (30) x 120',
            amountCents: 3600000,
            method: 'Mpesa',
            status: 'paid',
          })
        )
      )
      expect(status).toBe(201)
      expect(payload.data.tenantId).toBe(tenantId)
      expect(payload.data.item).toBe('Tray eggs (30) x 120')
      expect(payload.data.amountCents).toBe(3600000)
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
      mockCookie = ownerToken
      const res = await salesPOST(
        postRequest('http://localhost/api/data/sales', { tenantId, item: 'Eggs', amountCents: 10000, batchId: 'nonexistent-batch' })
      )
      expect(res.status).toBe(404)
    })
  })

  describe('GET /api/gl/trial-balance: derived from real sales + purchases only', () => {
    it('balances after a paid sale, a pending sale, a paid purchase and a partially-paid purchase', async () => {
      mockCookie = ownerToken
      const before = await readJson(await trialBalanceGET())
      expect(before.status).toBe(200)
      expect(before.payload.data.balanced).toBe(true)
      const cashBefore = before.payload.data.rows.find((r: { code: string }) => r.code === ACCOUNT_CODES.CASH).balanceCents

      // A cash sale (already recorded above: 36000 paid). Add a pending sale.
      const pendingSale = await readJson(
        await salesPOST(
          postRequest('http://localhost/api/data/sales', { tenantId, item: 'Broilers x 80 birds', amountCents: 12800000, status: 'pending' })
        )
      )
      expect(pendingSale.status).toBe(201)

      // A fully-paid purchase. totalCostCents/amountPaidCents are in cents
      // (KSh 100 total); postPurchaseJournal (issue #290) converts these to
      // whole units before posting, so the ledger sees 100, not 10000.
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
      // totalCostCents 15000 / amountPaidCents 5000 = KSh 150 total, KSh 50
      // paid, KSh 100 owed once converted to whole units.
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

      const after = await readJson(await trialBalanceGET())
      expect(after.status).toBe(200)
      const tb = after.payload.data
      expect(tb.totalDebits).toBe(tb.totalCredits)
      expect(tb.balanced).toBe(true)

      const row = (code: string) => tb.rows.find((r: { code: string }) => r.code === code)

      // Cash: the first paid sale (36000) is already in `cashBefore` (recorded in an
      // earlier test); this test only adds -100 (paid purchase, KSh 100 once
      // converted from cents) and -50 (partial payment on the second purchase,
      // KSh 50 once converted from cents).
      expect(row(ACCOUNT_CODES.CASH).balanceCents).toBe(cashBefore - 10000 - 5000)
      // Accounts Receivable: the pending sale's full amount.
      expect(row(ACCOUNT_CODES.ACCOUNTS_RECEIVABLE).balanceCents).toBe(12800000)
      // Accounts Payable: the unpaid remainder of the partial purchase, in
      // whole units (150 - 50 = 100), NOT the raw cents figure (15000 - 5000
      // = 10000) — proves postPurchaseJournal converts before posting.
      expect(row(ACCOUNT_CODES.ACCOUNTS_PAYABLE).balanceCents).toBe(10000)
      // Sales Revenue: 36000 (paid) + 128000 (pending) = 164000. Same order of
      // magnitude as Purchases Expense below now that both post in whole
      // units — this is the exact invariant issue #290 was about.
      expect(row(ACCOUNT_CODES.SALES_REVENUE).balanceCents).toBe(16400000)
      // Purchases Expense: 100 (paid) + 150 (partial) = 250 in whole units —
      // NOT 25000 (the raw cents sum), which is what the pre-fix code posted.
      expect(row(ACCOUNT_CODES.PURCHASES_EXPENSE).balanceCents).toBe(25000)
    })

    it('issue #290: a real KSh 36,000 sale and a real KSh 27,500 purchase post in the same, correct order of magnitude', async () => {
      const localTenantId = `t-fin-unit-${randomUUID()}`
      await db.insert(tenants).values({ id: localTenantId, name: 'Unit Mismatch Regression Co.', active: true })
      const localOwner = await createOwnerSession(localTenantId)
      mockCookie = localOwner.token
      try {
        // A real cash sale of KSh 36,000 — sales.amountCents is minor units
        // KSh figure, so this posts as 36000 either way.
        const sale = await readJson(
          await salesPOST(
            postRequest('http://localhost/api/data/sales', {
              tenantId: localTenantId,
              item: 'Tray eggs (30) x 120',
              amountCents: 3600000,
              status: 'paid',
            })
          )
        )
        expect(sale.status).toBe(201)

        // A real cash purchase of KSh 27,500 — totalCostCents/amountPaidCents
        // are in cents, so this is 2,750,000 raw. Pre-fix, postPurchaseJournal
        // posted that raw cents figure straight into Purchases Expense (a
        // ~100x inflation vs the real KSh value); post-fix it must post 27500.
        const purchase = await readJson(
          await purchasesPOST(
            postRequest('http://localhost/api/purchases', {
              tenantId: localTenantId,
              supplier: 'Agrovet Supplies',
              itemName: 'Layer Mash',
              unit: 'kg',
              quantity: 500,
              unitCostCents: 5500,
              totalCostCents: 2750000,
              amountPaidCents: 2750000,
            })
          )
        )
        expect(purchase.status).toBe(201)

        const tb = (await readJson(await trialBalanceGET())).payload.data
        expect(tb.balanced).toBe(true)
        const row = (code: string) => tb.rows.find((r: { code: string }) => r.code === code)

        // Revenue reflects the real KSh 36,000 sale.
        expect(row(ACCOUNT_CODES.SALES_REVENUE).balanceCents).toBe(3600000)
        // Expense reflects the real KSh 27,500 purchase — NOT 2,750,000 (the
        // pre-fix ~100x-inflated figure this issue was filed about).
        expect(row(ACCOUNT_CODES.PURCHASES_EXPENSE).balanceCents).toBe(2750000)
        expect(row(ACCOUNT_CODES.PURCHASES_EXPENSE).balanceCents).not.toBe(275000000)

        // Both sides are now the same order of magnitude as their real KSh
        // values: revenue/expense differ by less than 2x, not ~100x.
        const revenue = row(ACCOUNT_CODES.SALES_REVENUE).balanceCents
        const expense = row(ACCOUNT_CODES.PURCHASES_EXPENSE).balanceCents
        expect(Math.max(revenue, expense) / Math.min(revenue, expense)).toBeLessThan(2)

        // Cash (fully-paid sale + fully-paid purchase): 36000 - 27500 = 8500.
        expect(row(ACCOUNT_CODES.CASH).balanceCents).toBe(850000)
      } finally {
        await cleanupTenant(localTenantId, localOwner.userId)
      }
    })

    it('recording a real sale changes the trial balance correctly (before/after)', async () => {
      mockCookie = ownerToken
      const before = await readJson(await trialBalanceGET())
      const revenueBefore = before.payload.data.rows.find((r: { code: string }) => r.code === ACCOUNT_CODES.SALES_REVENUE).balanceCents

      const sale = await readJson(
        await salesPOST(postRequest('http://localhost/api/data/sales', { tenantId, item: 'Pork x 45kg', amountCents: 2700000, status: 'paid' }))
      )
      expect(sale.status).toBe(201)

      const after = await readJson(await trialBalanceGET())
      const revenueAfter = after.payload.data.rows.find((r: { code: string }) => r.code === ACCOUNT_CODES.SALES_REVENUE).balanceCents
      expect(revenueAfter).toBe(revenueBefore + 2700000)
      expect(after.payload.data.balanced).toBe(true)
    })

    it("does not include any payroll postings — journal_entries only ever come from 'sale'/'purchase' sources", async () => {
      const entries = await db.select().from(journalEntries).where(eq(journalEntries.tenantId, tenantId))
      expect(entries.length).toBeGreaterThan(0)
      expect(entries.every((e) => e.sourceType === 'sale' || e.sourceType === 'purchase')).toBe(true)
    })
  })
})
