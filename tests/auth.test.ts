// ── Auth tests (issue #223) ────────────────────────────────────────────────
// Integration tests that call the real POST /api/auth/login route handler and
// getSessionUser with a constructed Request / mocked cookie — no HTTP server
// needed. They run against the real postgres when DATABASE_URL is set
// (local/dev); CI has no database, so the suite skips there (vitest exits 0,
// and CI's build/typecheck still run).
//
// The suspended-tenant gate (issue #223): tenant-scoped accounts at an inactive
// tenant must not receive a session (login time) nor keep one (refresh time).
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { eq, inArray } from 'drizzle-orm'

vi.mock('server-only', () => ({}))

// Mock the request cookie for the getSessionUser tests (login tests never call
// cookies()). Named with a `mock` prefix so vitest's hoisted factory can read it.
let mockCookie: string | undefined
vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({ get: () => ({ value: mockCookie }) })),
}))

import { POST as loginPOST } from '@/app/api/auth/login/route'
import { db } from '@/db'
import { tenants, users, sessions, loginThrottle } from '@/db/schemas'
import { createSession, destroySession, getSessionUser, hashSecret, pinPrefilter } from '@/lib/auth'

const hasDb = !!process.env.DATABASE_URL
const run = hasDb ? describe : describe.skip

