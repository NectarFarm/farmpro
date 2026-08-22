// ── Onboarding emails (feat/email-notifications, Task 2) ────────────────────
// Integration tests against the real PATCH /api/onboard-requests/[id],
// POST/GET /api/set-password/[token] and GET/POST
// /api/onboard-requests/update/[token] routes, using a real postgres when
// DATABASE_URL is set (local/dev) — same convention as tests/onboarding.test.ts.
// The Resend provider is stubbed at the `fetch` boundary (never a real
// network call); RESEND_API_KEY is set only for the tests that need to
// inspect what was actually sent.
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
import { GET as setPasswordGET, POST as setPasswordPOST } from '@/app/api/set-password/[token]/route'
import { GET as updateGET, POST as updatePOST } from '@/app/api/onboard-requests/update/[token]/route'
import { db } from '@/db'
import { tenants, users, sessions, farms, onboardRequests, setPasswordTokens, onboardUpdateTokens } from '@/db/schemas'
import { createSession, hashSecret, verifySecret } from '@/lib/auth'

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
    farmerName: 'Email Test Farmer',
    email: `farmer-${randomUUID()}@test.ifms`,
    phone: `+254${700000000 + Math.floor(Math.random() * 99999999)}`,
    farmName: `Email Test Farm ${randomUUID().slice(0, 6)}`,
    location: 'Nakuru, Kenya',
    enterprises: ['layer'],
    consentGiven: true,
    ...overrides,
  }
}

