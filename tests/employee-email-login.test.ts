// ── Owner-issued manager/vet/auditor sign-ins ───────────────────────────────
// The hole this closes: POST /api/employees/[id]/login can only ever issue a
// worker's phone+PIN account — every other role was refused outright, and
// nothing else in the owner's app could create a login for a manager, vet or
// auditor employee (POST /api/admin/users is super_admin-only). A manager
// added to a fresh tenant therefore could never sign in.
//
// As with tests/worker-login.test.ts, the proof each test is after is not
// "the endpoint returned 201" but "the person can now actually get a working
// password and sign in" — the happy path goes through the same set-password
// token consume flow an approved onboarding applicant uses, then through
// POST /api/auth/login.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { eq, inArray } from 'drizzle-orm'

vi.mock('server-only', () => ({}))

let mockCookie: string | undefined
vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({ get: () => (mockCookie ? { value: mockCookie } : undefined) })),
}))

import { POST as emailLoginPOST } from '@/app/api/employees/[id]/email-login/route'
import { POST as setPasswordPOST } from '@/app/api/set-password/[token]/route'
import { POST as authLoginPOST } from '@/app/api/auth/login/route'
import { db } from '@/db'
import { tenants, users, sessions, employees, auditLog, setPasswordTokens } from '@/db/schemas'
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

