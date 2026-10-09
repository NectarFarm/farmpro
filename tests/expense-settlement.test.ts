// ── An expense on account is a liability someone can see and settle ─────────
// postExpenseJournal credits Accounts Payable for the unpaid part. The supplier
// balance used to sum purchases only, so the trial balance and the supplier
// screen disagreed, and the only way out was reversing the whole expense.
//   1. GET /api/suppliers includes unpaid (non-reversed) expenses.
//   2. POST /api/expenses/[id]/payments settles it as its own Dr AP / Cr Cash
//      entry and leaves the original posting, the amount and every P&L figure
//      exactly as they were.
//   3. Reversing the expense cancels its settlements too.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { eq, inArray } from 'drizzle-orm'

vi.mock('server-only', () => ({}))
let mockCookie: string | undefined
vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({ get: () => (mockCookie ? { value: mockCookie } : undefined) })),
}))

import { POST as expensesPOST } from '@/app/api/expenses/route'
import { POST as paymentsPOST } from '@/app/api/expenses/[id]/payments/route'
import { POST as reversePOST } from '@/app/api/expenses/[id]/reverse/route'
import { GET as suppliersGET } from '@/app/api/suppliers/route'
import { GET as categoriesGET } from '@/app/api/expense-categories/route'
import { db } from '@/db'
import {
  tenants, users, sessions, farms, suppliers, expenses, auditLog,
  journalEntries, journalLines, journalLineDimensions, documentDimensions,
} from '@/db/schemas'
import { createSession, hashSecret } from '@/lib/auth'
import { computePlReport } from '@/lib/reports'
import { computeTrialBalance } from '@/lib/finance'

const run = process.env.DATABASE_URL ? describe : describe.skip