run('onboarding emails (feat/email-notifications)', () => {
  const superAdminEmail = `super-onboard-email-${randomUUID()}@test.ifms`
  const superAdminId = randomUUID()
  let superAdminSessionToken: string

  const provisionedTenantIds: string[] = []
  const createdRequestIds: string[] = []

  let fetchMock: ReturnType<typeof vi.fn>
  const originalApiKey = process.env.RESEND_API_KEY

  beforeAll(async () => {
    const salt = randomUUID()
    await db.insert(users).values({
      id: superAdminId, tenantId: null, name: 'Onboard Email Super Admin', email: superAdminEmail,
      role: 'super_admin', passwordHash: hashSecret('platPass123', salt), passwordSalt: salt, status: 'ACTIVE',
    })
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
      await db.delete(onboardUpdateTokens).where(eq(onboardUpdateTokens.onboardRequestId, id)).catch(() => {})
      await db.delete(onboardRequests).where(eq(onboardRequests.id, id)).catch(() => {})
    }
    await db.delete(sessions).where(eq(sessions.userId, superAdminId))
    await db.delete(users).where(eq(users.id, superAdminId))
  })

  beforeEach(() => {
    mockCookie = undefined
    fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: `test-msg-${randomUUID()}` }) })
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    if (originalApiKey === undefined) delete process.env.RESEND_API_KEY
    else process.env.RESEND_API_KEY = originalApiKey
  })

  async function submitRequest(overrides: Record<string, unknown> = {}) {
    const body = newRequestBody(overrides)
    const { payload } = await readJson(await onboardPOST(jsonRequest('http://localhost/api/onboard-requests', 'POST', body)))
    const id: string = payload.data.id
    createdRequestIds.push(id)
    return { id, body }
  }

  it('approval emails a one-time set-password link and NEVER the raw password', async () => {
    process.env.RESEND_API_KEY = 'test-key'
    const { id, body } = await submitRequest()

    mockCookie = superAdminSessionToken
    const { status, payload } = await readJson(
      await onboardPATCH(jsonRequest(`http://localhost/api/onboard-requests/${id}`, 'PATCH', { status: 'approved' }), { params: Promise.resolve({ id }) })
    )
    expect(status).toBe(200)
    const tempPassword: string = payload.data.ownerTempPassword
    expect(typeof tempPassword).toBe('string')
    provisionedTenantIds.push(payload.data.tenantId)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [, init] = fetchMock.mock.calls[0]
    const sent = JSON.parse(init.body)
    expect(sent.to).toEqual([body.email])
    expect(sent.text).not.toContain(tempPassword)
    expect(sent.html).not.toContain(tempPassword)
    expect(sent.text).toMatch(/\/set-password\//)
  })

  it('with no RESEND_API_KEY configured, approval still succeeds and no network call is made', async () => {
    delete process.env.RESEND_API_KEY
    const { id } = await submitRequest()

    mockCookie = superAdminSessionToken
    const { status, payload } = await readJson(
      await onboardPATCH(jsonRequest(`http://localhost/api/onboard-requests/${id}`, 'PATCH', { status: 'approved' }), { params: Promise.resolve({ id }) })
    )
    expect(status).toBe(200)
    expect(payload.success).toBe(true)
    expect(typeof payload.data.ownerTempPassword).toBe('string')
    provisionedTenantIds.push(payload.data.tenantId)

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('the set-password link works once, then is refused', async () => {
    process.env.RESEND_API_KEY = 'test-key'
    const { id } = await submitRequest()
    mockCookie = superAdminSessionToken
    const approveRes = await readJson(
      await onboardPATCH(jsonRequest(`http://localhost/api/onboard-requests/${id}`, 'PATCH', { status: 'approved' }), { params: Promise.resolve({ id }) })
    )
    provisionedTenantIds.push(approveRes.payload.data.tenantId)
    mockCookie = undefined

    const sentBody = JSON.parse(fetchMock.mock.calls[0][1].body)
    const token = (sentBody.text.match(/\/set-password\/([^\s]+)/) as RegExpMatchArray)[1]

    const getRes = await readJson(await setPasswordGET(new Request('http://localhost'), { params: Promise.resolve({ token }) }))
    expect(getRes.status).toBe(200)

    const firstSet = await readJson(
      await setPasswordPOST(jsonRequest('http://localhost', 'POST', { password: 'brandNewPass123' }), { params: Promise.resolve({ token }) })
    )
    expect(firstSet.status).toBe(200)

    // The password really changed to what was submitted.
    const [ownerRow] = await db.select().from(users).where(eq(users.tenantId, approveRes.payload.data.tenantId))
    expect(verifySecret('brandNewPass123', ownerRow.passwordSalt, ownerRow.passwordHash)).toBe(true)

    const secondSet = await readJson(
      await setPasswordPOST(jsonRequest('http://localhost', 'POST', { password: 'anotherPass456' }), { params: Promise.resolve({ token }) })
    )
    expect(secondSet.status).toBe(401)
    expect(secondSet.payload.success).toBe(false)

    // ...and the second (refused) attempt never actually changed it again.
    const [ownerRowAfter] = await db.select().from(users).where(eq(users.tenantId, approveRes.payload.data.tenantId))
    expect(verifySecret('brandNewPass123', ownerRowAfter.passwordSalt, ownerRowAfter.passwordHash)).toBe(true)
  })

  it('an expired set-password token is refused', async () => {
    const userId = randomUUID()
    const salt = randomUUID()
    const tenantId = `t-exp-setpw-${randomUUID()}`
    await db.insert(tenants).values({ id: tenantId, name: 'Expired token tenant', active: true })
    await db.insert(users).values({
      id: userId, tenantId, name: 'Expired Token Owner', email: `exp-${randomUUID()}@test.ifms`,
      role: 'owner', passwordHash: hashSecret('pw', salt), passwordSalt: salt, status: 'ACTIVE',
    })
    const token = `expired-setpw-${randomUUID()}`
    await db.insert(setPasswordTokens).values({
      id: randomUUID(), userId, token,
      expiresAt: new Date(Date.now() - 60 * 60 * 1000),
      createdAt: new Date(Date.now() - 3 * 60 * 60 * 1000),
    })

    const res = await readJson(await setPasswordPOST(jsonRequest('http://localhost', 'POST', { password: 'somePassword123' }), { params: Promise.resolve({ token }) }))
    expect(res.status).toBe(401)

    await db.delete(setPasswordTokens).where(eq(setPasswordTokens.token, token))
    await db.delete(users).where(eq(users.id, userId))
    await db.delete(tenants).where(eq(tenants.id, tenantId))
  })

  it('info-needed emails an update link with the admin\'s notes, and the applicant can correct + resubmit', async () => {
    process.env.RESEND_API_KEY = 'test-key'
    const { id } = await submitRequest()

    mockCookie = superAdminSessionToken
    const infoRes = await readJson(
      await onboardPATCH(
        jsonRequest(`http://localhost/api/onboard-requests/${id}`, 'PATCH', { status: 'info-needed', notes: 'Phone number looks invalid' }),
        { params: Promise.resolve({ id }) }
      )
    )
    expect(infoRes.status).toBe(200)
    mockCookie = undefined

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const sent = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(sent.text).toContain('Phone number looks invalid')
    const token = (sent.text.match(/\/onboard-requests\/update\/([^\s]+)/) as RegExpMatchArray)[1]

    // GET reflects the current (still info-needed) data.
    const getRes = await readJson(await updateGET(new Request('http://localhost'), { params: Promise.resolve({ token }) }))
    expect(getRes.status).toBe(200)
    expect(getRes.payload.data.status).toBe('info-needed')

    // Validation still applies: too-short farmerName is refused.
    const badRes = await readJson(
      await updatePOST(
        jsonRequest('http://localhost', 'POST', { ...newRequestBody(), farmerName: 'A' }),
        { params: Promise.resolve({ token }) }
      )
    )
    expect(badRes.status).toBe(400)
    expect(badRes.payload.fields.farmerName).toBeTruthy()

    // A valid resubmission moves it back to pending and closes the link out.
    const goodRes = await readJson(
      await updatePOST(
        jsonRequest('http://localhost', 'POST', { ...newRequestBody({ email: getRes.payload.data.email }), farmerName: 'Corrected Name' }),
        { params: Promise.resolve({ token }) }
      )
    )
    expect(goodRes.status).toBe(200)
    expect(goodRes.payload.data.status).toBe('pending')

    const [row] = await db.select().from(onboardRequests).where(eq(onboardRequests.id, id))
    expect(row.farmerName).toBe('Corrected Name')
    expect(row.status).toBe('pending')

    // The same token cannot be used again — it was closed out on success.
    const reuseRes = await readJson(
      await updatePOST(jsonRequest('http://localhost', 'POST', newRequestBody()), { params: Promise.resolve({ token }) })
    )
    expect(reuseRes.status).toBe(401)
  })

  it('an update-request token only edits its OWN request, never another one', async () => {
    process.env.RESEND_API_KEY = 'test-key'
    const { id: idA } = await submitRequest()
    const { id: idB } = await submitRequest()

    mockCookie = superAdminSessionToken
    await onboardPATCH(jsonRequest(`http://localhost/api/onboard-requests/${idA}`, 'PATCH', { status: 'info-needed', notes: 'fix A' }), { params: Promise.resolve({ id: idA }) })
    mockCookie = undefined
    const sentA = JSON.parse(fetchMock.mock.calls[0][1].body)
    const tokenA = (sentA.text.match(/\/onboard-requests\/update\/([^\s]+)/) as RegExpMatchArray)[1]

    await updatePOST(jsonRequest('http://localhost', 'POST', { ...newRequestBody(), farmerName: 'Only A Changed' }), { params: Promise.resolve({ token: tokenA }) })

    const [rowA] = await db.select().from(onboardRequests).where(eq(onboardRequests.id, idA))
    const [rowB] = await db.select().from(onboardRequests).where(eq(onboardRequests.id, idB))
    expect(rowA.farmerName).toBe('Only A Changed')
    expect(rowB.farmerName).not.toBe('Only A Changed')
    expect(rowB.status).toBe('pending')
  })

  it('rejection emails a short notice with no credentials and no link', async () => {
    process.env.RESEND_API_KEY = 'test-key'
    const { id } = await submitRequest()

    mockCookie = superAdminSessionToken
    const res = await readJson(
      await onboardPATCH(jsonRequest(`http://localhost/api/onboard-requests/${id}`, 'PATCH', { status: 'rejected', notes: 'Not a fit' }), { params: Promise.resolve({ id }) })
    )
    expect(res.status).toBe(200)
    mockCookie = undefined

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const sent = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(sent.text).toContain('Not a fit')
    expect(sent.text).not.toMatch(/\/set-password\//)
    expect(sent.text).not.toMatch(/\/onboard-requests\/update\//)
  })
})
