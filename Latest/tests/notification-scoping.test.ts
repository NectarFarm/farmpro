// ── Notification recipient-scoping tests (notification-recipient-scoping fix) ─
// Integration tests that call the real route handlers directly against real
// Postgres (no HTTP server needed), same pattern as tests/farm-scoping.test.ts
// and tests/farms-crud.test.ts. Skips when DATABASE_URL is unset (CI has no
// database).
//
// Before this fix, `notifications` had no recipient at all: every row was
// tenant-wide by construction, so any user in a tenant could read every
// other user's notifications (including a password-reset row naming another
// user's name and email), and GET /api/notifications trusted a `tenantId`
// query param when there was no session — anyone could read a tenant's whole
// feed by guessing its id. These tests prove:
//   - the unauthenticated hole is closed
//   - a notification addressed to one user never reaches another
//   - a notification addressed to a role reaches only that role, and only
//     within the correct tenant (a role match in another tenant must not leak)
//   - a genuine broadcast (both userId and role null) still reaches everyone
//     in the tenant, so pre-existing rows keep behaving as before
//   - read state is per-user, not the old shared boolean
//   - the password-reset producer targets super_admin only, not the
//     requester's own tenant
//   - the task-sync producer stays idempotent under the new columns
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { and, eq, inArray } from 'drizzle-orm'

vi.mock('server-only', () => ({}))
let mockCookie: string | undefined
vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({ get: () => (mockCookie ? { value: mockCookie } : undefined) })),
}))

import { GET as notificationsGET } from '@/app/api/notifications/route'
import { PATCH as notificationPATCH } from '@/app/api/notifications/[id]/route'
import { POST as forgotPasswordPOST } from '@/app/api/auth/forgot-password/route'
import { db } from '@/db'
import { tenants, users, sessions, tasks, notifications, notificationReads, passwordResetRequests } from '@/db/schemas'
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

