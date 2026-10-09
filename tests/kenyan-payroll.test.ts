// Kenyan payroll (issue #420). Casual pay, advances, statutory lines dated
// by the period end, and a backfill that keeps an old run in the same P&L.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { and, eq, inArray, sql } from 'drizzle-orm'

vi.mock('server-only', () => ({}))
let mockCookie: string | undefined
vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({ get: () => (mockCookie ? { value: mockCookie } : undefined) })),
}))

import { POST as runsPOST } from '@/app/api/payroll/runs/route'
import { POST as payPOST } from '@/app/api/payroll/runs/[id]/pay/route'
import { GET as meGET } from '@/app/api/payroll/me/route'
import { GET as pdfGET } from '@/app/api/payroll/payslips/[id]/pdf/route'
import { POST as approvePOST } from '@/app/api/approvals/[id]/approve/route'
import { GET as ratesGET, POST as ratesPOST } from '@/app/api/admin/statutory-rates/route'
import { DELETE as rateDELETE, PATCH as ratePATCH } from '@/app/api/admin/statutory-rates/[id]/route'
import { db } from '@/db'
import {
  tenants, users, sessions, employees, payrollRuns, payslips, payslipLines, statutoryRates,
  journalEntries, journalLines, journalLineDimensions, accounts, postingPolicies,
  approvalRequests, notifications,
} from '@/db/schemas'
import { createSession, hashSecret } from '@/lib/auth'
import { computePlReport } from '@/lib/reports'
import { ACCOUNT_CODES, computeTrialBalance, ensureAccountsSeeded } from '@/lib/finance'
import { computePayroll, type PersonInput, type StatutoryRate } from '@/lib/payroll-calc'

const hasDb = !!process.env.DATABASE_URL
const dbRun = hasDb ? describe : describe.skip

