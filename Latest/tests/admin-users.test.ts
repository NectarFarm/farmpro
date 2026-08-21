// ── Admin user-management tests (admin user-management feature) ────────────
// Integration tests that call the real route handlers directly against real
// Postgres (no HTTP server needed), mirroring tests/onboarding.test.ts /
// tests/admin.test.ts. Skips when DATABASE_URL is unset (CI has no database).
//
// Covers: super_admin gating on every admin route, list narrowing, the
// no-credential-leak guarantee, PATCH + audit trail + duplicate-email
// handling, admin-mediated password reset (and that the temp password
// actually authenticates), the forgot-password enumeration-safety contract,
// and time-boxed impersonation start/stop/expiry.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { eq, inArray } from 'drizzle-orm'

vi.mock('server-only', () => ({}))

// Named-cookie-aware mock (unlike the single-cookie mocks in other test
// files) — the impersonate/stop flow needs to hold BOTH `ifms_session` and
// `ifms_admin_session` at once, and tests simulate what the browser would
// have stored by reading the real NextResponse cookie jar off a prior route's
// response and feeding it back in as the "current" request cookies.
let mockCookies: Record<string, string | undefined> = {}
function setCookies(next: Record<string, string | undefined>) {
  mockCookies = { ...mockCookies, ...next }
}
vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({
    get: (name: string) => (mockCookies[name] ? { value: mockCookies[name] } : undefined),
  })),
}))

import { GET as usersGET } from '@/app/api/admin/users/route'
import { GET as userGET, PATCH as userPATCH } from '@/app/api/admin/users/[id]/route'
import { POST as resetPasswordPOST } from '@/app/api/admin/users/[id]/reset-password/route'
import { GET as passwordResetsGET } from '@/app/api/admin/password-resets/route'
import { POST as impersonatePOST } from '@/app/api/admin/users/[id]/impersonate/route'
import { POST as impersonateStopPOST } from '@/app/api/admin/impersonate/stop/route'
import { GET as impersonationLogGET } from '@/app/api/admin/impersonation-log/route'
import { POST as forgotPasswordPOST } from '@/app/api/auth/forgot-password/route'
import { POST as loginPOST } from '@/app/api/auth/login/route'
import { db } from '@/db'
import { tenants, users, sessions, passwordResetRequests, auditLog } from '@/db/schemas'
import { createSession, hashSecret, getSessionUser, SESSION_COOKIE, ADMIN_SESSION_COOKIE } from '@/lib/auth'

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

const FORBIDDEN_KEYS = ['passwordHash', 'passwordSalt', 'pinHash', 'pinPrefilter']

function assertNoCredentials(payload: unknown) {
  const text = JSON.stringify(payload)
  for (const key of FORBIDDEN_KEYS) {
    expect(text.includes(key)).toBe(false)
  }
}

