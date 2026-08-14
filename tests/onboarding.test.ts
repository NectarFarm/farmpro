// ── Onboarding-request queue tests (issue #251) ─────────────────────────────
// Integration tests that call the real route handlers directly (no HTTP
// server needed), mirroring tests/auth.test.ts. Run against the real postgres
// when DATABASE_URL is set (local/dev); CI has no database, so the suite
// skips there (vitest exits 0, and CI's build/typecheck still run).
//
// Covers the DoD: a request can be submitted publicly, appears in the admin
// queue, and approving it provisions a real tenant via the shared transaction
// (lib/tenant-provisioning.ts) — submit -> approve -> tenant-exists.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'

vi.mock('server-only', () => ({}))

let mockCookie: string | undefined
vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({ get: () => (mockCookie ? { value: mockCookie } : undefined) })),
}))

import { POST as onboardPOST, GET as onboardGET } from '@/app/api/onboard-requests/route'
import { PATCH as onboardPATCH } from '@/app/api/onboard-requests/[id]/route'
import { db } from '@/db'
import { tenants, users, sessions, farms, onboardRequests } from '@/db/schemas'
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

run('onboarding requests: submit -> admin queue -> approve provisions a tenant (issue #251)', () => {
  const superAdminEmail = `super-onboard-${randomUUID()}@test.ifms`
  const superAdminId = randomUUID()
  const superAdminPassword = 'platPass123'
  let superAdminSessionToken: string

  const nonAdminTenantId = `t-onboard-${randomUUID()}`
  const nonAdminEmail = `owner-onboard-${randomUUID()}@test.ifms`
  const nonAdminId = randomUUID()

  const requestEmail = `farmer-${randomUUID()}@test.ifms`
  const farmName = `Test Onboard Farm ${randomUUID().slice(0, 8)}`
  let requestId: string
  let provisionedTenantId: string | undefined

  beforeAll(async () => {
    const salt = randomUUID()
    await db.insert(tenants).values({ id: nonAdminTenantId, name: 'Non-admin Test Co.', active: true })
    await db.insert(users).values([
      {
        id: superAdminId, tenantId: null, name: 'Onboard Test Super Admin', email: superAdminEmail,
        role: 'super_admin', passwordHash: hashSecret(superAdminPassword, salt), passwordSalt: salt, status: 'ACTIVE',
      },
      {
        id: nonAdminId, tenantId: nonAdminTenantId, name: 'Non Admin', email: nonAdminEmail,
        role: 'owner', passwordHash: hashSecret('ownerpw', salt), passwordSalt: salt, status: 'ACTIVE',
      },
    ])
    superAdminSessionToken = await createSession(superAdminId)
  })

  afterAll(async () => {
    if (requestId) await db.delete(onboardRequests).where(eq(onboardRequests.id, requestId))
    if (provisionedTenantId) {
      await db.delete(users).where(eq(users.tenantId, provisionedTenantId))
      await db.delete(farms).where(eq(farms.tenantId, provisionedTenantId))
      await db.delete(tenants).where(eq(tenants.id, provisionedTenantId))
    }
    await db.delete(sessions).where(eq(sessions.userId, superAdminId))
    await db.delete(users).where(eq(users.id, superAdminId))
    await db.delete(users).where(eq(users.id, nonAdminId))
    await db.delete(tenants).where(eq(tenants.id, nonAdminTenantId))
  })

  it('rejects a public submission missing required fields (400)', async () => {
    mockCookie = undefined
    const { status, payload } = await readJson(
      await onboardPOST(jsonRequest('http://localhost/api/onboard-requests', 'POST', { farmerName: 'No Email' }))
    )
    expect(status).toBe(400)
    expect(payload.success).toBe(false)
  })

  it('accepts a public submission with no session (201, matches the #224 contract)', async () => {
    mockCookie = undefined
    const { status, payload } = await readJson(
      await onboardPOST(
        jsonRequest('http://localhost/api/onboard-requests', 'POST', {
          farmerName: 'Test Farmer',
          email: requestEmail,
          phone: '+254-700-000-000',
          farmName,
          location: 'Nakuru, Kenya',
          enterprises: ['layer', 'broiler'],
        })
      )
    )
    expect(status).toBe(201)
    expect(payload.success).toBe(true)
    expect(typeof payload.data.id).toBe('string')
    requestId = payload.data.id
  })

  it('GET is rejected with no session (401)', async () => {
    mockCookie = undefined
    const { status, payload } = await readJson(await onboardGET())
    expect(status).toBe(401)
    expect(payload.success).toBe(false)
  })

  it('GET is rejected for a non-super_admin session (403)', async () => {
    const token = await createSession(nonAdminId)
    mockCookie = token
    const { status } = await readJson(await onboardGET())
    expect(status).toBe(403)
    await db.delete(sessions).where(eq(sessions.token, token))
  })

  it('GET as super_admin lists the submitted request', async () => {
    mockCookie = superAdminSessionToken
    const { status, payload } = await readJson(await onboardGET())
    expect(status).toBe(200)
    expect(payload.success).toBe(true)
    const found = payload.data.find((r: { id: string }) => r.id === requestId)
    expect(found).toBeTruthy()
    expect(found.status).toBe('pending')
    expect(found.farmName).toBe(farmName)
  })

  it('PATCH approve (super_admin) provisions a real tenant', async () => {
    mockCookie = superAdminSessionToken
    const { status, payload } = await readJson(
      await onboardPATCH(jsonRequest(`http://localhost/api/onboard-requests/${requestId}`, 'PATCH', { status: 'approved' }), {
        params: Promise.resolve({ id: requestId }),
      })
    )
    expect(status).toBe(200)
    expect(payload.success).toBe(true)
    expect(payload.data.status).toBe('approved')
    expect(typeof payload.data.tenantId).toBe('string')
    provisionedTenantId = payload.data.tenantId
    const tenantId: string = provisionedTenantId as string

    // The DoD: approving really provisions a tenant — confirm it exists.
    const tenantRows = await db.select().from(tenants).where(eq(tenants.id, tenantId))
    expect(tenantRows).toHaveLength(1)
    expect(tenantRows[0].name).toBe(farmName)
    expect(tenantRows[0].active).toBe(true)

    const farmRows = await db.select().from(farms).where(eq(farms.tenantId, tenantId))
    expect(farmRows).toHaveLength(1)

    const ownerRows = await db.select().from(users).where(eq(users.tenantId, tenantId))
    expect(ownerRows).toHaveLength(1)
    expect(ownerRows[0].role).toBe('owner')
    expect(ownerRows[0].email).toBe(requestEmail)
  })

  it('PATCH approve is idempotent (does not provision a second tenant)', async () => {
    mockCookie = superAdminSessionToken
    const { status, payload } = await readJson(
      await onboardPATCH(jsonRequest(`http://localhost/api/onboard-requests/${requestId}`, 'PATCH', { status: 'approved' }), {
        params: Promise.resolve({ id: requestId }),
      })
    )
    expect(status).toBe(200)
    expect(payload.data.tenantId).toBe(provisionedTenantId)
  })

  it('PATCH is rejected for a non-super_admin session (403)', async () => {
    const token = await createSession(nonAdminId)
    mockCookie = token
    const { status } = await readJson(
      await onboardPATCH(jsonRequest(`http://localhost/api/onboard-requests/${requestId}`, 'PATCH', { status: 'rejected' }), {
        params: Promise.resolve({ id: requestId }),
      })
    )
    expect(status).toBe(403)
    await db.delete(sessions).where(eq(sessions.token, token))
  })
})
