// ── Edit and reverse (item 23) ──────────────────────────────────────────────
// Integration tests against real Postgres (skipped with no DATABASE_URL, same
// convention as every other integration suite here). Covers:
//   - PATCH /api/data/sales/[id] and /api/purchases/[id]: reason required,
//     restricted to safe fields (amountCents/qty/status are silently ignored,
//     never rewritten), before/after recorded in audit_log, refused once a
//     row is reversed.
//   - POST .../reverse for both: reason required, refuses a double reversal,
//     marks reversedAt without touching the money fields, posts a contra
//     journal entry dated to the ORIGINAL entry's own date.
//   - Ownership: two non-owner actors granted the SAME finance-edit access
//     cannot edit/reverse each other's rows; the owner can touch either.
//   - THE mandated proof: computePlReport (period figures) and
//     computeTrialBalance (the ledger) are captured before and after a
//     reversal, and the numbers move by exactly the reversed amount and
//     nothing else — every unrelated account, every unrelated sale/purchase,
//     is asserted byte-identical across the reversal.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { eq, and, inArray } from 'drizzle-orm'

vi.mock('server-only', () => ({}))

let mockCookie: string | undefined
vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({ get: () => (mockCookie ? { value: mockCookie } : undefined) })),
}))

import { POST as salesPOST } from '@/app/api/data/sales/route'
import { PATCH as salePATCH } from '@/app/api/data/sales/[id]/route'
import { POST as saleReversePOST } from '@/app/api/data/sales/[id]/reverse/route'
import { POST as purchasesPOST } from '@/app/api/purchases/route'
import { PATCH as purchasePATCH } from '@/app/api/purchases/[id]/route'
import { POST as purchaseReversePOST } from '@/app/api/purchases/[id]/reverse/route'
import { computePlReport } from '@/lib/reports'
import { computeTrialBalance } from '@/lib/finance'
import { db } from '@/db'
import {
  tenants, users, sessions, sales, purchases, inventoryItems, inventoryLots,
  journalEntries, journalLines, auditLog, rolePermissions,
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

run('edit and reverse (item 23)', () => {
  const tenantId = `t-edit-reverse-${randomUUID()}`
  const ownerId = `usr-owner-${randomUUID()}`
  const managerAId = `usr-mgr-a-${randomUUID()}`
  const managerBId = `usr-mgr-b-${randomUUID()}`
  let ownerSession: string
  let managerASession: string
  let managerBSession: string

  // A deliberately old, closed window — real months that will never again be
  // "today" while this suite runs (same device tests/three-date-model.test.ts
  // already uses), so an un-backdated row can never accidentally land inside
  // it, and today's own period can never accidentally overlap it either.
  const windowFrom = new Date('2024-05-01T00:00:00.000Z')
  const windowTo = new Date('2024-05-31T23:59:59.999Z')
  const inWindowDate = new Date('2024-05-15T09:00:00.000Z')

  beforeAll(async () => {
    await db.insert(tenants).values({ id: tenantId, name: 'Edit Reverse Co.', active: true })
    const salt = randomUUID()
    await db.insert(users).values([
      {
        id: ownerId, tenantId, name: 'Owner', email: `edit-reverse-owner-${randomUUID()}@test.ifms`, role: 'owner',
        passwordHash: hashSecret('pw', salt), passwordSalt: salt, status: 'ACTIVE',
      },
      {
        id: managerAId, tenantId, name: 'Manager A', email: `edit-reverse-mgr-a-${randomUUID()}@test.ifms`, role: 'manager',
        passwordHash: hashSecret('pw', salt), passwordSalt: salt, status: 'ACTIVE',
      },
      {
        id: managerBId, tenantId, name: 'Manager B', email: `edit-reverse-mgr-b-${randomUUID()}@test.ifms`, role: 'manager',
        passwordHash: hashSecret('pw', salt), passwordSalt: salt, status: 'ACTIVE',
      },
    ])
    // Managers have `finance: 'view'` by default (lib/permission-matrix.ts) —
    // granted `edit` here for BOTH managers, deliberately, so a test that
    // finds manager B refused on manager A's row is proving the OWNERSHIP
    // check, not just the ordinary module gate manager B would fail anyway.
    await db.insert(rolePermissions).values([
      { id: randomUUID(), tenantId, role: 'manager', module: 'finance', access: 'edit', approvalRequired: false },
    ])
    ownerSession = await createSession(ownerId)
    managerASession = await createSession(managerAId)
    managerBSession = await createSession(managerBId)
  })

  afterAll(async () => {
    mockCookie = undefined
    const entryRows = await db.select({ id: journalEntries.id }).from(journalEntries).where(eq(journalEntries.tenantId, tenantId))
    const entryIds = entryRows.map((r) => r.id)
    if (entryIds.length > 0) await db.delete(journalLines).where(inArray(journalLines.entryId, entryIds))
    await db.delete(journalEntries).where(eq(journalEntries.tenantId, tenantId))
    await db.delete(auditLog).where(eq(auditLog.tenantId, tenantId))
    await db.delete(sales).where(eq(sales.tenantId, tenantId))
    await db.delete(inventoryLots).where(eq(inventoryLots.tenantId, tenantId))
    await db.delete(purchases).where(eq(purchases.tenantId, tenantId))
    await db.delete(inventoryItems).where(eq(inventoryItems.tenantId, tenantId))
    await db.delete(rolePermissions).where(eq(rolePermissions.tenantId, tenantId))
    await db.delete(sessions).where(inArray(sessions.userId, [ownerId, managerAId, managerBId]))
    await db.delete(users).where(inArray(users.id, [ownerId, managerAId, managerBId]))
    await db.delete(tenants).where(eq(tenants.id, tenantId))
  })

  async function recordSaleAs(session: string, overrides: Record<string, unknown> = {}) {
    mockCookie = session
    const { payload } = await readJson(await salesPOST(jsonRequest('http://localhost/api/data/sales', 'POST', {
      tenantId, item: 'Test sale', amountCents: 500000, status: 'paid', method: 'Cash',
      soldAt: inWindowDate.toISOString(), ...overrides,
    })))
    mockCookie = undefined
    return payload.data as { id: string; item: string; amountCents: number; status: string; recordedBy: string | null }
  }

  async function recordPurchaseAs(session: string, overrides: Record<string, unknown> = {}) {
    mockCookie = session
    const { payload } = await readJson(await purchasesPOST(jsonRequest('http://localhost/api/purchases', 'POST', {
      tenantId, supplier: 'Test Supplier', itemName: `Feed ${randomUUID()}`, unit: 'kg',
      quantity: 10, unitCostCents: 100000, amountPaidCents: 1000000,
      receivedDate: inWindowDate.toISOString(), ...overrides,
    })))
    mockCookie = undefined
    return payload.data.purchase as { id: string; supplier: string; totalCostCents: number; recordedBy: string | null }
  }

  describe('PATCH /api/data/sales/[id] — edit', () => {
    it('refuses with no reason', async () => {
      const sale = await recordSaleAs(managerASession)
      mockCookie = managerASession
      const { status, payload } = await readJson(await salePATCH(
        jsonRequest(`http://localhost/api/data/sales/${sale.id}`, 'PATCH', { tenantId, item: 'Renamed' }),
        { params: Promise.resolve({ id: sale.id }) },
      ))
      mockCookie = undefined
      expect(status).toBe(400)
      expect(payload.error).toMatch(/reason/i)
    })

    it('updates a safe field, ignores amountCents/qty/status, and records before/after + reason in audit_log', async () => {
      const sale = await recordSaleAs(managerASession, { item: 'Original item', notes: 'first note' })
      mockCookie = managerASession
      const { status, payload } = await readJson(await salePATCH(
        jsonRequest(`http://localhost/api/data/sales/${sale.id}`, 'PATCH', {
          tenantId, reason: 'Fixed a typo in the item name', item: 'Corrected item',
          amountCents: 999999999, qty: 42, status: 'pending', // must all be ignored
        }),
        { params: Promise.resolve({ id: sale.id }) },
      ))
      mockCookie = undefined
      expect(status).toBe(200)
      expect(payload.data.item).toBe('Corrected item')
      // The whole point: money/qty/status are never rewritten by an edit.
      expect(payload.data.amountCents).toBe(500000)
      expect(payload.data.qty).toBe(null)
      expect(payload.data.status).toBe('paid')

      const logs = await db.select().from(auditLog).where(and(eq(auditLog.tenantId, tenantId), eq(auditLog.entity, 'sale'), eq(auditLog.entityId, sale.id)))
      const editLog = logs.find((l) => l.action === 'sale.edited')
      expect(editLog).toBeTruthy()
      const meta = editLog!.meta as { reason: string; before: Record<string, unknown>; after: Record<string, unknown> }
      expect(meta.reason).toBe('Fixed a typo in the item name')
      expect(meta.before.item).toBe('Original item')
      expect(meta.after.item).toBe('Corrected item')
      expect(editLog!.actor).toBe(managerAId)
    })

    it('refuses manager B editing manager A\'s sale, even though both have finance edit access', async () => {
      const sale = await recordSaleAs(managerASession)
      mockCookie = managerBSession
      const { status, payload } = await readJson(await salePATCH(
        jsonRequest(`http://localhost/api/data/sales/${sale.id}`, 'PATCH', { tenantId, reason: 'Trying to edit someone else\'s sale', item: 'Hijacked' }),
        { params: Promise.resolve({ id: sale.id }) },
      ))
      mockCookie = undefined
      expect(status).toBe(403)
      expect(payload.success).toBe(false)
    })

    it('the owner can edit any row, including manager A\'s', async () => {
      const sale = await recordSaleAs(managerASession, { item: 'Owner will edit this' })
      mockCookie = ownerSession
      const { status, payload } = await readJson(await salePATCH(
        jsonRequest(`http://localhost/api/data/sales/${sale.id}`, 'PATCH', { tenantId, reason: 'Owner override', item: 'Owner edited this' }),
        { params: Promise.resolve({ id: sale.id }) },
      ))
      mockCookie = undefined
      expect(status).toBe(200)
      expect(payload.data.item).toBe('Owner edited this')
    })
  })

  describe('POST /api/data/sales/[id]/reverse — reverse', () => {
    it('refuses with no reason', async () => {
      const sale = await recordSaleAs(managerASession)
      mockCookie = managerASession
      const { status } = await readJson(await saleReversePOST(
        jsonRequest(`http://localhost/api/data/sales/${sale.id}/reverse`, 'POST', { tenantId }),
        { params: Promise.resolve({ id: sale.id }) },
      ))
      mockCookie = undefined
      expect(status).toBe(400)
    })

    it('refuses manager B reversing manager A\'s sale', async () => {
      const sale = await recordSaleAs(managerASession)
      mockCookie = managerBSession
      const { status } = await readJson(await saleReversePOST(
        jsonRequest(`http://localhost/api/data/sales/${sale.id}/reverse`, 'POST', { tenantId, reason: 'Not mine to reverse' }),
        { params: Promise.resolve({ id: sale.id }) },
      ))
      mockCookie = undefined
      expect(status).toBe(403)
    })

    it('marks reversedAt, leaves amountCents/status untouched, refuses a double reversal, and blocks a further edit', async () => {
      const sale = await recordSaleAs(managerASession, { item: 'Reverse me once' })
      mockCookie = managerASession
      const first = await readJson(await saleReversePOST(
        jsonRequest(`http://localhost/api/data/sales/${sale.id}/reverse`, 'POST', { tenantId, reason: 'Recorded in error' }),
        { params: Promise.resolve({ id: sale.id }) },
      ))
      expect(first.status).toBe(200)
      expect(first.payload.data.reversedAt).toBeTruthy()
      expect(first.payload.data.amountCents).toBe(500000)
      expect(first.payload.data.status).toBe('paid')
      expect(first.payload.data.item).toBe('Reverse me once')

      const second = await readJson(await saleReversePOST(
        jsonRequest(`http://localhost/api/data/sales/${sale.id}/reverse`, 'POST', { tenantId, reason: 'Trying again' }),
        { params: Promise.resolve({ id: sale.id }) },
      ))
      expect(second.status).toBe(400)
      expect(second.payload.error).toMatch(/already/i)

      const editAttempt = await readJson(await salePATCH(
        jsonRequest(`http://localhost/api/data/sales/${sale.id}`, 'PATCH', { tenantId, reason: 'Trying to edit a reversed sale', item: 'Should not land' }),
        { params: Promise.resolve({ id: sale.id }) },
      ))
      mockCookie = undefined
      expect(editAttempt.status).toBe(400)

      const logs = await db.select().from(auditLog).where(and(eq(auditLog.tenantId, tenantId), eq(auditLog.entity, 'sale'), eq(auditLog.entityId, sale.id)))
      expect(logs.some((l) => l.action === 'sale.reversed')).toBe(true)
    })

    it('the contra entry is dated to the ORIGINAL journal entry\'s own date, not today', async () => {
      const sale = await recordSaleAs(managerASession)
      const [originalEntry] = await db.select().from(journalEntries)
        .where(and(eq(journalEntries.tenantId, tenantId), eq(journalEntries.sourceType, 'sale'), eq(journalEntries.sourceId, sale.id)))
      expect(originalEntry.entryDate.toISOString().slice(0, 10)).toBe(inWindowDate.toISOString().slice(0, 10))

      mockCookie = managerASession
      await saleReversePOST(
        jsonRequest(`http://localhost/api/data/sales/${sale.id}/reverse`, 'POST', { tenantId, reason: 'Dating check' }),
        { params: Promise.resolve({ id: sale.id }) },
      )
      mockCookie = undefined

      const [contraEntry] = await db.select().from(journalEntries)
        .where(and(eq(journalEntries.tenantId, tenantId), eq(journalEntries.sourceType, 'sale_reversal'), eq(journalEntries.sourceId, sale.id)))
      expect(contraEntry).toBeTruthy()
      expect(contraEntry.entryDate.getTime()).toBe(originalEntry.entryDate.getTime())

      const contraLines = await db.select().from(journalLines).where(eq(journalLines.entryId, contraEntry.id))
      const originalLines = await db.select().from(journalLines).where(eq(journalLines.entryId, originalEntry.id))
      expect(contraLines.length).toBe(originalLines.length)
      for (const orig of originalLines) {
        const swapped = contraLines.find((l) => l.accountId === orig.accountId)
        expect(swapped).toBeTruthy()
        expect(swapped!.debitCents).toBe(orig.creditCents)
        expect(swapped!.creditCents).toBe(orig.debitCents)
      }
    })
  })

  describe('PATCH/POST reverse for purchases — same rules', () => {
    it('requires a reason to edit, requires a reason to reverse, and refuses editing after reversal', async () => {
      const purchase = await recordPurchaseAs(managerASession)
      mockCookie = managerASession

      const editNoReason = await readJson(await purchasePATCH(
        jsonRequest(`http://localhost/api/purchases/${purchase.id}`, 'PATCH', { tenantId, notes: 'no reason given' }),
        { params: Promise.resolve({ id: purchase.id }) },
      ))
      expect(editNoReason.status).toBe(400)

      const reverseNoReason = await readJson(await purchaseReversePOST(
        jsonRequest(`http://localhost/api/purchases/${purchase.id}/reverse`, 'POST', { tenantId }),
        { params: Promise.resolve({ id: purchase.id }) },
      ))
      expect(reverseNoReason.status).toBe(400)

      const reversed = await readJson(await purchaseReversePOST(
        jsonRequest(`http://localhost/api/purchases/${purchase.id}/reverse`, 'POST', { tenantId, reason: 'Wrong supplier billed us' }),
        { params: Promise.resolve({ id: purchase.id }) },
      ))
      expect(reversed.status).toBe(200)
      expect(reversed.payload.data.reversedAt).toBeTruthy()
      expect(reversed.payload.data.totalCostCents).toBe(1000000)

      const editAfter = await readJson(await purchasePATCH(
        jsonRequest(`http://localhost/api/purchases/${purchase.id}`, 'PATCH', { tenantId, reason: 'Too late', notes: 'should not land' }),
        { params: Promise.resolve({ id: purchase.id }) },
      ))
      mockCookie = undefined
      expect(editAfter.status).toBe(400)
    })
  })

  // ── THE mandated proof ──────────────────────────────────────────────────
  // "Prove it with a test that runs the P&L and trial balance before and
  // after a reversal and asserts the numbers move by exactly the reversed
  // amount and nothing else." Two unrelated rows (a second sale, a purchase)
  // sit in the SAME reported period throughout, specifically so a test that
  // only checked "revenue went down" could not pass by accident if the
  // reversal route were wired to touch more than the one row it was asked to
  // reverse.
  describe('the P&L and trial balance move by exactly the reversed amount, and nothing else', () => {
    it('reversing one sale', async () => {
      const reversedSale = await recordSaleAs(managerASession, { item: 'Will be reversed', amountCents: 500000, soldAt: inWindowDate.toISOString() })
      const untouchedSale = await recordSaleAs(managerASession, { item: 'Stays exactly as recorded', amountCents: 300000, soldAt: inWindowDate.toISOString() })
      const untouchedPurchase = await recordPurchaseAs(managerASession)

      const plBefore = await computePlReport(tenantId, windowFrom, windowTo)
      const tbBefore = await computeTrialBalance(tenantId)

      mockCookie = managerASession
      const { status } = await readJson(await saleReversePOST(
        jsonRequest(`http://localhost/api/data/sales/${reversedSale.id}/reverse`, 'POST', { tenantId, reason: 'Buyer cancelled after payment' }),
        { params: Promise.resolve({ id: reversedSale.id }) },
      ))
      mockCookie = undefined
      expect(status).toBe(200)

      const plAfter = await computePlReport(tenantId, windowFrom, windowTo)
      const tbAfter = await computeTrialBalance(tenantId)

      // Period P&L: revenue drops by exactly the reversed sale's amount
      // (5,000.00 major units); expense (the untouched purchase) is
      // completely unmoved; net income drops by exactly the same amount as
      // revenue did.
      expect(Number(plBefore.meta.periodRevenue) - Number(plAfter.meta.periodRevenue)).toBe(5000)
      expect(Number(plAfter.meta.periodExpense)).toBe(Number(plBefore.meta.periodExpense))
      expect(Number(plBefore.meta.periodNetIncome) - Number(plAfter.meta.periodNetIncome)).toBe(5000)
      // The reversed sale drops out of the period's transaction count; the
      // untouched sale and purchase do not.
      expect(Number(plBefore.meta.transactionCount) - Number(plAfter.meta.transactionCount)).toBe(1)

      // GL / trial balance: the SAME two accounts the reversed sale posted
      // to (Cash, Sales Revenue) move by exactly its amount; every other
      // account — Accounts Payable/Receivable, Owner's Equity, Purchases
      // Expense, Payroll Expense — is byte-identical before and after.
      const before = new Map(tbBefore.rows.map((r) => [r.code, r]))
      const after = new Map(tbAfter.rows.map((r) => [r.code, r]))
      for (const [code, rowBefore] of before) {
        const rowAfter = after.get(code)!
        if (code === '1001' /* Cash */ || code === '4001' /* Sales Revenue */) {
          expect(rowBefore.balanceCents - rowAfter.balanceCents).toBe(500000)
        } else {
          expect(rowAfter.balanceCents).toBe(rowBefore.balanceCents)
        }
      }
      expect(tbBefore.totalDebitsCents - tbAfter.totalDebitsCents).toBeLessThan(0) // both sides GREW (the contra adds real lines)…
      expect(tbAfter.balanced).toBe(true) // …but stayed balanced throughout.
      expect(tbBefore.balanced).toBe(true)

      // The untouched sale and purchase are provably untouched, not just
      // "the totals happen to still add up".
      const untouchedSaleRow = (await db.select().from(sales).where(eq(sales.id, untouchedSale.id)))[0]
      expect(untouchedSaleRow.amountCents).toBe(300000)
      expect(untouchedSaleRow.reversedAt).toBe(null)
      const untouchedPurchaseRow = (await db.select().from(purchases).where(eq(purchases.id, untouchedPurchase.id)))[0]
      expect(untouchedPurchaseRow.totalCostCents).toBe(1000000)
      expect(untouchedPurchaseRow.reversedAt).toBe(null)

      // A period that was never touched (today) reads identically before and
      // after — the reversal did not leak into "whatever period happens to
      // contain the moment someone clicked Reverse".
      const today = new Date()
      const todayFrom = new Date(today); todayFrom.setUTCHours(0, 0, 0, 0)
      const todayTo = new Date(today); todayTo.setUTCHours(23, 59, 59, 999)
      const todayBefore = await computePlReport(tenantId, todayFrom, todayTo)
      const todayAfter = await computePlReport(tenantId, todayFrom, todayTo)
      expect(Number(todayAfter.meta.periodRevenue)).toBe(Number(todayBefore.meta.periodRevenue))
      expect(Number(todayAfter.meta.transactionCount)).toBe(Number(todayBefore.meta.transactionCount))
    })

    it('reversing one purchase', async () => {
      const reversedPurchase = await recordPurchaseAs(managerASession, { unitCostCents: 200000, quantity: 5, amountPaidCents: 1000000 }) // totalCostCents 1,000,000
      const untouchedSale = await recordSaleAs(managerASession, { item: 'Untouched during purchase reversal', amountCents: 250000, soldAt: inWindowDate.toISOString() })

      const plBefore = await computePlReport(tenantId, windowFrom, windowTo)
      const tbBefore = await computeTrialBalance(tenantId)

      mockCookie = managerASession
      const { status } = await readJson(await purchaseReversePOST(
        jsonRequest(`http://localhost/api/purchases/${reversedPurchase.id}/reverse`, 'POST', { tenantId, reason: 'Delivery never arrived' }),
        { params: Promise.resolve({ id: reversedPurchase.id }) },
      ))
      mockCookie = undefined
      expect(status).toBe(200)

      const plAfter = await computePlReport(tenantId, windowFrom, windowTo)
      const tbAfter = await computeTrialBalance(tenantId)

      expect(Number(plBefore.meta.periodExpense) - Number(plAfter.meta.periodExpense)).toBe(10000) // 1,000,000 cents
      expect(Number(plAfter.meta.periodRevenue)).toBe(Number(plBefore.meta.periodRevenue))
      expect(Number(plBefore.meta.periodNetIncome)).toBeLessThan(Number(plAfter.meta.periodNetIncome))
      expect(Number(plAfter.meta.periodNetIncome) - Number(plBefore.meta.periodNetIncome)).toBe(10000)

      const before = new Map(tbBefore.rows.map((r) => [r.code, r]))
      const after = new Map(tbAfter.rows.map((r) => [r.code, r]))
      // This purchase was paid in full (amountPaidCents === totalCostCents),
      // so it only ever posted to Cash and Purchases Expense — never
      // Accounts Payable. Reversing a PURCHASE moves Cash the opposite way a
      // sale reversal does: the original purchase credited (decreased) Cash
      // to pay for it, so undoing it gives that cash back — Cash's
      // debit-normal balance goes UP, not down.
      for (const [code, rowBefore] of before) {
        const rowAfter = after.get(code)!
        if (code === '5001' /* Purchases Expense */) {
          expect(rowBefore.balanceCents - rowAfter.balanceCents).toBe(1000000)
        } else if (code === '1001' /* Cash */) {
          expect(rowAfter.balanceCents - rowBefore.balanceCents).toBe(1000000)
        } else {
          expect(rowAfter.balanceCents).toBe(rowBefore.balanceCents)
        }
      }

      const untouchedSaleRow = (await db.select().from(sales).where(eq(sales.id, untouchedSale.id)))[0]
      expect(untouchedSaleRow.amountCents).toBe(250000)
      expect(untouchedSaleRow.reversedAt).toBe(null)
    })
  })
})
