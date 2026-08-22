// ── Notification -> email delivery (feat/email-notifications, Task 3) ──────
// Integration tests against the real notifyRecipientsByEmail
// (lib/notification-email.ts) and the real GET /api/notifications route
// (which drives syncTaskNotifications), using a real postgres when
// DATABASE_URL is set — same convention as tests/notification-scoping.test.ts,
// which this file complements (that suite proves recipient VISIBILITY over
// the API; this one proves recipient visibility is what actually gets
// emailed, and that delivery is deduplicated). The Resend provider is
// stubbed at the `fetch` boundary — never a real network call.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { eq, inArray } from 'drizzle-orm'

vi.mock('server-only', () => ({}))

let mockCookie: string | undefined
vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({ get: () => (mockCookie ? { value: mockCookie } : undefined) })),
}))

import { GET as notificationsGET } from '@/app/api/notifications/route'
import { notifyRecipientsByEmail } from '@/lib/notification-email'
import { db } from '@/db'
import { tenants, users, sessions, tasks, notifications, tenantSettings } from '@/db/schemas'
import { createSession, hashSecret } from '@/lib/auth'

const hasDb = !!process.env.DATABASE_URL
const run = hasDb ? describe : describe.skip

function recipientsOf(fetchMock: ReturnType<typeof vi.fn>): string[] {
  return fetchMock.mock.calls.map((call) => JSON.parse(call[1].body).to[0])
}

run('notification email delivery (feat/email-notifications)', () => {
  const tenantId = `t-notif-email-${randomUUID()}`
  const salt = 'notif-email-test-salt'

  const ownerId = `u-owner-${randomUUID()}`
  const managerId = `u-manager-${randomUUID()}`
  const workerId = `u-worker-${randomUUID()}`

  const ownerEmail = `notif-email-owner-${randomUUID()}@test.ifms`
  const managerEmail = `notif-email-manager-${randomUUID()}@test.ifms`
  const workerEmail = `notif-email-worker-${randomUUID()}@test.ifms`

  let ownerSession: string
  const allUserIds = [ownerId, managerId, workerId]

  let fetchMock: ReturnType<typeof vi.fn>
  const originalApiKey = process.env.RESEND_API_KEY

  beforeAll(async () => {
    await db.insert(tenants).values({ id: tenantId, name: 'Notif Email Test Co.', active: true })
    await db.insert(users).values([
      { id: ownerId, tenantId, name: 'Notif Email Owner', email: ownerEmail, role: 'owner', passwordHash: hashSecret('pw', salt), passwordSalt: salt, status: 'ACTIVE' },
      { id: managerId, tenantId, name: 'Notif Email Manager', email: managerEmail, role: 'manager', passwordHash: hashSecret('pw', salt), passwordSalt: salt, status: 'ACTIVE' },
      { id: workerId, tenantId, name: 'Notif Email Worker', email: workerEmail, role: 'worker', passwordHash: hashSecret('pw', salt), passwordSalt: salt, status: 'ACTIVE' },
    ])
    ownerSession = await createSession(ownerId)
  })

  afterAll(async () => {
    mockCookie = undefined
    await db.delete(sessions).where(inArray(sessions.userId, allUserIds))
    await db.delete(users).where(inArray(users.id, allUserIds))
    await db.delete(tenants).where(eq(tenants.id, tenantId))
  })

  beforeEach(() => {
    mockCookie = undefined
    process.env.RESEND_API_KEY = 'test-key'
    fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: `test-${randomUUID()}` }) })
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(async () => {
    vi.unstubAllGlobals()
    if (originalApiKey === undefined) delete process.env.RESEND_API_KEY
    else process.env.RESEND_API_KEY = originalApiKey
    await db.delete(notifications).where(eq(notifications.tenantId, tenantId))
    await db.delete(tasks).where(eq(tasks.tenantId, tenantId))
    await db.delete(tenantSettings).where(eq(tenantSettings.tenantId, tenantId))
  })

  it('a user-targeted notification is emailed only to that user', async () => {
    const id = randomUUID()
    await db.insert(notifications).values({
      id, tenantId, sourceType: 'alert', sourceId: `src-${id}`, title: 'Just for owner', message: '', userId: ownerId, role: null,
    })
    await notifyRecipientsByEmail(id)

    expect(recipientsOf(fetchMock)).toEqual([ownerEmail])
  })

  it('a role-targeted notification is emailed only to users with that role in the tenant', async () => {
    const id = randomUUID()
    await db.insert(notifications).values({
      id, tenantId, sourceType: 'alert', sourceId: `src-${id}`, title: 'For managers', message: '', userId: null, role: 'manager',
    })
    await notifyRecipientsByEmail(id)

    expect(recipientsOf(fetchMock)).toEqual([managerEmail])
  })

  it('a broadcast (both null) is emailed to every ACTIVE user in the tenant', async () => {
    const id = randomUUID()
    await db.insert(notifications).values({
      id, tenantId, sourceType: 'alert', sourceId: `src-${id}`, title: 'Tenant-wide', message: '', userId: null, role: null,
    })
    await notifyRecipientsByEmail(id)

    expect(recipientsOf(fetchMock).sort()).toEqual([managerEmail, ownerEmail, workerEmail].sort())
  })

  it('notificationsEnabled: false suppresses mail entirely', async () => {
    await db.insert(tenantSettings).values({ tenantId, notificationsEnabled: false })
    const id = randomUUID()
    await db.insert(notifications).values({
      id, tenantId, sourceType: 'alert', sourceId: `src-${id}`, title: 'Should not be emailed', message: '', userId: null, role: null,
    })
    await notifyRecipientsByEmail(id)

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('does not email the same notification twice, even called directly twice', async () => {
    const id = randomUUID()
    await db.insert(notifications).values({
      id, tenantId, sourceType: 'alert', sourceId: `src-${id}`, title: 'Only once', message: '', userId: ownerId, role: null,
    })
    await notifyRecipientsByEmail(id)
    await notifyRecipientsByEmail(id)

    expect(fetchMock).toHaveBeenCalledTimes(1)

    const [row] = await db.select().from(notifications).where(eq(notifications.id, id))
    expect(row.emailedAt).not.toBeNull()
  })

  it('running the task sync (GET /api/notifications) twice does not send the overdue-task email twice', async () => {
    const overdueTaskId = randomUUID()
    await db.insert(tasks).values({
      id: overdueTaskId, tenantId, title: 'Notif email overdue task',
      dueAt: new Date(Date.now() - 24 * 60 * 60 * 1000), status: 'PENDING',
    })

    mockCookie = ownerSession
    await notificationsGET()
    await notificationsGET()

    const rows = await db.select().from(notifications).where(eq(notifications.sourceId, overdueTaskId))
    expect(rows).toHaveLength(1)

    // Broadcast task notification -> every active user in the tenant, but
    // only ONE round of sends total across both GETs.
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(recipientsOf(fetchMock).sort()).toEqual([managerEmail, ownerEmail, workerEmail].sort())

    await db.delete(tasks).where(inArray(tasks.id, [overdueTaskId]))
  })
})