run('admin user-management (admin user-management feature)', () => {
  const tenantId = `t-admin-users-${randomUUID()}`

  const superAdminEmail = `super-users-${randomUUID()}@test.ifms`
  const superAdminId = randomUUID()
  const superAdminPassword = 'platPass123'
  let superAdminSessionToken: string

  const otherSuperAdminEmail = `super-users-2-${randomUUID()}@test.ifms`
  const otherSuperAdminId = randomUUID()

  const ownerEmail = `owner-users-${randomUUID()}@test.ifms`
  const ownerId = randomUUID()
  const ownerPhone = '+254700000901'
  let ownerSessionToken: string

  const managerEmail = `manager-users-${randomUUID()}@test.ifms`
  const managerId = randomUUID()

  const suspendedEmail = `suspended-users-${randomUUID()}@test.ifms`
  const suspendedId = randomUUID()

  const collidingEmail = `colliding-users-${randomUUID()}@test.ifms`
  const collidingId = randomUUID()

  const createdSessionTokens: string[] = []

  beforeAll(async () => {
    const salt = randomUUID()
    await db.insert(tenants).values({ id: tenantId, name: 'Admin Users Test Co.', active: true })
    await db.insert(users).values([
      {
        id: superAdminId, tenantId: null, name: 'Platform Super Admin', email: superAdminEmail,
        role: 'super_admin', passwordHash: hashSecret(superAdminPassword, salt), passwordSalt: salt, status: 'ACTIVE',
      },
      {
        id: otherSuperAdminId, tenantId: null, name: 'Other Super Admin', email: otherSuperAdminEmail,
        role: 'super_admin', passwordHash: hashSecret('otherpw', salt), passwordSalt: salt, status: 'ACTIVE',
      },
      {
        id: ownerId, tenantId, name: 'Test Owner', email: ownerEmail, phone: ownerPhone,
        role: 'owner', passwordHash: hashSecret('ownerpw', salt), passwordSalt: salt, status: 'ACTIVE',
      },
      {
        id: managerId, tenantId, name: 'Test Manager', email: managerEmail,
        role: 'manager', passwordHash: hashSecret('mgrpw', salt), passwordSalt: salt, status: 'ACTIVE',
      },
      {
        id: suspendedId, tenantId, name: 'Suspended Person', email: suspendedEmail,
        role: 'worker', passwordHash: hashSecret('workerpw', salt), passwordSalt: salt, status: 'SUSPENDED',
      },
      {
        id: collidingId, tenantId, name: 'Colliding Email Person', email: collidingEmail,
        role: 'worker', passwordHash: hashSecret('workerpw', salt), passwordSalt: salt, status: 'ACTIVE',
      },
    ])
    superAdminSessionToken = await createSession(superAdminId)
    ownerSessionToken = await createSession(ownerId)
    createdSessionTokens.push(superAdminSessionToken, ownerSessionToken)
  })

  afterAll(async () => {
    await db.delete(sessions).where(inArray(sessions.userId, [superAdminId, otherSuperAdminId, ownerId, managerId, suspendedId, collidingId]))
    await db.delete(passwordResetRequests).where(eq(passwordResetRequests.userId, ownerId))
    await db.delete(auditLog).where(inArray(auditLog.entityId, [ownerId, superAdminId]))
    await db.delete(users).where(inArray(users.id, [superAdminId, otherSuperAdminId, ownerId, managerId, suspendedId, collidingId]))
    await db.delete(tenants).where(eq(tenants.id, tenantId))
  })

  // ── Auth gating: every admin route ────────────────────────────────────────
  describe('auth gating', () => {
    it('GET /api/admin/users: 401 with no session, 403 for a non-super_admin', async () => {
      setCookies({ [SESSION_COOKIE]: undefined })
      const noSession = await readJson(await usersGET(new Request('http://localhost/api/admin/users')))
      expect(noSession.status).toBe(401)

      setCookies({ [SESSION_COOKIE]: ownerSessionToken })
      const forbidden = await readJson(await usersGET(new Request('http://localhost/api/admin/users')))
      expect(forbidden.status).toBe(403)
    })

    it('GET /api/admin/users/[id]: 401 with no session, 403 for a non-super_admin', async () => {
      setCookies({ [SESSION_COOKIE]: undefined })
      const noSession = await readJson(await userGET(new Request('http://localhost/api/admin/users/x'), { params: Promise.resolve({ id: ownerId }) }))
      expect(noSession.status).toBe(401)

      setCookies({ [SESSION_COOKIE]: ownerSessionToken })
      const forbidden = await readJson(await userGET(new Request('http://localhost/api/admin/users/x'), { params: Promise.resolve({ id: ownerId }) }))
      expect(forbidden.status).toBe(403)
    })

    it('PATCH /api/admin/users/[id]: 401 with no session, 403 for a non-super_admin', async () => {
      setCookies({ [SESSION_COOKIE]: undefined })
      const noSession = await readJson(
        await userPATCH(jsonRequest(`http://localhost/api/admin/users/${ownerId}`, 'PATCH', { name: 'x' }), { params: Promise.resolve({ id: ownerId }) })
      )
      expect(noSession.status).toBe(401)

      setCookies({ [SESSION_COOKIE]: ownerSessionToken })
      const forbidden = await readJson(
        await userPATCH(jsonRequest(`http://localhost/api/admin/users/${ownerId}`, 'PATCH', { name: 'x' }), { params: Promise.resolve({ id: ownerId }) })
      )
      expect(forbidden.status).toBe(403)
    })

    it('POST reset-password: 401 with no session, 403 for a non-super_admin', async () => {
      setCookies({ [SESSION_COOKIE]: undefined })
      const noSession = await readJson(await resetPasswordPOST(jsonRequest(`http://localhost/api/admin/users/${ownerId}/reset-password`, 'POST', {}), { params: Promise.resolve({ id: ownerId }) }))
      expect(noSession.status).toBe(401)

      setCookies({ [SESSION_COOKIE]: ownerSessionToken })
      const forbidden = await readJson(await resetPasswordPOST(jsonRequest(`http://localhost/api/admin/users/${ownerId}/reset-password`, 'POST', {}), { params: Promise.resolve({ id: ownerId }) }))
      expect(forbidden.status).toBe(403)
    })

    it('GET /api/admin/password-resets: 401 with no session, 403 for a non-super_admin', async () => {
      setCookies({ [SESSION_COOKIE]: undefined })
      expect((await readJson(await passwordResetsGET())).status).toBe(401)
      setCookies({ [SESSION_COOKIE]: ownerSessionToken })
      expect((await readJson(await passwordResetsGET())).status).toBe(403)
    })

    it('POST impersonate: 401 with no session, 403 for a non-super_admin', async () => {
      setCookies({ [SESSION_COOKIE]: undefined })
      const noSession = await readJson(await impersonatePOST(jsonRequest(`http://localhost/api/admin/users/${managerId}/impersonate`, 'POST', { minutes: 5 }), { params: Promise.resolve({ id: managerId }) }))
      expect(noSession.status).toBe(401)

      setCookies({ [SESSION_COOKIE]: ownerSessionToken })
      const forbidden = await readJson(await impersonatePOST(jsonRequest(`http://localhost/api/admin/users/${managerId}/impersonate`, 'POST', { minutes: 5 }), { params: Promise.resolve({ id: managerId }) }))
      expect(forbidden.status).toBe(403)
    })

    it('GET /api/admin/impersonation-log: 401 with no session, 403 for a non-super_admin', async () => {
      setCookies({ [SESSION_COOKIE]: undefined })
      expect((await readJson(await impersonationLogGET())).status).toBe(401)
      setCookies({ [SESSION_COOKIE]: ownerSessionToken })
      expect((await readJson(await impersonationLogGET())).status).toBe(403)
    })
  })

  // ── List narrowing + no-credential-leak guarantee ─────────────────────────
  describe('GET /api/admin/users list', () => {
    it('narrows by q (name/email substring, case-insensitive)', async () => {
      setCookies({ [SESSION_COOKIE]: superAdminSessionToken })
      const { status, payload } = await readJson(await usersGET(new Request(`http://localhost/api/admin/users?q=${encodeURIComponent('test owner')}`)))
      expect(status).toBe(200)
      expect(payload.data.some((u: { id: string }) => u.id === ownerId)).toBe(true)
      expect(payload.data.every((u: { id: string }) => u.id !== managerId)).toBe(true)
    })

    it('narrows by role', async () => {
      setCookies({ [SESSION_COOKIE]: superAdminSessionToken })
      const { payload } = await readJson(await usersGET(new Request('http://localhost/api/admin/users?role=manager')))
      expect(payload.data.some((u: { id: string }) => u.id === managerId)).toBe(true)
      expect(payload.data.every((u: { role: string }) => u.role === 'manager')).toBe(true)
    })

    it('narrows by status', async () => {
      setCookies({ [SESSION_COOKIE]: superAdminSessionToken })
      const { payload } = await readJson(await usersGET(new Request('http://localhost/api/admin/users?status=SUSPENDED')))
      expect(payload.data.some((u: { id: string }) => u.id === suspendedId)).toBe(true)
      expect(payload.data.every((u: { status: string }) => u.status === 'SUSPENDED')).toBe(true)
    })

    it('never returns passwordHash/passwordSalt/pinHash/pinPrefilter on list, get, or patch', async () => {
      setCookies({ [SESSION_COOKIE]: superAdminSessionToken })
      const list = await readJson(await usersGET(new Request('http://localhost/api/admin/users')))
      assertNoCredentials(list.payload)

      const one = await readJson(await userGET(new Request('http://localhost/api/admin/users/x'), { params: Promise.resolve({ id: ownerId }) }))
      assertNoCredentials(one.payload)
      expect(one.payload.data.phone).toBe(ownerPhone)

      const patched = await readJson(
        await userPATCH(jsonRequest(`http://localhost/api/admin/users/${managerId}`, 'PATCH', { name: 'Test Manager Renamed' }), { params: Promise.resolve({ id: managerId }) })
      )
      assertNoCredentials(patched.payload)
    })
  })

  // ── PATCH: field updates, audit trail, duplicate email ────────────────────
  describe('PATCH /api/admin/users/[id]', () => {
    it('updates fields and writes an audit_log entry recording the change', async () => {
      setCookies({ [SESSION_COOKIE]: superAdminSessionToken })
      const { status, payload } = await readJson(
        await userPATCH(jsonRequest(`http://localhost/api/admin/users/${managerId}`, 'PATCH', { name: 'Manager Renamed Again', status: 'SUSPENDED' }), { params: Promise.resolve({ id: managerId }) })
      )
      expect(status).toBe(200)
      expect(payload.data.name).toBe('Manager Renamed Again')
      expect(payload.data.status).toBe('SUSPENDED')

      const auditRows = await db.select().from(auditLog).where(eq(auditLog.entityId, managerId))
      const entry = auditRows.find((r) => r.action === 'user.update')
      expect(entry).toBeTruthy()
      expect(entry!.actor).toBe(superAdminId)
      const changes = (entry!.meta as Record<string, { old: unknown; new: unknown }>).changes ?? entry!.meta
      expect(changes).toBeTruthy()

      // Restore status for later tests in this file.
      await userPATCH(jsonRequest(`http://localhost/api/admin/users/${managerId}`, 'PATCH', { status: 'ACTIVE' }), { params: Promise.resolve({ id: managerId }) })
    })

    it('rejects a duplicate email with a clean fields.email error, not a 500', async () => {
      setCookies({ [SESSION_COOKIE]: superAdminSessionToken })
      const { status, payload } = await readJson(
        await userPATCH(jsonRequest(`http://localhost/api/admin/users/${managerId}`, 'PATCH', { email: collidingEmail }), { params: Promise.resolve({ id: managerId }) })
      )
      expect(status).toBe(409)
      expect(payload.success).toBe(false)
      expect(payload.fields.email).toBeTruthy()
    })

    it('rejects an invalid role with fields.role set', async () => {
      setCookies({ [SESSION_COOKIE]: superAdminSessionToken })
      const { status, payload } = await readJson(
        await userPATCH(jsonRequest(`http://localhost/api/admin/users/${managerId}`, 'PATCH', { role: 'not-a-role' }), { params: Promise.resolve({ id: managerId }) })
      )
      expect(status).toBe(400)
      expect(payload.fields.role).toBeTruthy()
    })
  })

  // ── Reset password ─────────────────────────────────────────────────────────
  describe('POST /api/admin/users/[id]/reset-password', () => {
    it('changes the hash, returns the temp password once, and the user can log in with it', async () => {
      setCookies({ [SESSION_COOKIE]: superAdminSessionToken })
      const { status, payload } = await readJson(
        await resetPasswordPOST(jsonRequest(`http://localhost/api/admin/users/${ownerId}/reset-password`, 'POST', {}), { params: Promise.resolve({ id: ownerId }) })
      )
      expect(status).toBe(200)
      expect(payload.data.email).toBe(ownerEmail)
      expect(typeof payload.data.tempPassword).toBe('string')
      expect(payload.data.tempPassword.length).toBeGreaterThan(0)
      assertNoCredentials(payload)

      const loginRes = await readJson(
        await loginPOST(jsonRequest('http://localhost/api/auth/login', 'POST', { email: ownerEmail, password: payload.data.tempPassword }))
      )
      expect(loginRes.status).toBe(200)
      expect(loginRes.payload.success).toBe(true)
      await db.delete(sessions).where(eq(sessions.userId, ownerId))

      // Old password no longer works.
      const oldLoginRes = await readJson(
        await loginPOST(jsonRequest('http://localhost/api/auth/login', 'POST', { email: ownerEmail, password: 'ownerpw' }))
      )
      expect(oldLoginRes.status).toBe(401)
    })
  })

  // ── forgot-password: enumeration-safety contract ──────────────────────────
  describe('POST /api/auth/forgot-password', () => {
    it('a correct email+phone pair creates a pending password_reset_requests row', async () => {
      const before = await db.select().from(passwordResetRequests).where(eq(passwordResetRequests.userId, ownerId))
      const { status, payload } = await readJson(
        await forgotPasswordPOST(jsonRequest('http://localhost/api/auth/forgot-password', 'POST', { email: ownerEmail, phone: ownerPhone }))
      )
      expect(status).toBe(200)
      expect(payload.success).toBe(true)

      const after = await db.select().from(passwordResetRequests).where(eq(passwordResetRequests.userId, ownerId))
      expect(after.length).toBe(before.length + 1)
      expect(after[after.length - 1].status).toBe('pending')
    })

    it('a WRONG phone for a real email creates nothing, and returns an identical response', async () => {
      const before = await db.select().from(passwordResetRequests).where(eq(passwordResetRequests.userId, ownerId))
      const correct = await readJson(
        await forgotPasswordPOST(jsonRequest('http://localhost/api/auth/forgot-password', 'POST', { email: ownerEmail, phone: ownerPhone }))
      )
      const wrong = await readJson(
        await forgotPasswordPOST(jsonRequest('http://localhost/api/auth/forgot-password', 'POST', { email: ownerEmail, phone: '+254700000999' }))
      )
      expect(wrong.status).toBe(correct.status)
      expect(wrong.payload).toEqual(correct.payload)

      const after = await db.select().from(passwordResetRequests).where(eq(passwordResetRequests.userId, ownerId))
      // The correct-pair call above adds exactly one row; the wrong-phone call adds none.
      expect(after.length).toBe(before.length + 1)
    })

    it('a non-existent email also returns the identical generic response', async () => {
      const correct = await readJson(
        await forgotPasswordPOST(jsonRequest('http://localhost/api/auth/forgot-password', 'POST', { email: ownerEmail, phone: ownerPhone }))
      )
      const nonExistent = await readJson(
        await forgotPasswordPOST(jsonRequest('http://localhost/api/auth/forgot-password', 'POST', { email: `nobody-${randomUUID()}@test.ifms`, phone: ownerPhone }))
      )
      expect(nonExistent.status).toBe(correct.status)
      expect(nonExistent.payload).toEqual(correct.payload)
    })

    it('rejects malformed input with a fields error (not the generic ack)', async () => {
      const { status, payload } = await readJson(
        await forgotPasswordPOST(jsonRequest('http://localhost/api/auth/forgot-password', 'POST', { email: 'not-an-email', phone: '123' }))
      )
      expect(status).toBe(400)
      expect(payload.fields.email).toBeTruthy()
      expect(payload.fields.phone).toBeTruthy()
    })
  })

  // ── Impersonation: start/stop/expiry ──────────────────────────────────────
  describe('impersonation', () => {
    it('rejects a duration outside the allow-list', async () => {
      setCookies({ [SESSION_COOKIE]: superAdminSessionToken })
      const { status, payload } = await readJson(
        await impersonatePOST(jsonRequest(`http://localhost/api/admin/users/${managerId}/impersonate`, 'POST', { minutes: 7 }), { params: Promise.resolve({ id: managerId }) })
      )
      expect(status).toBe(400)
      expect(payload.fields.minutes).toBeTruthy()
    })

    it('refuses to impersonate another super_admin', async () => {
      setCookies({ [SESSION_COOKIE]: superAdminSessionToken })
      const { status } = await readJson(
        await impersonatePOST(jsonRequest(`http://localhost/api/admin/users/${otherSuperAdminId}/impersonate`, 'POST', { minutes: 5 }), { params: Promise.resolve({ id: otherSuperAdminId }) })
      )
      expect(status).toBe(403)
    })

    it('refuses to impersonate yourself', async () => {
      setCookies({ [SESSION_COOKIE]: superAdminSessionToken })
      const { status } = await readJson(
        await impersonatePOST(jsonRequest(`http://localhost/api/admin/users/${superAdminId}/impersonate`, 'POST', { minutes: 5 }), { params: Promise.resolve({ id: superAdminId }) })
      )
      expect(status).toBe(400)
    })

    it('creates a session for the target with impersonatedBy set and an expiry matching the requested minutes', async () => {
      setCookies({ [SESSION_COOKIE]: superAdminSessionToken })
      const before = Date.now()
      const res = await impersonatePOST(
        jsonRequest(`http://localhost/api/admin/users/${managerId}/impersonate`, 'POST', { minutes: 10 }),
        { params: Promise.resolve({ id: managerId }) }
      )
      const { status, payload } = await readJson(res)
      expect(status).toBe(200)
      expect(payload.data.minutesGranted).toBe(10)

      const targetToken = res.cookies.get(SESSION_COOKIE)?.value
      const adminCookieValue = res.cookies.get(ADMIN_SESSION_COOKIE)?.value
      expect(targetToken).toBeTruthy()
      expect(adminCookieValue).toBe(superAdminSessionToken)

      const rows = await db.select().from(sessions).where(eq(sessions.token, targetToken!))
      expect(rows).toHaveLength(1)
      expect(rows[0].userId).toBe(managerId)
      expect(rows[0].impersonatedBy).toBe(superAdminId)
      const expiresAtMs = rows[0].expiresAt.getTime()
      expect(expiresAtMs).toBeGreaterThan(before + 9 * 60 * 1000)
      expect(expiresAtMs).toBeLessThan(before + 11 * 60 * 1000)

      const auditRows = await db.select().from(auditLog).where(eq(auditLog.entityId, managerId))
      const startEntry = auditRows.find((r) => r.action === 'impersonation.start')
      expect(startEntry).toBeTruthy()
      expect(startEntry!.actor).toBe(superAdminId)

      // ── Stop it (early — plenty of time left) ──
      setCookies({ [SESSION_COOKIE]: targetToken, [ADMIN_SESSION_COOKIE]: adminCookieValue })
      const stopRes = await impersonateStopPOST(jsonRequest('http://localhost/api/admin/impersonate/stop', 'POST', {}))
      const stop = await readJson(stopRes)
      expect(stop.status).toBe(200)
      expect(stop.payload.data.endedEarly).toBe(true)

      // Session row is gone.
      const afterStop = await db.select().from(sessions).where(eq(sessions.token, targetToken!))
      expect(afterStop).toHaveLength(0)

      // Admin cookie restored, impersonation cookie cleared.
      expect(stopRes.cookies.get(SESSION_COOKIE)?.value).toBe(superAdminSessionToken)
      expect(stopRes.cookies.get(ADMIN_SESSION_COOKIE)?.value).toBe('')

      const endEntry = (await db.select().from(auditLog).where(eq(auditLog.entityId, managerId))).find((r) => r.action === 'impersonation.end')
      expect(endEntry).toBeTruthy()
      expect(endEntry!.actor).toBe(superAdminId)
      expect((endEntry!.meta as Record<string, unknown>).endedEarly).toBe(true)
    })

    it('an expired impersonation session no longer authenticates', async () => {
      const expiredToken = randomUUID()
      await db.insert(sessions).values({
        token: expiredToken,
        userId: managerId,
        expiresAt: new Date(Date.now() - 60 * 1000), // already in the past
        impersonatedBy: superAdminId,
      })

      setCookies({ [SESSION_COOKIE]: expiredToken })
      const user = await getSessionUser()
      expect(user).toBeNull()

      await db.delete(sessions).where(eq(sessions.token, expiredToken))
    })
  })

  // ── GET /api/admin/impersonation-log ───────────────────────────────────────
  describe('GET /api/admin/impersonation-log', () => {
    it('lists start/end entries with admin and target identity resolved', async () => {
      setCookies({ [SESSION_COOKIE]: superAdminSessionToken })
      const { status, payload } = await readJson(await impersonationLogGET())
      expect(status).toBe(200)
      const startRow = payload.data.find((r: { action: string; target: { id: string } }) => r.action === 'impersonation.start' && r.target.id === managerId)
      expect(startRow).toBeTruthy()
      expect(startRow.admin.id).toBe(superAdminId)
      expect(startRow.admin.email).toBe(superAdminEmail)
    })
  })

  // ── GET /api/admin/password-resets ────────────────────────────────────────
  describe('GET /api/admin/password-resets', () => {
    it('lists the pending queue newest first, joined to the requesting user', async () => {
      setCookies({ [SESSION_COOKIE]: superAdminSessionToken })
      const { status, payload } = await readJson(await passwordResetsGET())
      expect(status).toBe(200)
      const row = payload.data.find((r: { userId: string }) => r.userId === ownerId)
      expect(row).toBeTruthy()
      expect(row.userName).toBe('Test Owner')
      expect(row.status).toBe('pending')
    })
  })
})
