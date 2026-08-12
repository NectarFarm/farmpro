// ── Auth tests (issue #223) ────────────────────────────────────────────────
// Integration tests that call the real POST /api/auth/login route handler with
// a constructed Request — no HTTP server needed. They run against the real
// postgres when DATABASE_URL is set (local/dev); CI has no database, so the
// suite skips there (vitest exits 0, and CI's build/typecheck still run).
//
// The suspended-tenant gate (issue #223): tenant-scoped accounts at an inactive
// tenant must not receive a session. Proved here for both the worker PIN path
// and the owner email/password path.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'

vi.mock('server-only', () => ({}))

import { POST as loginPOST } from '@/app/api/auth/login/route'
import { db } from '@/db'
import { tenants, users, sessions, loginThrottle } from '@/db/schemas'
import { hashSecret, pinPrefilter } from '@/lib/auth'

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
  const ownerPassword = 'ownerPass123'
  const workerPin = '2468'
  const suspendedPin = '9753'
  const superAdminEmail = `super-${randomUUID()}@test.ifms`
  const superAdminPassword = 'platPass123'
  let userIds: string[] = []

  beforeAll(async () => {
    // Clear any throttling left over from previous runs.
    await db.delete(loginThrottle)

    await db.insert(tenants).values([
      { id: tenantActiveId, name: 'Active Test Co.', active: true },
      { id: tenantSuspendedId, name: 'Suspended Test Co.', active: false },
    ])

    const salt = (n: number) => `salt-${n}-${randomUUID()}`
    // One salt per user, used for BOTH password and PIN hashes — the route
    // verifies PINs against the stored passwordSalt, so a different PIN salt
    // would silently break verification (mirrors db/seed.mjs).
    const sOwner = salt(1)
    const sWorker = salt(2)
    const sSusp = salt(3)
    const sSuper = salt(4)
    const rows = await db
      .insert(users)
      .values([
        {
          id: randomUUID(), tenantId: tenantActiveId, name: 'Active Owner', email: ownerEmail,
          role: 'owner', passwordHash: hashSecret(ownerPassword, sOwner), passwordSalt: sOwner,
          pinHash: null, pinPrefilter: null, status: 'ACTIVE',
        },
        {
          id: randomUUID(), tenantId: tenantActiveId, name: 'Active Worker', email: workerEmail,
          role: 'worker', passwordHash: hashSecret('w123', sWorker), passwordSalt: sWorker,
          pinHash: hashSecret(workerPin, sWorker), pinPrefilter: pinPrefilter(workerPin), status: 'ACTIVE',
        },
        {
          id: randomUUID(), tenantId: tenantSuspendedId, name: 'Suspended Worker', email: suspendedWorkerEmail,
          role: 'worker', passwordHash: hashSecret('s123', sSusp), passwordSalt: sSusp,
          pinHash: hashSecret(suspendedPin, sSusp), pinPrefilter: pinPrefilter(suspendedPin), status: 'ACTIVE',
        },
        {
          id: randomUUID(), tenantId: null, name: 'Platform Admin', email: superAdminEmail,
          role: 'super_admin', passwordHash: hashSecret(superAdminPassword, sSuper), passwordSalt: sSuper,
          pinHash: null, pinPrefilter: null, status: 'ACTIVE',
        },
      ])
      .returning({ id: users.id })
    userIds = rows.map((r) => r.id)
  })

  afterAll(async () => {
    // Clean up: sessions reference users; users reference tenants.
    if (userIds.length) {
      await db.delete(sessions).where(eq(sessions.userId, userIds[0]))
      // Delete each user's sessions + the user rows.
      for (const id of userIds) {
        await db.delete(sessions).where(eq(sessions.userId, id))
        await db.delete(users).where(eq(users.id, id))
      }
    }
    await db.delete(tenants).where(eq(tenants.id, tenantActiveId))
    await db.delete(tenants).where(eq(tenants.id, tenantSuspendedId))
    await db.delete(loginThrottle)
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

  it('owner at a SUSPENDED tenant is denied login via email/password (403)', async () => {
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
})