run('owner-issued email sign-ins (POST /api/employees/[id]/email-login)', () => {
  const tenantId = `t-${randomUUID()}`
  const otherTenantId = `t-${randomUUID()}`
  const ownerId = `usr-owner-${randomUUID()}`
  const managerCallerId = `usr-manager-caller-${randomUUID()}`
  const otherOwnerId = `usr-other-owner-${randomUUID()}`

  const managerEmployeeId = `emp-manager-${randomUUID()}`
  const vetEmployeeId = `emp-vet-${randomUUID()}`
  const workerEmployeeId = `emp-worker-${randomUUID()}`
  const ownerEmployeeId = `emp-owner-${randomUUID()}`
  const dupTargetEmployeeId = `emp-dup-${randomUUID()}`
  const otherTenantEmployeeId = `emp-other-${randomUUID()}`

  const managerEmail = `grace-${randomUUID()}@example.com`

  let ownerSession: string
  let managerCallerSession: string
  let otherOwnerSession: string
  const issuedUserIds: string[] = []

  beforeAll(async () => {
    await db.insert(tenants).values([
      { id: tenantId, name: 'Email Login Co.', active: true },
      { id: otherTenantId, name: 'Other Co.', active: true },
    ])
    const salt = randomUUID()
    await db.insert(users).values([
      { id: ownerId, tenantId, name: 'Owner', email: `owner-${randomUUID()}@test.ifms`, role: 'owner', passwordHash: hashSecret('pw', salt), passwordSalt: salt, status: 'ACTIVE' },
      { id: managerCallerId, tenantId, name: 'Manager Caller', email: `manager-${randomUUID()}@test.ifms`, role: 'manager', passwordHash: hashSecret('pw', salt), passwordSalt: salt, status: 'ACTIVE' },
      { id: otherOwnerId, tenantId: otherTenantId, name: 'Other Owner', email: `other-${randomUUID()}@test.ifms`, role: 'owner', passwordHash: hashSecret('pw', salt), passwordSalt: salt, status: 'ACTIVE' },
    ])
    await db.insert(employees).values([
      { id: managerEmployeeId, tenantId, name: 'Grace Manager', role: 'manager' },
      { id: vetEmployeeId, tenantId, name: 'Dr. Vet', role: 'vet' },
      { id: workerEmployeeId, tenantId, name: 'Worker Wanjiku', role: 'worker' },
      { id: ownerEmployeeId, tenantId, name: 'Second Owner', role: 'owner' },
      { id: dupTargetEmployeeId, tenantId, name: 'Duplicate Target', role: 'auditor' },
      { id: otherTenantEmployeeId, tenantId: otherTenantId, name: 'Outsider', role: 'manager' },
    ])
    ownerSession = await createSession(ownerId)
    managerCallerSession = await createSession(managerCallerId)
    otherOwnerSession = await createSession(otherOwnerId)
  })

  afterAll(async () => {
    mockCookie = undefined
    if (issuedUserIds.length) {
      await db.delete(setPasswordTokens).where(inArray(setPasswordTokens.userId, issuedUserIds))
      await db.delete(sessions).where(inArray(sessions.userId, issuedUserIds))
      await db.delete(users).where(inArray(users.id, issuedUserIds))
    }
    await db.delete(auditLog).where(inArray(auditLog.tenantId, [tenantId, otherTenantId]))
    await db.delete(employees).where(inArray(employees.tenantId, [tenantId, otherTenantId]))
    await db.delete(sessions).where(inArray(sessions.userId, [ownerId, managerCallerId, otherOwnerId]))
    await db.delete(users).where(inArray(users.id, [ownerId, managerCallerId, otherOwnerId]))
    await db.delete(tenants).where(inArray(tenants.id, [tenantId, otherTenantId]))
  })

  async function issue(id: string, body: unknown, cookie = ownerSession) {
    mockCookie = cookie
    const res = await readJson(await emailLoginPOST(jsonRequest('http://localhost', 'POST', body), { params: Promise.resolve({ id }) }))
    mockCookie = undefined
    if (res.status === 201) issuedUserIds.push(res.payload.data.userId)
    return res
  }

  it('an owner issues a manager a login, and they can set a password and sign in', async () => {
    const { status, payload } = await issue(managerEmployeeId, { email: managerEmail })
    expect(status).toBe(201)
    expect(payload.data.email).toBe(managerEmail)
    expect(typeof payload.data.setPasswordUrl).toBe('string')
    const token = payload.data.setPasswordUrl.split('/').pop()

    // Linked to the person, not floating loose.
    const [emp] = await db.select().from(employees).where(eq(employees.id, managerEmployeeId))
    expect(emp.userId).toBe(payload.data.userId)

    // No usable password was left behind until the token is consumed.
    const setRes = await readJson(await setPasswordPOST(jsonRequest('http://localhost', 'POST', { password: 'a-real-password-1' }), { params: Promise.resolve({ token }) }))
    expect(setRes.status).toBe(200)

    // The point of the whole feature: they can now actually sign in.
    const login = await readJson(await authLoginPOST(jsonRequest('http://localhost/api/auth/login', 'POST', { email: managerEmail, password: 'a-real-password-1' })))
    expect(login.status).toBe(200)
    expect(login.payload.data.role).toBe('manager')
    expect(login.payload.data.tenantId).toBe(tenantId)
  })

  it('also issues a login for a vet', async () => {
    const { status, payload } = await issue(vetEmployeeId, { email: `vet-${randomUUID()}@example.com` })
    expect(status).toBe(201)
    expect(payload.data.userId).toBeTruthy()
  })

  it('refuses a worker — that role uses the PIN route instead', async () => {
    const { status, payload } = await issue(workerEmployeeId, { email: `worker-${randomUUID()}@example.com` })
    expect(status).toBe(400)
    expect(String(payload.error)).toContain('PIN')
  })

  it('refuses to escalate: an owner cannot issue an owner-role login through here', async () => {
    const { status, payload } = await issue(ownerEmployeeId, { email: `second-owner-${randomUUID()}@example.com` })
    expect(status).toBe(403)
    expect(String(payload.error).length).toBeGreaterThan(0)
    const [emp] = await db.select().from(employees).where(eq(employees.id, ownerEmployeeId))
    expect(emp.userId).toBeNull()
  })

  it('refuses a duplicate email already used by another account', async () => {
    const { status, payload } = await issue(dupTargetEmployeeId, { email: managerEmail })
    expect(status).toBe(409)
    expect(payload.fields?.email).toBeTruthy()
  })

  it('refuses a second login for the same employee rather than replacing their credentials', async () => {
    const { status, payload } = await issue(managerEmployeeId, { email: `another-${randomUUID()}@example.com` })
    expect(status).toBe(409)
    expect(String(payload.error)).toContain('already has a login')
  })

  it('rejects an invalid email address', async () => {
    const target = `emp-invalid-${randomUUID()}`
    await db.insert(employees).values({ id: target, tenantId, name: 'Bad Email', role: 'manager' })
    const { status, payload } = await issue(target, { email: 'not-an-email' })
    expect(status).toBe(400)
    expect(payload.fields?.email).toBeTruthy()
  })

  it('a manager cannot issue logins (owner-only), and another tenant\'s owner cannot see the employee at all', async () => {
    const target = `emp-guard-${randomUUID()}`
    await db.insert(employees).values({ id: target, tenantId, name: 'Guard Target', role: 'manager' })

    const byManager = await issue(target, { email: `x-${randomUUID()}@example.com` }, managerCallerSession)
    expect(byManager.status).toBe(403)

    const crossTenant = await issue(managerEmployeeId, { email: `y-${randomUUID()}@example.com` }, otherOwnerSession)
    expect(crossTenant.status).toBe(404)
  })
})