const post = (url: string, body: unknown) =>
  new Request(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
const readJson = async (res: Response) => ({ status: res.status, payload: await res.json() })

run('expense settlement', () => {
  const tenantId = `t-settle-${randomUUID()}`
  const farmId = randomUUID()
  const supplierId = randomUUID()
  const otherSupplierId = randomUUID()
  let ownerId = ''; let token = ''; let categoryId = ''

  beforeAll(async () => {
    await db.insert(tenants).values({ id: tenantId, name: 'Settle Co.', active: true })
    const salt = randomUUID()
    ownerId = randomUUID()
    await db.insert(users).values({
      id: ownerId, tenantId, name: 'Owner', email: `settle-${randomUUID()}@test.ifms`, role: 'owner',
      passwordHash: hashSecret('pw', salt), passwordSalt: salt, status: 'ACTIVE',
    })
    token = await createSession(ownerId)
    await db.insert(farms).values({ id: farmId, tenantId, name: 'Farm', location: 'X', code: `SF-${farmId.slice(0, 6)}` })
    await db.insert(suppliers).values([
      { id: supplierId, tenantId, name: 'Rider Joe' },
      { id: otherSupplierId, tenantId, name: 'Nobody Owed' },
    ])
    mockCookie = token
    const cats = await readJson(await categoriesGET(new Request(`http://x/api/expense-categories?tenantId=${tenantId}`)))
    categoryId = cats.payload.data.find((c: { code: string }) => c.code === 'transport').id
    mockCookie = undefined
  })

  afterAll(async () => {
    const entryIds = (await db.select({ id: journalEntries.id }).from(journalEntries).where(eq(journalEntries.tenantId, tenantId))).map((r) => r.id)
    if (entryIds.length > 0) {
      const lineIds = (await db.select({ id: journalLines.id }).from(journalLines).where(inArray(journalLines.entryId, entryIds))).map((r) => r.id)
      if (lineIds.length > 0) await db.delete(journalLineDimensions).where(inArray(journalLineDimensions.lineId, lineIds))
      await db.delete(journalLines).where(inArray(journalLines.entryId, entryIds))
      await db.delete(journalEntries).where(inArray(journalEntries.id, entryIds))
    }
    await db.delete(documentDimensions).where(eq(documentDimensions.tenantId, tenantId))
    await db.delete(expenses).where(eq(expenses.tenantId, tenantId))
    await db.delete(auditLog).where(eq(auditLog.tenantId, tenantId))
    await db.delete(suppliers).where(eq(suppliers.tenantId, tenantId))
    await db.delete(farms).where(eq(farms.tenantId, tenantId))
    await db.delete(sessions).where(eq(sessions.userId, ownerId))
    await db.delete(users).where(eq(users.id, ownerId))
    await db.delete(tenants).where(eq(tenants.id, tenantId))
  })

  async function balances(): Promise<{ joe: number; nobody: number }> {
    mockCookie = token
    const res = await readJson(await suppliersGET(new Request(`http://x/api/suppliers?tenantId=${tenantId}`)))
    mockCookie = undefined
    const by = (id: string) => res.payload.data.find((s: { id: string }) => s.id === id).balanceCents as number
    return { joe: by(supplierId), nobody: by(otherSupplierId) }
  }
  async function ap(): Promise<number> {
    const tb = await computeTrialBalance(tenantId)
    return tb.rows.find((r) => r.code === '2001')?.creditCents ?? 0
  }
  async function apDebits(): Promise<number> {
    const tb = await computeTrialBalance(tenantId)
    return tb.rows.find((r) => r.code === '2001')?.debitCents ?? 0
  }
  async function pl() {
    const r = await computePlReport(tenantId, new Date('2026-04-01T00:00:00Z'), new Date('2026-04-30T23:59:59Z'))
    return { expense: r.meta.periodExpense, operating: r.meta.periodOperatingExpense }
  }
  const pay = async (id: string, body: Record<string, unknown>) => {
    mockCookie = token
    const res = await readJson(await paymentsPOST(post(`http://x/api/expenses/${id}/payments`, { tenantId, ...body }), { params: Promise.resolve({ id }) }))
    mockCookie = undefined
    return res
  }

  it('an unpaid expense shows in the supplier balance, agrees with the AP ledger, and is settled in parts', async () => {
    expect(await balances()).toEqual({ joe: 0, nobody: 0 })

    mockCookie = token
    const created = await readJson(await expensesPOST(post('http://x/api/expenses', {
      tenantId, payee: 'Rider Joe', supplierId, categoryId, amountCents: 300000, amountPaidCents: 100000,
      paymentMethod: 'Cash', farmId, date: '2026-04-10',
    })))
    mockCookie = undefined
    expect(created.status).toBe(201)
    const expenseId = created.payload.data.expense.id as string

    expect(await balances()).toEqual({ joe: 200000, nobody: 0 })
    expect(await ap()).toBe(200000)

    const plBefore = await pl()
    const [entryBefore] = await db.select().from(journalEntries).where(eq(journalEntries.sourceId, expenseId))

    // refusals
    expect((await pay(expenseId, { amountCents: 50000, paymentMethod: 'Cash', reason: '   ' })).status).toBe(400)
    expect((await pay(expenseId, { amountCents: 0, paymentMethod: 'Cash', reason: 'x' })).status).toBe(400)
    expect((await pay(expenseId, { amountCents: 200001, paymentMethod: 'Cash', reason: 'x' })).status).toBe(400)
    expect((await pay(expenseId, { amountCents: 50000, paymentMethod: 'M-Pesa', reason: 'x' })).status).toBe(400) // reference needed
    expect((await pay(randomUUID(), { amountCents: 50000, paymentMethod: 'Cash', reason: 'x' })).status).toBe(404)
    mockCookie = undefined
    expect((await readJson(await paymentsPOST(post('http://x', { tenantId, amountCents: 1, paymentMethod: 'Cash', reason: 'x' }), { params: Promise.resolve({ id: expenseId }) }))).status).toBe(401)
    expect(await balances()).toEqual({ joe: 200000, nobody: 0 })

    const part = await pay(expenseId, { amountCents: 50000, paymentMethod: 'M-Pesa', paymentReference: 'QWE123', reason: 'Part payment' })
    expect(part.status).toBe(200)
    expect(await balances()).toEqual({ joe: 150000, nobody: 0 })
    expect(await apDebits()).toBe(50000)

    const rest = await pay(expenseId, { amountCents: 150000, paymentMethod: 'Cash', reason: 'Cleared' })
    expect(rest.status).toBe(200)
    expect(await balances()).toEqual({ joe: 0, nobody: 0 })
    expect((await pay(expenseId, { amountCents: 1, paymentMethod: 'Cash', reason: 'again' })).status).toBe(400)

    // The original posting and every reported figure are untouched; the ledger
    // stays balanced and AP nets to zero.
    const [row] = await db.select().from(expenses).where(eq(expenses.id, expenseId))
    expect(row.amountCents).toBe(300000)
    expect(row.amountPaidCents).toBe(300000)
    const [entryAfter] = await db.select().from(journalEntries).where(eq(journalEntries.id, entryBefore.id))
    expect(entryAfter).toEqual(entryBefore)
    expect(await pl()).toEqual(plBefore)
    const tb = await computeTrialBalance(tenantId)
    expect(tb.totalDebitsCents).toBe(tb.totalCreditsCents)
    expect((await ap()) - (await apDebits())).toBe(0)

    const audits = await db.select().from(auditLog).where(eq(auditLog.entityId, expenseId))
    const payments = audits.filter((a) => a.action === 'expense.payment_recorded')
    expect(payments).toHaveLength(2)
    expect((payments[0].meta as { reason: string }).reason).toBeTruthy()
  })

  it('reversing an expense cancels its settlements and drops it from the supplier balance', async () => {
    mockCookie = token
    const created = await readJson(await expensesPOST(post('http://x/api/expenses', {
      tenantId, payee: 'Rider Joe', supplierId, categoryId, amountCents: 80000, amountPaidCents: 0,
      paymentMethod: 'Credit', farmId, date: '2026-04-12',
    })))
    mockCookie = undefined
    const expenseId = created.payload.data.expense.id as string
    expect(await balances()).toEqual({ joe: 80000, nobody: 0 })
    expect((await pay(expenseId, { amountCents: 30000, paymentMethod: 'Cash', reason: 'Part' })).status).toBe(200)

    mockCookie = token
    const rev = await readJson(await reversePOST(
      post(`http://x/api/expenses/${expenseId}/reverse`, { tenantId, reason: 'Entered twice' }),
      { params: Promise.resolve({ id: expenseId }) },
    ))
    mockCookie = undefined
    expect(rev.status).toBe(200)

    expect(await balances()).toEqual({ joe: 0, nobody: 0 })
    expect((await pay(expenseId, { amountCents: 1000, paymentMethod: 'Cash', reason: 'late' })).status).toBe(400)
    const tb = await computeTrialBalance(tenantId)
    expect(tb.totalDebitsCents).toBe(tb.totalCreditsCents)
    expect((await ap()) - (await apDebits())).toBe(0)
  })
})
