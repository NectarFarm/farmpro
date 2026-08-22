// ── Payroll v1 (payroll-and-gps task) ───────────────────────────────────────
// Integration tests against real route handlers + real Postgres, same
// pattern as tests/role-permission-enforcement.test.ts / tests/finance.test.ts.
// Skips when DATABASE_URL is unset (CI has no database).
//
// Covers:
//   - an owner can run payroll for a period; only ACTIVE employees with a
//     rate > 0 are paid, snapshotted amounts, a run with zero eligible
//     employees is refused, and running the same period twice is refused.
//   - the run's journal entry is posted and genuinely balances
//     (sum(debitCents) === sum(creditCents)).
//   - a manager is refused the write (canEdit default: 'view', not 'edit')
//     but can still list/view runs (canView default: 'view').
//   - a worker is refused both the write AND the admin list/view routes.
//   - a worker's own payslips (GET /api/payroll/me) show ONLY that worker's
//     payslips, never a coworker's, even when both were paid in the same run.
//   - unauthenticated is 401 on every route.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { eq, inArray } from 'drizzle-orm'

vi.mock('server-only', () => ({}))

let mockCookie: string | undefined
vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({ get: () => (mockCookie ? { value: mockCookie } : undefined) })),
}))

import { GET as runsGET, POST as runsPOST } from '@/app/api/payroll/runs/route'
import { GET as runGET } from '@/app/api/payroll/runs/[id]/route'
import { GET as meGET } from '@/app/api/payroll/me/route'
import { db } from '@/db'
import { tenants, users, sessions, employees, payrollRuns, payslips, journalEntries, journalLines } from '@/db/schemas'
import { createSession, hashSecret } from '@/lib/auth'
import { getRoleAccess, MODULES } from '@/lib/permissions'

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

