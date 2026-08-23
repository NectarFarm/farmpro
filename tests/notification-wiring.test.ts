// ── Notification wiring: approvals, task assignment, per-assignee sync
// (notifications-wiring task) ────────────────────────────────────────────
// Integration tests against the real route handlers/functions and a real
// Postgres when DATABASE_URL is set, same pattern as
// tests/notification-email.test.ts and tests/notification-scoping.test.ts
// (which this file complements — those prove delivery/visibility for the
// two producers that already existed; this one proves the four NEW
// producers wired up for this task actually fire, and only when they
// should). The Brevo provider is stubbed at the `fetch` boundary — never a
// real network call. Proves:
//   - raising an approval (task_completion via PATCH /api/tasks/[id], and
//     mortality via POST /api/records) notifies and emails the named
//     approver, or broadcasts to owner+manager when there is none
//   - deciding an approval notifies and emails whoever requested it
//   - assigning a task (POST /api/tasks create, PATCH /api/tasks/[id]
//     reassignment) notifies and emails that employee's linked user, is a
//     silent no-op when the employee has no login, and does not fire again
//     when the assignee is unchanged
//   - syncTaskNotifications targets an assigned task's linked user instead
//     of broadcasting, and still broadcasts a task with no assignee
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { eq, inArray } from 'drizzle-orm'

vi.mock('server-only', () => ({}))

let mockCookie: string | undefined
vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({ get: () => (mockCookie ? { value: mockCookie } : undefined) })),
}))

import { GET as notificationsGET } from '@/app/api/notifications/route'
import { POST as tasksPOST } from '@/app/api/tasks/route'
import { PATCH as taskPATCH } from '@/app/api/tasks/[id]/route'
import { POST as approvePOST } from '@/app/api/approvals/[id]/approve/route'
import { POST as recordsPOST } from '@/app/api/records/route'
import { db } from '@/db'
import {
  tenants, users, sessions, employees, tasks, approvalRequests, notifications,
  farms, productionUnits, batches, records, rolePermissions, batchMovements, auditLog,
} from '@/db/schemas'
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

// Brevo's payload is `to: [{ email }]`, not a bare string array — same
// helper as tests/notification-email.test.ts.
function recipientsOf(fetchMock: ReturnType<typeof vi.fn>): string[] {
  return fetchMock.mock.calls.map((call) => JSON.parse(call[1].body).to[0].email)
}

