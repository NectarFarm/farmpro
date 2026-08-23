// ── Assigning, repeating and gating tasks (tasks-scheduling task) ───────────
// Three things that did not exist before migration 0029:
//   - a task names WHO does it (employees.id) and WHO signs it off (users.id)
//   - a repeating task creates its successor when it is completed, from
//     BOTH ways a task can finish (a direct PATCH, and an approval)
//   - an approval belongs to the person it was assigned to, not to everyone
//     holding governance rights
//
// The recurrence tests deliberately check the successor's DUE DATE, not just
// that a row appeared: a chain that repeats on the wrong day is worse than
// one that doesn't repeat, because nobody looks twice at a task that exists.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { and, eq, inArray } from 'drizzle-orm'

vi.mock('server-only', () => ({}))

let mockCookie: string | undefined
vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({ get: () => (mockCookie ? { value: mockCookie } : undefined) })),
}))

import { POST as tasksPOST, GET as tasksGET } from '@/app/api/tasks/route'
import { PATCH as taskPATCH } from '@/app/api/tasks/[id]/route'
import { GET as approvalsGET } from '@/app/api/approvals/route'
import { GET as approversGET } from '@/app/api/approvals/approvers/route'
import { POST as approvePOST } from '@/app/api/approvals/[id]/approve/route'
import { db } from '@/db'
import { tenants, users, sessions, employees, tasks, approvalRequests, auditLog } from '@/db/schemas'
import { createSession, hashSecret } from '@/lib/auth'
import { nextOccurrence } from '@/lib/tasks'

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

describe('nextOccurrence', () => {
  it('advances by day and week', () => {
    expect(nextOccurrence(new Date('2026-03-10T08:00:00Z'), 'daily')?.getDate()).toBe(11)
    expect(nextOccurrence(new Date('2026-03-10T08:00:00Z'), 'weekly')?.getDate()).toBe(17)
  })

  it('keeps a monthly chore on its day of the month', () => {
    const next = nextOccurrence(new Date(2026, 0, 15, 8, 0), 'monthly')
    expect(next?.getMonth()).toBe(1)
    expect(next?.getDate()).toBe(15)
  })

  it('clamps a month-end date instead of skipping a month', () => {
    // 31 Jan + 1 month is 3 March by plain JS date arithmetic — which would
    // silently drop February from a monthly chore's schedule.
    const next = nextOccurrence(new Date(2026, 0, 31, 8, 0), 'monthly')
    expect(next?.getMonth()).toBe(1)
    expect(next?.getDate()).toBe(28)
  })

  it('does not advance a task that does not repeat', () => {
    expect(nextOccurrence(new Date(), 'none')).toBeNull()
  })
})

