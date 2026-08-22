// ── Settings backend tests (issue #255) ──────────────────────────────────────
// Integration tests against the real route handlers + real postgres when
// DATABASE_URL is set (local/dev); CI has no database, so the suite skips
// there — same pattern as tests/tasks-governance.test.ts / tests/auth.test.ts.
//
// Covers the issue's Definition of Done:
//   - password change works via a real endpoint with a test, using the
//     existing scrypt hashing (hashSecret/verifySecret)
//   - settings set by one user on a tenant are readable by a second user on
//     the same tenant via the API (per-tenant, not per-device)
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { eq, inArray } from 'drizzle-orm'

vi.mock('server-only', () => ({}))

let mockCookie: string | undefined
vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({ get: () => (mockCookie ? { value: mockCookie } : undefined) })),
}))

import { POST as changePasswordPOST } from '@/app/api/auth/change-password/route'
import { GET as settingsGET, PATCH as settingsPATCH } from '@/app/api/settings/route'
import { db } from '@/db'
import { tenants, users, sessions, tenantSettings } from '@/db/schemas'
import { createSession, hashSecret, verifySecret } from '@/lib/auth'

const hasDb = !!process.env.DATABASE_URL
const run = hasDb ? describe : describe.skip

function jsonRequest(url: string, method: string, body?: unknown): Request {
  return new Request(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })
}

async function readJson(res: Response) {
  return { status: res.status, payload: await res.json() }
}