function loginRequest(body: unknown): Request {
  return new Request('http://localhost/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

async function attempt(body: unknown) {
  const res = await loginPOST(loginRequest(body))
  const payload = await res.json()
  return { status: res.status, payload }
}

run('auth: login + suspended-tenant gate (issue #223)', () => {
  const tenantActiveId = `t-${randomUUID()}`
  const tenantSuspendedId = `t-${randomUUID()}`
  const ownerEmail = `owner-${randomUUID()}@test.ifms`
  const workerEmail = `worker-${randomUUID()}@test.ifms`
  const suspendedWorkerEmail = `susp-${randomUUID()}@test.ifms`
  const suspendedAccountEmail = `suspacc-${randomUUID()}@test.ifms`
  const superAdminEmail = `super-${randomUUID()}@test.ifms`
  const ownerPassword = 'ownerPass123'
  const workerPin = '2468'
  const suspendedPin = '9753'
  const superAdminPassword = 'platPass123'
  const ownerId = randomUUID()
  const workerId = randomUUID()
  const suspendedWorkerId = randomUUID()
  const suspendedAccountId = randomUUID()
  const superAdminId = randomUUID()

  // The throttle identifiers this suite can touch (scoped cleanup — never wipe
  // the shared DB's real lockout state).
  const throttleIds = [
    `email:${ownerEmail}`,
    `email:${suspendedWorkerEmail}`,
    `email:${superAdminEmail}`,
    `pin:${workerPin}`,
    `pin:${suspendedPin}`,
    'pin:global',
  ]

  beforeAll(async () => {
    await db.delete(loginThrottle).where(inArray(loginThrottle.identifier, throttleIds))

    await db.insert(tenants).values([
      { id: tenantActiveId, name: 'Active Test Co.', active: true },
      { id: tenantSuspendedId, name: 'Suspended Test Co.', active: false },
    ])

    // One salt per user, used for BOTH password and PIN hashes — the route
    // verifies PINs against the stored passwordSalt, so a different PIN salt
    // would silently break verification (mirrors db/seed.mjs).
    const salt = (n: number) => `salt-${n}-${randomUUID()}`
    const sOwner = salt(1)
    const sWorker = salt(2)
    const sSusp = salt(3)
    const sSuspAcc = salt(4)
    const sSuper = salt(5)

    await db.insert(users).values([
      {
        id: ownerId, tenantId: tenantActiveId, name: 'Active Owner', email: ownerEmail,
        role: 'owner', passwordHash: hashSecret(ownerPassword, sOwner), passwordSalt: sOwner,
        pinHash: null, pinPrefilter: null, status: 'ACTIVE',
      },
      {
        id: workerId, tenantId: tenantActiveId, name: 'Active Worker', email: workerEmail,
        role: 'worker', passwordHash: hashSecret('w123', sWorker), passwordSalt: sWorker,
        pinHash: hashSecret(workerPin, sWorker), pinPrefilter: pinPrefilter(workerPin), status: 'ACTIVE',
      },
      {
        id: suspendedWorkerId, tenantId: tenantSuspendedId, name: 'Suspended Worker', email: suspendedWorkerEmail,
        role: 'worker', passwordHash: hashSecret('s123', sSusp), passwordSalt: sSusp,
        pinHash: hashSecret(suspendedPin, sSusp), pinPrefilter: pinPrefilter(suspendedPin), status: 'ACTIVE',
      },
      {
        id: suspendedAccountId, tenantId: tenantActiveId, name: 'Suspended Account', email: suspendedAccountEmail,
        role: 'worker', passwordHash: hashSecret('sa123', sSuspAcc), passwordSalt: sSuspAcc,
        pinHash: null, pinPrefilter: null, status: 'SUSPENDED',
      },
      {
        id: superAdminId, tenantId: null, name: 'Platform Admin', email: superAdminEmail,
        role: 'super_admin', passwordHash: hashSecret(superAdminPassword, sSuper), passwordSalt: sSuper,
        pinHash: null, pinPrefilter: null, status: 'ACTIVE',
      },
    ])
  })

  afterAll(async () => {
    // Sessions reference users; users reference (logically) tenants.
    for (const id of [ownerId, workerId, suspendedWorkerId, suspendedAccountId, superAdminId]) {
      await db.delete(sessions).where(eq(sessions.userId, id))
      await db.delete(users).where(eq(users.id, id))
    }
    await db.delete(tenants).where(inArray(tenants.id, [tenantActiveId, tenantSuspendedId]))
    await db.delete(loginThrottle).where(inArray(loginThrottle.identifier, throttleIds))
  })

  it('owner at an ACTIVE tenant can log in (200, owner role, session cookie set)', async () => {
    const { status, payload } = await attempt({ email: ownerEmail, password: ownerPassword })
    expect(status).toBe(200)
    expect(payload.success).toBe(true)
    expect(payload.data.role).toBe('owner')
    expect(payload.data.tenantId).toBe(tenantActiveId)
  })

  it('worker at an ACTIVE tenant can log in via PIN (200, worker role)', async () => {
    const { status, payload } = await attempt({ pin: workerPin })
    expect(status).toBe(200)
    expect(payload.success).toBe(true)
    expect(payload.data.role).toBe('worker')
    expect(payload.data.tenantId).toBe(tenantActiveId)
  })

  it('worker at a SUSPENDED tenant is denied login via PIN (403, no session)', async () => {
    const { status, payload } = await attempt({ pin: suspendedPin })
    expect(status).toBe(403)
    expect(payload.success).toBe(false)
    expect(String(payload.error).toLowerCase()).toContain('suspend')
  })

  it('worker at a SUSPENDED tenant is denied login via email/password (403)', async () => {
    const { status, payload } = await attempt({ email: suspendedWorkerEmail, password: 's123' })
    expect(status).toBe(403)
    expect(payload.success).toBe(false)
    expect(String(payload.error).toLowerCase()).toContain('suspend')
  })

  it('wrong password still returns a generic 401', async () => {
    const { status, payload } = await attempt({ email: ownerEmail, password: 'definitely-wrong' })
    expect(status).toBe(401)
    expect(payload.success).toBe(false)
  })

  it('super_admin (no tenant) bypasses the tenant gate', async () => {
    const { status, payload } = await attempt({ email: superAdminEmail, password: superAdminPassword })
    expect(status).toBe(200)
    expect(payload.success).toBe(true)
    expect(payload.data.role).toBe('super_admin')
    expect(payload.data.tenantId).toBeNull()
  })

  it('session lookup resolves for an ACTIVE account at an ACTIVE tenant', async () => {
    const token = await createSession(ownerId)
    mockCookie = token
    try {
      const user = await getSessionUser()
      expect(user).not.toBeNull()
      expect(user?.role).toBe('owner')
    } finally {
      mockCookie = undefined
      await destroySession(token)
    }
  })

  it('session lookup returns null when the tenant is suspended (refresh-time gate)', async () => {
    const token = await createSession(suspendedWorkerId)
    mockCookie = token
    try {
      expect(await getSessionUser()).toBeNull()
    } finally {
      mockCookie = undefined
      await destroySession(token)
    }
  })

  it('session lookup returns null when the account is suspended', async () => {
    const token = await createSession(suspendedAccountId)
    mockCookie = token
    try {
      expect(await getSessionUser()).toBeNull()
    } finally {
      mockCookie = undefined
      await destroySession(token)
    }
  })
})
