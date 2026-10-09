// ── Platform-admin re-issue of a set-password link ──────────────────────────
// An approved farmer who opens the one link after it expired was locked out
// for good: the link is minted once, and no admin action existed. These pin
// the admin route: it supersedes the old link, refuses anyone who has already
// set a password (that is Reset password), needs users.manage, and the list
// reports who is still waiting.
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { eq, inArray } from 'drizzle-orm'

vi.mock('server-only', () => ({}))

let mockCookie: string | undefined
vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({ get: () => (mockCookie ? { value: mockCookie } : undefined) })),
}))

import { POST as reissuePOST } from '@/app/api/admin/users/[id]/set-password-link/route'
import { GET as usersGET } from '@/app/api/admin/users/route'
import { POST as setPasswordPOST } from '@/app/api/set-password/[token]/route'
import { db } from '@/db'
import { tenants, users, sessions, auditLog, setPasswordTokens, platformStaff } from '@/db/schemas'
import { createSession, hashSecret } from '@/lib/auth'
import { issueSetPasswordToken, setPasswordWaitFor, classifyLatestToken } from '@/lib/set-password'

const run = process.env.DATABASE_URL ? describe : describe.skip

const req = (method = 'POST', url = 'http://localhost') => new Request(url, { method })
const post = async (id: string) => {
  const res = await reissuePOST(req(), { params: Promise.resolve({ id }) })
  return { status: res.status, payload: await res.json() }
}

describe('classifyLatestToken', () => {
  const now = new Date('2026-10-09T12:00:00Z')
  const t = (createdH: number, expiresH: number, used = false) => ({
    createdAt: new Date(now.getTime() + createdH * 3_600_000),
    expiresAt: new Date(now.getTime() + expiresH * 3_600_000),
    usedAt: used ? now : null,
  })
  it('is null with no token or a redeemed one', () => {
    expect(classifyLatestToken(undefined, now)).toBeNull()
    expect(classifyLatestToken(t(-10, 38, true), now)).toBeNull()
  })
  it('separates a live link from an expired one', () => {
    expect(classifyLatestToken(t(-10, 38), now)?.state).toBe('waiting')
    expect(classifyLatestToken(t(-60, -12), now)?.state).toBe('expired')
  })
})

