// ── Getting-started guide + duplicate-application handling ──────────────────
// Integration tests against the real route handlers and a real postgres when
// DATABASE_URL is set (local/dev) — same convention as tests/onboarding.test.ts
// and tests/onboarding-email.test.ts. Brevo is stubbed at the `fetch` boundary.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'

vi.mock('server-only', () => ({}))

let mockCookie: string | undefined
vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({ get: () => (mockCookie ? { value: mockCookie } : undefined) })),
}))

import { POST as onboardPOST } from '@/app/api/onboard-requests/route'
import { PATCH as onboardPATCH } from '@/app/api/onboard-requests/[id]/route'
import { POST as sendGuidePOST } from '@/app/api/onboard-requests/[id]/send-guide/route'
import { db } from '@/db'
import { tenants, users, sessions, farms, onboardRequests, setPasswordTokens } from '@/db/schemas'
import { createSession, hashSecret } from '@/lib/auth'
import { ONBOARDING_GUIDE_STEPS } from '@/lib/onboarding-guide'

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

function newRequestBody(overrides: Record<string, unknown> = {}) {
  return {
    farmerName: 'Guide Test Farmer',
    email: `farmer-${randomUUID()}@test.ifms`,
    phone: `+254${700000000 + Math.floor(Math.random() * 99999999)}`,
    farmName: `Guide Test Farm ${randomUUID().slice(0, 6)}`,
    location: 'Nakuru, Kenya',
    enterprises: ['layer'],
    consentGiven: true,
    latitude: '-0.303099',
    longitude: '36.080025',
    ...overrides,
  }
}