function patchRequest(url: string, body?: unknown): Request {
  return new Request(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

async function readJson(res: Response) {
  return { status: res.status, payload: await res.json() }
}

function idsOf(rows: { id: string }[]): string[] {
  return rows.map((r) => r.id).sort()
}

run('notification recipient scoping (notification-recipient-scoping fix)', () => {
  const tenantAId = `t-notif-a-${randomUUID()}`
  const tenantBId = `t-notif-b-${randomUUID()}`
  const salt = 'notif-scoping-test-salt'

  const ownerAId = `u-owner-a-${randomUUID()}`
  const managerAId = `u-manager-a-${randomUUID()}`
  const workerAId = `u-worker-a-${randomUUID()}`
  const managerBId = `u-manager-b-${randomUUID()}`
  const superAdminXId = `u-super-x-${randomUUID()}`
  const superAdminYId = `u-super-y-${randomUUID()}`

  let ownerASession: string
  let managerASession: string
  let workerASession: string
  let managerBSession: string
  let superAdminXSession: string
  let superAdminYSession: string

  const ownerAEmail = `notif-owner-a-${randomUUID()}@test.ifms`
  // E164_RE (lib/validation.ts) just needs "+" + 7-15 digits — a fixed
  // literal here previously collided with a leftover row from an
  // interrupted run (idx_users_phone is unique), so this is randomized per
  // run instead.
  const ownerAPhone = `+254${700000000 + Math.floor(Math.random() * 99999999)}`

  const allUserIds = [ownerAId, managerAId, workerAId, managerBId, superAdminXId, superAdminYId]
  const allTenantIds = [tenantAId, tenantBId]

  beforeAll(async () => {
    await db.insert(tenants).values([
      { id: tenantAId, name: 'Notif Scoping Test Co. A', active: true },
      { id: tenantBId, name: 'Notif Scoping Test Co. B', active: true },
    ])
    await db.insert(users).values([
      { id: ownerAId, tenantId: tenantAId, name: 'Notif Owner A', email: ownerAEmail, phone: ownerAPhone, role: 'owner', passwordHash: hashSecret('pw', salt), passwordSalt: salt, status: 'ACTIVE' },
      { id: managerAId, tenantId: tenantAId, name: 'Notif Manager A', email: `notif-manager-a-${randomUUID()}@test.ifms`, role: 'manager', passwordHash: hashSecret('pw', salt), passwordSalt: salt, status: 'ACTIVE' },
      { id: workerAId, tenantId: tenantAId, name: 'Notif Worker A', email: `notif-worker-a-${randomUUID()}@test.ifms`, role: 'worker', passwordHash: hashSecret('pw', salt), passwordSalt: salt, status: 'ACTIVE' },
      { id: managerBId, tenantId: tenantBId, name: 'Notif Manager B', email: `notif-manager-b-${randomUUID()}@test.ifms`, role: 'manager', passwordHash: hashSecret('pw', salt), passwordSalt: salt, status: 'ACTIVE' },
      { id: superAdminXId, tenantId: null, name: 'Notif Super X', email: `notif-super-x-${randomUUID()}@test.ifms`, role: 'super_admin', passwordHash: hashSecret('pw', salt), passwordSalt: salt, status: 'ACTIVE' },
      { id: superAdminYId, tenantId: null, name: 'Notif Super Y', email: `notif-super-y-${randomUUID()}@test.ifms`, role: 'super_admin', passwordHash: hashSecret('pw', salt), passwordSalt: salt, status: 'ACTIVE' },
    ])
    ownerASession = await createSession(ownerAId)
    managerASession = await createSession(managerAId)
    workerASession = await createSession(workerAId)
    managerBSession = await createSession(managerBId)
    superAdminXSession = await createSession(superAdminXId)
    superAdminYSession = await createSession(superAdminYId)
  })

  afterAll(async () => {
    mockCookie = undefined
    await db.delete(notificationReads).where(inArray(notificationReads.userId, allUserIds))
    await db.delete(notifications).where(inArray(notifications.tenantId, [...allTenantIds, 'platform']))
    await db.delete(tasks).where(inArray(tasks.tenantId, allTenantIds))
    // The password-reset producer test files a real passwordResetRequests
    // row against ownerAId — clear it before deleting the user (FK).
    await db.delete(passwordResetRequests).where(inArray(passwordResetRequests.userId, allUserIds))
    await db.delete(sessions).where(inArray(sessions.userId, allUserIds))
    await db.delete(users).where(inArray(users.id, allUserIds))
    await db.delete(tenants).where(inArray(tenants.id, allTenantIds))
  })

  it('unauthenticated GET is refused (the leak this fix closes) — no session, no data', async () => {
    mockCookie = undefined
    const { status, payload } = await readJson(await notificationsGET())
    expect(status).toBe(401)
    expect(payload.success).toBe(false)
  })

  it('a notification addressed to user A is not returned to user B in the same tenant', async () => {
    const id = randomUUID()
    await db.insert(notifications).values({
      id, tenantId: tenantAId, sourceType: 'alert', sourceId: `src-${id}`,
      title: 'For owner A only', message: '', userId: ownerAId, role: null,
    })

    mockCookie = ownerASession
    const mine = await readJson(await notificationsGET())
    expect(idsOf(mine.payload.data)).toContain(id)

    mockCookie = workerASession
    const other = await readJson(await notificationsGET())
    expect(idsOf(other.payload.data)).not.toContain(id)
  })

  it('a notification addressed to a role is returned to users with that role, and not to others in the same tenant', async () => {
    const id = randomUUID()
    await db.insert(notifications).values({
      id, tenantId: tenantAId, sourceType: 'alert', sourceId: `src-${id}`,
      title: 'For managers only', message: '', userId: null, role: 'manager',
    })

    mockCookie = managerASession
    const manager = await readJson(await notificationsGET())
    expect(idsOf(manager.payload.data)).toContain(id)

    mockCookie = workerASession
    const worker = await readJson(await notificationsGET())
    expect(idsOf(worker.payload.data)).not.toContain(id)

    mockCookie = ownerASession
    const owner = await readJson(await notificationsGET())
    expect(idsOf(owner.payload.data)).not.toContain(id)
  })

  it('a broadcast (both userId and role null) is returned to everyone in the tenant', async () => {
    const id = randomUUID()
    await db.insert(notifications).values({
      id, tenantId: tenantAId, sourceType: 'alert', sourceId: `src-${id}`,
      title: 'Tenant-wide broadcast', message: '', userId: null, role: null,
    })

    for (const cookie of [ownerASession, managerASession, workerASession]) {
      mockCookie = cookie
      const res = await readJson(await notificationsGET())
      expect(idsOf(res.payload.data)).toContain(id)
    }
  })

  it('cross-tenant: a role match in another tenant never leaks in, even for a broadcast', async () => {
    const roleId = randomUUID()
    const broadcastId = randomUUID()
    await db.insert(notifications).values([
      { id: roleId, tenantId: tenantAId, sourceType: 'alert', sourceId: `src-${roleId}`, title: 'Tenant A managers', message: '', userId: null, role: 'manager' },
      { id: broadcastId, tenantId: tenantAId, sourceType: 'alert', sourceId: `src-${broadcastId}`, title: 'Tenant A broadcast', message: '', userId: null, role: null },
    ])

    // managerB has the matching role but belongs to tenant B — must see neither.
    mockCookie = managerBSession
    const res = await readJson(await notificationsGET())
    expect(idsOf(res.payload.data)).not.toContain(roleId)
    expect(idsOf(res.payload.data)).not.toContain(broadcastId)
  })

  it('read state is per-user: A marking a broadcast read leaves it unread for B', async () => {
    const id = randomUUID()
    await db.insert(notifications).values({
      id, tenantId: tenantAId, sourceType: 'alert', sourceId: `src-${id}`,
      title: 'Shared broadcast, per-user read', message: '', userId: null, role: null,
    })

    mockCookie = ownerASession
    const patchRes = await notificationPATCH(patchRequest(`http://localhost/api/notifications/${id}`, { read: true }), { params: Promise.resolve({ id }) })
    expect(patchRes.status).toBe(200)

    const afterOwner = await readJson(await notificationsGET())
    expect(afterOwner.payload.data.find((n: { id: string }) => n.id === id)?.read).toBe(true)

    mockCookie = workerASession
    const afterWorker = await readJson(await notificationsGET())
    expect(afterWorker.payload.data.find((n: { id: string }) => n.id === id)?.read).toBe(false)

    // The legacy shared column must not have been the mechanism — it stays
    // whatever it was created with, since PATCH no longer writes it.
    const row = (await db.select().from(notifications).where(eq(notifications.id, id)))[0]
    expect(row.read).toBe(false)
  })

  it('marking read twice is idempotent and does not error', async () => {
    const id = randomUUID()
    await db.insert(notifications).values({
      id, tenantId: tenantAId, sourceType: 'alert', sourceId: `src-${id}`,
      title: 'Double mark-read', message: '', userId: ownerAId, role: null,
    })

    mockCookie = ownerASession
    const first = await notificationPATCH(patchRequest(`http://localhost/api/notifications/${id}`, { read: true }), { params: Promise.resolve({ id }) })
    expect(first.status).toBe(200)
    const second = await notificationPATCH(patchRequest(`http://localhost/api/notifications/${id}`, { read: true }), { params: Promise.resolve({ id }) })
    expect(second.status).toBe(200)

    const readRows = await db.select().from(notificationReads).where(
      and(eq(notificationReads.notificationId, id), eq(notificationReads.userId, ownerAId))
    )
    expect(readRows).toHaveLength(1)
  })

  it('the password-reset notification is visible to super_admin, and NOT to a worker/manager who cannot action it', async () => {
    mockCookie = undefined // forgot-password is a public, unauthenticated route
    const { status, payload } = await readJson(
      await forgotPasswordPOST(jsonRequest('http://localhost/api/auth/forgot-password', 'POST', { email: ownerAEmail, phone: ownerAPhone }))
    )
    expect(status).toBe(200)
    expect(payload.success).toBe(true)

    mockCookie = superAdminXSession
    const superAdmin = await readJson(await notificationsGET())
    const found = superAdmin.payload.data.find((n: { sourceType: string; message: string }) => n.sourceType === 'password_reset' && n.message.includes(ownerAEmail))
    expect(found).toBeTruthy()

    // A second super_admin (no individual userId targeting) sees it too.
    mockCookie = superAdminYSession
    const superAdminY = await readJson(await notificationsGET())
    expect(superAdminY.payload.data.some((n: { id: string }) => n.id === found.id)).toBe(true)

    // The requester's own tenant — manager and worker alike — must not see it.
    mockCookie = managerASession
    const manager = await readJson(await notificationsGET())
    expect(manager.payload.data.some((n: { id: string }) => n.id === found.id)).toBe(false)

    mockCookie = workerASession
    const worker = await readJson(await notificationsGET())
    expect(worker.payload.data.some((n: { id: string }) => n.id === found.id)).toBe(false)

    // Not even the requester (owner) themselves — only super_admin acts on these.
    mockCookie = ownerASession
    const owner = await readJson(await notificationsGET())
    expect(owner.payload.data.some((n: { id: string }) => n.id === found.id)).toBe(false)
  })

  it('task sync stays idempotent under the new columns — running it twice creates no duplicate row', async () => {
    const overdueTaskId = randomUUID()
    await db.insert(tasks).values({
      id: overdueTaskId,
      tenantId: tenantAId,
      title: 'Notif scoping overdue task',
      dueAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
      status: 'PENDING',
    })

    mockCookie = ownerASession
    await notificationsGET()
    await notificationsGET()

    const rows = await db.select().from(notifications).where(eq(notifications.sourceId, overdueTaskId))
    expect(rows).toHaveLength(1)
    // Broadcast, per syncTaskNotifications's documented decision.
    expect(rows[0].userId).toBeNull()
    expect(rows[0].role).toBeNull()
  })
})
