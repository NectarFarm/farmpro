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
import { POST as loginPOST } from '@/app/api/auth/login/route'
import { db } from '@/db'
import { tenants, users, sessions, farms, onboardRequests, setPasswordTokens } from '@/db/schemas'
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
  let ownerTempPassword: string

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
      // feat/email-notifications: approval now mints a set_password_tokens
      // row (FK -> users.id) instead of only handing the temp password back
      // — clear it before deleting the owner row it references.
      const ownerRows = await db.select({ id: users.id }).from(users).where(eq(users.tenantId, provisionedTenantId))
      for (const owner of ownerRows) {
        await db.delete(setPasswordTokens).where(eq(setPasswordTokens.userId, owner.id))
      }
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
          consentGiven: true,
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

    // issue #291: the response must surface the real one-time owner temp
    // password so the approving admin can actually relay it.
    expect(typeof payload.data.ownerTempPassword).toBe('string')
    expect(payload.data.ownerTempPassword.length).toBeGreaterThan(0)
    ownerTempPassword = payload.data.ownerTempPassword
  })

  it('the returned temp password actually authenticates the new owner (issue #291)', async () => {
    expect(ownerTempPassword).toBeTruthy()
    const { status, payload } = await readJson(
      await loginPOST(
        new Request('http://localhost/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: requestEmail, password: ownerTempPassword }),
        })
      )
    )
    expect(status).toBe(200)
    expect(payload.success).toBe(true)
    expect(payload.data.email).toBe(requestEmail)
    expect(payload.data.role).toBe('owner')
    expect(payload.data.tenantId).toBe(provisionedTenantId)

    // Clean up the session the login created so afterAll's tenant/user
    // deletes aren't blocked by an FK-referencing session row.
    await db.delete(sessions).where(eq(sessions.userId, payload.data.id))
  })

  it('PATCH approve is idempotent (does not provision a second tenant, and never re-returns the password)', async () => {
    mockCookie = superAdminSessionToken
    const { status, payload } = await readJson(
      await onboardPATCH(jsonRequest(`http://localhost/api/onboard-requests/${requestId}`, 'PATCH', { status: 'approved' }), {
        params: Promise.resolve({ id: requestId }),
      })
    )
    expect(status).toBe(200)
    expect(payload.data.tenantId).toBe(provisionedTenantId)
    // The "already provisioned" branch returns the existing row as-is — the
    // password can never be retrieved again after the first response.
    expect(payload.data.ownerTempPassword).toBeUndefined()
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

// ── Field-level validation (issues #251/#252) ───────────────────────────────
// Covers the location fields (address/latitude/longitude — RegisterScreen
// collects GPS but used to throw it away), the required consent record, and
// the `{ success: false, error, fields }` shape the form relies on to
// highlight every bad field at once.
run('onboarding requests: field validation + location + consent (issues #251/#252)', () => {
  const superAdminEmail = `super-onboard-fields-${randomUUID()}@test.ifms`
  const superAdminId = randomUUID()
  const superAdminPassword = 'platPass123'
  let superAdminSessionToken: string

  const nonAdminTenantId = `t-onboard-fields-${randomUUID()}`
  const nonAdminEmail = `owner-onboard-fields-${randomUUID()}@test.ifms`
  const nonAdminId = randomUUID()

  const createdRequestIds: string[] = []

  function validBody(overrides: Record<string, unknown> = {}) {
    return {
      farmerName: 'Test Farmer',
      email: `farmer-${randomUUID()}@test.ifms`,
      phone: '+254700000111',
      farmName: `Field Test Farm ${randomUUID().slice(0, 8)}`,
      location: 'Nakuru, Kenya',
      enterprises: ['layer'],
      consentGiven: true,
      ...overrides,
    }
  }

  async function submit(body: Record<string, unknown>) {
    const res = await readJson(await onboardPOST(jsonRequest('http://localhost/api/onboard-requests', 'POST', body)))
    if (res.status === 201) createdRequestIds.push(res.payload.data.id)
    return res
  }

  beforeAll(async () => {
    const salt = randomUUID()
    await db.insert(tenants).values({ id: nonAdminTenantId, name: 'Non-admin Fields Test Co.', active: true })
    await db.insert(users).values([
      {
        id: superAdminId, tenantId: null, name: 'Fields Test Super Admin', email: superAdminEmail,
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
    for (const id of createdRequestIds) {
      await db.delete(onboardRequests).where(eq(onboardRequests.id, id))
    }
    await db.delete(sessions).where(eq(sessions.userId, superAdminId))
    await db.delete(users).where(eq(users.id, superAdminId))
    await db.delete(users).where(eq(users.id, nonAdminId))
    await db.delete(tenants).where(eq(tenants.id, nonAdminTenantId))
  })

  it('persists and returns address/latitude/longitude when supplied', async () => {
    mockCookie = undefined
    const { status, payload } = await submit(
      validBody({ address: '123 Farm Rd, Nakuru', latitude: '-0.303099', longitude: '36.080025' })
    )
    expect(status).toBe(201)
    const id = payload.data.id

    mockCookie = superAdminSessionToken
    const { payload: listPayload } = await readJson(await onboardGET())
    const found = listPayload.data.find((r: { id: string }) => r.id === id)
    expect(found).toBeTruthy()
    expect(found.address).toBe('123 Farm Rd, Nakuru')
    expect(found.latitude).toBeCloseTo(-0.303099)
    expect(found.longitude).toBeCloseTo(36.080025)
  })

  it('succeeds with no location fields at all (they are optional)', async () => {
    mockCookie = undefined
    const { status, payload } = await submit(validBody())
    expect(status).toBe(201)
    expect(typeof payload.data.id).toBe('string')
  })

  it('rejects latitude supplied without longitude', async () => {
    mockCookie = undefined
    const { status, payload } = await submit(validBody({ latitude: '-1.5' }))
    expect(status).toBe(400)
    expect(payload.success).toBe(false)
    expect(payload.fields.longitude).toBeTruthy()
  })

  it('rejects out-of-range latitude and longitude', async () => {
    mockCookie = undefined
    const { status, payload } = await submit(validBody({ latitude: 91, longitude: 181 }))
    expect(status).toBe(400)
    expect(payload.fields.latitude).toBeTruthy()
    expect(payload.fields.longitude).toBeTruthy()
  })

  it('rejects an invalid email with fields.email set', async () => {
    mockCookie = undefined
    const { status, payload } = await submit(validBody({ email: 'not-an-email' }))
    expect(status).toBe(400)
    expect(payload.success).toBe(false)
    expect(payload.fields.email).toBeTruthy()
  })

  it('rejects an invalid phone with fields.phone set, and accepts+normalizes a local 07XXXXXXXX number', async () => {
    mockCookie = undefined
    const invalid = await submit(validBody({ phone: '12345' }))
    expect(invalid.status).toBe(400)
    expect(invalid.payload.fields.phone).toBeTruthy()

    const localPhoneEmail = `farmer-local-${randomUUID()}@test.ifms`
    const valid = await submit(validBody({ email: localPhoneEmail, phone: '0712345678' }))
    expect(valid.status).toBe(201)

    const [row] = await db.select().from(onboardRequests).where(eq(onboardRequests.id, valid.payload.data.id))
    expect(row.phone).toBe('+254712345678')
  })

  it('collects multiple simultaneous failures in one fields object', async () => {
    mockCookie = undefined
    const { status, payload } = await submit(
      validBody({ email: 'bad', phone: 'bad', farmerName: '', latitude: 200 })
    )
    expect(status).toBe(400)
    expect(payload.fields.email).toBeTruthy()
    expect(payload.fields.phone).toBeTruthy()
    expect(payload.fields.farmerName).toBeTruthy()
    expect(payload.fields.latitude).toBeTruthy()
    // error carries the first message, but every failing field is present.
    expect(typeof payload.error).toBe('string')
    expect(payload.error.length).toBeGreaterThan(0)
  })

  it('rejects an empty enterprises array', async () => {
    mockCookie = undefined
    const { status, payload } = await submit(validBody({ enterprises: [] }))
    expect(status).toBe(400)
    expect(payload.fields.enterprises).toBeTruthy()
  })

  it('rejects a submission missing consentGiven, with fields.consentGiven set', async () => {
    mockCookie = undefined
    const body = validBody() as Record<string, unknown>
    delete body.consentGiven
    const { status, payload } = await submit(body)
    expect(status).toBe(400)
    expect(payload.fields.consentGiven).toBeTruthy()
  })

  it('rejects consentGiven: false', async () => {
    mockCookie = undefined
    const { status, payload } = await submit(validBody({ consentGiven: false }))
    expect(status).toBe(400)
    expect(payload.fields.consentGiven).toBeTruthy()
  })

  it('rejects consentGiven as the string "true" (must be a real boolean)', async () => {
    mockCookie = undefined
    const { status, payload } = await submit(validBody({ consentGiven: 'true' }))
    expect(status).toBe(400)
    expect(payload.fields.consentGiven).toBeTruthy()
  })

  it('consentGiven: true succeeds and persists a server-recorded consentAt + default consentVersion', async () => {
    mockCookie = undefined
    const before = Date.now()
    const { status, payload } = await submit(validBody())
    expect(status).toBe(201)

    const [row] = await db.select().from(onboardRequests).where(eq(onboardRequests.id, payload.data.id))
    expect(row.consentAt).toBeInstanceOf(Date)
    expect(row.consentAt!.getTime()).toBeGreaterThanOrEqual(before - 1000)
    expect(row.consentVersion).toBe('v1')
  })

  it('ignores a client-supplied consentAt — the stored value is the server clock, not the client date', async () => {
    mockCookie = undefined
    const before = Date.now()
    const { status, payload } = await submit(validBody({ consentAt: '1990-01-01T00:00:00.000Z' }))
    expect(status).toBe(201)

    const [row] = await db.select().from(onboardRequests).where(eq(onboardRequests.id, payload.data.id))
    expect(row.consentAt!.getTime()).toBeGreaterThanOrEqual(before - 1000)
  })

  it('admin PATCH can set location on a pending request', async () => {
    mockCookie = undefined
    const { payload: created } = await submit(validBody())
    const id = created.data.id

    mockCookie = superAdminSessionToken
    const { status, payload } = await readJson(
      await onboardPATCH(
        jsonRequest(`http://localhost/api/onboard-requests/${id}`, 'PATCH', {
          address: 'Updated Address, Nakuru',
          latitude: -0.4,
          longitude: 36.1,
        }),
        { params: Promise.resolve({ id }) }
      )
    )
    expect(status).toBe(200)
    expect(payload.data.status).toBe('pending')
    expect(payload.data.address).toBe('Updated Address, Nakuru')
    expect(payload.data.latitude).toBeCloseTo(-0.4)
    expect(payload.data.longitude).toBeCloseTo(36.1)
  })

  it('a non-super_admin cannot PATCH location onto a request', async () => {
    mockCookie = undefined
    const { payload: created } = await submit(validBody())
    const id = created.data.id

    const token = await createSession(nonAdminId)
    mockCookie = token
    const { status } = await readJson(
      await onboardPATCH(
        jsonRequest(`http://localhost/api/onboard-requests/${id}`, 'PATCH', { latitude: 1, longitude: 1 }),
        { params: Promise.resolve({ id }) }
      )
    )
    expect(status).toBe(403)
    await db.delete(sessions).where(eq(sessions.token, token))
  })

  it('PATCH cannot modify consentAt or consentVersion', async () => {
    mockCookie = undefined
    const { payload: created } = await submit(validBody())
    const id = created.data.id

    mockCookie = superAdminSessionToken
    const { status, payload } = await readJson(
      await onboardPATCH(
        jsonRequest(`http://localhost/api/onboard-requests/${id}`, 'PATCH', {
          consentAt: '1990-01-01T00:00:00.000Z',
          consentVersion: 'v99',
        }),
        { params: Promise.resolve({ id }) }
      )
    )
    expect(status).toBe(400)
    expect(payload.success).toBe(false)
    expect(payload.fields.consentAt).toBeTruthy()
    expect(payload.fields.consentVersion).toBeTruthy()

    const [row] = await db.select().from(onboardRequests).where(eq(onboardRequests.id, id))
    expect(row.consentVersion).toBe('v1')
  })
})