run('payroll v1 (payroll-and-gps task)', () => {
  const tenantId = `t-payroll-${randomUUID()}`

  const ownerId = randomUUID()
  const managerId = randomUUID()
  const workerAId = randomUUID()
  const workerBId = randomUUID()

  const empAId = randomUUID()
  const empBId = randomUUID()
  const empUnpaidId = randomUUID() // no rate set — must be excluded from every run

  let ownerSession: string
  let managerSession: string
  let workerASession: string
  let workerBSession: string

  const runIds: string[] = []

  beforeAll(async () => {
    await db.insert(tenants).values({ id: tenantId, name: 'Payroll Test Co.', active: true })
    const salt = randomUUID()
    await db.insert(users).values([
      { id: ownerId, tenantId, name: 'Payroll Owner', email: `payroll-owner-${randomUUID()}@test.ifms`, role: 'owner', passwordHash: hashSecret('pw', salt), passwordSalt: salt, status: 'ACTIVE' },
      { id: managerId, tenantId, name: 'Payroll Manager', email: `payroll-manager-${randomUUID()}@test.ifms`, role: 'manager', passwordHash: hashSecret('pw', salt), passwordSalt: salt, status: 'ACTIVE' },
      { id: workerAId, tenantId, name: 'Worker A', email: `payroll-workera-${randomUUID()}@test.ifms`, role: 'worker', passwordHash: hashSecret('pw', salt), passwordSalt: salt, status: 'ACTIVE' },
      { id: workerBId, tenantId, name: 'Worker B', email: `payroll-workerb-${randomUUID()}@test.ifms`, role: 'worker', passwordHash: hashSecret('pw', salt), passwordSalt: salt, status: 'ACTIVE' },
    ])
    await db.insert(employees).values([
      { id: empAId, tenantId, userId: workerAId, name: 'Worker A', phone: '', role: 'worker', monthlySalaryCents: 3000000, status: 'ACTIVE' },
      { id: empBId, tenantId, userId: workerBId, name: 'Worker B', phone: '', role: 'worker', monthlySalaryCents: 2500000, status: 'ACTIVE' },
      { id: empUnpaidId, tenantId, userId: null, name: 'No Rate Set', phone: '', role: 'worker', monthlySalaryCents: 0, status: 'ACTIVE' },
    ])
    ownerSession = await createSession(ownerId)
    managerSession = await createSession(managerId)
    workerASession = await createSession(workerAId)
    workerBSession = await createSession(workerBId)
  })

  afterAll(async () => {
    mockCookie = undefined
    if (runIds.length > 0) {
      await db.delete(payslips).where(inArray(payslips.runId, runIds))
      const entryRows = await db.select({ id: journalEntries.id }).from(journalEntries).where(eq(journalEntries.tenantId, tenantId))
      const entryIds = entryRows.map((r) => r.id)
      if (entryIds.length > 0) await db.delete(journalLines).where(inArray(journalLines.entryId, entryIds))
      await db.delete(journalEntries).where(eq(journalEntries.tenantId, tenantId))
      await db.delete(payrollRuns).where(inArray(payrollRuns.id, runIds))
    }
    await db.delete(employees).where(eq(employees.tenantId, tenantId))
    await db.delete(sessions).where(inArray(sessions.userId, [ownerId, managerId, workerAId, workerBId]))
    await db.delete(users).where(inArray(users.id, [ownerId, managerId, workerAId, workerBId]))
    await db.delete(tenants).where(eq(tenants.id, tenantId))
  })

  describe('authentication before anything else', () => {
    it('every payroll route is 401 with no session', async () => {
      mockCookie = undefined
      expect((await runsPOST(jsonRequest('http://localhost/api/payroll/runs', 'POST', { tenantId, periodStart: '2026-01-01', periodEnd: '2026-01-31' }))).status).toBe(401)
      expect((await runsGET(jsonRequest(`http://localhost/api/payroll/runs?tenantId=${tenantId}`, 'GET'))).status).toBe(401)
      expect((await meGET()).status).toBe(401)
    })
  })

  describe('creating a run', () => {
    it('a manager is refused the write — canEdit(payroll) is false by default', async () => {
      expect(await getRoleAccess(tenantId, 'manager', MODULES.payroll)).not.toBe('edit')
      mockCookie = managerSession
      const before = await db.select().from(payrollRuns).where(eq(payrollRuns.tenantId, tenantId))
      const { status, payload } = await readJson(
        await runsPOST(jsonRequest('http://localhost/api/payroll/runs', 'POST', { tenantId, periodStart: '2026-02-01', periodEnd: '2026-02-28' }))
      )
      expect(status).toBe(403)
      expect(payload.success).toBe(false)
      const after = await db.select().from(payrollRuns).where(eq(payrollRuns.tenantId, tenantId))
      expect(after.length).toBe(before.length)
    })

    it('a worker is refused the write', async () => {
      mockCookie = workerASession
      const { status } = await readJson(
        await runsPOST(jsonRequest('http://localhost/api/payroll/runs', 'POST', { tenantId, periodStart: '2026-02-01', periodEnd: '2026-02-28' }))
      )
      expect(status).toBe(403)
    })

    it('an owner runs payroll: only rated ACTIVE employees are paid, amounts snapshotted, and the journal entry balances', async () => {
      mockCookie = ownerSession
      const { status, payload } = await readJson(
        await runsPOST(jsonRequest('http://localhost/api/payroll/runs', 'POST', { tenantId, periodStart: '2026-03-01', periodEnd: '2026-03-31', memo: 'March payroll' }))
      )
      expect(status).toBe(201)
      expect(payload.success).toBe(true)
      runIds.push(payload.data.run.id)

      expect(payload.data.run.totalAmountCents).toBe(3000000 + 2500000)
      expect(payload.data.run.employeeCount).toBe(2)
      expect(payload.data.payslips).toHaveLength(2)
      // The unpaid (no rate) employee never appears.
      expect(payload.data.payslips.some((p: { employeeId: string }) => p.employeeId === empUnpaidId)).toBe(false)
      const slipA = payload.data.payslips.find((p: { employeeId: string }) => p.employeeId === empAId)
      const slipB = payload.data.payslips.find((p: { employeeId: string }) => p.employeeId === empBId)
      expect(slipA.amountCents).toBe(3000000)
      expect(slipB.amountCents).toBe(2500000)

      // Real ledger entry, genuinely balanced.
      const entryRows = await db.select().from(journalEntries).where(eq(journalEntries.sourceId, payload.data.run.id))
      expect(entryRows).toHaveLength(1)
      const lines = await db.select().from(journalLines).where(eq(journalLines.entryId, entryRows[0].id))
      const totalDebit = lines.reduce((s, l) => s + l.debitCents, 0)
      const totalCredit = lines.reduce((s, l) => s + l.creditCents, 0)
      expect(totalDebit).toBe(totalCredit)
      expect(totalDebit).toBe(3000000 + 2500000)
    })

    it('refuses to create a run for the exact same period twice', async () => {
      mockCookie = ownerSession
      const { status, payload } = await readJson(
        await runsPOST(jsonRequest('http://localhost/api/payroll/runs', 'POST', { tenantId, periodStart: '2026-03-01', periodEnd: '2026-03-31' }))
      )
      expect(status).toBe(400)
      expect(payload.success).toBe(false)
    })

    it('refuses a period with zero eligible employees', async () => {
      const soloTenantId = `t-payroll-solo-${randomUUID()}`
      await db.insert(tenants).values({ id: soloTenantId, name: 'No Rates Co.', active: true })
      const soloOwnerId = randomUUID()
      const salt = randomUUID()
      await db.insert(users).values({ id: soloOwnerId, tenantId: soloTenantId, name: 'Solo Owner', email: `solo-owner-${randomUUID()}@test.ifms`, role: 'owner', passwordHash: hashSecret('pw', salt), passwordSalt: salt, status: 'ACTIVE' })
      mockCookie = await createSession(soloOwnerId)

      const { status, payload } = await readJson(
        await runsPOST(jsonRequest('http://localhost/api/payroll/runs', 'POST', { tenantId: soloTenantId, periodStart: '2026-03-01', periodEnd: '2026-03-31' }))
      )
      expect(status).toBe(400)
      expect(payload.success).toBe(false)

      await db.delete(sessions).where(eq(sessions.userId, soloOwnerId))
      await db.delete(users).where(eq(users.id, soloOwnerId))
      await db.delete(tenants).where(eq(tenants.id, soloTenantId))
    })
  })

  describe('listing and viewing runs (administrative — canView(payroll))', () => {
    it('a manager can list runs and view one (view access by default)', async () => {
      mockCookie = managerSession
      const listRes = await readJson(await runsGET(jsonRequest(`http://localhost/api/payroll/runs?tenantId=${tenantId}`, 'GET')))
      expect(listRes.status).toBe(200)
      expect(listRes.payload.data.length).toBeGreaterThan(0)

      const runRes = await readJson(await runGET(jsonRequest(`http://localhost/api/payroll/runs/${runIds[0]}?tenantId=${tenantId}`, 'GET'), { params: Promise.resolve({ id: runIds[0] }) }))
      expect(runRes.status).toBe(200)
      expect(runRes.payload.data.payslips).toHaveLength(2)
    })

    it('a worker is refused the admin list AND the admin view-one-run route', async () => {
      mockCookie = workerASession
      expect((await runsGET(jsonRequest(`http://localhost/api/payroll/runs?tenantId=${tenantId}`, 'GET'))).status).toBe(403)
      expect(
        (await runGET(jsonRequest(`http://localhost/api/payroll/runs/${runIds[0]}?tenantId=${tenantId}`, 'GET'), { params: Promise.resolve({ id: runIds[0] }) })).status
      ).toBe(403)
    })
  })

  describe('a worker sees only their own payslips — hard requirement', () => {
    it('Worker A sees exactly their own payslip, never Worker B\'s', async () => {
      mockCookie = workerASession
      const { status, payload } = await readJson(await meGET())
      expect(status).toBe(200)
      expect(payload.data.length).toBeGreaterThan(0)
      expect(payload.data.every((p: { amountCents: number }) => p.amountCents === 3000000)).toBe(true)
      // The response carries no employeeId/employeeName field for another
      // worker to have leaked in, and every amount matches Worker A's own
      // rate — Worker B's 2,500,000-cent payslip never appears here.
      expect(payload.data.some((p: { amountCents: number }) => p.amountCents === 2500000)).toBe(false)
    })

    it('Worker B sees exactly their own payslip, never Worker A\'s', async () => {
      mockCookie = workerBSession
      const { status, payload } = await readJson(await meGET())
      expect(status).toBe(200)
      expect(payload.data.length).toBeGreaterThan(0)
      expect(payload.data.every((p: { amountCents: number }) => p.amountCents === 2500000)).toBe(true)
      expect(payload.data.some((p: { amountCents: number }) => p.amountCents === 3000000)).toBe(false)
    })

    it('an employee with no linked login account gets a 404, not another employee\'s data', async () => {
      // No session in this tenant maps to empUnpaidId (userId is null) — there
      // is no login this test can create for it that would prove anything
      // beyond what /api/employees/me already covers, so this just documents
      // the resolution path is by session userId, never by a param.
      mockCookie = ownerSession // owner has no employees row of their own
      const { status } = await readJson(await meGET())
      expect(status).toBe(404)
    })
  })
})
