// ── Dashboard-backend tests (issue #227) ───────────────────────────────────
// Integration tests that call the real route handlers against the real
// postgres when DATABASE_URL is set (local/dev); CI has no database, so the
// suite skips there (vitest exits 0, and CI's build/typecheck still run) —
// same pattern as tests/auth.test.ts.
//
// current-prices and tasks now require a real session too (auth fix:
// fix/authenticate-all-apis) — tenant comes from `session.tenantId` only,
// with no `tenantId` query-param fallback for either route. They authenticate
// as ownerA the same way the notifications describe block below already did.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { and, eq, inArray } from 'drizzle-orm'

vi.mock('server-only', () => ({}))
let mockCookie: string | undefined
vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({ get: () => (mockCookie ? { value: mockCookie } : undefined) })),
}))

import { GET as currentPricesGET } from '@/app/api/products/current-prices/route'
import { GET as tasksGET } from '@/app/api/tasks/route'
import { GET as notificationsGET } from '@/app/api/notifications/route'
import { PATCH as notificationPATCH } from '@/app/api/notifications/[id]/route'
import { db } from '@/db'
import { tenants, products, tasks, notifications, notificationReads, users, sessions } from '@/db/schemas'
import { createSession, hashSecret } from '@/lib/auth'

const hasDb = !!process.env.DATABASE_URL
const run = hasDb ? describe : describe.skip

function getRequest(url: string): Request {
  return new Request(url)
}