run('tasks: assignment, repeats and approver gating', () => {
  const tenantId = `t-sched-${randomUUID()}`
  const otherTenantId = `t-sched-other-${randomUUID()}`
  const ownerId = `usr-owner-${randomUUID()}`
  const managerAId = `usr-mgr-a-${randomUUID()}`
  const managerBId = `usr-mgr-b-${randomUUID()}`
  const workerUserId = `usr-wkr-${randomUUID()}`
  const employeeId = `emp-${randomUUID()}`
  const otherTenantEmployeeId = `emp-other-${randomUUID()}`

  let ownerSession: string
  let managerASession: string
  let managerBSession: string

  const createdTaskIds: string[] = []

  beforeAll(async () => {
    await db.insert(tenants).values([
      { id: tenantId, name: 'Scheduling Co.', active: true },
      { id: otherTenantId, name: 'Other Co.', active: true },
    ])
    const salt = randomUUID()
    const mk = (id: string, tid: string, role: string, name: string) => ({
      id, tenantId: tid, name, email: `${id}@test.ifms`, role,
      passwordHash: hashSecret('pw', salt), passwordSalt: salt, status: 'ACTIVE',
    })
    await db.insert(users).values([
      mk(ownerId, tenantId, 'owner', 'Owner'),
      mk(managerAId, tenantId, 'manager', 'Manager A'),
      mk(managerBId, tenantId, 'manager', 'Manager B'),
      mk(workerUserId, tenantId, 'worker', 'Worker'),
    ])
    await db.insert(employees).values([
      { id: employeeId, tenantId, name: 'Jane Wanjiku', phone: '', role: 'worker' },
      { id: otherTenantEmployeeId, tenantId: otherTenantId, name: 'Outsider', phone: '', role: 'worker' },
    ])
    ownerSession = await createSession(ownerId)
    managerASession = await createSession(managerAId)
    managerBSession = await createSession(managerBId)
  })

  afterAll(async () => {
    mockCookie = undefined
    await db.delete(auditLog).where(inArray(auditLog.tenantId, [tenantId, otherTenantId]))
    await db.delete(approvalRequests).where(inArray(approvalRequests.tenantId, [tenantId, otherTenantId]))
    await db.delete(tasks).where(inArray(tasks.tenantId, [tenantId, otherTenantId]))
    await db.delete(employees).where(inArray(employees.tenantId, [tenantId, otherTenantId]))
    await db.delete(sessions).where(inArray(sessions.userId, [ownerId, managerAId, managerBId, workerUserId]))
    await db.delete(users).where(inArray(users.id, [ownerId, managerAId, managerBId, workerUserId]))
    await db.delete(tenants).where(inArray(tenants.id, [tenantId, otherTenantId]))
  })

  async function createTask(body: Record<string, unknown>, cookie = ownerSession) {
    mockCookie = cookie
    const res = await readJson(await tasksPOST(jsonRequest('http://localhost/api/tasks', 'POST', { tenantId, ...body })))
    mockCookie = undefined
    if (res.status === 201) createdTaskIds.push(res.payload.data.id)
    return res
  }

  async function patchTask(id: string, body: Record<string, unknown>, cookie = ownerSession) {
    mockCookie = cookie
    const res = await readJson(await taskPATCH(jsonRequest(`http://localhost/api/tasks/${id}`, 'PATCH', body), { params: Promise.resolve({ id }) }))
    mockCookie = undefined
    return res
  }

  it('stores the assignee as a real column, and refuses one from another farm', async () => {
    const ok = await createTask({ title: 'Feed House A', assigneeId: employeeId })
    expect(ok.status).toBe(201)
    expect(ok.payload.data.assigneeId).toBe(employeeId)

    const foreign = await createTask({ title: 'Should not stick', assigneeId: otherTenantEmployeeId })
    expect(foreign.status).toBe(400)
    expect(String(foreign.payload.error)).toContain('not on this farm')
  })

  it('will not name an approver who could never approve', async () => {
    const res = await createTask({ title: 'Needs sign-off', requiresApproval: true, approverId: workerUserId })
    expect(res.status).toBe(400)
    // The reason matters: naming a worker creates a task that can never be
    // completed, and the queue gives no clue why.
    expect(String(res.payload.error)).toContain('cannot approve')
  })

  it('lists only the people who can be named as approvers', async () => {
    mockCookie = ownerSession
    const { status, payload } = await readJson(await approversGET(new Request(`http://localhost/api/approvals/approvers?tenantId=${tenantId}`)))
    mockCookie = undefined
    expect(status).toBe(200)
    const ids = payload.data.map((a: { userId: string }) => a.userId)
    expect(ids).toContain(ownerId)
    expect(ids).toContain(managerAId)
    expect(ids).not.toContain(workerUserId)
  })

  it('refuses a repeating task with no due date to count repeats from', async () => {
    const res = await createTask({ title: 'Repeats into the void', recurrence: 'daily' })
    expect(res.status).toBe(400)
    expect(String(res.payload.error)).toContain('due date')
  })

  it('creates the next occurrence when a repeating task is completed', async () => {
    const due = new Date(2026, 5, 1, 8, 0)
    const created = await createTask({ title: 'Daily feed round', dueAt: due.toISOString(), recurrence: 'daily', assigneeId: employeeId })
    expect(created.status).toBe(201)

    const done = await patchTask(created.payload.data.id, { status: 'DONE' })
    expect(done.status).toBe(200)
    expect(done.payload.data.nextOccurrenceId).toBeTruthy()

    const [next] = await db.select().from(tasks).where(eq(tasks.id, done.payload.data.nextOccurrenceId))
    expect(next.status).toBe('PENDING')
    expect(new Date(next.dueAt as Date).getDate()).toBe(2)
    // The successor inherits who does it — a repeat that arrives unassigned
    // is a repeat nobody picks up.
    expect(next.assigneeId).toBe(employeeId)
    expect(next.recurrenceParentId).toBe(created.payload.data.id)
    createdTaskIds.push(next.id)
  })

  it('stops repeating after the end date, and never forks the chain on a repeated completion', async () => {
    const due = new Date(2026, 5, 1, 8, 0)
    const created = await createTask({
      title: 'Weekly dip', dueAt: due.toISOString(), recurrence: 'weekly',
      recurrenceUntil: new Date(2026, 5, 5).toISOString(),
    })
    const done = await patchTask(created.payload.data.id, { status: 'DONE' })
    expect(done.status).toBe(200)
    // 8 June is past the 5 June cutoff, so the chain ends here.
    expect(done.payload.data.nextOccurrenceId).toBeUndefined()

    // And completing an already-done task a second time must not spawn one.
    const again = await patchTask(created.payload.data.id, { status: 'DONE' })
    expect(again.payload.data.nextOccurrenceId).toBeUndefined()
    const children = await db.select().from(tasks).where(eq(tasks.recurrenceParentId, created.payload.data.id))
    expect(children.length).toBe(0)
  })

  it('an approval belongs to the person it was assigned to', async () => {
    const created = await createTask({
      title: 'Cull decision', dueAt: new Date(2026, 5, 10, 8, 0).toISOString(),
      requiresApproval: true, approverId: managerAId,
    })
    const submitted = await patchTask(created.payload.data.id, { status: 'DONE' })
    expect(submitted.status).toBe(200)
    expect(submitted.payload.data.status).toBe('PENDING_APPROVAL')
    const approvalId = submitted.payload.data.approvalRequestId

    const [request] = await db.select().from(approvalRequests).where(eq(approvalRequests.id, approvalId))
    expect(request.assignedApproverId).toBe(managerAId)

    // The other manager is refused outright — holding governance rights is
    // not the same as being asked.
    mockCookie = managerBSession
    const refused = await readJson(await approvePOST(new Request('http://localhost', { method: 'POST' }), { params: Promise.resolve({ id: approvalId }) }))
    mockCookie = undefined
    expect(refused.status).toBe(403)

    // ...and it isn't even in their queue.
    mockCookie = managerBSession
    const theirQueue = await readJson(await approvalsGET(new Request(`http://localhost/api/approvals?tenantId=${tenantId}&scope=mine`)))
    mockCookie = undefined
    expect(theirQueue.payload.data.map((r: { id: string }) => r.id)).not.toContain(approvalId)

    // The named approver can decide it, and the queue records that they did.
    mockCookie = managerASession
    const decided = await readJson(await approvePOST(new Request('http://localhost', { method: 'POST' }), { params: Promise.resolve({ id: approvalId }) }))
    mockCookie = undefined
    expect(decided.status).toBe(200)

    const [after] = await db.select().from(approvalRequests).where(eq(approvalRequests.id, approvalId))
    expect(after.status).toBe('approved')
    expect(after.decidedBy).toBe(managerAId)
    expect(after.decidedAt).toBeTruthy()
  })

  it('the owner can unblock a queue waiting on someone else, and it is recorded as an override', async () => {
    const created = await createTask({
      title: 'Stuck on an absent approver', dueAt: new Date(2026, 5, 12, 8, 0).toISOString(),
      requiresApproval: true, approverId: managerAId,
    })
    const submitted = await patchTask(created.payload.data.id, { status: 'DONE' })
    const approvalId = submitted.payload.data.approvalRequestId

    mockCookie = ownerSession
    const decided = await readJson(await approvePOST(new Request('http://localhost', { method: 'POST' }), { params: Promise.resolve({ id: approvalId }) }))
    mockCookie = undefined
    expect(decided.status).toBe(200)

    const [log] = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.tenantId, tenantId), eq(auditLog.entityId, approvalId)))
    expect((log.meta as Record<string, unknown>).ownerOverride).toBe(true)
  })

  it('approving a repeating task also schedules the next one', async () => {
    const created = await createTask({
      title: 'Monthly audit', dueAt: new Date(2026, 5, 15, 8, 0).toISOString(),
      recurrence: 'monthly', requiresApproval: true, approverId: managerAId,
    })
    const submitted = await patchTask(created.payload.data.id, { status: 'DONE' })
    const approvalId = submitted.payload.data.approvalRequestId

    mockCookie = managerASession
    await approvePOST(new Request('http://localhost', { method: 'POST' }), { params: Promise.resolve({ id: approvalId }) })
    mockCookie = undefined

    const children = await db.select().from(tasks).where(eq(tasks.recurrenceParentId, created.payload.data.id))
    expect(children.length).toBe(1)
    expect(new Date(children[0].dueAt as Date).getMonth()).toBe(6)
    createdTaskIds.push(children[0].id)
  })

  it('filters the list to one person\'s work and to a date window', async () => {
    mockCookie = ownerSession
    const mine = await readJson(await tasksGET(new Request(`http://localhost/api/tasks?tenantId=${tenantId}&assigneeId=${employeeId}`)))
    mockCookie = undefined
    expect(mine.status).toBe(200)
    expect(mine.payload.data.length).toBeGreaterThan(0)
    expect(mine.payload.data.every((t: { assigneeId: string }) => t.assigneeId === employeeId)).toBe(true)

    mockCookie = ownerSession
    const june = await readJson(await tasksGET(new Request(
      `http://localhost/api/tasks?tenantId=${tenantId}&from=${new Date(2026, 5, 1).toISOString()}&to=${new Date(2026, 6, 1).toISOString()}`
    )))
    mockCookie = undefined
    expect(june.payload.data.every((t: { dueAt: string }) => new Date(t.dueAt).getMonth() === 5)).toBe(true)
  })
})