run('settings backend: password change + per-tenant settings store (issue #255)', () => {
  const tenantAId = `t-${randomUUID()}`
  const tenantBId = `t-${randomUUID()}`

  const ownerEmail = `owner-${randomUUID()}@test.ifms`
  const managerEmail = `manager-${randomUUID()}@test.ifms`
  const workerEmail = `worker-${randomUUID()}@test.ifms`
  const otherOwnerEmail = `owner-b-${randomUUID()}@test.ifms`

  const ownerId = randomUUID()
  const managerId = randomUUID()
  const workerId = randomUUID()
  const otherOwnerId = randomUUID()

  const ownerPassword = 'ownerPass123'
  const managerPassword = 'managerPass123'

  let ownerSalt: string
  let ownerSessionToken: string
  let managerSessionToken: string
  let workerSessionToken: string
  let otherOwnerSessionToken: string

  beforeAll(async () => {
    await db.insert(tenants).values([
      { id: tenantAId, name: 'Settings Test Co. A', active: true },
      { id: tenantBId, name: 'Settings Test Co. B', active: true },
    ])

    ownerSalt = `salt-owner-${randomUUID()}`
    const managerSalt = `salt-manager-${randomUUID()}`
    const workerSalt = `salt-worker-${randomUUID()}`
    const otherOwnerSalt = `salt-other-${randomUUID()}`

    await db.insert(users).values([
      {
        id: ownerId, tenantId: tenantAId, name: 'Settings Owner', email: ownerEmail,
        role: 'owner', passwordHash: hashSecret(ownerPassword, ownerSalt), passwordSalt: ownerSalt, status: 'ACTIVE',
      },
      {
        id: managerId, tenantId: tenantAId, name: 'Settings Manager', email: managerEmail,
        role: 'manager', passwordHash: hashSecret(managerPassword, managerSalt), passwordSalt: managerSalt, status: 'ACTIVE',
      },
      {
        id: workerId, tenantId: tenantAId, name: 'Settings Worker', email: workerEmail,
        role: 'worker', passwordHash: hashSecret('workerpw', workerSalt), passwordSalt: workerSalt, status: 'ACTIVE',
      },
      {
        id: otherOwnerId, tenantId: tenantBId, name: 'Other Tenant Owner', email: otherOwnerEmail,
        role: 'owner', passwordHash: hashSecret('otherpw', otherOwnerSalt), passwordSalt: otherOwnerSalt, status: 'ACTIVE',
      },
    ])

    ownerSessionToken = await createSession(ownerId)
    managerSessionToken = await createSession(managerId)
    workerSessionToken = await createSession(workerId)
    otherOwnerSessionToken = await createSession(otherOwnerId)
  })

  afterAll(async () => {
    await db.delete(tenantSettings).where(inArray(tenantSettings.tenantId, [tenantAId, tenantBId]))
    await db.delete(sessions).where(inArray(sessions.userId, [ownerId, managerId, workerId, otherOwnerId]))
    await db.delete(users).where(inArray(users.id, [ownerId, managerId, workerId, otherOwnerId]))
    await db.delete(tenants).where(inArray(tenants.id, [tenantAId, tenantBId]))
    mockCookie = undefined
  })

  describe('POST /api/auth/change-password', () => {
    afterAll(async () => {
      mockCookie = undefined
    })

    it('rejects an unauthenticated request (401)', async () => {
      mockCookie = undefined
      const { status, payload } = await readJson(
        await changePasswordPOST(jsonRequest('http://localhost/api/auth/change-password', 'POST', { currentPassword: ownerPassword, newPassword: 'newPassword1' }))
      )
      expect(status).toBe(401)
      expect(payload.success).toBe(false)
    })

    it('rejects a worker session (403) — workers use PIN, not password', async () => {
      mockCookie = workerSessionToken
      const { status } = await readJson(
        await changePasswordPOST(jsonRequest('http://localhost/api/auth/change-password', 'POST', { currentPassword: 'workerpw', newPassword: 'newPassword1' }))
      )
      expect(status).toBe(403)
    })

    it('rejects the wrong current password (401)', async () => {
      mockCookie = ownerSessionToken
      const { status, payload } = await readJson(
        await changePasswordPOST(jsonRequest('http://localhost/api/auth/change-password', 'POST', { currentPassword: 'definitely-wrong', newPassword: 'newPassword1' }))
      )
      expect(status).toBe(401)
      expect(payload.success).toBe(false)
    })

    it('rejects a too-short new password (400)', async () => {
      mockCookie = ownerSessionToken
      const { status } = await readJson(
        await changePasswordPOST(jsonRequest('http://localhost/api/auth/change-password', 'POST', { currentPassword: ownerPassword, newPassword: 'short' }))
      )
      expect(status).toBe(400)
    })

    it('changes the password using the real scrypt hashing, verifiable via verifySecret', async () => {
      mockCookie = ownerSessionToken
      const newPassword = 'freshOwnerPass456'
      const { status, payload } = await readJson(
        await changePasswordPOST(jsonRequest('http://localhost/api/auth/change-password', 'POST', { currentPassword: ownerPassword, newPassword }))
      )
      expect(status).toBe(200)
      expect(payload.success).toBe(true)

      const rows = await db.select().from(users).where(eq(users.id, ownerId)).limit(1)
      const updated = rows[0]
      expect(updated).toBeDefined()
      // Real scrypt verify against the new stored hash/salt — no bypass hashing.
      expect(verifySecret(newPassword, updated.passwordSalt, updated.passwordHash)).toBe(true)
      // Old password no longer verifies.
      expect(verifySecret(ownerPassword, updated.passwordSalt, updated.passwordHash)).toBe(false)
    })
  })

  describe('GET/PATCH /api/settings', () => {
    it('GET returns defaults when no row exists yet for the tenant', async () => {
      mockCookie = ownerSessionToken
      const { status, payload } = await readJson(await settingsGET(jsonRequest('http://localhost/api/settings', 'GET')))
      expect(status).toBe(200)
      expect(payload.success).toBe(true)
      expect(payload.data.tenantId).toBe(tenantAId)
      expect(payload.data.theme).toBe('dark-farm')
      expect(payload.data.fontSize).toBe('normal')
      expect(payload.data.currencySymbol).toBe('KSh')
      expect(payload.data.weightUnit).toBe('kg')
      // Regional/session defaults (settings-reorg) — coherent even with no
      // row in the table at all, same "never a 404, always the documented
      // defaults" contract as the pre-existing fields above.
      expect(payload.data.timezone).toBe('Africa/Nairobi')
      expect(payload.data.dateFormat).toBe('DD/MM/YYYY')
      expect(payload.data.sessionTimeoutMinutes).toBeNull()
    })

    it('rejects an unauthenticated GET (401)', async () => {
      mockCookie = undefined
      const { status } = await readJson(await settingsGET(jsonRequest('http://localhost/api/settings', 'GET')))
      expect(status).toBe(401)
    })

    it('PATCH is forbidden for a manager (403) — write-gated to owner/super_admin, row genuinely unchanged', async () => {
      mockCookie = managerSessionToken
      const { status } = await readJson(
        await settingsPATCH(jsonRequest('http://localhost/api/settings', 'PATCH', { theme: 'sun-mode', timezone: 'Africa/Lagos' }))
      )
      expect(status).toBe(403)

      // Not just the status code — the row itself must still be untouched.
      mockCookie = ownerSessionToken
      const { payload } = await readJson(await settingsGET(jsonRequest('http://localhost/api/settings', 'GET')))
      expect(payload.data.theme).toBe('dark-farm')
      expect(payload.data.timezone).toBe('Africa/Nairobi')
    })

    it('PATCH is forbidden for a worker (403), row genuinely unchanged', async () => {
      mockCookie = workerSessionToken
      const { status } = await readJson(
        await settingsPATCH(jsonRequest('http://localhost/api/settings', 'PATCH', { theme: 'sun-mode' }))
      )
      expect(status).toBe(403)

      mockCookie = ownerSessionToken
      const { payload } = await readJson(await settingsGET(jsonRequest('http://localhost/api/settings', 'GET')))
      expect(payload.data.theme).toBe('dark-farm')
    })

    it('rejects an invalid theme value (400) with the fields envelope', async () => {
      mockCookie = ownerSessionToken
      const { status, payload } = await readJson(
        await settingsPATCH(jsonRequest('http://localhost/api/settings', 'PATCH', { theme: 'not-a-real-theme' }))
      )
      expect(status).toBe(400)
      expect(payload.success).toBe(false)
      expect(payload.fields).toHaveProperty('theme')
    })

    it('rejects a bad timezone (400, fields.timezone) and does not store it', async () => {
      mockCookie = ownerSessionToken
      const { status, payload } = await readJson(
        await settingsPATCH(jsonRequest('http://localhost/api/settings', 'PATCH', { timezone: 'Not/A_Real_Zone' }))
      )
      expect(status).toBe(400)
      expect(payload.success).toBe(false)
      expect(payload.fields).toHaveProperty('timezone')

      const { payload: after } = await readJson(await settingsGET(jsonRequest('http://localhost/api/settings', 'GET')))
      expect(after.data.timezone).toBe('Africa/Nairobi')
    })

    it('rejects a nonsense date format (400, fields.dateFormat)', async () => {
      mockCookie = ownerSessionToken
      const { status, payload } = await readJson(
        await settingsPATCH(jsonRequest('http://localhost/api/settings', 'PATCH', { dateFormat: 'banana' }))
      )
      expect(status).toBe(400)
      expect(payload.fields).toHaveProperty('dateFormat')
    })

    it('rejects an out-of-range session timeout (400, fields.sessionTimeoutMinutes)', async () => {
      mockCookie = ownerSessionToken
      const tooShort = await readJson(
        await settingsPATCH(jsonRequest('http://localhost/api/settings', 'PATCH', { sessionTimeoutMinutes: 1 }))
      )
      expect(tooShort.status).toBe(400)
      expect(tooShort.payload.fields).toHaveProperty('sessionTimeoutMinutes')

      const tooLong = await readJson(
        await settingsPATCH(jsonRequest('http://localhost/api/settings', 'PATCH', { sessionTimeoutMinutes: 999_999 }))
      )
      expect(tooLong.status).toBe(400)
      expect(tooLong.payload.fields).toHaveProperty('sessionTimeoutMinutes')
    })

    it('a PATCH mixing one bad field with good ones collects the failure and stores nothing (400, fields)', async () => {
      mockCookie = ownerSessionToken
      const { status, payload } = await readJson(
        await settingsPATCH(jsonRequest('http://localhost/api/settings', 'PATCH', {
          timezone: 'Africa/Lagos',
          dateFormat: 'not-a-format',
        }))
      )
      expect(status).toBe(400)
      expect(payload.fields).toHaveProperty('dateFormat')

      // The whole PATCH is rejected — timezone must NOT have been saved
      // even though it was individually valid.
      const { payload: after } = await readJson(await settingsGET(jsonRequest('http://localhost/api/settings', 'GET')))
      expect(after.data.timezone).toBe('Africa/Nairobi')
    })

    it('owner PATCH updates theme/fontSize/branding/modules/regional/session-timeout and returns the full row', async () => {
      mockCookie = ownerSessionToken
      const { status, payload } = await readJson(
        await settingsPATCH(jsonRequest('http://localhost/api/settings', 'PATCH', {
          theme: 'sun-mode',
          fontSize: 'large',
          notificationsEnabled: false,
          offlineModeEnabled: false,
          accentColor: '#60a5fa',
          logoEmoji: '🐐',
          dashboardGreeting: 'Good morning, team!',
          currencySymbol: 'UGX',
          weightUnit: 'lbs',
          modules: [{ id: 'finance', enabled: false }, { id: 'crops', enabled: true, customLabel: 'Batches' }],
          timezone: 'Africa/Lagos',
          dateFormat: 'YYYY-MM-DD',
          sessionTimeoutMinutes: 60,
        }))
      )
      expect(status).toBe(200)
      expect(payload.success).toBe(true)
      expect(payload.data.theme).toBe('sun-mode')
      expect(payload.data.fontSize).toBe('large')
      expect(payload.data.notificationsEnabled).toBe(false)
      expect(payload.data.offlineModeEnabled).toBe(false)
      expect(payload.data.accentColor).toBe('#60a5fa')
      expect(payload.data.logoEmoji).toBe('🐐')
      expect(payload.data.dashboardGreeting).toBe('Good morning, team!')
      expect(payload.data.currencySymbol).toBe('UGX')
      expect(payload.data.weightUnit).toBe('lbs')
      expect(payload.data.modules).toEqual([
        { id: 'finance', enabled: false },
        { id: 'crops', enabled: true, customLabel: 'Batches' },
      ])
      expect(payload.data.timezone).toBe('Africa/Lagos')
      expect(payload.data.dateFormat).toBe('YYYY-MM-DD')
      expect(payload.data.sessionTimeoutMinutes).toBe(60)
    })

    it('a later PATCH can clear sessionTimeoutMinutes back to the platform default by sending null', async () => {
      mockCookie = ownerSessionToken
      const { status, payload } = await readJson(
        await settingsPATCH(jsonRequest('http://localhost/api/settings', 'PATCH', { sessionTimeoutMinutes: null }))
      )
      expect(status).toBe(200)
      expect(payload.data.sessionTimeoutMinutes).toBeNull()
    })

    it('a second user (manager) on the SAME tenant reads back the owner\'s changes — proving per-tenant, not per-device', async () => {
      mockCookie = managerSessionToken
      const { status, payload } = await readJson(await settingsGET(jsonRequest('http://localhost/api/settings', 'GET')))
      expect(status).toBe(200)
      expect(payload.data.theme).toBe('sun-mode')
      expect(payload.data.currencySymbol).toBe('UGX')
      expect(payload.data.modules).toEqual([
        { id: 'finance', enabled: false },
        { id: 'crops', enabled: true, customLabel: 'Batches' },
      ])
    })

    it('a partial PATCH only updates the given fields, leaving the rest intact', async () => {
      mockCookie = ownerSessionToken
      const { status, payload } = await readJson(
        await settingsPATCH(jsonRequest('http://localhost/api/settings', 'PATCH', { soundAlertsEnabled: true }))
      )
      expect(status).toBe(200)
      expect(payload.data.soundAlertsEnabled).toBe(true)
      // Untouched fields from the previous PATCH remain.
      expect(payload.data.theme).toBe('sun-mode')
      expect(payload.data.weightUnit).toBe('lbs')
    })

    it('a different tenant\'s owner sees its own (default) settings, not tenant A\'s', async () => {
      mockCookie = otherOwnerSessionToken
      const { status, payload } = await readJson(await settingsGET(jsonRequest('http://localhost/api/settings', 'GET')))
      expect(status).toBe(200)
      expect(payload.data.tenantId).toBe(tenantBId)
      expect(payload.data.theme).toBe('dark-farm')
      expect(payload.data.currencySymbol).toBe('KSh')
      expect(payload.data.timezone).toBe('Africa/Nairobi')
    })

    it('tenant B\'s owner PATCHing timezone never touches tenant A\'s row — each tenant writes only its own', async () => {
      mockCookie = otherOwnerSessionToken
      const { status, payload } = await readJson(
        await settingsPATCH(jsonRequest('http://localhost/api/settings', 'PATCH', { timezone: 'Europe/London' }))
      )
      expect(status).toBe(200)
      expect(payload.data.tenantId).toBe(tenantBId)
      expect(payload.data.timezone).toBe('Europe/London')

      // Tenant A's row (set to Africa/Lagos earlier in this suite) is
      // completely unaffected by tenant B's write.
      mockCookie = ownerSessionToken
      const { payload: tenantA } = await readJson(await settingsGET(jsonRequest('http://localhost/api/settings', 'GET')))
      expect(tenantA.data.tenantId).toBe(tenantAId)
      expect(tenantA.data.timezone).toBe('Africa/Lagos')
    })

    it('rejects a malformed modules entry (400)', async () => {
      mockCookie = ownerSessionToken
      const { status } = await readJson(
        await settingsPATCH(jsonRequest('http://localhost/api/settings', 'PATCH', { modules: [{ id: 'finance' }] }))
      )
      expect(status).toBe(400)
    })
  })
})