function patchRequest(url: string, body?: unknown): Request {
  return new Request(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

run('dashboard: current-prices, due-today tasks, notifications (issue #227)', () => {
  const tenantAId = `t-${randomUUID()}`
  const tenantBId = `t-${randomUUID()}`
  const ownerAId = `u-owner-a-${randomUUID()}`
  const ownerBId = `u-owner-b-${randomUUID()}`
  let ownerASessionToken: string
  let ownerBSessionToken: string
  const salt = 'dashboard-test-salt'

  beforeAll(async () => {
    await db.insert(tenants).values([
      { id: tenantAId, name: 'Dashboard Test Co. A', active: true },
      { id: tenantBId, name: 'Dashboard Test Co. B', active: true },
    ])
    await db.insert(users).values([
      { id: ownerAId, tenantId: tenantAId, name: 'Dashboard Owner A', email: `dash-owner-a-${randomUUID()}@test.ifms`, role: 'owner', passwordHash: hashSecret('pw', salt), passwordSalt: salt, status: 'ACTIVE' },
      { id: ownerBId, tenantId: tenantBId, name: 'Dashboard Owner B', email: `dash-owner-b-${randomUUID()}@test.ifms`, role: 'owner', passwordHash: hashSecret('pw', salt), passwordSalt: salt, status: 'ACTIVE' },
    ])
    ownerASessionToken = await createSession(ownerAId)
    ownerBSessionToken = await createSession(ownerBId)
  })

  afterAll(async () => {
    mockCookie = undefined
    // Cleans up by the same owner ids that ever marked anything read in this
    // suite, rather than a subquery on notification ids scoped inside `it`
    // blocks the afterAll here has no closure over.
    await db.delete(notificationReads).where(inArray(notificationReads.userId, [ownerAId, ownerBId]))
    await db.delete(notifications).where(inArray(notifications.tenantId, [tenantAId, tenantBId]))
    await db.delete(tasks).where(inArray(tasks.tenantId, [tenantAId, tenantBId]))
    await db.delete(products).where(inArray(products.tenantId, [tenantAId, tenantBId]))
    await db.delete(sessions).where(inArray(sessions.userId, [ownerAId, ownerBId]))
    await db.delete(users).where(inArray(users.id, [ownerAId, ownerBId]))
    await db.delete(tenants).where(inArray(tenants.id, [tenantAId, tenantBId]))
  })

  describe('GET /api/products/current-prices', () => {
    it('returns real per-tenant prices, scoped to the requesting tenant', async () => {
      await db.insert(products).values([
        { id: randomUUID(), tenantId: tenantAId, type: 'eggs', name: 'Eggs (tray)', saleUnits: '450.50' },
        { id: randomUUID(), tenantId: tenantAId, type: 'milk', name: 'Milk (litre)', saleUnits: '60' },
        // Different tenant — must not leak into tenant A's response.
        { id: randomUUID(), tenantId: tenantBId, type: 'eggs', name: 'Eggs (tray)', saleUnits: '999' },
      ])

      mockCookie = ownerASessionToken
      const res = await currentPricesGET()
      expect(res.status).toBe(200)
      const payload = await res.json()
      expect(payload.success).toBe(true)
      expect(payload.data).toHaveLength(2)
      const byType = Object.fromEntries(payload.data.map((p: { type: string; currentPrice: number }) => [p.type, p.currentPrice]))
      expect(byType.eggs).toBe(450.5)
      expect(byType.milk).toBe(60)
    })

    it('401s with no session', async () => {
      mockCookie = undefined
      const res = await currentPricesGET()
      expect(res.status).toBe(401)
    })
  })

  describe('GET /api/tasks?due=today', () => {
    it('returns only tasks due today for the seeded tenant', async () => {
      const now = new Date()
      const todayNoon = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 12))
      const yesterday = new Date(todayNoon.getTime() - 24 * 60 * 60 * 1000)
      const tomorrow = new Date(todayNoon.getTime() + 24 * 60 * 60 * 1000)

      const dueTodayId = randomUUID()
      await db.insert(tasks).values([
        { id: dueTodayId, tenantId: tenantAId, title: 'Feed the flock', dueAt: todayNoon, status: 'PENDING' },
        { id: randomUUID(), tenantId: tenantAId, title: 'Yesterday task', dueAt: yesterday, status: 'PENDING' },
        { id: randomUUID(), tenantId: tenantAId, title: 'Tomorrow task', dueAt: tomorrow, status: 'PENDING' },
        { id: randomUUID(), tenantId: tenantAId, title: 'No due date', dueAt: null, status: 'PENDING' },
        // Different tenant, also due today — must not leak in.
        { id: randomUUID(), tenantId: tenantBId, title: 'Other tenant, due today', dueAt: todayNoon, status: 'PENDING' },
      ])

      mockCookie = ownerASessionToken
      const res = await tasksGET(getRequest('http://localhost/api/tasks?due=today'))
      expect(res.status).toBe(200)
      const payload = await res.json()
      expect(payload.success).toBe(true)
      expect(payload.data).toHaveLength(1)
      expect(payload.data[0].id).toBe(dueTodayId)
      expect(payload.data[0].title).toBe('Feed the flock')
    })
  })

  describe('GET /api/notifications + PATCH /api/notifications/[id]', () => {
    it('aggregates an overdue task into a notification, and marking it read persists (per-user, not the legacy shared column)', async () => {
      const overdueTaskId = randomUUID()
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000)
      await db.insert(tasks).values({
        id: overdueTaskId,
        tenantId: tenantAId,
        title: 'Overdue vaccination round',
        dueAt: yesterday,
        status: 'PENDING',
      })

      mockCookie = ownerASessionToken
      const listRes = await notificationsGET()
      expect(listRes.status).toBe(200)
      const listPayload = await listRes.json()
      expect(listPayload.success).toBe(true)
      const forTask = listPayload.data.find((n: { sourceId: string | null }) => n.sourceId === overdueTaskId)
      expect(forTask).toBeTruthy()
      expect(forTask.read).toBe(false)
      expect(String(forTask.title).toLowerCase()).toContain('overdue')

      // Re-fetching must not duplicate the synced notification (idempotent sync).
      const listRes2 = await notificationsGET()
      const listPayload2 = await listRes2.json()
      const matches = listPayload2.data.filter((n: { sourceId: string | null }) => n.sourceId === overdueTaskId)
      expect(matches).toHaveLength(1)

      const patchRes = await notificationPATCH(
        patchRequest(`http://localhost/api/notifications/${forTask.id}`, { read: true }),
        { params: Promise.resolve({ id: forTask.id }) }
      )
      expect(patchRes.status).toBe(200)
      const patchPayload = await patchRes.json()
      expect(patchPayload.success).toBe(true)
      expect(patchPayload.data.read).toBe(true)

      // Persistence check: a notification_reads row for THIS user, not the
      // legacy shared `notifications.read` column (which this fix stops
      // relying on for what any caller sees).
      const readRows = await db.select().from(notificationReads).where(
        and(eq(notificationReads.notificationId, forTask.id), eq(notificationReads.userId, ownerAId))
      )
      expect(readRows).toHaveLength(1)

      // Re-fetching for the same user now shows it read.
      const listRes3 = await notificationsGET()
      const listPayload3 = await listRes3.json()
      const forTaskAgain = listPayload3.data.find((n: { id: string }) => n.id === forTask.id)
      expect(forTaskAgain.read).toBe(true)
    })

    it('rejects marking a notification read for the wrong tenant (404, not a cross-tenant write)', async () => {
      const overdueTaskId = randomUUID()
      await db.insert(tasks).values({
        id: overdueTaskId,
        tenantId: tenantBId,
        title: 'Tenant B overdue task',
        dueAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
        status: 'PENDING',
      })
      mockCookie = ownerBSessionToken
      await notificationsGET()
      const rows = await db.select().from(notifications).where(inArray(notifications.tenantId, [tenantBId]))
      const target = rows.find((n) => n.sourceId === overdueTaskId)
      expect(target).toBeTruthy()

      // Tenant A's owner has no session tie to tenant B's notification.
      mockCookie = ownerASessionToken
      const res = await notificationPATCH(
        patchRequest(`http://localhost/api/notifications/${target!.id}`, { read: true }),
        { params: Promise.resolve({ id: target!.id }) }
      )
      expect(res.status).toBe(404)
    })

    it('requires a session (unauthenticated GET is refused, not a tenant-wide read)', async () => {
      mockCookie = undefined
      const res = await notificationsGET()
      expect(res.status).toBe(401)
      const payload = await res.json()
      expect(payload.success).toBe(false)
    })
  })
})
