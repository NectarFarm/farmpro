// ── Owner-issued worker sign-ins ────────────────────────────────────────────
// The hole these cover: an owner could add an employee and could rotate an
// existing worker's PIN, but nothing in their app could CREATE the account
// those two sit either side of — POST /api/admin/users is super_admin-only.
// A new tenant's workers therefore could not sign in at all, and the owner
// had no action available that would change that.
//
// The proof each test is really after is not "the endpoint returned 201" but
// "the worker can now actually sign in", so the happy path goes all the way
// through POST /api/auth/login with the phone and PIN the owner just set.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { eq, inArray, like } from 'drizzle-orm'

vi.mock('server-only', () => ({}))

let mockCookie: string | undefined
vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({ get: () => (mockCookie ? { value: mockCookie } : undefined) })),
}))

import { GET as loginGET, POST as loginPOST, DELETE as loginDELETE } from '@/app/api/employees/[id]/login/route'
import { POST as authLoginPOST } from '@/app/api/auth/login/route'
import { db } from '@/db'
import { tenants, users, sessions, employees, auditLog, loginThrottle } from '@/db/schemas'
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

run('owner-issued worker sign-ins (POST /api/employees/[id]/login)', () => {
  const tenantId = `t-${randomUUID()}`
  const otherTenantId = `t-${randomUUID()}`
  const ownerId = `usr-owner-${randomUUID()}`
  const workerCallerId = `usr-worker-caller-${randomUUID()}`
  const otherOwnerId = `usr-other-owner-${randomUUID()}`

  const employeeId = `emp-${randomUUID()}`
  const secondEmployeeId = `emp-${randomUUID()}`
  const managerEmployeeId = `emp-${randomUUID()}`
  const otherTenantEmployeeId = `emp-${randomUUID()}`

  // Distinct suffixes so two employees never collide on a phone by accident.
  const workerPhone = '+254711000111'
  const secondPhone = '+254711000222'

  let ownerSession: string
  let workerCallerSession: string
  let otherOwnerSession: string
  const issuedUserIds: string[] = []

  beforeAll(async () => {
    await db.insert(tenants).values([
      { id: tenantId, name: 'Worker Login Co.', active: true },
      { id: otherTenantId, name: 'Other Co.', active: true },
    ])
    const salt = randomUUID()
    await db.insert(users).values([
      { id: ownerId, tenantId, name: 'Owner', email: `owner-${randomUUID()}@test.ifms`, role: 'owner', passwordHash: hashSecret('pw', salt), passwordSalt: salt, status: 'ACTIVE' },
      { id: workerCallerId, tenantId, name: 'Worker Caller', email: `worker-${randomUUID()}@test.ifms`, role: 'worker', passwordHash: hashSecret('pw', salt), passwordSalt: salt, status: 'ACTIVE' },
      { id: otherOwnerId, tenantId: otherTenantId, name: 'Other Owner', email: `other-${randomUUID()}@test.ifms`, role: 'owner', passwordHash: hashSecret('pw', salt), passwordSalt: salt, status: 'ACTIVE' },
    ])
    await db.insert(employees).values([
      { id: employeeId, tenantId, name: 'Jane Wanjiku', phone: workerPhone, role: 'worker' },
      { id: secondEmployeeId, tenantId, name: 'Peter Otieno', phone: '', role: 'worker' },
      { id: managerEmployeeId, tenantId, name: 'Grace Manager', phone: '+254711000333', role: 'manager' },
      { id: otherTenantEmployeeId, tenantId: otherTenantId, name: 'Outsider', phone: '+254711000444', role: 'worker' },
    ])
    ownerSession = await createSession(ownerId)
    workerCallerSession = await createSession(workerCallerId)
    otherOwnerSession = await createSession(otherOwnerId)
  })

  afterAll(async () => {
    mockCookie = undefined
    await db.delete(loginThrottle).where(inArray(loginThrottle.identifier, [`phone:${workerPhone}`, `phone:${secondPhone}`, 'pin:global']))
    await db.delete(auditLog).where(inArray(auditLog.tenantId, [tenantId, otherTenantId]))
    await db.delete(employees).where(inArray(employees.tenantId, [tenantId, otherTenantId]))
    if (issuedUserIds.length) {
      await db.delete(sessions).where(inArray(sessions.userId, issuedUserIds))
      await db.delete(users).where(inArray(users.id, issuedUserIds))
    }
    await db.delete(sessions).where(inArray(sessions.userId, [ownerId, workerCallerId, otherOwnerId]))
    await db.delete(users).where(inArray(users.id, [ownerId, workerCallerId, otherOwnerId]))
    // Any account created by a test that didn't record its id.
    await db.delete(users).where(like(users.email, '%@workers.ifms.local'))
    await db.delete(tenants).where(inArray(tenants.id, [tenantId, otherTenantId]))
  })

  async function issue(id: string, body: unknown, cookie = ownerSession) {
    mockCookie = cookie
    const res = await readJson(await loginPOST(jsonRequest('http://localhost', 'POST', body), { params: Promise.resolve({ id }) }))
    mockCookie = undefined
    if (res.status === 201) issuedUserIds.push(res.payload.data.userId)
    return res
  }

  it('reports no sign-in before one is issued', async () => {
    mockCookie = ownerSession
    const { status, payload } = await readJson(
      await loginGET(new Request('http://localhost'), { params: Promise.resolve({ id: employeeId }) })
    )
    mockCookie = undefined
    expect(status).toBe(200)
    expect(payload.data.hasLogin).toBe(false)
    expect(payload.data.hasPin).toBe(false)
  })

  it('an owner issues a login and the worker can then actually sign in', async () => {
    const { status, payload } = await issue(employeeId, { pin: '4417' })
    expect(status).toBe(201)
    expect(payload.data.phone).toBe(workerPhone)

    // The point of the whole feature.
    const login = await readJson(await authLoginPOST(jsonRequest('http://localhost/api/auth/login', 'POST', { phone: workerPhone, pin: '4417' })))
    expect(login.status).toBe(200)
    expect(login.payload.data.role).toBe('worker')
    expect(login.payload.data.tenantId).toBe(tenantId)

    // Linked to the person, not floating loose.
    const [emp] = await db.select().from(employees).where(eq(employees.id, employeeId))
    expect(emp.userId).toBe(payload.data.userId)

    // No usable password was left behind: the account is PIN-only.
    const [account] = await db.select().from(users).where(eq(users.id, payload.data.userId))
    expect(account.pinHash).toBeTruthy()
    expect(account.email.endsWith('@workers.ifms.local')).toBe(true)
  })

  it('takes the phone from the request when the employee record has none', async () => {
    const { status, payload } = await issue(secondEmployeeId, { pin: '9021', phone: '0711000222' })
    expect(status).toBe(201)
    // Normalised to storage form, and written back onto the employee so the
    // two can't disagree about what the worker signs in with.
    expect(payload.data.phone).toBe(secondPhone)
    const [emp] = await db.select().from(employees).where(eq(employees.id, secondEmployeeId))
    expect(emp.phone).toBe(secondPhone)
  })

  it('refuses a second login for the same employee rather than replacing their credentials', async () => {
    const { status, payload } = await issue(employeeId, { pin: '1234' })
    expect(status).toBe(409)
    expect(String(payload.error)).toContain('already has a login')
  })

  it('refuses a phone that already signs in to another account', async () => {
    const dupEmployeeId = `emp-${randomUUID()}`
    await db.insert(employees).values({ id: dupEmployeeId, tenantId, name: 'Duplicate Phone', phone: workerPhone, role: 'worker' })
    const { status, payload } = await issue(dupEmployeeId, { pin: '5678' })
    expect(status).toBe(409)
    expect(payload.fields.phone).toBeTruthy()
  })

  it('rejects a PIN that is not exactly four digits', async () => {
    for (const pin of ['123', '12345', 'abcd', '']) {
      const { status } = await issue(secondEmployeeId, { pin })
      expect(status).toBe(400)
    }
  })

  it('rejects an unusable phone number outright — a PIN with no phone is a login nobody can use', async () => {
    const noPhoneId = `emp-${randomUUID()}`
    await db.insert(employees).values({ id: noPhoneId, tenantId, name: 'No Phone', phone: '', role: 'worker' })
    const { status, payload } = await issue(noPhoneId, { pin: '1111' })
    expect(status).toBe(400)
    expect(payload.fields.phone).toBeTruthy()
  })

  it('will not issue a PIN login for a manager', async () => {
    const { status, payload } = await issue(managerEmployeeId, { pin: '2222' })
    expect(status).toBe(400)
    expect(String(payload.error)).toContain('worker')
  })

  it('a worker cannot issue logins, and another tenant\'s owner cannot see the employee at all', async () => {
    const byWorker = await issue(secondEmployeeId, { pin: '3333' }, workerCallerSession)
    expect(byWorker.status).toBe(403)

    const crossTenant = await issue(employeeId, { pin: '3333' }, otherOwnerSession)
    expect(crossTenant.status).toBe(404)
  })

  it('revoking kills the PIN and every live session immediately', async () => {
    // Sign in first so there is a session to kill.
    const before = await readJson(await authLoginPOST(jsonRequest('http://localhost/api/auth/login', 'POST', { phone: secondPhone, pin: '9021' })))
    expect(before.status).toBe(200)
    const [emp] = await db.select().from(employees).where(eq(employees.id, secondEmployeeId))
    const liveBefore = await db.select().from(sessions).where(eq(sessions.userId, emp.userId as string))
    expect(liveBefore.length).toBeGreaterThan(0)

    mockCookie = ownerSession
    const { status } = await readJson(
      await loginDELETE(new Request('http://localhost'), { params: Promise.resolve({ id: secondEmployeeId }) })
    )
    mockCookie = undefined
    expect(status).toBe(200)

    const liveAfter = await db.select().from(sessions).where(eq(sessions.userId, emp.userId as string))
    expect(liveAfter.length).toBe(0)

    const after = await readJson(await authLoginPOST(jsonRequest('http://localhost/api/auth/login', 'POST', { phone: secondPhone, pin: '9021' })))
    expect(after.status).not.toBe(200)
  })
})
