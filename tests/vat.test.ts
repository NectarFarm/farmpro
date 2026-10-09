// VAT codes, inclusive/exclusive, and a period summary (issue #419).
// A document with no tax code posts the same journal it posted before this
// column existed. Re-applying the migration does not move a seeded period.
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

import { POST as salesPOST } from '@/app/api/data/sales/route'
import { POST as purchasesPOST } from '@/app/api/purchases/route'
import { POST as expensesPOST } from '@/app/api/expenses/route'
import { GET as categoriesGET } from '@/app/api/expense-categories/route'
import { POST as payrollPOST } from '@/app/api/payroll/runs/route'
import { GET as vatGET } from '@/app/api/reports/vat/route'
import { GET as taxCodesGET } from '@/app/api/tax-codes/route'
import { GET as adminRatesGET, POST as adminRatesPOST } from '@/app/api/admin/tax-rates/route'
import { PATCH as adminRatePATCH } from '@/app/api/admin/tax-rates/[id]/route'
import { db } from '@/db'
import {
  tenants, users, sessions, farms, productionUnits, employees, payslips, payrollRuns,
  purchases, inventoryLots, inventoryItems, expenses, sales,
  journalEntries, journalLines, journalLineDimensions, documentDimensions, accounts,
  taxCodes, taxRates,
} from '@/db/schemas'
import { createSession, hashSecret } from '@/lib/auth'
import { computePlReport } from '@/lib/reports'
import { computeTrialBalance } from '@/lib/finance'
import { computeTax, pickRate, NO_VAT_RATE_MESSAGE, AMBIGUOUS_VAT_RATE_MESSAGE } from '@/lib/tax'

const hasDb = !!process.env.DATABASE_URL
const run = hasDb ? describe : describe.skip

const PERIOD_FROM = new Date('2026-03-01T00:00:00.000Z')
const PERIOD_TO = new Date('2026-03-31T23:59:59.999Z')
const SALE_CENTS = 500000
const PURCHASE_QTY = 4
const PURCHASE_UNIT = 2500
const PURCHASE_CENTS = PURCHASE_QTY * PURCHASE_UNIT
const PURCHASE_PAID = 5000
const PAYROLL_CENTS = 200000

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

async function applyVatMigration() {
  const raw = readFileSync(join(process.cwd(), 'drizzle/0054_vat.sql'), 'utf8')
  const statements = raw.split('--> statement-breakpoint').map((s) => s.trim()).filter(Boolean)
  for (const statement of statements) {
    await db.execute(sql.raw(statement))
  }
}