run('duplicate applications, email-already-registered, and the getting-started guide', () => {
  const superAdminEmail = `super-guide-${randomUUID()}@test.ifms`
  const superAdminId = randomUUID()
  let superAdminSessionToken: string

  const nonAdminTenantId = `t-guide-${randomUUID()}`
  const nonAdminEmail = `owner-guide-${randomUUID()}@test.ifms`
  const nonAdminId = randomUUID()

  const provisionedTenantIds: string[] = []
  const createdRequestIds: string[] = []

  let fetchMock: ReturnType<typeof vi.fn>
  const originalApiKey = process.env.BREVO_API_KEY

  beforeAll(async () => {
    const salt = randomUUID()
    await db.insert(tenants).values({ id: nonAdminTenantId, name: 'Non-admin Guide Test Co.', active: true })
    await db.insert(users).values([
      {
        id: superAdminId, tenantId: null, name: 'Guide Test Super Admin', email: superAdminEmail,
        role: 'super_admin', passwordHash: hashSecret('platPass123', salt), passwordSalt: salt, status: 'ACTIVE',
      },
      {
        id: nonAdminId, tenantId: nonAdminTenantId, name: 'Non Admin', email: nonAdminEmail,
        role: 'owner', passwordHash: hashSecret('ownerpw', salt), passwordSalt: salt, status: 'ACTIVE',
      },
    ])
    superAdminSessionToken = await createSession(superAdminId)
  })

  afterAll(async () => {
    for (const tenantId of provisionedTenantIds) {
      const ownerRows = await db.select({ id: users.id }).from(users).where(eq(users.tenantId, tenantId))
      for (const owner of ownerRows) {
        await db.delete(setPasswordTokens).where(eq(setPasswordTokens.userId, owner.id))
      }
      await db.delete(users).where(eq(users.tenantId, tenantId))
      await db.delete(farms).where(eq(farms.tenantId, tenantId))
      await db.delete(tenants).where(eq(tenants.id, tenantId))
    }
    for (const id of createdRequestIds) {
      await db.delete(onboardRequests).where(eq(onboardRequests.id, id)).catch(() => {})
    }
    await db.delete(sessions).where(eq(sessions.userId, superAdminId))
    await db.delete(users).where(eq(users.id, superAdminId))
    await db.delete(users).where(eq(users.id, nonAdminId))
    await db.delete(tenants).where(eq(tenants.id, nonAdminTenantId))
  })

  beforeEach(() => {
    mockCookie = undefined
    fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: `test-msg-${randomUUID()}` }) })
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    if (originalApiKey === undefined) delete process.env.BREVO_API_KEY
    else process.env.BREVO_API_KEY = originalApiKey
  })

  async function submitRequest(overrides: Record<string, unknown> = {}) {
    const body = newRequestBody(overrides)
    const { status, payload } = await readJson(await onboardPOST(jsonRequest('http://localhost/api/onboard-requests', 'POST', body)))
    if (payload?.data?.id) createdRequestIds.push(payload.data.id)
    return { status, payload, body }
  }

  it('a second application from the same email while pending UPDATES the row instead of creating a second one', async () => {
    mockCookie = undefined
    const email = `farmer-dup-${randomUUID()}@test.ifms`
    const first = await submitRequest({ email, farmerName: 'First Try' })
    expect(first.status).toBe(201)
    expect(first.payload.data.updated).toBe(false)
    const id = first.payload.data.id

    const second = await submitRequest({ email, farmerName: 'Second Try, Corrected' })
    expect(second.status).toBe(201)
    expect(second.payload.data.updated).toBe(true)
    expect(second.payload.data.id).toBe(id)

    const rows = await db.select().from(onboardRequests).where(eq(onboardRequests.email, email))
    expect(rows).toHaveLength(1)
    expect(rows[0].farmerName).toBe('Second Try, Corrected')
    expect(rows[0].status).toBe('pending')
  })

  it('a second application while info-needed UPDATES the row and resets it to pending', async () => {
    mockCookie = undefined
    const email = `farmer-dup-info-${randomUUID()}@test.ifms`
    const first = await submitRequest({ email })
    const id = first.payload.data.id

    mockCookie = superAdminSessionToken
    await onboardPATCH(
      jsonRequest(`http://localhost/api/onboard-requests/${id}`, 'PATCH', { status: 'info-needed', notes: 'fix your phone' }),
      { params: Promise.resolve({ id }) }
    )
    mockCookie = undefined

    const resubmit = await submitRequest({ email, farmerName: 'Corrected After Info Needed' })
    expect(resubmit.status).toBe(201)
    expect(resubmit.payload.data.updated).toBe(true)
    expect(resubmit.payload.data.id).toBe(id)

    const [row] = await db.select().from(onboardRequests).where(eq(onboardRequests.id, id))
    expect(row.status).toBe('pending')
    expect(row.farmerName).toBe('Corrected After Info Needed')
  })

  it('re-applying after rejection creates a genuinely NEW row, leaving the rejected one alone', async () => {
    mockCookie = undefined
    const email = `farmer-dup-rejected-${randomUUID()}@test.ifms`
    const first = await submitRequest({ email })
    const firstId = first.payload.data.id

    mockCookie = superAdminSessionToken
    await onboardPATCH(
      jsonRequest(`http://localhost/api/onboard-requests/${firstId}`, 'PATCH', { status: 'rejected', notes: 'not a fit' }),
      { params: Promise.resolve({ id: firstId }) }
    )
    mockCookie = undefined

    const second = await submitRequest({ email })
    expect(second.status).toBe(201)
    expect(second.payload.data.updated).toBe(false)
    expect(second.payload.data.id).not.toBe(firstId)

    const rows = await db.select().from(onboardRequests).where(eq(onboardRequests.email, email))
    expect(rows).toHaveLength(2)
    const rejectedRow = rows.find((r) => r.id === firstId)
    expect(rejectedRow?.status).toBe('rejected')
  })

  it('re-applying after approval is refused outright — the email now belongs to a real account (task 4), not a fresh onboarding row', async () => {
    mockCookie = undefined
    const email = `farmer-dup-approved-${randomUUID()}@test.ifms`
    const first = await submitRequest({ email })
    const firstId = first.payload.data.id

    mockCookie = superAdminSessionToken
    const approveRes = await readJson(
      await onboardPATCH(jsonRequest(`http://localhost/api/onboard-requests/${firstId}`, 'PATCH', { status: 'approved' }), { params: Promise.resolve({ id: firstId }) })
    )
    provisionedTenantIds.push(approveRes.payload.data.tenantId)
    mockCookie = undefined

    // Approving created a real `users` row for this email — task 4's check
    // now refuses a further application outright rather than creating a
    // second onboard_requests row for an address that already has an account.
    const second = await submitRequest({ email })
    expect(second.status).toBe(409)
    expect(second.payload.success).toBe(false)
    expect(second.payload.fields.email).toBeTruthy()

    const rows = await db.select().from(onboardRequests).where(eq(onboardRequests.email, email))
    expect(rows).toHaveLength(1)
    expect(rows[0].status).toBe('approved')
  })

  it('rejects a submission whose email already belongs to a users row, with a clear 409 and fields.email', async () => {
    mockCookie = undefined
    const { status, payload } = await submitRequest({ email: nonAdminEmail })
    expect(status).toBe(409)
    expect(payload.success).toBe(false)
    expect(payload.fields.email).toBeTruthy()
    expect(payload.error).toMatch(/already has an account/i)

    // Confirm nothing was inserted for it.
    const rows = await db.select().from(onboardRequests).where(eq(onboardRequests.email, nonAdminEmail))
    expect(rows).toHaveLength(0)
  })

  it('the approval email includes the getting-started guide alongside the set-password link', async () => {
    process.env.BREVO_API_KEY = 'test-key'
    const { payload: created } = await submitRequest()
    const id = created.data.id

    mockCookie = superAdminSessionToken
    const { status, payload } = await readJson(
      await onboardPATCH(jsonRequest(`http://localhost/api/onboard-requests/${id}`, 'PATCH', { status: 'approved' }), { params: Promise.resolve({ id }) })
    )
    expect(status).toBe(200)
    provisionedTenantIds.push(payload.data.tenantId)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const sent = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(sent.textContent).toMatch(/\/set-password\//)
    // Every step's title appears — the email is the SAME data as
    // ONBOARDING_GUIDE_STEPS, not a hand-copied summary.
    for (const step of ONBOARDING_GUIDE_STEPS) {
      expect(sent.textContent).toContain(step.title)
      expect(sent.htmlContent).toContain(step.title)
    }
  })

  it('POST /api/onboard-requests/[id]/send-guide requires a session and super_admin role', async () => {
    process.env.BREVO_API_KEY = 'test-key'
    const { payload: created } = await submitRequest()
    const id = created.data.id

    mockCookie = superAdminSessionToken
    const approveRes = await readJson(
      await onboardPATCH(jsonRequest(`http://localhost/api/onboard-requests/${id}`, 'PATCH', { status: 'approved' }), { params: Promise.resolve({ id }) })
    )
    provisionedTenantIds.push(approveRes.payload.data.tenantId)

    mockCookie = undefined
    const noSession = await readJson(await sendGuidePOST(jsonRequest('http://localhost', 'POST'), { params: Promise.resolve({ id }) }))
    expect(noSession.status).toBe(401)

    const token = await createSession(nonAdminId)
    mockCookie = token
    const wrongRole = await readJson(await sendGuidePOST(jsonRequest('http://localhost', 'POST'), { params: Promise.resolve({ id }) }))
    expect(wrongRole.status).toBe(403)
    await db.delete(sessions).where(eq(sessions.token, token))
  })

  it('POST send-guide refuses a request that is not yet approved', async () => {
    const { payload: created } = await submitRequest()
    const id = created.data.id

    mockCookie = superAdminSessionToken
    const { status, payload } = await readJson(await sendGuidePOST(jsonRequest('http://localhost', 'POST'), { params: Promise.resolve({ id }) }))
    expect(status).toBe(400)
    expect(payload.success).toBe(false)
  })

  it('POST send-guide emails the guide again for an approved request, with NO set-password link', async () => {
    process.env.BREVO_API_KEY = 'test-key'
    const { payload: created, body } = await submitRequest()
    const id = created.data.id

    mockCookie = superAdminSessionToken
    const approveRes = await readJson(
      await onboardPATCH(jsonRequest(`http://localhost/api/onboard-requests/${id}`, 'PATCH', { status: 'approved' }), { params: Promise.resolve({ id }) })
    )
    provisionedTenantIds.push(approveRes.payload.data.tenantId)
    fetchMock.mockClear()

    const { status, payload } = await readJson(await sendGuidePOST(jsonRequest('http://localhost', 'POST'), { params: Promise.resolve({ id }) }))
    expect(status).toBe(200)
    expect(payload.success).toBe(true)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const sent = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(sent.to).toEqual([{ email: body.email }])
    expect(sent.textContent).not.toMatch(/\/set-password\//)
    expect(sent.textContent).toMatch(/forgot password/i)
    expect(sent.textContent).toContain(ONBOARDING_GUIDE_STEPS[0].title)
  })

  it('POST send-guide with no BREVO_API_KEY still reports success (mail is a no-op, not a failure)', async () => {
    delete process.env.BREVO_API_KEY
    const { payload: created } = await submitRequest()
    const id = created.data.id

    mockCookie = superAdminSessionToken
    const approveRes = await readJson(
      await onboardPATCH(jsonRequest(`http://localhost/api/onboard-requests/${id}`, 'PATCH', { status: 'approved' }), { params: Promise.resolve({ id }) })
    )
    provisionedTenantIds.push(approveRes.payload.data.tenantId)
    fetchMock.mockClear()

    const { status, payload } = await readJson(await sendGuidePOST(jsonRequest('http://localhost', 'POST'), { params: Promise.resolve({ id }) }))
    expect(status).toBe(200)
    expect(payload.success).toBe(true)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('POST send-guide 404s for an unknown request id', async () => {
    mockCookie = superAdminSessionToken
    const { status } = await readJson(await sendGuidePOST(jsonRequest('http://localhost', 'POST'), { params: Promise.resolve({ id: randomUUID() }) }))
    expect(status).toBe(404)
  })
})