run('admin set-password link re-issue', () => {
  const tenantId = `t-${randomUUID()}`
  const salt = randomUUID()
  const mk = (id: string, role: string, extra: Record<string, unknown> = {}) => ({
    id, tenantId: role === 'super_admin' ? null : tenantId, name: id, email: `${id}@test.ifms`, role,
    passwordHash: hashSecret('pw', salt), passwordSalt: salt, status: 'ACTIVE', ...extra,
  })
  const adminId = `usr-admin-${randomUUID()}`
  const limitedId = `usr-limited-${randomUUID()}`
  const waitingId = `usr-wait-${randomUUID()}`
  const doneId = `usr-done-${randomUUID()}`
  const noTokenId = `usr-notoken-${randomUUID()}`
  const workerId = `usr-worker-${randomUUID()}`
  const ids = [adminId, limitedId, waitingId, doneId, noTokenId, workerId]
  let adminSession: string
  let limitedSession: string

  beforeAll(async () => {
    await db.insert(tenants).values({ id: tenantId, name: 'Admin Link Co.', active: true })
    await db.insert(users).values([
      mk(adminId, 'super_admin'), mk(limitedId, 'super_admin'), mk(waitingId, 'owner'),
      mk(doneId, 'owner'), mk(noTokenId, 'owner'), mk(workerId, 'worker'),
    ] as never)
    // A staff row WITHOUT users.manage — super_admin alone must not be enough.
    await db.insert(platformStaff).values({ userId: limitedId, title: 'Support', capabilities: ['support.handle'], active: true, createdBy: 'test' })
    adminSession = await createSession(adminId)
    limitedSession = await createSession(limitedId)
    await issueSetPasswordToken(waitingId)
    const { token } = await issueSetPasswordToken(doneId)
    await setPasswordPOST(new Request('http://localhost', { method: 'POST', body: JSON.stringify({ password: 'a-real-password-1' }), headers: { 'Content-Type': 'application/json' } }), { params: Promise.resolve({ token }) })
  })

  afterAll(async () => {
    mockCookie = undefined
    await db.delete(setPasswordTokens).where(inArray(setPasswordTokens.userId, ids))
    await db.delete(auditLog).where(eq(auditLog.tenantId, tenantId))
    await db.delete(sessions).where(inArray(sessions.userId, ids))
    await db.delete(platformStaff).where(eq(platformStaff.userId, limitedId))
    await db.delete(users).where(inArray(users.id, ids))
    await db.delete(tenants).where(eq(tenants.id, tenantId))
  })

  describe('emailing the re-issued link', () => {
    const originalKey = process.env.BREVO_API_KEY
    afterEach(() => {
      vi.unstubAllGlobals()
      if (originalKey === undefined) delete process.env.BREVO_API_KEY
      else process.env.BREVO_API_KEY = originalKey
    })
    const freshWaiting = async () => {
      const id = `usr-mail-${randomUUID()}`
      ids.push(id)
      await db.insert(users).values(mk(id, 'owner') as never)
      await issueSetPasswordToken(id)
      return id
    }
    const reissue = async (id: string) => {
      mockCookie = adminSession
      const res = await post(id)
      mockCookie = undefined
      return res
    }

    it('emails the link to the account address and reports emailed: true', async () => {
      process.env.BREVO_API_KEY = 'test-key'
      const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ messageId: 'm1' }) })
      vi.stubGlobal('fetch', fetchMock)
      const id = await freshWaiting()
      const { status, payload } = await reissue(id)
      expect(status).toBe(200)
      expect(payload.data.emailed).toBe(true)
      expect(fetchMock).toHaveBeenCalledTimes(1)
      const sent = JSON.parse(fetchMock.mock.calls[0][1].body)
      expect(sent.to).toEqual([{ email: `${id}@test.ifms` }])
      expect(sent.textContent).toContain(payload.data.setPasswordUrl)
    })

    it('a failing send still returns 200 with the URL and emailed: false', async () => {
      process.env.BREVO_API_KEY = 'test-key'
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')))
      const { status, payload } = await reissue(await freshWaiting())
      expect(status).toBe(200)
      expect(payload.data.emailed).toBe(false)
      expect(payload.data.setPasswordUrl).toContain('/set-password/')
    })

    it('with no BREVO_API_KEY the link is still returned and emailed is false', async () => {
      delete process.env.BREVO_API_KEY
      const fetchMock = vi.fn()
      vi.stubGlobal('fetch', fetchMock)
      const { status, payload } = await reissue(await freshWaiting())
      expect(status).toBe(200)
      expect(payload.data.emailed).toBe(false)
      expect(fetchMock).not.toHaveBeenCalled()
    })
  })

  it('supersedes the old link: old token dead, new one works', async () => {
    const [oldTok] = await db.select().from(setPasswordTokens).where(eq(setPasswordTokens.userId, waitingId))
    // Age the first link past expiry — the real-world case.
    await db.update(setPasswordTokens).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(setPasswordTokens.id, oldTok.id))
    expect((await setPasswordWaitFor([waitingId])).get(waitingId)?.state).toBe('expired')

    mockCookie = adminSession
    const res = await post(waitingId)
    mockCookie = undefined
    expect(res.status).toBe(200)
    const newToken = res.payload.data.setPasswordUrl.split('/').pop()
    expect(newToken).not.toBe(oldTok.token)
    expect((await setPasswordWaitFor([waitingId])).get(waitingId)?.state).toBe('waiting')

    const body = (token: string) => [new Request('http://localhost', { method: 'POST', body: JSON.stringify({ password: 'another-password-1' }), headers: { 'Content-Type': 'application/json' } }), { params: Promise.resolve({ token }) }] as const
    expect((await setPasswordPOST(...body(oldTok.token))).status).not.toBe(200)
    expect((await setPasswordPOST(...body(newToken))).status).toBe(200)
    // Redeemed: no longer waiting.
    expect((await setPasswordWaitFor([waitingId])).has(waitingId)).toBe(false)
  })

  it('refuses a user who already set a password (that is Reset password)', async () => {
    mockCookie = adminSession
    const res = await post(doneId)
    mockCookie = undefined
    expect(res.status).toBe(409)
    expect(String(res.payload.error)).toContain('already set a password')
  })

  it('refuses a user who was never sent a link, a worker, and platform staff', async () => {
    mockCookie = adminSession
    expect((await post(noTokenId)).status).toBe(409)
    expect((await post(workerId)).status).toBe(400)
    expect((await post(limitedId)).status).toBe(403)
    expect((await post(`missing-${randomUUID()}`)).status).toBe(404)
    mockCookie = undefined
  })

  it('needs the users.manage capability, not just super_admin', async () => {
    mockCookie = limitedSession
    expect((await post(waitingId)).status).toBe(403)
    mockCookie = undefined
    expect((await post(waitingId)).status).toBe(401)
  })

  it('the user list reports who is waiting', async () => {
    const pending = `usr-list-${randomUUID()}`
    await db.insert(users).values(mk(pending, 'owner') as never)
    ids.push(pending)
    await issueSetPasswordToken(pending)
    mockCookie = adminSession
    const res = await usersGET(req('GET', `http://localhost/api/admin/users?tenantId=${tenantId}`))
    mockCookie = undefined
    const rows = (await res.json()).data as { id: string; signIn: { state: string } | null }[]
    expect(rows.find((r) => r.id === pending)?.signIn?.state).toBe('waiting')
    expect(rows.find((r) => r.id === doneId)?.signIn).toBeNull()
  })
})
