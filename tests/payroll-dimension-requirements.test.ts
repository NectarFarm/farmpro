// ── Payroll only asks for a dimension an account it posts to requires ──────
// Reporting dimensions -> account rules is the authority. A payroll run posts
// Dr Payroll Expense (5002) / Cr Cash (1001) and nothing else, so the Run
// Payroll sheet's picker (POST /api/dimensions/resolve, docType payroll_run)
// must ask for exactly what those two accounts require: nothing when no rule
// exists, nothing when the rule sits on a sale-only account (Sales Revenue,
// Accounts Receivable), and the dimension when it is Required on 5002 or Cash.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { eq, inArray } from 'drizzle-orm'

vi.mock('server-only', () => ({}))
let mockCookie: string | undefined
vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({ get: () => (mockCookie ? { value: mockCookie } : undefined) })),
}))

import { POST as payrollRunsPOST } from '@/app/api/payroll/runs/route'
import { POST as payrollPayPOST } from '@/app/api/payroll/runs/[id]/pay/route'
import { POST as resolvePOST } from '@/app/api/dimensions/resolve/route'
import { db } from '@/db'
import {
  tenants, users, sessions, farms, productionUnits, employees, accounts, dimensions, dimensionLevels,
  dimensionValues, defaultDimensions, documentDimensions, journalEntries, journalLines, journalLineDimensions,
  payrollRuns, payslips,
} from '@/db/schemas'
import { createSession, hashSecret } from '@/lib/auth'
import { ensureSystemDimensions, projectFarm, projectUnit, SYSTEM_DIMENSION_CODES } from '@/lib/dimensions'
import { ensureAccountsSeeded, ACCOUNT_CODES } from '@/lib/finance'

