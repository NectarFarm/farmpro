// ── Admin platform-stats/tenants tests (issue #252) ─────────────────────────
// Integration tests that call the real route handlers directly (no HTTP
// server needed), mirroring tests/onboarding.test.ts. Run against the real
// postgres when DATABASE_URL is set (local/dev); CI has no database, so the
// suite skips there.
//
// Covers the DoD: GET /api/admin/tenants and GET /api/admin/stats exist, are
// super_admin-gated, and return real data.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'

vi.mock('server-only', () => ({}))

let mockCookie: string | undefined
vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({ get: () => (mockCookie ? { value: mockCookie } : undefined) })),
}))

import { GET as tenantsGET } from '@/app/api/admin/tenants/route'
import { GET as statsGET } from '@/app/api/admin/stats/route'
import { db } from '@/db'
import { tenants, users, sessions, farms, onboardRequests } from '@/db/schemas'
import { createSession, hashSecret } from '@/lib/auth'

const hasDb = !!process.env.DATABASE_URL
const run = hasDb ? describe : describe.skip

async function readJson(res: Response) {
  return { status: res.status, payload: await res.json() }
}

run('admin: GET /api/admin/tenants and GET /api/admin/stats (issue #252)', () => {
  const superAdminEmail = `super-admin-${randomUUID()}@test.ifms`
  const superAdminId = randomUUID()
  let superAdminSessionToken: string

  const tenantAId = `t-admin-a-${randomUUID()}`
  const tenantBId = `t-admin-b-${randomUUID()}`
  const ownerAId = randomUUID()
  const ownerBId = randomUUID()
  const workerAId = randomUUID()
  const inactiveWorkerId = randomUUID() // suspended user — should not count

  const farmAId = randomUUID()
  const farmA2Id = randomUUID()
  const farmBId = randomUUID()

  const onboardRequestIds: string[] = []

  beforeAll(async () => {
    const salt = randomUUID()
    await db.insert(tenants).values([
      { id: tenantAId, name: 'Admin Test Tenant A', active: true },
      { id: tenantBId, name: 'Admin Test Tenant B', active: false },
    ])
    await db.insert(users).values([
      {
        id: superAdminId, tenantId: null, name: 'Platform Super Admin', email: superAdminEmail,
        role: 'super_admin', passwordHash: hashSecret('platPass123', salt), passwordSalt: salt, status: 'ACTIVE',
      },
      {
        id: ownerAId, tenantId: tenantAId, name: 'Owner A', email: `owner-a-${randomUUID()}@test.ifms`,
        role: 'owner', passwordHash: hashSecret('ownerpw', salt), passwordSalt: salt, status: 'ACTIVE',
      },
      {
        id: workerAId, tenantId: tenantAId, name: 'Worker A', email: `worker-a-${randomUUID()}@test.ifms`,
        role: 'worker', passwordHash: hashSecret('workerpw', salt), passwordSalt: salt, status: 'ACTIVE',
      },
      {
        id: inactiveWorkerId, tenantId: tenantAId, name: 'Inactive Worker A', email: `inactive-a-${randomUUID()}@test.ifms`,
        role: 'worker', passwordHash: hashSecret('workerpw', salt), passwordSalt: salt, status: 'SUSPENDED',
      },
      {
        id: ownerBId, tenantId: tenantBId, name: 'Owner B', email: `owner-b-${randomUUID()}@test.ifms`,
        role: 'owner', passwordHash: hashSecret('ownerpw', salt), passwordSalt: salt, status: 'ACTIVE',
      },
    ])
    await db.insert(farms).values([
      { id: farmAId, tenantId: tenantAId, name: 'Farm A1', location: 'Nakuru', code: `FRM-A1-${farmAId.slice(0, 4)}` },
      { id: farmA2Id, tenantId: tenantAId, name: 'Farm A2', location: 'Nakuru', code: `FRM-A2-${farmA2Id.slice(0, 4)}` },
      { id: farmBId, tenantId: tenantBId, name: 'Farm B1', location: 'Eldoret', code: `FRM-B1-${farmBId.slice(0, 4)}` },
    ])

    const pendingId = randomUUID()
    const approvedId = randomUUID()
    onboardRequestIds.push(pendingId, approvedId)
    await db.insert(onboardRequests).values([
      {
        id: pendingId, farmerName: 'Applicant One', email: `app1-${randomUUID()}@test.ifms`, phone: '+254-700-000-100',
        farmName: 'Applicant Farm One', location: 'Nakuru', enterprises: ['layer'], status: 'pending',
      },
      {
        id: approvedId, farmerName: 'Applicant Two', email: `app2-${randomUUID()}@test.ifms`, phone: '+254-700-000-200',
        farmName: 'Applicant Farm Two', location: 'Eldoret', enterprises: ['dairy_cow'], status: 'approved',
      },
    ])

    superAdminSessionToken = await createSession(superAdminId)
  })

  afterAll(async () => {
    for (const id of onboardRequestIds) {
      await db.delete(onboardRequests).where(eq(onboardRequests.id, id))
    }
    await db.delete(farms).where(eq(farms.tenantId, tenantAId))
    await db.delete(farms).where(eq(farms.tenantId, tenantBId))
    await db.delete(sessions).where(eq(sessions.userId, superAdminId))
    await db.delete(users).where(eq(users.id, superAdminId))
    await db.delete(users).where(eq(users.tenantId, tenantAId))
    await db.delete(users).where(eq(users.tenantId, tenantBId))
    await db.delete(tenants).where(eq(tenants.id, tenantAId))
    await db.delete(tenants).where(eq(tenants.id, tenantBId))
  })

  it('GET /api/admin/tenants is rejected with no session (401)', async () => {
    mockCookie = undefined
    const { status, payload } = await readJson(await tenantsGET())
    expect(status).toBe(401)
    expect(payload.success).toBe(false)
  })

  it('GET /api/admin/tenants is rejected for a non-super_admin session (403)', async () => {
    const token = await createSession(ownerAId)
    mockCookie = token
    const { status } = await readJson(await tenantsGET())
    expect(status).toBe(403)
    await db.delete(sessions).where(eq(sessions.token, token))
  })

  it('GET /api/admin/tenants returns real tenants with farm/user counts as super_admin', async () => {
    mockCookie = superAdminSessionToken
    const { status, payload } = await readJson(await tenantsGET())
    expect(status).toBe(200)
    expect(payload.success).toBe(true)

    const a = payload.data.find((t: { id: string }) => t.id === tenantAId)
    const b = payload.data.find((t: { id: string }) => t.id === tenantBId)
    expect(a).toBeTruthy()
    expect(b).toBeTruthy()

    expect(a.name).toBe('Admin Test Tenant A')
    expect(a.active).toBe(true)
    expect(a.farms).toBe(2)
    // Only ACTIVE users count — the suspended worker must not be included.
    expect(a.users).toBe(2)

    expect(b.name).toBe('Admin Test Tenant B')
    expect(b.active).toBe(false)
    expect(b.farms).toBe(1)
    expect(b.users).toBe(1)
  })

  it('GET /api/admin/stats is rejected with no session (401)', async () => {
    mockCookie = undefined
    const { status, payload } = await readJson(await statsGET())
    expect(status).toBe(401)
    expect(payload.success).toBe(false)
  })

  it('GET /api/admin/stats is rejected for a non-super_admin session (403)', async () => {
    // Uses ownerAId (tenant A is active) rather than ownerBId — tenant B is
    // inactive, and getSessionUser's tenant gate (issue #223) already returns
    // null (401) for a suspended tenant before role is even checked; this
    // test wants the role-check path (403) specifically.
    const token = await createSession(ownerAId)
    mockCookie = token
    const { status } = await readJson(await statsGET())
    expect(status).toBe(403)
    await db.delete(sessions).where(eq(sessions.token, token))
  })

  it('GET /api/admin/stats returns real aggregate counts as super_admin', async () => {
    mockCookie = superAdminSessionToken
    const { status, payload } = await readJson(await statsGET())
    expect(status).toBe(200)
    expect(payload.success).toBe(true)

    // At least our two seeded tenants/users must be reflected — other tests
    // or seed data may add more, so assert lower bounds, not exact totals.
    expect(payload.data.totalTenants).toBeGreaterThanOrEqual(2)
    expect(payload.data.activeTenants).toBeGreaterThanOrEqual(1)
    expect(payload.data.totalUsers).toBeGreaterThanOrEqual(3)
    expect(payload.data.onboardRequestsByStatus.pending).toBeGreaterThanOrEqual(1)
    expect(payload.data.onboardRequestsByStatus.approved).toBeGreaterThanOrEqual(1)
    expect(typeof payload.data.onboardRequestsByStatus.rejected).toBe('number')
    expect(typeof payload.data.onboardRequestsByStatus['info-needed']).toBe('number')
  })
})