function post(url: string, body: unknown) {
  return new Request(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
}
function patch(url: string, body: unknown) {
  return new Request(url, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
}
async function readJson(res: Response) {
  return { status: res.status, payload: await res.json() }
}

const person = (over: Partial<PersonInput> = {}): PersonInput => ({
  monthlySalaryCents: 1_000_000,
  daysWorked: null,
  dailyRateCents: null,
  overtimeHours: null,
  overtimeRateCents: null,
  lines: [],
  ...over,
})

const rate = (over: Partial<StatutoryRate> & Pick<StatutoryRate, 'code' | 'payer' | 'kind' | 'effectiveFrom'>): StatutoryRate => ({
  rateBps: 0,
  brackets: null,
  ceilingCents: null,
  floorCents: null,
  effectiveTo: null,
  ...over,
})

describe('payroll arithmetic', () => {
  it('pays days and overtime, and an advance reduces net without reducing gross', () => {
    const figures = computePayroll([person({
      monthlySalaryCents: 0,
      daysWorked: 10,
      dailyRateCents: 150_000,
      overtimeHours: 2.5,
      overtimeRateCents: 20_000,
      lines: [{ kind: 'advance', label: 'Advance', amountCents: 10_000 }],
    })], '2026-06-30', [])
    expect('refused' in figures).toBe(false)
    if ('refused' in figures) return
    expect(figures.grossCents).toBe(1_550_000)
    expect(figures.netCents).toBe(1_540_000)
    expect(figures.deductionCents).toBe(10_000)
    expect(figures.expenseCents).toBe(1_550_000)
    expect(figures.people[0].lines.find((line) => line.label === 'Advance')?.amountCents).toBe(-10_000)
    expect(figures.unconfigured).toEqual([
      'PAYE is not configured for this date.',
      'NSSF is not configured for this date.',
      'SHIF is not configured for this date.',
    ])
  })

  it('uses the rate effective on the date it is given, including last year', () => {
    const rates: StatutoryRate[] = [
      rate({ code: 'PAYE', payer: 'employee', kind: 'bracket', effectiveFrom: '2025-01-01', effectiveTo: '2025-12-31', brackets: [{ upToCents: null, rateBps: 1000 }] }),
      rate({ code: 'PAYE', payer: 'employee', kind: 'fixed', effectiveFrom: '2025-01-01', effectiveTo: '2025-12-31', rateBps: 5_000 }),
      rate({ code: 'PAYE', payer: 'employee', kind: 'percent', effectiveFrom: '2026-07-01', effectiveTo: '2026-07-31', rateBps: 2000 }),
      rate({ code: 'NSSF', payer: 'employer', kind: 'percent', effectiveFrom: '2025-01-01', effectiveTo: '2025-12-31', rateBps: 600 }),
    ]
    const lastYear = computePayroll([person()], '2025-06-15', rates)
    const thisYear = computePayroll([person()], '2026-07-15', rates)
    expect('refused' in lastYear || 'refused' in thisYear).toBe(false)
    if ('refused' in lastYear || 'refused' in thisYear) return
    expect(lastYear.people[0].lines.find((line) => line.kind === 'paye')?.amountCents).toBe(-95_000)
    expect(lastYear.people[0].lines.find((line) => line.kind === 'employer_nssf')?.amountCents).toBe(60_000)
    expect(lastYear.unconfigured).not.toContain('NSSF is not configured for this date.')
    expect(lastYear.people[0].lines.some((line) => line.kind === 'nssf')).toBe(false)
    expect(thisYear.people[0].lines.find((line) => line.kind === 'paye')?.amountCents).toBe(-200_000)
    expect(thisYear.expenseCents).toBe(1_000_000)
    expect(thisYear.netCents).toBe(800_000)
  })

  it('refuses a pay that cannot be recorded, and does not invent a zero statutory line', () => {
    const none = computePayroll([person()], '2026-06-30', [])
    expect('refused' in none).toBe(false)
    if ('refused' in none) return
    expect(none.people[0].lines.some((line) => line.kind === 'paye')).toBe(false)
    expect(none.netCents).toBe(none.grossCents)
    expect(computePayroll([person({ lines: [{ kind: 'advance', label: 'Advance', amountCents: 2_000_000 }] })], '2026-06-30', [])).toEqual({ refused: 'Deductions are more than the gross pay.' })
    expect(computePayroll([person({ monthlySalaryCents: 0, daysWorked: 0, dailyRateCents: 100 })], '2026-06-30', [])).toEqual({ refused: 'There is no pay for this person.' })
    expect(computePayroll([person({
      monthlySalaryCents: 0, daysWorked: 1, dailyRateCents: 100, overtimeHours: 1.234, overtimeRateCents: 100,
    })], '2026-06-30', [])).toEqual({ refused: 'Overtime hours can have at most two decimal places.' })
    const doubled = computePayroll([person()], '2026-07-15', [
      rate({ code: 'PAYE', payer: 'employee', kind: 'percent', effectiveFrom: '2026-07-01', rateBps: 1000 }),
      rate({ code: 'PAYE', payer: 'employee', kind: 'percent', effectiveFrom: '2026-07-01', rateBps: 2000 }),
    ])
    expect(doubled).toEqual({ refused: 'More than one PAYE calculation is configured for this date.' })
  })
})

describe('payroll copy', () => {
  it('says housing levy is not calculated, and does not call an unpaid run paid', () => {
    const about = readFileSync(join(process.cwd(), 'components/farm/about.tsx'), 'utf8')
    const panel = readFileSync(join(process.cwd(), 'components/farm/statutory-rates-panel.tsx'), 'utf8')
    const finance = readFileSync(join(process.cwd(), 'components/farm/finance.tsx'), 'utf8')
    expect(about).toContain('Housing levy is not calculated.')
    expect(panel).toContain('Housing levy is not calculated.')
    expect(about).not.toContain('Payroll is gross pay only')
    expect(finance).toContain('Approved — not paid.')
    expect(finance).toContain('Type PAY to record the payment')
    expect(finance).not.toContain('posted to the ledger')
  })
})

async function applyPayrollMigration() {
  const raw = readFileSync(join(process.cwd(), 'drizzle/0057_kenyan_payroll.sql'), 'utf8')
  for (const statement of raw.split('--> statement-breakpoint').map((part) => part.trim()).filter(Boolean)) {
    await db.execute(sql.raw(statement))
  }
}

dbRun('kenyan payroll on the books', () => {
  const tenantId = `t-ke-pay-${randomUUID()}`
  const ownerId = randomUUID()
  const workerAId = randomUUID()
  const workerBId = randomUUID()
  const adminId = randomUUID()
  const empA = randomUUID()
  const empB = randomUUID()
  const empC = randomUUID()
  const empCasual = randomUUID()
  const empNone = randomUUID()
  let ownerToken = ''
  let workerAToken = ''
  let workerBToken = ''
  let adminToken = ''
  const rateIds: string[] = []
  let cashId = ''
  let expenseId = ''
  let payeId = ''

  async function snapshot(from: string, to: string) {
    const pl = await computePlReport(tenantId, new Date(`${from}T00:00:00.000Z`), new Date(`${to}T23:59:59.999Z`))
    const tb = await computeTrialBalance(tenantId)
    return {
      periodPayrollExpense: Number(pl.meta.periodPayrollExpense),
      totalDebitsCents: tb.totalDebitsCents,
      totalCreditsCents: tb.totalCreditsCents,
    }
  }

  async function approve(periodStart: string, periodEnd: string, employees: unknown) {
    mockCookie = ownerToken
    return readJson(await runsPOST(post('http://localhost/api/payroll/runs', {
      tenantId, periodStart, periodEnd, employees,
    })))
  }

  async function pay(runId: string, body: Record<string, unknown>) {
    mockCookie = ownerToken
    return readJson(await payPOST(post('http://localhost/api/payroll/runs/pay', {
      tenantId, payDate: '2026-09-30', paymentMethod: 'Cash', paymentReference: 'REF', ...body,
    }), { params: Promise.resolve({ id: runId }) }))
  }

  beforeAll(async () => {
    await db.insert(tenants).values({ id: tenantId, name: 'Kenyan Payroll', active: true })
    const salt = randomUUID()
    await db.insert(users).values([
      { id: ownerId, tenantId, name: 'Owner', email: `ke-owner-${randomUUID()}@test.ifms`, role: 'owner', passwordHash: hashSecret('pw', salt), passwordSalt: salt, status: 'ACTIVE' },
      { id: workerAId, tenantId, name: 'Asha', email: `ke-a-${randomUUID()}@test.ifms`, role: 'worker', passwordHash: hashSecret('pw', salt), passwordSalt: salt, status: 'ACTIVE' },
      { id: workerBId, tenantId, name: 'Boro', email: `ke-b-${randomUUID()}@test.ifms`, role: 'worker', passwordHash: hashSecret('pw', salt), passwordSalt: salt, status: 'ACTIVE' },
      { id: adminId, tenantId: null, name: 'Catalogue', email: `ke-admin-${randomUUID()}@test.ifms`, role: 'super_admin', passwordHash: hashSecret('pw', salt), passwordSalt: salt, status: 'ACTIVE' },
    ])
    await db.insert(employees).values([
      { id: empA, tenantId, userId: workerAId, name: 'Asha', phone: '', role: 'worker', monthlySalaryCents: 1_000_000, status: 'ACTIVE' },
      { id: empB, tenantId, userId: workerBId, name: 'Boro', phone: '', role: 'worker', monthlySalaryCents: 500_000, status: 'ACTIVE' },
      { id: empC, tenantId, userId: null, name: 'Chao', phone: '', role: 'worker', monthlySalaryCents: 250_000, status: 'ACTIVE' },
      { id: empCasual, tenantId, userId: null, name: 'Day Hand', phone: '', role: 'worker', monthlySalaryCents: 0, status: 'ACTIVE' },
      { id: empNone, tenantId, userId: null, name: 'No Rate', phone: '', role: 'worker', monthlySalaryCents: 0, status: 'ACTIVE' },
    ])
    ownerToken = await createSession(ownerId)
    workerAToken = await createSession(workerAId)
    workerBToken = await createSession(workerBId)
    adminToken = await createSession(adminId)
    await ensureAccountsSeeded()
    const rows = await db.select().from(accounts)
    cashId = rows.find((row) => row.code === ACCOUNT_CODES.CASH)!.id
    expenseId = rows.find((row) => row.code === ACCOUNT_CODES.PAYROLL_EXPENSE)!.id
    payeId = rows.find((row) => row.code === ACCOUNT_CODES.PAYE_PAYABLE)!.id
  })

  afterAll(async () => {
    if (rateIds.length > 0) await db.delete(statutoryRates).where(inArray(statutoryRates.id, rateIds))
    const entryIds = (await db.select({ id: journalEntries.id }).from(journalEntries).where(eq(journalEntries.tenantId, tenantId))).map((row) => row.id)
    if (entryIds.length > 0) {
      const lineIds = (await db.select({ id: journalLines.id }).from(journalLines).where(inArray(journalLines.entryId, entryIds))).map((row) => row.id)
      if (lineIds.length > 0) await db.delete(journalLineDimensions).where(inArray(journalLineDimensions.lineId, lineIds))
      await db.delete(journalLines).where(inArray(journalLines.entryId, entryIds))
      await db.delete(journalEntries).where(inArray(journalEntries.id, entryIds))
    }
    await db.delete(notifications).where(eq(notifications.tenantId, tenantId))
    await db.delete(approvalRequests).where(eq(approvalRequests.tenantId, tenantId))
    await db.delete(postingPolicies).where(eq(postingPolicies.tenantId, tenantId))
    await db.delete(payslips).where(eq(payslips.tenantId, tenantId))
    await db.delete(payrollRuns).where(eq(payrollRuns.tenantId, tenantId))
    await db.delete(employees).where(eq(employees.tenantId, tenantId))
    await db.delete(sessions).where(inArray(sessions.userId, [ownerId, workerAId, workerBId, adminId]))
    await db.delete(users).where(inArray(users.id, [ownerId, workerAId, workerBId, adminId]))
    await db.delete(tenants).where(eq(tenants.id, tenantId))
  })

  it('keeps a seeded run on the same totals when the migration marks it paid', async () => {
    const idTenant = `t-ke-old-${randomUUID()}`
    const idOwner = randomUUID()
    const runId = randomUUID()
    await db.insert(tenants).values({ id: idTenant, name: 'Old Payroll', active: true })
    const salt = randomUUID()
    await db.insert(users).values({
      id: idOwner, tenantId: idTenant, name: 'Old Owner', email: `ke-old-${randomUUID()}@test.ifms`, role: 'owner',
      passwordHash: hashSecret('pw', salt), passwordSalt: salt, status: 'ACTIVE',
    })
    await db.insert(payrollRuns).values({
      id: runId, tenantId: idTenant, periodStart: new Date('2026-03-01T00:00:00.000Z'), periodEnd: new Date('2026-03-31T00:00:00.000Z'),
      totalAmountCents: 200_000, employeeCount: 1, createdByUserId: idOwner, memo: 'already journaled',
    })
    const plBefore = await computePlReport(idTenant, new Date('2026-03-01T00:00:00.000Z'), new Date('2026-03-31T23:59:59.999Z'))
    const tbBefore = await computeTrialBalance(idTenant)
    const before = {
      periodPayrollExpense: Number(plBefore.meta.periodPayrollExpense),
      totalDebitsCents: tbBefore.totalDebitsCents,
      totalCreditsCents: tbBefore.totalCreditsCents,
    }
    expect(before.periodPayrollExpense).toBe(2_000)
    await applyPayrollMigration()
    const [row] = await db.select().from(payrollRuns).where(eq(payrollRuns.id, runId))
    expect(row.status).toBe('paid')
    expect(row.totalAmountCents).toBe(200_000)
    const plAfter = await computePlReport(idTenant, new Date('2026-03-01T00:00:00.000Z'), new Date('2026-03-31T23:59:59.999Z'))
    const tbAfter = await computeTrialBalance(idTenant)
    expect({
      periodPayrollExpense: Number(plAfter.meta.periodPayrollExpense),
      totalDebitsCents: tbAfter.totalDebitsCents,
      totalCreditsCents: tbAfter.totalCreditsCents,
    }).toEqual(before)
    await db.delete(payrollRuns).where(eq(payrollRuns.id, runId))
    await db.delete(sessions).where(eq(sessions.userId, idOwner))
    await db.delete(users).where(eq(users.id, idOwner))
    await db.delete(tenants).where(eq(tenants.id, idTenant))
  })

  it('leaves out people who were not named, and names a person with no rate', async () => {
    const named = await approve('2026-08-01', '2026-08-15', [{ employeeId: empA }])
    expect(named.status).toBe(201)
    expect(named.payload.data.payslips).toHaveLength(1)
    expect(named.payload.data.payslips[0].employeeId).toBe(empA)
    const slips = await db.select().from(payslips).where(eq(payslips.runId, named.payload.data.run.id))
    expect(slips.some((slip) => slip.employeeId === empB || slip.employeeId === empC)).toBe(false)
    const before = await snapshot('2026-08-01', '2026-08-15')
    expect(before.periodPayrollExpense).toBe(0)
    const unnamed = await approve('2026-08-01', '2026-08-15', [{ employeeId: empNone }])
    expect(unnamed.status).toBe(400)
    expect(unnamed.payload.error).toContain('No Rate')
  })

  it('lets a different person share the dates, and refuses the same person twice', async () => {
    const first = await approve('2026-05-01', '2026-05-15', [{ employeeId: empA }])
    expect(first.status).toBe(201)
    const other = await approve('2026-05-01', '2026-05-15', [{ employeeId: empB }])
    expect(other.status).toBe(201)
    const again = await approve('2026-05-10', '2026-05-20', [{ employeeId: empA }])
    expect(again.status).toBe(400)
    expect(again.payload.error).toMatch(/would be paid twice/)
    expect(again.payload.fields.periodStart).toBe('Overlaps a payroll run that already exists')
  })

  it('records a casual payslip from days, overtime and an advance', async () => {
    const saved = await approve('2026-06-01', '2026-06-30', [{
      employeeId: empCasual,
      daysWorked: 10,
      dailyRateCents: 150_000,
      overtimeHours: 2.5,
      overtimeRateCents: 20_000,
      lines: [{ kind: 'advance', label: 'Advance', amountCents: 10_000 }],
    }])
    expect(saved.status).toBe(201)
    expect(saved.payload.data.run.grossCents).toBe(1_550_000)
    expect(saved.payload.data.run.netCents).toBe(1_540_000)
    expect(saved.payload.data.run.deductionCents).toBe(10_000)
    expect(saved.payload.data.run.totalAmountCents).toBe(1_550_000)
    const [slip] = await db.select().from(payslips).where(eq(payslips.runId, saved.payload.data.run.id))
    const lines = await db.select().from(payslipLines).where(eq(payslipLines.payslipId, slip.id))
    expect(lines.find((line) => line.label === 'Days worked')?.amountCents).toBe(1_500_000)
    expect(lines.find((line) => line.label === 'Overtime')?.amountCents).toBe(50_000)
    expect(lines.find((line) => line.kind === 'advance')?.amountCents).toBe(-10_000)
    expect(lines.some((line) => line.kind === 'paye')).toBe(false)
  })

  it('does not post until the word PAY, and a second payment does not post again', async () => {
    const before = await snapshot('2026-09-16', '2026-09-30')
    const saved = await approve('2026-09-16', '2026-09-30', [{ employeeId: empA }])
    expect(saved.status).toBe(201)
    expect(saved.payload.data.run.status).toBe('approved')
    expect(await snapshot('2026-09-16', '2026-09-30')).toEqual(before)
    mockCookie = workerAToken
    const hidden = await readJson(await meGET())
    expect(hidden.payload.data.some((row: { runId: string }) => row.runId === saved.payload.data.run.id)).toBe(false)
    const wrong = await pay(saved.payload.data.run.id, { confirmation: 'pay', payDate: '2026-09-30' })
    expect(wrong.status).toBe(400)
    expect(wrong.payload.error).toBe('Type PAY to record the payment.')
    expect(await snapshot('2026-09-16', '2026-09-30')).toEqual(before)
    const paid = await pay(saved.payload.data.run.id, { confirmation: 'PAY', payDate: '2026-09-30', paymentReference: 'SEPT' })
    expect(paid.status).toBe(200)
    const after = await snapshot('2026-09-16', '2026-09-30')
    expect(after.periodPayrollExpense).toBe(before.periodPayrollExpense + 10_000)
    expect(after.totalDebitsCents).toBe(before.totalDebitsCents + 1_000_000)
    expect(after.totalCreditsCents).toBe(before.totalCreditsCents + 1_000_000)
    const again = await pay(saved.payload.data.run.id, { confirmation: 'PAY', payDate: '2026-09-30' })
    expect(again.status).toBe(400)
    expect(again.payload.error).toBe('This run is already paid.')
    const entries = await db.select().from(journalEntries).where(eq(journalEntries.sourceId, saved.payload.data.run.id))
    expect(entries).toHaveLength(1)
    expect(entries[0].entryDate.getTime()).toBe(new Date('2026-09-30T00:00:00.000Z').getTime())
    mockCookie = workerAToken
    const visible = await readJson(await meGET())
    expect(visible.payload.data.some((row: { runId: string }) => row.runId === saved.payload.data.run.id)).toBe(true)
  })

  it('posts PAYE from the rate effective on the period end, and a later window does not change it', async () => {
    mockCookie = adminToken
    const created = await readJson(await ratesPOST(post('http://localhost/api/admin/statutory-rates', {
      code: 'PAYE', payer: 'employee', kind: 'percent', rateBps: 1000, effectiveFrom: '2026-07-01', effectiveTo: '2026-07-31',
    })))
    expect(created.status).toBe(201)
    rateIds.push(created.payload.data.id)
    try {
      const saved = await approve('2026-07-01', '2026-07-31', [{ employeeId: empA }])
      expect(saved.status).toBe(201)
      expect(saved.payload.data.run.grossCents).toBe(1_000_000)
      expect(saved.payload.data.run.netCents).toBe(900_000)
      expect(saved.payload.data.run.statutoryNote).toMatch(/NSSF is not configured/)
      const [slip] = await db.select().from(payslips).where(eq(payslips.runId, saved.payload.data.run.id))
      const lines = await db.select().from(payslipLines).where(eq(payslipLines.payslipId, slip.id))
      expect(lines.find((line) => line.kind === 'paye')?.amountCents).toBe(-100_000)
      const paid = await pay(saved.payload.data.run.id, { confirmation: 'PAY', payDate: '2026-07-31', paymentReference: 'JULY' })
      expect(paid.status).toBe(200)
      const journal = await db.select().from(journalLines).where(eq(journalLines.entryId, (
        await db.select().from(journalEntries).where(eq(journalEntries.sourceId, saved.payload.data.run.id))
      )[0].id))
      expect(journal.find((line) => line.accountId === expenseId)?.debitCents).toBe(1_000_000)
      expect(journal.find((line) => line.accountId === cashId)?.creditCents).toBe(900_000)
      expect(journal.find((line) => line.accountId === payeId)?.creditCents).toBe(100_000)
      mockCookie = workerAToken
      const pdf = await pdfGET(new Request(`http://localhost/api/payroll/payslips/${slip.id}/pdf?tenantId=${tenantId}`), { params: Promise.resolve({ id: slip.id }) })
      expect(pdf.status).toBe(200)
      expect(pdf.headers.get('content-type')).toBe('application/pdf')
      const bytes = Buffer.from(await pdf.arrayBuffer())
      expect(bytes.subarray(0, 4).toString()).toBe('%PDF')
      expect(bytes.toString('latin1')).toContain('Asha')
      mockCookie = workerBToken
      const hidden = await pdfGET(new Request(`http://localhost/api/payroll/payslips/${slip.id}/pdf?tenantId=${tenantId}`), { params: Promise.resolve({ id: slip.id }) })
      expect(hidden.status).toBe(404)
    } finally {
      await db.delete(statutoryRates).where(eq(statutoryRates.id, created.payload.data.id))
    }
  })

  it('refuses a second statutory rate that overlaps, and an owner cannot add one', async () => {
    mockCookie = undefined
    expect((await ratesPOST(post('http://localhost/api/admin/statutory-rates', {}))).status).toBe(401)
    mockCookie = ownerToken
    expect((await ratesPOST(post('http://localhost/api/admin/statutory-rates', {
      code: 'NSSF', payer: 'employee', kind: 'percent', rateBps: 600, effectiveFrom: '2025-01-01', effectiveTo: '2025-12-31',
    }))).status).toBe(403)
    mockCookie = adminToken
    const empty = await readJson(await ratesGET())
    expect(empty.status).toBe(200)
    const first = await readJson(await ratesPOST(post('http://localhost/api/admin/statutory-rates', {
      code: 'SHIF', payer: 'employee', kind: 'percent', rateBps: 275, effectiveFrom: '2025-01-01', effectiveTo: '2025-06-30',
    })))
    expect(first.status).toBe(201)
    rateIds.push(first.payload.data.id)
    const overlap = await readJson(await ratesPOST(post('http://localhost/api/admin/statutory-rates', {
      code: 'SHIF', payer: 'employee', kind: 'percent', rateBps: 300, effectiveFrom: '2025-06-01', effectiveTo: '2025-12-31',
    })))
    expect(overlap.status).toBe(400)
    expect(overlap.payload.error).toBe('That rate overlaps one already configured for this scheme.')
    const closed = await readJson(await ratePATCH(patch(`http://localhost/api/admin/statutory-rates/${first.payload.data.id}`, {
      effectiveTo: '2024-12-31',
    }), { params: Promise.resolve({ id: first.payload.data.id }) }))
    expect(closed.status).toBe(400)
    await db.delete(statutoryRates).where(eq(statutoryRates.id, first.payload.data.id))
  })

  it('holds the overlap line when rates race, when an end date is stretched, and removes only an unused rate', async () => {
    mockCookie = adminToken
    const body = (rateBps: number, from: string, to: string | null) => post('http://localhost/api/admin/statutory-rates', {
      code: 'NSSF', payer: 'employer', kind: 'percent', rateBps, effectiveFrom: from, effectiveTo: to,
    })
    // Two simultaneous posts for the same window: exactly one may land.
    const raced = await Promise.all([ratesPOST(body(600, '2031-01-01', '2031-12-31')), ratesPOST(body(650, '2031-06-01', '2032-06-30'))])
    const statuses = raced.map((res) => res.status).sort()
    expect(statuses).toEqual([201, 400])
    const landed = await readJson(raced[0].status === 201 ? raced[0] : raced[1])
    rateIds.push(landed.payload.data.id)

    // A neighbour that is clear can be added, then its end date cannot be stretched into the first.
    const next = await readJson(await ratesPOST(body(700, '2033-01-01', '2033-12-31')))
    expect(next.status).toBe(201)
    rateIds.push(next.payload.data.id)
    const stretched = await readJson(await ratePATCH(patch(`http://localhost/api/admin/statutory-rates/${landed.payload.data.id}`, {
      effectiveTo: '2033-06-30',
    }), { params: Promise.resolve({ id: landed.payload.data.id }) }))
    expect(stretched.status).toBe(400)

    // Nothing has been calculated under either, so both can be removed.
    for (const id of [landed.payload.data.id, next.payload.data.id]) {
      const removed = await readJson(await rateDELETE(new Request(`http://localhost/api/admin/statutory-rates/${id}`, { method: 'DELETE' }), { params: Promise.resolve({ id }) }))
      expect(removed.status).toBe(200)
    }
    expect(await db.select().from(statutoryRates).where(inArray(statutoryRates.id, [landed.payload.data.id, next.payload.data.id]))).toHaveLength(0)
    mockCookie = ownerToken
    const denied = await rateDELETE(new Request('http://localhost/api/admin/statutory-rates/x', { method: 'DELETE' }), { params: Promise.resolve({ id: 'x' }) })
    expect(denied.status).toBe(403)
  })

  it('blocks a payment above an amount line and holds one that is pending until it is approved', async () => {
    const blockId = randomUUID()
    await db.insert(postingPolicies).values({
      id: blockId, tenantId, kind: 'amount', effect: 'block', thresholdCents: 1, accountCode: null, farmId: null,
    })
    const blockedRun = await approve('2026-08-16', '2026-08-31', [{ employeeId: empC }])
    expect(blockedRun.status).toBe(201)
    const blocked = await pay(blockedRun.payload.data.run.id, { confirmation: 'PAY', payDate: '2026-08-31', paymentReference: 'BLOCK' })
    expect(blocked.status).toBe(400)
    expect(blocked.payload.error).toMatch(/^Blocked:/)
    const [still] = await db.select().from(payrollRuns).where(eq(payrollRuns.id, blockedRun.payload.data.run.id))
    expect(still.status).toBe('approved')
    expect(await db.select().from(journalEntries).where(eq(journalEntries.sourceId, still.id))).toHaveLength(0)
    await db.delete(postingPolicies).where(eq(postingPolicies.id, blockId))

    const pendingId = randomUUID()
    await db.insert(postingPolicies).values({
      id: pendingId, tenantId, kind: 'amount', effect: 'pending', thresholdCents: 0, accountCode: null, farmId: null,
    })
    const before = await snapshot('2026-09-01', '2026-09-15')
    const heldRun = await approve('2026-09-01', '2026-09-15', [{ employeeId: empB }])
    expect(heldRun.status).toBe(201)
    const held = await pay(heldRun.payload.data.run.id, { confirmation: 'PAY', payDate: '2026-09-15', paymentReference: 'HOLD' })
    expect(held.status).toBe(200)
    expect(held.payload.data.pending).toBe(true)
    expect(await snapshot('2026-09-01', '2026-09-15')).toEqual(before)
    const [approval] = await db.select().from(approvalRequests).where(and(
      eq(approvalRequests.tenantId, tenantId),
      eq(approvalRequests.entityId, heldRun.payload.data.run.id),
    ))
    expect(approval.status).toBe('pending')
    mockCookie = ownerToken
    const approved = await readJson(await approvePOST(post(`http://localhost/api/approvals/${approval.id}/approve`, {}), { params: Promise.resolve({ id: approval.id }) }))
    expect(approved.status).toBe(200)
    const after = await snapshot('2026-09-01', '2026-09-15')
    expect(after.periodPayrollExpense).toBe(before.periodPayrollExpense + 5_000)
    const [entry] = await db.select().from(journalEntries).where(eq(journalEntries.sourceId, heldRun.payload.data.run.id))
    expect(entry.entryDate.getTime()).toBe(new Date('2026-09-15T00:00:00.000Z').getTime())
    const second = await readJson(await approvePOST(post(`http://localhost/api/approvals/${approval.id}/approve`, {}), { params: Promise.resolve({ id: approval.id }) }))
    expect(second.status).toBe(409)
    await db.delete(postingPolicies).where(eq(postingPolicies.id, pendingId))
  })

  it('does not post a journal that would disagree with the stored total', async () => {
    const saved = await approve('2026-04-01', '2026-04-15', [{ employeeId: empC }])
    expect(saved.status).toBe(201)
    const [slip] = await db.select().from(payslips).where(eq(payslips.runId, saved.payload.data.run.id))
    await db.update(payslipLines).set({ amountCents: 1 }).where(eq(payslipLines.payslipId, slip.id))
    const paid = await pay(saved.payload.data.run.id, { confirmation: 'PAY', payDate: '2026-04-15', paymentReference: 'BAD' })
    expect(paid.status).toBe(400)
    expect(paid.payload.error).toBe('Payroll journal does not balance')
    const [run] = await db.select().from(payrollRuns).where(eq(payrollRuns.id, saved.payload.data.run.id))
    expect(run.status).toBe('approved')
    expect(await db.select().from(journalEntries).where(eq(journalEntries.sourceId, run.id))).toHaveLength(0)
  })

  it('prints an old payslip from the stored amount and does not invent a net', async () => {
    const runId = randomUUID()
    const slipId = randomUUID()
    await db.insert(payrollRuns).values({
      id: runId, tenantId, periodStart: new Date('2026-02-01T00:00:00.000Z'), periodEnd: new Date('2026-02-15T00:00:00.000Z'),
      totalAmountCents: 80_000, employeeCount: 1, createdByUserId: ownerId, memo: '', status: 'paid',
    })
    await db.insert(payslips).values({
      id: slipId, tenantId, runId, employeeId: empA, employeeName: 'Asha', amountCents: 80_000,
    })
    mockCookie = ownerToken
    const pdf = await pdfGET(new Request(`http://localhost/api/payroll/payslips/${slipId}/pdf?tenantId=${tenantId}`), { params: Promise.resolve({ id: slipId }) })
    expect(pdf.status).toBe(200)
    expect(Buffer.from(await pdf.arrayBuffer()).toString('latin1')).toContain('before line amounts were stored')
    mockCookie = undefined
    expect((await pdfGET(new Request(`http://localhost/api/payroll/payslips/${slipId}/pdf?tenantId=${tenantId}`), { params: Promise.resolve({ id: slipId }) })).status).toBe(401)
  })
})