const run = process.env.DATABASE_URL ? describe : describe.skip
const jsonRequest = (url: string, body: unknown) =>
  new Request(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
const readJson = async (res: Response) => ({ status: res.status, payload: await res.json() })

run('payroll: required dimensions reflect the accounts it actually posts to', () => {
  let tenantId: string; let cookie: string; let employeeId: string
  let unitDimId: string; let unitCode: string
  const acct: Record<string, string> = {}

  async function setRule(code: string) {
    await db.insert(defaultDimensions).values({
      id: randomUUID(), tenantId, masterType: 'account', masterId: acct[code],
      dimensionId: unitDimId, dimensionValueId: null, requirement: 'required',
    })
  }
  async function clearRules() { await db.delete(defaultDimensions).where(eq(defaultDimensions.tenantId, tenantId)) }
  async function previewMissing(): Promise<string[]> {
    mockCookie = cookie
    const res = await readJson(await resolvePOST(jsonRequest('http://x/api/dimensions/resolve', { tenantId, docType: 'payroll_run' })))
    mockCookie = undefined
    expect(res.status).toBe(200)
    return [...new Set<string>(res.payload.data.perAccount.flatMap((a: { requiredMissing: { dimensionCode: string }[] }) => a.requiredMissing.map((m) => m.dimensionCode)))]
  }
  async function savePayroll(period: [string, string], dimensions?: Record<string, string>) {
    mockCookie = cookie
    const res = await readJson(await payrollRunsPOST(jsonRequest('http://x/api/payroll/runs', {
      tenantId, periodStart: period[0], periodEnd: period[1],
      employees: [{ employeeId }],
      ...(dimensions ? { dimensions } : {}),
    })))
    mockCookie = undefined
    return res
  }
  async function payPayroll(runId: string, periodEnd: string, dimensions?: Record<string, string>) {
    mockCookie = cookie
    const res = await readJson(await payrollPayPOST(jsonRequest('http://x/api/payroll/runs/pay', {
      tenantId, confirmation: 'PAY', payDate: periodEnd, paymentMethod: 'Cash', paymentReference: `pay-${runId.slice(0, 8)}`,
      ...(dimensions ? { dimensions } : {}),
    }), { params: Promise.resolve({ id: runId }) }))
    mockCookie = undefined
    return res
  }

  beforeAll(async () => {
    tenantId = `t-payroll-dim-${randomUUID()}`
    await db.insert(tenants).values({ id: tenantId, name: 'Payroll Dim', active: true })
    const ownerId = `usr-${randomUUID()}`; const salt = randomUUID()
    await db.insert(users).values({
      id: ownerId, tenantId, name: 'Owner', email: `pd-${randomUUID()}@test.ifms`, role: 'owner',
      passwordHash: hashSecret('pw', salt), passwordSalt: salt, status: 'ACTIVE',
    })
    cookie = await createSession(ownerId)
    await ensureAccountsSeeded()
    const idByCode = await ensureSystemDimensions(tenantId)
    unitDimId = idByCode.get(SYSTEM_DIMENSION_CODES.UNIT)!
    for (const code of [ACCOUNT_CODES.CASH, ACCOUNT_CODES.PAYROLL_EXPENSE, ACCOUNT_CODES.SALES_REVENUE, ACCOUNT_CODES.ACCOUNTS_RECEIVABLE, ACCOUNT_CODES.PURCHASES_EXPENSE]) {
      acct[code] = (await db.select().from(accounts).where(eq(accounts.code, code)))[0].id
    }
    const farmId = `f-${randomUUID()}`; const unitId = `u-${randomUUID()}`
    unitCode = `UNT-PD-${randomUUID().slice(0, 8)}`
    await db.insert(farms).values({ id: farmId, tenantId, name: 'PD Farm', code: `FRM-PD-${randomUUID().slice(0, 8)}` })
    await projectFarm(db, tenantId, { id: farmId, code: `FRM-PD-${randomUUID().slice(0, 8)}`, name: 'PD Farm' })
    await db.insert(productionUnits).values({ id: unitId, tenantId, farmId, type: 'poultry', name: 'PD Unit', code: unitCode })
    await projectUnit(db, tenantId, { id: unitId, code: unitCode, name: 'PD Unit' })
    employeeId = randomUUID()
    await db.insert(employees).values({ id: employeeId, tenantId, userId: null, name: 'Worker', phone: '', role: 'worker', monthlySalaryCents: 1000000, status: 'ACTIVE', farmId })
  })

  afterAll(async () => {
    const entryIds = (await db.select({ id: journalEntries.id }).from(journalEntries).where(eq(journalEntries.tenantId, tenantId))).map((r) => r.id)
    const lineIds = entryIds.length ? (await db.select({ id: journalLines.id }).from(journalLines).where(inArray(journalLines.entryId, entryIds))).map((l) => l.id) : []
    if (lineIds.length) await db.delete(journalLineDimensions).where(inArray(journalLineDimensions.lineId, lineIds))
    await db.delete(defaultDimensions).where(eq(defaultDimensions.tenantId, tenantId))
    await db.delete(documentDimensions).where(eq(documentDimensions.tenantId, tenantId))
    const dimIds = (await db.select({ id: dimensions.id }).from(dimensions).where(eq(dimensions.tenantId, tenantId))).map((d) => d.id)
    if (dimIds.length) {
      await db.delete(dimensionLevels).where(inArray(dimensionLevels.dimensionId, dimIds))
      await db.delete(dimensionValues).where(inArray(dimensionValues.dimensionId, dimIds))
    }
    await db.delete(dimensions).where(eq(dimensions.tenantId, tenantId))
    if (lineIds.length) await db.delete(journalLines).where(inArray(journalLines.id, lineIds))
    await db.delete(journalEntries).where(eq(journalEntries.tenantId, tenantId))
    const runIds = (await db.select({ id: payrollRuns.id }).from(payrollRuns).where(eq(payrollRuns.tenantId, tenantId))).map((r) => r.id)
    if (runIds.length) await db.delete(payslips).where(inArray(payslips.runId, runIds))
    await db.delete(payrollRuns).where(eq(payrollRuns.tenantId, tenantId))
    await db.delete(employees).where(eq(employees.tenantId, tenantId))
    await db.delete(productionUnits).where(eq(productionUnits.tenantId, tenantId))
    await db.delete(farms).where(eq(farms.tenantId, tenantId))
    await db.delete(sessions).where(inArray(sessions.userId, (await db.select({ id: users.id }).from(users).where(eq(users.tenantId, tenantId))).map((u) => u.id)))
    await db.delete(users).where(eq(users.tenantId, tenantId))
    await db.delete(tenants).where(eq(tenants.id, tenantId))
  })

  it('with no dimension rules, a run needs no pickers and posts when it is paid', async () => {
    expect(await previewMissing()).toEqual([])
    const saved = await savePayroll(['2026-01-01', '2026-01-31'])
    expect(saved.status).toBe(201)
    expect((await payPayroll(saved.payload.data.run.id, '2026-01-31')).status).toBe(200)
  })

  it('a rule on accounts payroll never touches does not make it ask', async () => {
    await clearRules()
    await setRule(ACCOUNT_CODES.SALES_REVENUE)
    await setRule(ACCOUNT_CODES.ACCOUNTS_RECEIVABLE)
    await setRule(ACCOUNT_CODES.PURCHASES_EXPENSE)
    expect(await previewMissing()).toEqual([])
    const saved = await savePayroll(['2026-02-01', '2026-02-28'])
    expect(saved.status).toBe(201)
    expect((await payPayroll(saved.payload.data.run.id, '2026-02-28')).status).toBe(200)
  })

  it('Production Unit Required on the payroll expense account is asked for, refused without, posts once supplied', async () => {
    await clearRules()
    await setRule(ACCOUNT_CODES.PAYROLL_EXPENSE)
    expect(await previewMissing()).toEqual([SYSTEM_DIMENSION_CODES.UNIT])
    const saved = await savePayroll(['2026-03-01', '2026-03-31'])
    expect(saved.status).toBe(201)
    const refused = await payPayroll(saved.payload.data.run.id, '2026-03-31')
    expect(refused.status).toBe(400)
    expect(refused.payload.error).toMatch(/Production Unit/)
    expect((await payPayroll(saved.payload.data.run.id, '2026-03-31', { [SYSTEM_DIMENSION_CODES.UNIT]: unitCode })).status).toBe(200)
  })

  it('Production Unit Required on Cash (which payroll credits) is also asked for', async () => {
    await clearRules()
    await setRule(ACCOUNT_CODES.CASH)
    expect(await previewMissing()).toEqual([SYSTEM_DIMENSION_CODES.UNIT])
    const saved = await savePayroll(['2026-04-01', '2026-04-30'])
    expect(saved.status).toBe(201)
    expect((await payPayroll(saved.payload.data.run.id, '2026-04-30')).status).toBe(400)
    expect((await payPayroll(saved.payload.data.run.id, '2026-04-30', { [SYSTEM_DIMENSION_CODES.UNIT]: unitCode })).status).toBe(200)
  })
})