async function snapshot(tenantId: string) {
  const pl = await computePlReport(tenantId, PERIOD_FROM, PERIOD_TO)
  const tb = await computeTrialBalance(tenantId)
  const balances: Record<string, { debitCents: number; creditCents: number; balanceCents: number }> = {}
  for (const code of ['1001', '1002', '1300', '2001', '2300', '4001', '5001', '5002']) {
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

async function linesFor(tenantId: string, sourceType: string, sourceId: string) {
  const entries = await db.select().from(journalEntries).where(eq(journalEntries.tenantId, tenantId))
  const entry = entries.find((e) => e.sourceId === sourceId && e.sourceType === sourceType)
  if (!entry) return []
  const lines = await db.select().from(journalLines).where(eq(journalLines.entryId, entry.id))
  const accountRows = await db.select().from(accounts)
  const codeById = new Map(accountRows.map((a) => [a.id, a.code]))
  return lines
    .map((line) => ({
      code: codeById.get(line.accountId),
      debitCents: line.debitCents,
      creditCents: line.creditCents,
    }))
    .sort((a, b) => (a.code ?? '').localeCompare(b.code ?? ''))
}

describe('VAT arithmetic', () => {
  it('rounds an exact half up, and rounds 16% on either side of a half', () => {
    // 50% of 1 cent is exactly 0.5.
    expect(computeTax({ code: 'VATABLE', baseCents: 1, inclusive: false, rateBps: 5000 })).toMatchObject({
      ok: true, taxCents: 1, netCents: 1, grossCents: 2, taxInclusive: false,
    })
    // 1 basis point of 4999 cents is 0.4999; of 5000 cents is exactly 0.5.
    expect(computeTax({ code: 'VATABLE', baseCents: 4999, inclusive: false, rateBps: 1 })).toMatchObject({ ok: true, taxCents: 0 })
    expect(computeTax({ code: 'VATABLE', baseCents: 5000, inclusive: false, rateBps: 1 })).toMatchObject({ ok: true, taxCents: 1, grossCents: 5001 })
    // 16% of 3 cents is 0.48; of 4 cents is 0.64.
    expect(computeTax({ code: 'VATABLE', baseCents: 3, inclusive: false, rateBps: 1600 })).toMatchObject({ ok: true, taxCents: 0, grossCents: 3 })
    expect(computeTax({ code: 'VATABLE', baseCents: 4, inclusive: false, rateBps: 1600 })).toMatchObject({ ok: true, taxCents: 1, grossCents: 5, netCents: 4 })
  })

  it('extracts inclusive VAT and ignores the flag on the other codes', () => {
    expect(computeTax({ code: 'VATABLE', baseCents: 11600, inclusive: true, rateBps: 1600 })).toMatchObject({
      ok: true, grossCents: 11600, taxCents: 1600, netCents: 10000, taxInclusive: true,
    })
    // 16% inclusive of 11 cents is just over a half (remainder 6000 of 11600).
    expect(computeTax({ code: 'VATABLE', baseCents: 11, inclusive: true, rateBps: 1600 })).toMatchObject({
      ok: true, taxCents: 2, netCents: 9, grossCents: 11,
    })
    // 18 cents is just under that half.
    expect(computeTax({ code: 'VATABLE', baseCents: 18, inclusive: true, rateBps: 1600 })).toMatchObject({
      ok: true, taxCents: 2, netCents: 16,
    })
    for (const code of ['ZERO_RATED', 'EXEMPT', 'OUTSIDE_SCOPE']) {
      expect(computeTax({ code, baseCents: 11600, inclusive: true, rateBps: 1600 })).toEqual({
        ok: true, grossCents: 11600, taxCents: 0, netCents: 11600, taxInclusive: null, rateBps: null,
      })
    }
  })

  it('uses integer half-up on a large amount', () => {
    // Above 2^53, and still under the money ceiling once 16% is added.
    const base = 50_000_000_000_000
    const tax = Number((BigInt(base) * BigInt(1600) + BigInt(5000)) / BigInt(10000))
    const result = computeTax({ code: 'VATABLE', baseCents: base, inclusive: false, rateBps: 1600 })
    expect(result).toMatchObject({ ok: true, taxCents: tax, netCents: base, grossCents: base + tax })
    const over = computeTax({ code: 'VATABLE', baseCents: 99_999_999_999_999, inclusive: false, rateBps: 1600 })
    expect(over).toEqual({ ok: false, message: 'The amount with VAT is too large to record.' })
  })

  it('treats the end date as inclusive and refuses two covering rates', () => {
    const rates = [
      { taxCode: 'VATABLE', rateBps: 1600, effectiveFrom: '2026-06-01', effectiveTo: '2026-06-30' },
    ]
    expect(pickRate(rates, 'VATABLE', '2026-06-30')).toMatchObject({ rateBps: 1600 })
    expect(pickRate(rates, 'VATABLE', '2026-07-01')).toBeNull()
    expect(pickRate([
      ...rates,
      { taxCode: 'VATABLE', rateBps: 1400, effectiveFrom: '2026-06-15', effectiveTo: null },
    ], 'VATABLE', '2026-06-20')).toBe('ambiguous')
  })

  it('refuses a VATable date with no rate', () => {
    expect(computeTax({ code: 'VATABLE', baseCents: 100, inclusive: false, rateBps: null })).toEqual({
      ok: false, message: NO_VAT_RATE_MESSAGE,
    })
  })
})

describe('VAT screens', () => {
  const finance = readFileSync(join(process.cwd(), 'components/farm/finance.tsx'), 'utf8')
  const expense = readFileSync(join(process.cwd(), 'components/farm/expense-sheet.tsx'), 'utf8')
  const fields = readFileSync(join(process.cwd(), 'components/farm/tax-fields.tsx'), 'utf8')
  const panel = readFileSync(join(process.cwd(), 'components/farm/tax-rates-panel.tsx'), 'utf8')

  it('puts the tax block on sale, purchase, and expense, and not on payroll', () => {
    const payrollAt = finance.indexOf('function RunPayrollSheet')
    expect(payrollAt).toBeGreaterThan(0)
    const beforePayroll = finance.slice(0, payrollAt)
    expect(beforePayroll.match(/<TaxFields/g)).toHaveLength(2)
    expect(finance.slice(payrollAt)).not.toContain('<TaxFields')
    expect(expense).toContain('<TaxFields')
    expect(fields).not.toMatch(/<select[\s>]/)
    expect(fields).not.toContain('type="date"')
    expect(panel).not.toMatch(/<select[\s>]/)
    expect(panel).not.toContain('type="date"')
    expect(panel).toContain('<DateField')
  })
})

run('VAT on sales, purchases and expenses (issue #419)', () => {
  const tenantId = `t-vat-${randomUUID()}`
  const farmId = randomUUID()
  const unitId = randomUUID()
  const employeeId = randomUUID()
  let ownerUserId = ''
  let adminUserId = ''
  let workerUserId = ''
  let auditorUserId = ''
  let ownerToken = ''
  let adminToken = ''
  let workerToken = ''
  let auditorToken = ''
  let transportCategoryId = ''
  let marchPurchaseId = ''
  const rateIds: string[] = []

  beforeAll(async () => {
    await applyVatMigration()
    await db.insert(tenants).values({ id: tenantId, name: 'VAT Test Co.', active: true })
    const salt = randomUUID()
    ownerUserId = randomUUID()
    adminUserId = randomUUID()
    workerUserId = randomUUID()
    auditorUserId = randomUUID()
    const passwordHash = hashSecret('pw', salt)
    await db.insert(users).values([
      { id: ownerUserId, tenantId, name: 'VAT Owner', email: `owner-vat-${randomUUID()}@test.ifms`, role: 'owner', passwordHash, passwordSalt: salt, status: 'ACTIVE' },
      { id: adminUserId, tenantId: null, name: 'VAT Admin', email: `admin-vat-${randomUUID()}@test.ifms`, role: 'super_admin', passwordHash, passwordSalt: salt, status: 'ACTIVE' },
      { id: workerUserId, tenantId, name: 'VAT Worker', email: `worker-vat-${randomUUID()}@test.ifms`, role: 'worker', passwordHash, passwordSalt: salt, status: 'ACTIVE' },
      { id: auditorUserId, tenantId, name: 'VAT Auditor', email: `auditor-vat-${randomUUID()}@test.ifms`, role: 'auditor', passwordHash, passwordSalt: salt, status: 'ACTIVE' },
    ])
    ownerToken = await createSession(ownerUserId)
    adminToken = await createSession(adminUserId)
    workerToken = await createSession(workerUserId)
    auditorToken = await createSession(auditorUserId)
    await db.insert(farms).values({ id: farmId, tenantId, name: 'VAT Farm', location: 'Nakuru', code: `VF-${farmId.slice(0, 6)}` })
    await db.insert(productionUnits).values({ id: unitId, tenantId, farmId, type: 'house', name: 'House 1', code: `VH-${unitId.slice(0, 6)}`, status: 'ACTIVE' })
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
      tenantId, supplier: 'Unga Ltd', itemName: 'Layer Mash VAT', unit: 'kg', quantity: PURCHASE_QTY,
      unitCostCents: PURCHASE_UNIT, amountPaidCents: PURCHASE_PAID, farmId,
      transactionDate: '2026-03-12', postingDate: '2026-03-12', receivedDate: '2026-03-12',
    })))
    expect(purchase.status).toBe(201)
    marchPurchaseId = purchase.payload.data.purchase.id
    const payroll = await readJson(await payrollPOST(postRequest('http://localhost/api/payroll/runs', {
      tenantId, periodStart: '2026-03-01', periodEnd: '2026-03-31', memo: 'March wages',
    })))
    expect(payroll.status).toBe(201)
    const cats = await readJson(await categoriesGET(new Request(`http://localhost/api/expense-categories?tenantId=${tenantId}`)))
    transportCategoryId = cats.payload.data.find((c: { code: string }) => c.code === 'transport').id
  })

  afterAll(async () => {
    if (rateIds.length > 0) await db.delete(taxRates).where(inArray(taxRates.id, rateIds))
    await db.update(taxCodes).set({ active: true }).where(eq(taxCodes.code, 'EXEMPT'))
    const entryIds = (await db.select({ id: journalEntries.id }).from(journalEntries).where(eq(journalEntries.tenantId, tenantId))).map((r) => r.id)
    if (entryIds.length > 0) {
      const lineIds = (await db.select({ id: journalLines.id }).from(journalLines).where(inArray(journalLines.entryId, entryIds))).map((r) => r.id)
      if (lineIds.length > 0) await db.delete(journalLineDimensions).where(inArray(journalLineDimensions.lineId, lineIds))
      await db.delete(journalLines).where(inArray(journalLines.entryId, entryIds))
      await db.delete(journalEntries).where(inArray(journalEntries.id, entryIds))
    }
    await db.delete(documentDimensions).where(eq(documentDimensions.tenantId, tenantId))
    await db.delete(expenses).where(eq(expenses.tenantId, tenantId))
    await db.delete(sales).where(eq(sales.tenantId, tenantId))
    await db.delete(payslips).where(eq(payslips.tenantId, tenantId))
    await db.delete(payrollRuns).where(eq(payrollRuns.tenantId, tenantId))
    await db.delete(purchases).where(eq(purchases.tenantId, tenantId))
    await db.delete(inventoryLots).where(eq(inventoryLots.tenantId, tenantId))
    await db.delete(inventoryItems).where(eq(inventoryItems.tenantId, tenantId))
    await db.delete(employees).where(eq(employees.tenantId, tenantId))
    await db.delete(productionUnits).where(eq(productionUnits.tenantId, tenantId))
    await db.delete(farms).where(eq(farms.tenantId, tenantId))
    const userIds = [ownerUserId, adminUserId, workerUserId, auditorUserId].filter(Boolean)
    if (userIds.length > 0) {
      await db.delete(sessions).where(inArray(sessions.userId, userIds))
      await db.delete(users).where(inArray(users.id, userIds))
    }
    await db.delete(tenants).where(eq(tenants.id, tenantId))
  })

  it('posts a purchase with no tax code the way it did before VAT', async () => {
    const [row] = await db.select().from(purchases).where(eq(purchases.id, marchPurchaseId))
    expect(row.taxCode).toBeNull()
    expect(row.taxInclusive).toBeNull()
    expect(row.grossCents).toBeNull()
    expect(row.taxCents).toBeNull()
    expect(row.netCents).toBeNull()
    expect(row.totalCostCents).toBe(PURCHASE_CENTS)
    const [lot] = await db.select().from(inventoryLots).where(eq(inventoryLots.tenantId, tenantId))
    expect(lot.unitCostCents).toBe(PURCHASE_UNIT)
    const lines = await linesFor(tenantId, 'purchase', marchPurchaseId)
    expect(lines).toEqual([
      { code: '1001', debitCents: 0, creditCents: PURCHASE_PAID },
      { code: '2001', debitCents: 0, creditCents: PURCHASE_CENTS - PURCHASE_PAID },
      { code: '5001', debitCents: PURCHASE_CENTS, creditCents: 0 },
    ])
  })

  it('re-applying the migration does not move the seeded period', async () => {
    const before = await snapshot(tenantId)
    expect(before.periodRevenue).toBe(SALE_CENTS / 100)
    expect(before.periodPurchaseExpense).toBe(PURCHASE_CENTS / 100)
    expect(before.periodPayrollExpense).toBe(PAYROLL_CENTS / 100)
    expect(before.periodOperatingExpense).toBe(0)
    expect(before.balances['1300'].balanceCents).toBe(0)
    expect(before.balances['2300'].balanceCents).toBe(0)
    await applyVatMigration()
    const after = await snapshot(tenantId)
    expect(after).toEqual(before)
    expect(after.totalDebitsCents).toBe(after.totalCreditsCents)
  })

  it('refuses VATable when no rate covers the posting date, and writes nothing', async () => {
    mockCookie = ownerToken
    const before = await db.select().from(sales).where(eq(sales.tenantId, tenantId))
    const refused = await readJson(await salesPOST(postRequest('http://localhost/api/data/sales', {
      tenantId, item: 'Untaxed attempt', amountCents: 10000, method: 'Cash', status: 'paid',
      soldAt: '2026-01-15', postingDate: '2026-01-15',
      taxCode: 'VATABLE', taxInclusive: false,
    })))
    expect(refused.status).toBe(400)
    expect(refused.payload.error).toBe(NO_VAT_RATE_MESSAGE)
    const after = await db.select().from(sales).where(eq(sales.tenantId, tenantId))
    expect(after).toHaveLength(before.length)
  })

  it('refuses VATable when the amount does not say whether VAT is included', async () => {
    mockCookie = adminToken
    const created = await readJson(await adminRatesPOST(postRequest('http://localhost/api/admin/tax-rates', {
      taxCode: 'VATABLE', percent: '16', effectiveFrom: '2026-06-01', effectiveTo: '2026-06-30',
    })))
    expect(created.status).toBe(201)
    rateIds.push(created.payload.data.id)

    mockCookie = ownerToken
    const refused = await readJson(await salesPOST(postRequest('http://localhost/api/data/sales', {
      tenantId, item: 'No toggle', amountCents: 10000, method: 'Cash', status: 'paid',
      soldAt: '2026-06-15', postingDate: '2026-06-15', taxCode: 'VATABLE',
    })))
    expect(refused.status).toBe(400)
    expect(refused.payload.error).toBe('Say whether the amount includes VAT.')
  })

  it('posts exclusive and inclusive VAT, and keeps the lot unit cost', async () => {
    mockCookie = ownerToken
    const marchBefore = await snapshot(tenantId)

    const exclusive = await readJson(await salesPOST(postRequest('http://localhost/api/data/sales', {
      tenantId, item: 'Exclusive eggs', amountCents: 100000, method: 'Cash', status: 'paid',
      soldAt: '2026-06-15', postingDate: '2026-06-15', taxCode: 'VATABLE', taxInclusive: false,
    })))
    expect(exclusive.status).toBe(201)
    expect(exclusive.payload.data.amountCents).toBe(116000)
    expect(exclusive.payload.data.taxCents).toBe(16000)
    expect(exclusive.payload.data.netCents).toBe(100000)
    expect(exclusive.payload.data.grossCents).toBe(116000)
    const exclusiveLines = await linesFor(tenantId, 'sale', exclusive.payload.data.id)
    expect(exclusiveLines).toEqual([
      { code: '1001', debitCents: 116000, creditCents: 0 },
      { code: '2300', debitCents: 0, creditCents: 16000 },
      { code: '4001', debitCents: 0, creditCents: 100000 },
    ])

    const inclusive = await readJson(await salesPOST(postRequest('http://localhost/api/data/sales', {
      tenantId, item: 'Inclusive eggs', amountCents: 11600, method: 'Cash', status: 'paid',
      soldAt: '2026-06-16', postingDate: '2026-06-16', taxCode: 'VATABLE', taxInclusive: true,
    })))
    expect(inclusive.status).toBe(201)
    expect(inclusive.payload.data.amountCents).toBe(11600)
    expect(inclusive.payload.data.taxCents).toBe(1600)
    expect(inclusive.payload.data.netCents).toBe(10000)

    const purchase = await readJson(await purchasesPOST(postRequest('http://localhost/api/purchases', {
      tenantId, supplier: 'VAT Mill', itemName: 'VAT Mash', unit: 'kg', quantity: 2,
      unitCostCents: 5000, amountPaidCents: 11600, farmId,
      postingDate: '2026-06-17', receivedDate: '2026-06-17',
      taxCode: 'VATABLE', taxInclusive: false,
    })))
    expect(purchase.status).toBe(201)
    expect(purchase.payload.data.purchase.totalCostCents).toBe(11600)
    expect(purchase.payload.data.purchase.taxCents).toBe(1600)
    expect(purchase.payload.data.purchase.netCents).toBe(10000)
    expect(purchase.payload.data.lot.unitCostCents).toBe(5000)
    const purchaseLines = await linesFor(tenantId, 'purchase', purchase.payload.data.purchase.id)
    expect(purchaseLines).toEqual([
      { code: '1001', debitCents: 0, creditCents: 11600 },
      { code: '1300', debitCents: 1600, creditCents: 0 },
      { code: '5001', debitCents: 10000, creditCents: 0 },
    ])

    const expense = await readJson(await expensesPOST(postRequest('http://localhost/api/expenses', {
      tenantId, payee: 'Matatu', categoryId: transportCategoryId,
      amountCents: 100000, amountPaidCents: 116000, paymentMethod: 'Cash', farmId,
      date: '2026-06-18', postingDate: '2026-06-18',
      taxCode: 'VATABLE', taxInclusive: false,
    })))
    expect(expense.status).toBe(201)
    expect(expense.payload.data.expense.amountCents).toBe(116000)
    expect(expense.payload.data.expense.netCents).toBe(100000)
    expect(expense.payload.data.expense.taxCents).toBe(16000)
    const expenseLines = await linesFor(tenantId, 'expense', expense.payload.data.expense.id)
    expect(expenseLines).toEqual([
      { code: '1001', debitCents: 0, creditCents: 116000 },
      { code: '1300', debitCents: 16000, creditCents: 0 },
      { code: '5010', debitCents: 100000, creditCents: 0 },
    ])

    const uncoded = await readJson(await salesPOST(postRequest('http://localhost/api/data/sales', {
      tenantId, item: 'No code', amountCents: 50000, method: 'Cash', status: 'paid',
      soldAt: '2026-06-19', postingDate: '2026-06-19',
    })))
    expect(uncoded.status).toBe(201)
    expect(uncoded.payload.data.taxCode).toBeNull()
    expect(uncoded.payload.data.taxCents).toBeNull()

    for (const [code, amount] of [['ZERO_RATED', 20000], ['EXEMPT', 30000], ['OUTSIDE_SCOPE', 40000]] as const) {
      const posted = await readJson(await salesPOST(postRequest('http://localhost/api/data/sales', {
        tenantId, item: code, amountCents: amount, method: 'Cash', status: 'paid',
        soldAt: '2026-06-20', postingDate: '2026-06-20', taxCode: code, taxInclusive: true,
      })))
      expect(posted.status).toBe(201)
      expect(posted.payload.data.amountCents).toBe(amount)
      expect(posted.payload.data.taxCents).toBe(0)
      expect(posted.payload.data.netCents).toBe(amount)
      expect(posted.payload.data.taxInclusive).toBeNull()
      const lines = await linesFor(tenantId, 'sale', posted.payload.data.id)
      expect(lines.map((line) => line.code)).toEqual(['1001', '4001'])
    }

    const june = await computePlReport(tenantId, new Date('2026-06-01T00:00:00.000Z'), new Date('2026-06-30T23:59:59.999Z'))
    expect(june.meta.periodRevenue).toBe(2500)
    expect(june.meta.periodPurchaseExpense).toBe(100)
    expect(june.meta.periodOperatingExpense).toBe(1000)
    // June journals belong in the trial balance. They must not move March.
    const marchAfter = await snapshot(tenantId)
    expect(marchAfter.periodRevenue).toBe(marchBefore.periodRevenue)
    expect(marchAfter.periodExpense).toBe(marchBefore.periodExpense)
    expect(marchAfter.periodPurchaseExpense).toBe(marchBefore.periodPurchaseExpense)
    expect(marchAfter.periodPayrollExpense).toBe(marchBefore.periodPayrollExpense)
    expect(marchAfter.periodOperatingExpense).toBe(marchBefore.periodOperatingExpense)
    expect(marchAfter.totalDebitsCents).toBeGreaterThan(marchBefore.totalDebitsCents)
    expect(marchAfter.balanced).toBe(true)

    mockCookie = auditorToken
    const report = await readJson(await vatGET(new Request(`http://localhost/api/reports/vat?from=2026-06-01&to=2026-06-30&tenantId=${tenantId}`)))
    expect(report.status).toBe(200)
    expect(report.payload.data.meta.outputTaxCents).toBe(17600)
    expect(report.payload.data.meta.inputTaxCents).toBe(17600)
    expect(report.payload.data.meta.netTaxCents).toBe(0)
    expect(report.payload.data.meta.periodLabel).toContain('01/06/2026')
    expect(report.payload.data.meta.periodLabel).toContain('30/06/2026')
    const uncodedRow = report.payload.data.rows.find((row: (string | number | null)[]) => row[1] === 'No tax code recorded')
    expect(uncodedRow[3]).toBe(500)
    expect(uncodedRow[4]).toBeNull()
    expect(uncodedRow[5]).toBeNull()
    expect(report.payload.data.notes.join(' ')).toContain('not zero-rated')
    expect(report.payload.data.headline[2].caption).toContain('not a refund')

    const storedTax = (await db.select().from(sales).where(eq(sales.tenantId, tenantId)))
      .filter((row) => row.taxCode != null && row.postingDate && row.postingDate >= new Date('2026-06-01') && row.postingDate <= new Date('2026-06-30'))
      .reduce((sum, row) => sum + (row.taxCents ?? 0), 0)
    const storedInput = (await db.select().from(purchases).where(eq(purchases.tenantId, tenantId)))
      .filter((row) => row.taxCode != null)
      .reduce((sum, row) => sum + (row.taxCents ?? 0), 0)
      + (await db.select().from(expenses).where(eq(expenses.tenantId, tenantId)))
        .filter((row) => row.taxCode != null)
        .reduce((sum, row) => sum + (row.taxCents ?? 0), 0)
    expect(report.payload.data.meta.outputTaxCents).toBe(storedTax)
    expect(report.payload.data.meta.inputTaxCents).toBe(storedInput)
  })

  it('refuses an overlapping rate and a day covered by two rates', async () => {
    mockCookie = adminToken
    const overlap = await readJson(await adminRatesPOST(postRequest('http://localhost/api/admin/tax-rates', {
      taxCode: 'VATABLE', percent: '14', effectiveFrom: '2026-06-15', effectiveTo: '2026-07-15',
    })))
    expect(overlap.status).toBe(400)
    expect(overlap.payload.error).toBe('That rate overlaps one already configured for this code.')

    const first = await readJson(await adminRatesPOST(postRequest('http://localhost/api/admin/tax-rates', {
      taxCode: 'VATABLE', percent: '14', effectiveFrom: '2026-08-01', effectiveTo: '2026-08-31',
    })))
    const second = await readJson(await adminRatesPOST(postRequest('http://localhost/api/admin/tax-rates', {
      taxCode: 'VATABLE', percent: '12', effectiveFrom: '2026-08-10', effectiveTo: '2026-08-20',
    })))
    // The route refuses the overlap, so the second insert is the direct-table
    // case the poster also refuses rather than guessing a rate.
    expect(second.status).toBe(400)
    expect(first.status).toBe(201)
    rateIds.push(first.payload.data.id)
    const extraId = randomUUID()
    rateIds.push(extraId)
    await db.insert(taxRates).values({
      id: extraId, taxCode: 'VATABLE', rateBps: 1200, effectiveFrom: '2026-08-10', effectiveTo: '2026-08-20',
    })
    mockCookie = ownerToken
    const refused = await readJson(await salesPOST(postRequest('http://localhost/api/data/sales', {
      tenantId, item: 'Two rates', amountCents: 10000, method: 'Cash', status: 'paid',
      soldAt: '2026-08-15', postingDate: '2026-08-15', taxCode: 'VATABLE', taxInclusive: false,
    })))
    expect(refused.status).toBe(400)
    expect(refused.payload.error).toBe(AMBIGUOUS_VAT_RATE_MESSAGE)
  })

  it('does not let an owner maintain rates, and does not edit a rate in place', async () => {
    mockCookie = undefined
    const anon = await readJson(await adminRatesPOST(postRequest('http://localhost/api/admin/tax-rates', {})))
    expect(anon.status).toBe(401)

    mockCookie = ownerToken
    const owner = await readJson(await adminRatesPOST(postRequest('http://localhost/api/admin/tax-rates', {
      taxCode: 'VATABLE', percent: '16', effectiveFrom: '2026-09-01',
    })))
    expect(owner.status).toBe(403)

    mockCookie = adminToken
    const edited = await readJson(await adminRatePATCH(patchRequest(`http://localhost/api/admin/tax-rates/${rateIds[0]}`, {
      percent: '10',
    }), { params: Promise.resolve({ id: rateIds[0] }) }))
    expect(edited.status).toBe(400)
    expect(edited.payload.error).toBe('A rate cannot be edited. Set an end date and add a new rate.')

    const retired = await readJson(await adminRatePATCH(patchRequest(`http://localhost/api/admin/tax-rates/${rateIds[0]}`, {
      effectiveTo: '2026-06-20',
    }), { params: Promise.resolve({ id: rateIds[0] }) }))
    expect(retired.status).toBe(200)
    expect(retired.payload.data.rateBps).toBe(1600)
    expect(retired.payload.data.effectiveTo).toBe('2026-06-20')
  })

  it('refuses an inactive code and hides it from the sheet catalogue', async () => {
    await db.update(taxCodes).set({ active: false }).where(eq(taxCodes.code, 'EXEMPT'))
    mockCookie = ownerToken
    const refused = await readJson(await salesPOST(postRequest('http://localhost/api/data/sales', {
      tenantId, item: 'Exempt off', amountCents: 1000, method: 'Cash', status: 'paid',
      soldAt: '2026-06-21', postingDate: '2026-06-21', taxCode: 'EXEMPT',
    })))
    expect(refused.status).toBe(400)
    expect(refused.payload.error).toBe('That tax code is not in use.')
    const catalogue = await readJson(await taxCodesGET(new Request(`http://localhost/api/tax-codes?tenantId=${tenantId}`)))
    expect(catalogue.status).toBe(200)
    expect(catalogue.payload.data.codes.map((row: { code: string }) => row.code)).not.toContain('EXEMPT')
    await db.update(taxCodes).set({ active: true }).where(eq(taxCodes.code, 'EXEMPT'))
  })

  it('lets an auditor read the summary and refuses a worker', async () => {
    mockCookie = workerToken
    const worker = await readJson(await vatGET(new Request('http://localhost/api/reports/vat?from=2026-06-01&to=2026-06-30')))
    expect(worker.status).toBe(403)
    mockCookie = auditorToken
    const auditor = await readJson(await vatGET(new Request('http://localhost/api/reports/vat?from=2026-03-01&to=2026-03-31')))
    expect(auditor.status).toBe(200)
    const marchUncoded = auditor.payload.data.rows.filter((row: (string | number | null)[]) => row[1] === 'No tax code recorded')
    expect(marchUncoded.length).toBeGreaterThan(0)
    expect(auditor.payload.data.meta.outputTaxCents).toBe(0)
    expect(auditor.payload.data.headline[0].caption).toBe('No document in this period has a tax code.')
  })

  it('lists the four codes for a tenant and does not seed a rate beyond what this test added', async () => {
    mockCookie = ownerToken
    const catalogue = await readJson(await taxCodesGET(new Request(`http://localhost/api/tax-codes?tenantId=${tenantId}`)))
    expect(catalogue.payload.data.codes.map((row: { code: string }) => row.code).sort()).toEqual([
      'EXEMPT', 'OUTSIDE_SCOPE', 'VATABLE', 'ZERO_RATED',
    ])
    mockCookie = adminToken
    const admin = await readJson(await adminRatesGET())
    const foreign = admin.payload.data.rates.filter((row: { id: string }) => !rateIds.includes(row.id))
    // Other suites do not seed rates. Anything else in the table was not put
    // there by the migration.
    expect(admin.payload.data.rates.every((row: { rateBps: number }) => typeof row.rateBps === 'number')).toBe(true)
    expect(foreign).toEqual([])
  })
})
