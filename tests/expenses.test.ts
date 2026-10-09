// An expense that is not stock (issue #416).
// A transport cost posts to its own expense account and creates no inventory
// lot. A stock purchase still creates a lot and still debits Purchases
// Expense. Re-applying the migration does not move a seeded period's P&L
// or trial balance.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { eq, inArray, sql } from 'drizzle-orm'

vi.mock('server-only', () => ({}))

let mockCookie: string | undefined
vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({ get: () => (mockCookie ? { value: mockCookie } : undefined) })),
}))

import { GET as expensesGET, POST as expensesPOST } from '@/app/api/expenses/route'
import { POST as expenseReversePOST } from '@/app/api/expenses/[id]/reverse/route'
import { GET as categoriesGET } from '@/app/api/expense-categories/route'
import { POST as adminCategoriesPOST } from '@/app/api/admin/expense-categories/route'
import { PATCH as adminCategoryPATCH } from '@/app/api/admin/expense-categories/[id]/route'
import { GET as purchasesGET, POST as purchasesPOST } from '@/app/api/purchases/route'
import { POST as salesPOST } from '@/app/api/data/sales/route'
import { POST as payrollPOST } from '@/app/api/payroll/runs/route'
import { POST as payrollPayPOST } from '@/app/api/payroll/runs/[id]/pay/route'
import { db } from '@/db'
import {
  tenants, users, sessions, farms, productionUnits, employees, payslips, payrollRuns,
  purchases, inventoryLots, inventoryItems, expenses, expenseCategories, auditLog,
  journalEntries, journalLines, journalLineDimensions, documentDimensions, accounts,
} from '@/db/schemas'
import { createSession, hashSecret } from '@/lib/auth'
import { computePlReport } from '@/lib/reports'
import { computeTrialBalance } from '@/lib/finance'

const hasDb = !!process.env.DATABASE_URL
const run = hasDb ? describe : describe.skip

const PERIOD_FROM = new Date('2026-03-01T00:00:00.000Z')
const PERIOD_TO = new Date('2026-03-31T23:59:59.999Z')
const PURCHASE_CENTS = 4 * 2500
const SALE_CENTS = 500000
const PAYROLL_CENTS = 200000
const TRANSPORT_CENTS = 200000