run('notification wiring: approvals, task assignment, per-assignee sync', () => {
  const tenantId = `t-notifwire-${randomUUID()}`
  const farmId = `f-notifwire-${randomUUID()}`
  const unitId = `u-notifwire-${randomUUID()}`
  const batchId = `b-notifwire-${randomUUID()}`

  const ownerId = `usr-owner-${randomUUID()}`
  const managerId = `usr-manager-${randomUUID()}`
  const workerUserId = `usr-worker-${randomUUID()}`

  const ownerEmail = `notifwire-owner-${randomUUID()}@test.ifms`
  const managerEmail = `notifwire-manager-${randomUUID()}@test.ifms`
  const workerEmail = `notifwire-worker-${randomUUID()}@test.ifms`

  const employeeWithLoginId = `emp-login-${randomUUID()}`
  const employeeNoLoginId = `emp-nologin-${randomUUID()}`

  let ownerSession: string
  let managerSession: string
  let workerSession: string

  let fetchMock: ReturnType<typeof vi.fn>
  const originalApiKey = process.env.BREVO_API_KEY

  beforeAll(async () => {
    await db.insert(tenants).values({ id: tenantId, name: 'Notif Wiring Co.', active: true })
    await db.insert(farms).values({ id: farmId, tenantId, name: 'Farm', location: 'Nakuru', code: 'FRM-NW' })
    await db.insert(productionUnits).values({ id: unitId, tenantId, farmId, type: 'house', name: 'House', code: 'HSE-NW' })
    await db.insert(batches).values({
      id: batchId, tenantId, unitId, code: 'BRO-NW', name: 'Broilers', enterprise: 'broiler',
      initialQty: 100, currentQty: 100,
    })
    const salt = randomUUID()
    await db.insert(users).values([
      { id: ownerId, tenantId, name: 'Owner', email: ownerEmail, role: 'owner', passwordHash: hashSecret('pw', salt), passwordSalt: salt, status: 'ACTIVE' },
      { id: managerId, tenantId, name: 'Manager', email: managerEmail, role: 'manager', passwordHash: hashSecret('pw', salt), passwordSalt: salt, status: 'ACTIVE' },
      { id: workerUserId, tenantId, name: 'Worker', email: workerEmail, role: 'worker', passwordHash: hashSecret('pw', salt), passwordSalt: salt, status: 'ACTIVE' },
    ])
    await db.insert(employees).values([
      { id: employeeWithLoginId, tenantId, userId: workerUserId, name: 'Has Login', phone: '', role: 'worker' },
      { id: employeeNoLoginId, tenantId, userId: null, name: 'No Login', phone: '', role: 'worker' },
    ])
    // Worker mortality submissions wait for sign-off — same rolePermissions
    // shape as tests/batch-ledger.test.ts, needed to exercise the
    // records-raised approval-notification path.
    await db.insert(rolePermissions).values([
      { id: randomUUID(), tenantId, role: 'worker', module: 'mortality', access: 'edit', approvalRequired: true },
    ])
    ownerSession = await createSession(ownerId)
    managerSession = await createSession(managerId)
    workerSession = await createSession(workerUserId)
  })

  afterAll(async () => {
    mockCookie = undefined
    await db.delete(auditLog).where(eq(auditLog.tenantId, tenantId))
    await db.delete(approvalRequests).where(eq(approvalRequests.tenantId, tenantId))
    await db.delete(batchMovements).where(eq(batchMovements.tenantId, tenantId))
    await db.delete(records).where(eq(records.tenantId, tenantId))
    await db.delete(rolePermissions).where(eq(rolePermissions.tenantId, tenantId))
    await db.delete(notifications).where(eq(notifications.tenantId, tenantId))
    await db.delete(tasks).where(eq(tasks.tenantId, tenantId))
    await db.delete(batches).where(eq(batches.tenantId, tenantId))
    await db.delete(productionUnits).where(eq(productionUnits.tenantId, tenantId))
    await db.delete(farms).where(eq(farms.tenantId, tenantId))
    await db.delete(employees).where(eq(employees.tenantId, tenantId))
    await db.delete(sessions).where(inArray(sessions.userId, [ownerId, managerId, workerUserId]))
    await db.delete(users).where(inArray(users.id, [ownerId, managerId, workerUserId]))
    await db.delete(tenants).where(eq(tenants.id, tenantId))
  })

  beforeEach(() => {
    mockCookie = undefined
    process.env.BREVO_API_KEY = 'test-key'
    fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: `test-${randomUUID()}` }) })
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(async () => {
    vi.unstubAllGlobals()
    if (originalApiKey === undefined) delete process.env.BREVO_API_KEY
    else process.env.BREVO_API_KEY = originalApiKey
    // Cleared after every test so each one starts from a task/approval/
    // notification-free tenant — sync tests in particular depend on this to
    // know exactly which tasks are "due".
    await db.delete(auditLog).where(eq(auditLog.tenantId, tenantId))
    await db.delete(approvalRequests).where(eq(approvalRequests.tenantId, tenantId))
    await db.delete(notifications).where(eq(notifications.tenantId, tenantId))
    await db.delete(tasks).where(eq(tasks.tenantId, tenantId))
  })

  async function createTask(body: Record<string, unknown>, cookie = ownerSession) {
    mockCookie = cookie
    const res = await readJson(await tasksPOST(jsonRequest('http://localhost/api/tasks', 'POST', { tenantId, ...body })))
    mockCookie = undefined
    return res
  }

  async function patchTask(id: string, body: Record<string, unknown>, cookie = ownerSession) {
    mockCookie = cookie
    const res = await readJson(await taskPATCH(jsonRequest(`http://localhost/api/tasks/${id}`, 'PATCH', body), { params: Promise.resolve({ id }) }))
    mockCookie = undefined
    return res
  }

  describe('task assignment', () => {
    it('assigning a task on create notifies and emails the assignee\'s linked login', async () => {
      const created = await createTask({ title: 'Feed Round', assigneeId: employeeWithLoginId })
      expect(created.status).toBe(201)

      expect(recipientsOf(fetchMock)).toEqual([workerEmail])

      const sourceId = `${created.payload.data.id}:assigned:${employeeWithLoginId}`
      const [row] = await db.select().from(notifications).where(eq(notifications.sourceId, sourceId))
      expect(row.userId).toBe(workerUserId)
      expect(row.title).toContain('Feed Round')
    })

    it('assigning to an employee with no login account creates no notification and sends no email', async () => {
      const created = await createTask({ title: 'Silent Assignment', assigneeId: employeeNoLoginId })
      expect(created.status).toBe(201)
      expect(fetchMock).not.toHaveBeenCalled()

      const sourceId = `${created.payload.data.id}:assigned:${employeeNoLoginId}`
      const rows = await db.select().from(notifications).where(eq(notifications.sourceId, sourceId))
      expect(rows).toHaveLength(0)
    })

    it('reassigning notifies the new assignee; re-saving with the same assignee does not notify again', async () => {
      const created = await createTask({ title: 'Reassign Me' })
      expect(created.status).toBe(201)
      const taskId = created.payload.data.id
      expect(fetchMock).not.toHaveBeenCalled() // no assignee at creation

      const reassigned = await patchTask(taskId, { assigneeId: employeeWithLoginId })
      expect(reassigned.status).toBe(200)
      expect(recipientsOf(fetchMock)).toEqual([workerEmail])

      fetchMock.mockClear()
      const resaved = await patchTask(taskId, { assigneeId: employeeWithLoginId, notes: 'still on it' })
      expect(resaved.status).toBe(200)
      expect(fetchMock).not.toHaveBeenCalled()
    })
  })

  describe('approval raised', () => {
    it('a task completion with a named approver notifies only that approver', async () => {
      const created = await createTask({
        title: 'Cull decision', dueAt: new Date(Date.now() + 86400000).toISOString(),
        requiresApproval: true, approverId: managerId,
      })
      const submitted = await patchTask(created.payload.data.id, { status: 'DONE' })
      expect(submitted.status).toBe(200)
      const approvalId = submitted.payload.data.approvalRequestId

      expect(recipientsOf(fetchMock)).toEqual([managerEmail])
      const [row] = await db.select().from(notifications).where(eq(notifications.sourceId, approvalId))
      expect(row.userId).toBe(managerId)
      expect(row.role).toBeNull()
    })

    it('a task completion with no named approver broadcasts to owner and manager on separate source ids', async () => {
      const created = await createTask({
        title: 'Undecided approver', dueAt: new Date(Date.now() + 86400000).toISOString(),
        requiresApproval: true,
      })
      const submitted = await patchTask(created.payload.data.id, { status: 'DONE' })
      const approvalId = submitted.payload.data.approvalRequestId

      expect(recipientsOf(fetchMock).sort()).toEqual([managerEmail, ownerEmail].sort())
      const rows = await db
        .select()
        .from(notifications)
        .where(inArray(notifications.sourceId, [`${approvalId}:owner`, `${approvalId}:manager`]))
      expect(rows).toHaveLength(2)
      expect(rows.map((r) => r.role).sort()).toEqual(['manager', 'owner'])
    })

    it('a mortality record needing approval broadcasts to owner and manager', async () => {
      mockCookie = workerSession
      const res = await readJson(await recordsPOST(jsonRequest('http://localhost/api/records', 'POST', {
        tenantId, batchId, employeeId: employeeWithLoginId, type: 'mortality', data: { count: 3, cause: 'Heat' },
      })))
      mockCookie = undefined
      expect(res.status).toBe(201)
      expect(res.payload.data.pendingApproval).toBe(true)
      const approvalId = res.payload.data.approvalRequestId

      expect(recipientsOf(fetchMock).sort()).toEqual([managerEmail, ownerEmail].sort())
      const rows = await db
        .select()
        .from(notifications)
        .where(inArray(notifications.sourceId, [`${approvalId}:owner`, `${approvalId}:manager`]))
      expect(rows).toHaveLength(2)

      await db.delete(batchMovements).where(eq(batchMovements.tenantId, tenantId))
      await db.delete(records).where(eq(records.tenantId, tenantId))
    })
  })

  describe('approval decided', () => {
    it('notifies and emails whoever requested it', async () => {
      const created = await createTask({
        title: 'Needs a decision', dueAt: new Date(Date.now() + 86400000).toISOString(),
        requiresApproval: true, approverId: managerId,
      }, ownerSession)
      const submitted = await patchTask(created.payload.data.id, { status: 'DONE' }, ownerSession)
      const approvalId = submitted.payload.data.approvalRequestId

      fetchMock.mockClear()
      mockCookie = managerSession
      const decided = await readJson(await approvePOST(new Request('http://localhost', { method: 'POST' }), { params: Promise.resolve({ id: approvalId }) }))
      mockCookie = undefined
      expect(decided.status).toBe(200)

      // The owner both created the task and PATCHed it to DONE, so the
      // owner is `requestedBy` on the approval — see PATCH /api/tasks/[id].
      expect(recipientsOf(fetchMock)).toEqual([ownerEmail])
      const [row] = await db.select().from(notifications).where(eq(notifications.sourceId, `${approvalId}:decided`))
      expect(row.userId).toBe(ownerId)
      expect(row.title).toContain('approved')
    })
  })

  describe('per-assignee due/overdue sync (syncTaskNotifications)', () => {
    it('targets an assigned task\'s linked user instead of broadcasting', async () => {
      const overdueAssignedId = randomUUID()
      await db.insert(tasks).values({
        id: overdueAssignedId, tenantId, title: 'Assigned overdue chore',
        dueAt: new Date(Date.now() - 86400000), status: 'PENDING', assigneeId: employeeWithLoginId,
      })

      mockCookie = ownerSession
      await notificationsGET()
      mockCookie = undefined

      const [row] = await db.select().from(notifications).where(eq(notifications.sourceId, overdueAssignedId))
      expect(row.userId).toBe(workerUserId)
      expect(row.role).toBeNull()
      expect(recipientsOf(fetchMock)).toEqual([workerEmail])
    })

    it('still broadcasts a task with no assignee', async () => {
      const overdueUnassignedId = randomUUID()
      await db.insert(tasks).values({
        id: overdueUnassignedId, tenantId, title: 'Unassigned overdue chore',
        dueAt: new Date(Date.now() - 86400000), status: 'PENDING',
      })

      mockCookie = ownerSession
      await notificationsGET()
      mockCookie = undefined

      const [row] = await db.select().from(notifications).where(eq(notifications.sourceId, overdueUnassignedId))
      expect(row.userId).toBeNull()
      expect(row.role).toBeNull()
      expect(recipientsOf(fetchMock).sort()).toEqual([managerEmail, ownerEmail, workerEmail].sort())
    })

    it('broadcasts when the assignee has no linked login', async () => {
      const overdueNoLoginId = randomUUID()
      await db.insert(tasks).values({
        id: overdueNoLoginId, tenantId, title: 'Overdue, assigned to someone with no login',
        dueAt: new Date(Date.now() - 86400000), status: 'PENDING', assigneeId: employeeNoLoginId,
      })

      mockCookie = ownerSession
      await notificationsGET()
      mockCookie = undefined

      const [row] = await db.select().from(notifications).where(eq(notifications.sourceId, overdueNoLoginId))
      expect(row.userId).toBeNull()
      expect(recipientsOf(fetchMock).sort()).toEqual([managerEmail, ownerEmail, workerEmail].sort())
    })
  })
})