function postRequest(url: string, body: unknown): Request {
  return new Request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function patchRequest(url: string, body: unknown): Request {
  return new Request(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

async function readJson(res: Response) {
  return { status: res.status, payload: await res.json() }
}

async function applyExpenseMigration() {
  const raw = readFileSync(join(process.cwd(), 'drizzle/0051_expense_not_stock.sql'), 'utf8')
  const statements = raw.split('--> statement-breakpoint').map((s) => s.trim()).filter(Boolean)
  for (const statement of statements) {
    await db.execute(sql.raw(statement))
  }
}

async function snapshot(tenantId: string) {
  const pl = await computePlReport(tenantId, PERIOD_FROM, PERIOD_TO)
  const tb = await computeTrialBalance(tenantId)
  const balances: Record<string, { debitCents: number; creditCents: number; balanceCents: number }> = {}
  for (const code of ['1001', '1002', '2001', '4001', '5001', '5002', '5010']) {
    const row = tb.rows.find((r) => r.code === code)
    balances[code] = row
      ? { debitCents: row.debitCents, creditCents: row.creditCents, balanceCents: row.balanceCents }
      : { debitCents: 0, creditCents: 0, balanceCents: 0 }
  }
  return {
    periodRevenue: Number(pl.meta.periodRevenue),
    periodExpense: Number(pl.meta.periodExpense),
    periodPurchaseExpense: Number(pl.meta.periodPurchaseExpense),
    periodPayrollExpense: Number(pl.meta.periodPayrollExpense),
    periodOperatingExpense: Number(pl.meta.periodOperatingExpense),
    totalDebitsCents: tb.totalDebitsCents,
    totalCreditsCents: tb.totalCreditsCents,
    balanced: tb.balanced,
    balances,
  }
}

async function linesForSource(tenantId: string, sourceId: string) {
  const entries = await db.select().from(journalEntries).where(eq(journalEntries.tenantId, tenantId))
  const entry = entries.find((e) => e.sourceId === sourceId && e.sourceType === 'expense')
  if (!entry) return []
  const lines = await db.select().from(journalLines).where(eq(journalLines.entryId, entry.id))
  const accountRows = await db.select().from(accounts)
  const codeById = new Map(accountRows.map((a) => [a.id, a.code]))
  return lines.map((l) => ({ ...l, code: codeById.get(l.accountId) }))
}

describe('finance screen offers an expense that is not a purchase', () => {
  const finance = readFileSync(join(process.cwd(), 'components/farm/finance.tsx'), 'utf8')
  const sheet = readFileSync(join(process.cwd(), 'components/farm/expense-sheet.tsx'), 'utf8')

  it('points the purchase sheet at Record expense', () => {
    expect(finance).toContain('Record expense')
    expect(finance).not.toContain('there is no expense-only record')
  })

  it('the Expenses tab header action opens the expense sheet, and the stock path is labelled as stock', () => {
    expect(finance).toMatch(/if \(tab === 'purchases'\) setShowRecordExpense\(true\)/)
    expect(finance).toContain("tab === 'purchases' ? 'Record expense'")
    expect(finance).not.toContain("'Record purchase'")
    expect(finance).toContain('Record stock purchase')
  })

  it('never copies the amount into Paid now (it goes stale when the amount is corrected)', () => {
    const fn = sheet.slice(sheet.indexOf('function onMethodChange'), sheet.indexOf('async function createSupplier'))
    expect(fn).toContain("if (next === 'Credit') setAmountPaid('0')")
    expect(fn).not.toMatch(/setAmountPaid\((amount|amount\.trim)/)
    expect(fn).toContain("setAmountPaid('')")
  })

  it('uses the styled date and select primitives', () => {
    expect(sheet).toContain('<DateField')
    expect(sheet).toContain('<Select')
    expect(sheet).not.toMatch(/<select[\s>]/)
    expect(sheet).not.toContain('type="date"')
    expect(sheet).toContain('useRequiredDimensions(')
    expect(sheet).toContain("'expense'")
  })
})

run('expenses that are not stock (issue #416)', () => {
  const tenantId = `t-exp-${randomUUID()}`
  const farmId = randomUUID()
  const otherFarmId = randomUUID()
  const unitId = randomUUID()
  const otherUnitId = randomUUID()
  const employeeId = randomUUID()
  let ownerUserId = ''
  let adminUserId = ''
  let ownerToken = ''
  let adminToken = ''
  let transportCategoryId = ''
  const extraCategoryIds: string[] = []

  beforeAll(async () => {
    await applyExpenseMigration()
    await db.insert(tenants).values({ id: tenantId, name: 'Expense Test Co.', active: true })
    const salt = randomUUID()
    ownerUserId = randomUUID()
    adminUserId = randomUUID()
    await db.insert(users).values([
      {
        id: ownerUserId, tenantId, name: 'Expense Owner', email: `owner-exp-${randomUUID()}@test.ifms`,
        role: 'owner', passwordHash: hashSecret('pw', salt), passwordSalt: salt, status: 'ACTIVE',
      },
      {
        id: adminUserId, tenantId: null, name: 'Expense Admin', email: `admin-exp-${randomUUID()}@test.ifms`,
        role: 'super_admin', passwordHash: hashSecret('pw', salt), passwordSalt: salt, status: 'ACTIVE',
      },
    ])
    ownerToken = await createSession(ownerUserId)
    adminToken = await createSession(adminUserId)
    await db.insert(farms).values([
      { id: farmId, tenantId, name: 'Home Farm', location: 'Nakuru', code: `HF-${farmId.slice(0, 6)}` },
      { id: otherFarmId, tenantId, name: 'Other Farm', location: 'Eldoret', code: `OF-${otherFarmId.slice(0, 6)}` },
    ])
    await db.insert(productionUnits).values([
      { id: unitId, tenantId, farmId, type: 'house', name: 'House 1', code: `H1-${unitId.slice(0, 6)}`, status: 'ACTIVE' },
      { id: otherUnitId, tenantId, farmId: otherFarmId, type: 'house', name: 'House Other', code: `HO-${otherUnitId.slice(0, 6)}`, status: 'ACTIVE' },
    ])
    await db.insert(employees).values({
      id: employeeId, tenantId, name: 'March Hand', phone: '', role: 'worker',
      monthlySalaryCents: PAYROLL_CENTS, status: 'ACTIVE', farmId,
    })

    mockCookie = ownerToken
    const sale = await readJson(await salesPOST(postRequest('http://localhost/api/data/sales', {
      tenantId, item: 'Eggs', amountCents: SALE_CENTS, method: 'Cash', status: 'paid',
      soldAt: '2026-03-10', postingDate: '2026-03-10',
    })))
    expect(sale.status).toBe(201)
    const purchase = await readJson(await purchasesPOST(postRequest('http://localhost/api/purchases', {
      tenantId, supplier: 'Unga Ltd', itemName: 'Layer Mash', unit: 'kg', quantity: 4,
      unitCostCents: 2500, amountPaidCents: PURCHASE_CENTS, farmId,
      transactionDate: '2026-03-12', postingDate: '2026-03-12', receivedDate: '2026-03-12',
    })))
    expect(purchase.status).toBe(201)
    const payroll = await readJson(await payrollPOST(postRequest('http://localhost/api/payroll/runs', {
      tenantId, periodStart: '2026-03-01', periodEnd: '2026-03-31', memo: 'March wages',
      employees: [{ employeeId }],
    })))
    expect(payroll.status).toBe(201)
    const payrollPaid = await readJson(await payrollPayPOST(postRequest('http://localhost/api/payroll/runs/pay', {
      tenantId, confirmation: 'PAY', payDate: '2026-03-31', paymentMethod: 'Cash', paymentReference: 'MARCH-WAGES',
    }), { params: Promise.resolve({ id: payroll.payload.data.run.id }) }))
    expect(payrollPaid.status).toBe(200)

    const cats = await readJson(await categoriesGET(new Request(`http://localhost/api/expense-categories?tenantId=${tenantId}`)))
    expect(cats.status).toBe(200)
    transportCategoryId = cats.payload.data.find((c: { code: string }) => c.code === 'transport').id
    expect(transportCategoryId).toBeTruthy()
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
    await db.delete(payslips).where(eq(payslips.tenantId, tenantId))
    await db.delete(payrollRuns).where(eq(payrollRuns.tenantId, tenantId))
    await db.delete(purchases).where(eq(purchases.tenantId, tenantId))
    await db.delete(inventoryLots).where(eq(inventoryLots.tenantId, tenantId))
    await db.delete(inventoryItems).where(eq(inventoryItems.tenantId, tenantId))
    await db.delete(employees).where(eq(employees.tenantId, tenantId))
    await db.delete(productionUnits).where(eq(productionUnits.tenantId, tenantId))
    await db.delete(farms).where(eq(farms.tenantId, tenantId))
    const userIds = [ownerUserId, adminUserId].filter(Boolean)
    if (userIds.length > 0) {
      await db.delete(sessions).where(inArray(sessions.userId, userIds))
      await db.delete(users).where(inArray(users.id, userIds))
    }
    await db.delete(tenants).where(eq(tenants.id, tenantId))
    if (extraCategoryIds.length > 0) {
      await db.delete(expenseCategories).where(inArray(expenseCategories.id, extraCategoryIds))
    }
  })

  function expenseBody(overrides: Record<string, unknown> = {}) {
    return {
      tenantId,
      payee: 'Boda rider',
      categoryId: transportCategoryId,
      amountCents: TRANSPORT_CENTS,
      amountPaidCents: TRANSPORT_CENTS,
      paymentMethod: 'Cash',
      farmId,
      date: '2026-03-18',
      ...overrides,
    }
  }

  it('keeps a stock purchase on the inventory path', async () => {
    const lots = await db.select().from(inventoryLots).where(eq(inventoryLots.tenantId, tenantId))
    expect(lots).toHaveLength(1)
    expect(lots[0].qtyOnHand).toBe(4)
    const books = await snapshot(tenantId)
    expect(books.balances['5001'].debitCents).toBe(PURCHASE_CENTS)
    expect(books.periodPurchaseExpense).toBe(PURCHASE_CENTS / 100)
    expect(books.periodPayrollExpense).toBe(PAYROLL_CENTS / 100)
    expect(books.periodRevenue).toBe(SALE_CENTS / 100)
    expect(books.periodOperatingExpense).toBe(0)
    expect(books.periodExpense).toBe(books.periodPurchaseExpense + books.periodPayrollExpense)
    expect(books.balanced).toBe(true)
  })

  it('re-applying the migration does not move the seeded period', async () => {
    const before = await snapshot(tenantId)
    await applyExpenseMigration()
    const after = await snapshot(tenantId)
    expect(after).toEqual(before)
    expect(after.periodOperatingExpense).toBe(0)
    expect(after.periodExpense).toBe(after.periodPurchaseExpense + after.periodPayrollExpense)
    expect(after.totalDebitsCents).toBe(after.totalCreditsCents)
  })

  it('posts a transport expense to 5010 and creates no stock', async () => {
    mockCookie = ownerToken
    const beforeLots = await db.select().from(inventoryLots).where(eq(inventoryLots.tenantId, tenantId))
    const beforePurchases = await readJson(await purchasesGET(new Request(`http://localhost/api/purchases?tenantId=${tenantId}&farmId=${farmId}`)))
    const before = await snapshot(tenantId)

    const created = await readJson(await expensesPOST(postRequest('http://localhost/api/expenses', expenseBody())))
    expect(created.status).toBe(201)
    const expenseId = created.payload.data.expense.id as string
    expect(created.payload.data.expense.amountCents).toBe(TRANSPORT_CENTS)

    const lots = await db.select().from(inventoryLots).where(eq(inventoryLots.tenantId, tenantId))
    expect(lots).toHaveLength(beforeLots.length)
    const purchasesAfter = await readJson(await purchasesGET(new Request(`http://localhost/api/purchases?tenantId=${tenantId}&farmId=${farmId}`)))
    expect(purchasesAfter.payload.data.map((p: { id: string }) => p.id)).toEqual(beforePurchases.payload.data.map((p: { id: string }) => p.id))
    expect(purchasesAfter.payload.data.some((p: { id: string }) => p.id === expenseId)).toBe(false)

    const listed = await readJson(await expensesGET(new Request(`http://localhost/api/expenses?tenantId=${tenantId}&farmId=${farmId}`)))
    expect(listed.status).toBe(200)
    const row = listed.payload.data.find((e: { id: string }) => e.id === expenseId)
    expect(row.payee).toBe('Boda rider')
    expect(row.accountCode).toBe('5010')
    expect(row.categoryName).toBeTruthy()

    const lines = await linesForSource(tenantId, expenseId)
    expect(lines.find((l) => l.code === '5010')?.debitCents).toBe(TRANSPORT_CENTS)
    expect(lines.find((l) => l.code === '1001')?.creditCents).toBe(TRANSPORT_CENTS)
    expect(lines.some((l) => l.code === '5001')).toBe(false)

    const after = await snapshot(tenantId)
    expect(after.periodOperatingExpense).toBe(before.periodOperatingExpense + TRANSPORT_CENTS / 100)
    expect(after.periodExpense).toBe(before.periodExpense + TRANSPORT_CENTS / 100)
    expect(after.periodPurchaseExpense).toBe(before.periodPurchaseExpense)
    expect(after.periodPayrollExpense).toBe(before.periodPayrollExpense)
    expect(after.periodRevenue).toBe(before.periodRevenue)
    expect(after.balanced).toBe(true)
    expect(after.totalDebitsCents).toBe(before.totalDebitsCents + TRANSPORT_CENTS)
    expect(after.totalCreditsCents).toBe(before.totalCreditsCents + TRANSPORT_CENTS)
    expect(after.balances['5010'].debitCents).toBe(before.balances['5010'].debitCents + TRANSPORT_CENTS)
    expect(after.balances['5001']).toEqual(before.balances['5001'])
    expect(after.balances['5002']).toEqual(before.balances['5002'])
  })

  it('splits a partial payment between cash and accounts payable', async () => {
    mockCookie = ownerToken
    const before = await snapshot(tenantId)
    const created = await readJson(await expensesPOST(postRequest('http://localhost/api/expenses', expenseBody({
      payee: 'Vet on account', amountCents: 200000, amountPaidCents: 50000, date: '2026-03-20',
    }))))
    expect(created.status).toBe(201)
    const lines = await linesForSource(tenantId, created.payload.data.expense.id)
    expect(lines.find((l) => l.code === '5010')?.debitCents).toBe(200000)
    expect(lines.find((l) => l.code === '1001')?.creditCents).toBe(50000)
    expect(lines.find((l) => l.code === '2001')?.creditCents).toBe(150000)
    const after = await snapshot(tenantId)
    expect(after.balanced).toBe(true)
    expect(after.totalDebitsCents).toBe(before.totalDebitsCents + 200000)
    expect(after.balances['2001'].creditCents).toBe(before.balances['2001'].creditCents + 150000)
    expect(after.balances['1001'].creditCents).toBe(before.balances['1001'].creditCents + 50000)
    expect(after.periodOperatingExpense).toBe(before.periodOperatingExpense + 2000)
  })

  it('treats a blank amount paid as unpaid', async () => {
    mockCookie = ownerToken
    const before = await snapshot(tenantId)
    const created = await readJson(await expensesPOST(postRequest('http://localhost/api/expenses', expenseBody({
      payee: 'Unpaid airtime', amountCents: 10000, amountPaidCents: undefined, date: '2026-03-21',
    }))))
    expect(created.status).toBe(201)
    expect(created.payload.data.expense.amountPaidCents).toBe(0)
    const lines = await linesForSource(tenantId, created.payload.data.expense.id)
    expect(lines.find((l) => l.code === '1001')).toBeUndefined()
    expect(lines.find((l) => l.code === '2001')?.creditCents).toBe(10000)
    const after = await snapshot(tenantId)
    expect(after.balances['1001']).toEqual(before.balances['1001'])
    expect(after.periodOperatingExpense).toBe(before.periodOperatingExpense + 100)
    expect(after.balanced).toBe(true)
  })

  it('refuses a missing session, a bad category, a foreign farm, the wrong house, and an overpayment', async () => {
    const before = await snapshot(tenantId)
    const beforeCount = (await db.select().from(expenses).where(eq(expenses.tenantId, tenantId))).length

    mockCookie = undefined
    expect((await readJson(await expensesPOST(postRequest('http://localhost/api/expenses', expenseBody())))).status).toBe(401)

    mockCookie = ownerToken
    expect((await readJson(await expensesPOST(postRequest('http://localhost/api/expenses', expenseBody({ categoryId: '' }))))).status).toBe(400)
    expect((await readJson(await expensesPOST(postRequest('http://localhost/api/expenses', expenseBody({ categoryId: 'missing-category' }))))).status).toBe(400)
    expect((await readJson(await expensesPOST(postRequest('http://localhost/api/expenses', expenseBody({ farmId: randomUUID() }))))).status).toBe(404)
    const wrongHouse = await readJson(await expensesPOST(postRequest('http://localhost/api/expenses', expenseBody({ unitId: otherUnitId }))))
    expect(wrongHouse.status).toBe(400)
    expect(wrongHouse.payload.error).toMatch(/house/i)
    const overpaid = await readJson(await expensesPOST(postRequest('http://localhost/api/expenses', expenseBody({ amountCents: 1000, amountPaidCents: 2000 }))))
    expect(overpaid.status).toBe(400)

    const afterCount = (await db.select().from(expenses).where(eq(expenses.tenantId, tenantId))).length
    expect(afterCount).toBe(beforeCount)
    expect(await snapshot(tenantId)).toEqual(before)
  })

  it('reverses with a contra entry and drops the expense out of the period', async () => {
    mockCookie = ownerToken
    const created = await readJson(await expensesPOST(postRequest('http://localhost/api/expenses', expenseBody({
      payee: 'To reverse', date: '2026-03-22',
    }))))
    expect(created.status).toBe(201)
    const expenseId = created.payload.data.expense.id as string
    const before = await snapshot(tenantId)

    mockCookie = undefined
    expect((await readJson(await expenseReversePOST(
      postRequest(`http://localhost/api/expenses/${expenseId}/reverse`, { tenantId, reason: 'Wrong rider' }),
      { params: Promise.resolve({ id: expenseId }) },
    ))).status).toBe(401)

    mockCookie = ownerToken
    expect((await readJson(await expenseReversePOST(
      postRequest(`http://localhost/api/expenses/${expenseId}/reverse`, { tenantId, reason: '   ' }),
      { params: Promise.resolve({ id: expenseId }) },
    ))).status).toBe(400)

    const reversed = await readJson(await expenseReversePOST(
      postRequest(`http://localhost/api/expenses/${expenseId}/reverse`, { tenantId, reason: 'Wrong rider' }),
      { params: Promise.resolve({ id: expenseId }) },
    ))
    expect(reversed.status).toBe(200)

    const [row] = await db.select().from(expenses).where(eq(expenses.id, expenseId))
    expect(row.reversedAt).toBeTruthy()
    expect(row.amountCents).toBe(TRANSPORT_CENTS)

    const entries = await db.select().from(journalEntries).where(eq(journalEntries.tenantId, tenantId))
    expect(entries.some((e) => e.sourceId === expenseId && e.sourceType === 'expense_reversal')).toBe(true)

    const after = await snapshot(tenantId)
    expect(after.periodOperatingExpense).toBe(before.periodOperatingExpense - TRANSPORT_CENTS / 100)
    expect(after.periodExpense).toBe(before.periodExpense - TRANSPORT_CENTS / 100)
    expect(after.balanced).toBe(true)
    expect(after.totalDebitsCents).toBe(after.totalCreditsCents)
    expect(after.balances['5010'].balanceCents).toBe(before.balances['5010'].balanceCents - TRANSPORT_CENTS)
  })

  it('lets a platform admin add an expense-account category and refuses anything else', async () => {
    const code = `zzexp${randomUUID().replace(/-/g, '').slice(0, 12)}`
    mockCookie = ownerToken
    const asOwner = await readJson(await adminCategoriesPOST(postRequest('http://localhost/api/admin/expense-categories', {
      code, name: 'Owner attempt', accountCode: '5001',
    })))
    expect(asOwner.status).toBe(403)

    mockCookie = adminToken
    const badAccount = await readJson(await adminCategoriesPOST(postRequest('http://localhost/api/admin/expense-categories', {
      code, name: 'Cash is not an expense', accountCode: '1001',
    })))
    expect(badAccount.status).toBe(400)

    const created = await readJson(await adminCategoriesPOST(postRequest('http://localhost/api/admin/expense-categories', {
      code, name: 'Test feed surcharge', accountCode: '5001',
    })))
    expect(created.status).toBe(201)
    extraCategoryIds.push(created.payload.data.id)
    expect(created.payload.data.accountCode).toBe('5001')

    mockCookie = ownerToken
    const visible = await readJson(await categoriesGET(new Request(`http://localhost/api/expense-categories?tenantId=${tenantId}`)))
    expect(visible.payload.data.some((c: { id: string }) => c.id === created.payload.data.id)).toBe(true)

    mockCookie = adminToken
    const deactivated = await readJson(await adminCategoryPATCH(
      patchRequest(`http://localhost/api/admin/expense-categories/${created.payload.data.id}`, { active: false }),
      { params: Promise.resolve({ id: created.payload.data.id }) },
    ))
    expect(deactivated.status).toBe(200)

    mockCookie = ownerToken
    const hidden = await readJson(await categoriesGET(new Request(`http://localhost/api/expense-categories?tenantId=${tenantId}`)))
    expect(hidden.payload.data.some((c: { id: string }) => c.id === created.payload.data.id)).toBe(false)

    const books = await snapshot(tenantId)
    expect(books.balanced).toBe(true)
  })
})
