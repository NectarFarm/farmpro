// ── Worker Home "My Tasks Today" tests (issue #303) ─────────────────────────
// Integration tests that call the real GET /api/tasks route handler against
// the real postgres when DATABASE_URL is set (local/dev); CI has no
// database, so the suite skips there — same pattern as
// tests/dashboard.test.ts / tests/tasks-governance.test.ts.
//
// The Worker Home screen (components/farm/worker.tsx) sources its "My Tasks
// Today" section from the exact same GET /api/tasks?due=today endpoint the
// Tasks/Governance screens use (already covered by dashboard.test.ts's
// "due=today" suite), then filters client-side to the logged-in worker's own
// tasks using the "Assigned: <name>" notes convention
// (components/farm/tasks.tsx's `splitNotes`, reused by
// components/farm/worker.tsx's exported `selectMyTasksToday`). These tests
// cover that assignee-filtering step, plus a unit-level check of
// `selectMyTasksToday` in isolation, and a completion round-trip that mirrors
// tasks.tsx's `markDone` (including the requiresApproval -> PENDING_APPROVAL
// transition), proving Worker Home stays consistent with how Tasks/Governance
// already handle the same task (issue #303's second acceptance criterion).
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { inArray } from 'drizzle-orm'

vi.mock('server-only', () => ({}))
vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({ get: () => undefined })),
}))

import { GET as tasksGET, POST as tasksPOST } from '@/app/api/tasks/route'
import { PATCH as taskPATCH } from '@/app/api/tasks/[id]/route'
import { db } from '@/db'
import { tenants, employees, tasks, approvalRequests } from '@/db/schemas'
import { splitNotes, buildNotes, type ApiTask } from '@/components/farm/tasks'
import { selectMyTasksToday } from '@/components/farm/worker'

const hasDb = !!process.env.DATABASE_URL
const run = hasDb ? describe : describe.skip

function getRequest(url: string): Request {
  return new Request(url)
}
function postRequest(url: string, body: unknown): Request {
  return new Request(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
}
function patchRequest(url: string, body: unknown): Request {
  return new Request(url, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
}

describe('selectMyTasksToday (pure filter, no DB needed)', () => {
  function task(overrides: Partial<ApiTask>): ApiTask {
    return {
      id: randomUUID(),
      tenantId: 't-1',
      title: 'Task',
      dueAt: new Date().toISOString(),
      status: 'PENDING',
      priority: 'medium',
      requiresApproval: false,
      notes: null,
      createdAt: new Date().toISOString(),
      ...overrides,
    }
  }

  it('keeps only tasks whose notes-encoded assignee matches the worker name', () => {
    const mine = task({ id: 'mine', notes: buildNotes('John Kamau', '') })
    const someoneElses = task({ id: 'other', notes: buildNotes('Sarah Mwangi', '') })
    const unassigned = task({ id: 'unassigned', notes: null })

    const result = selectMyTasksToday([mine, someoneElses, unassigned], 'John Kamau')
    expect(result.map((t) => t.id)).toEqual(['mine'])
  })

  it('matches case-insensitively and ignores surrounding whitespace', () => {
    const mine = task({ id: 'mine', notes: buildNotes('  John Kamau  ', '') })
    const result = selectMyTasksToday([mine], 'john kamau')
    expect(result.map((t) => t.id)).toEqual(['mine'])
  })

  it('returns nothing for an empty worker name', () => {
    const mine = task({ id: 'mine', notes: buildNotes('John Kamau', '') })
    expect(selectMyTasksToday([mine], '')).toEqual([])
  })
})

run('worker home "My Tasks Today": GET /api/tasks?due=today + assignee filter (issue #303)', () => {
  const tenantId = `t-worker-tasks-${randomUUID()}`
  const workerId = randomUUID()

  beforeAll(async () => {
    await db.insert(tenants).values({ id: tenantId, name: 'Worker Tasks Test Co.', active: true })
    await db.insert(employees).values({ id: workerId, tenantId, name: 'John Kamau', role: 'worker' })
  })

  afterAll(async () => {
    await db.delete(approvalRequests).where(inArray(approvalRequests.tenantId, [tenantId]))
    await db.delete(tasks).where(inArray(tasks.tenantId, [tenantId]))
    await db.delete(employees).where(inArray(employees.tenantId, [tenantId]))
    await db.delete(tenants).where(inArray(tenants.id, [tenantId]))
  })

  it('surfaces a task assigned to the worker and due today, and excludes others', async () => {
    const now = new Date()
    const todayNoon = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 12))
    const tomorrow = new Date(todayNoon.getTime() + 24 * 60 * 60 * 1000)

    const myTaskRes = await tasksPOST(
      postRequest('http://localhost/api/tasks', {
        tenantId,
        title: 'Feeding — House A1',
        dueAt: todayNoon.toISOString(),
        notes: buildNotes('John Kamau', 'Use the morning mash'),
      })
    )
    expect(myTaskRes.status).toBe(201)
    const myTask = (await myTaskRes.json()).data

    await tasksPOST(
      postRequest('http://localhost/api/tasks', {
        tenantId,
        title: 'Vaccination round',
        dueAt: todayNoon.toISOString(),
        notes: buildNotes('Sarah Mwangi', ''),
      })
    )
    await tasksPOST(
      postRequest('http://localhost/api/tasks', {
        tenantId,
        title: 'Unassigned mortality check',
        dueAt: todayNoon.toISOString(),
      })
    )
    await tasksPOST(
      postRequest('http://localhost/api/tasks', {
        tenantId,
        title: 'Tomorrow feeding — House A1',
        dueAt: tomorrow.toISOString(),
        notes: buildNotes('John Kamau', ''),
      })
    )

    const res = await tasksGET(getRequest(`http://localhost/api/tasks?tenantId=${tenantId}&due=today`))
    expect(res.status).toBe(200)
    const payload = await res.json()
    expect(payload.success).toBe(true)

    const mine = selectMyTasksToday(payload.data, 'John Kamau')
    expect(mine).toHaveLength(1)
    expect(mine[0].id).toBe(myTask.id)
    expect(mine[0].title).toBe('Feeding — House A1')
    expect(splitNotes(mine[0].notes).assignee).toBe('John Kamau')
    expect(splitNotes(mine[0].notes).rest).toBe('Use the morning mash')
  })

  it('completing a task from the worker view goes through the same approval-aware PATCH as Tasks/Governance', async () => {
    const createRes = await tasksPOST(
      postRequest('http://localhost/api/tasks', {
        tenantId,
        title: 'Mortality record — needs sign-off',
        dueAt: new Date().toISOString(),
        requiresApproval: true,
        notes: buildNotes('John Kamau', ''),
      })
    )
    const created = (await createRes.json()).data

    const patchRes = await taskPATCH(
      patchRequest(`http://localhost/api/tasks/${created.id}?tenantId=${tenantId}`, { status: 'DONE', actorId: workerId }),
      { params: Promise.resolve({ id: created.id }) }
    )
    expect(patchRes.status).toBe(200)
    const patched = (await patchRes.json()).data

    // Same transition tasks.tsx's markDone relies on: requiresApproval routes
    // through PENDING_APPROVAL + a real approval_requests row, not straight to DONE.
    expect(patched.status).toBe('PENDING_APPROVAL')
    expect(patched.approvalRequestId).toBeTruthy()

    const approvalRows = await db.select().from(approvalRequests).where(inArray(approvalRequests.tenantId, [tenantId]))
    expect(approvalRows.some((a) => a.entityId === created.id && a.type === 'task_completion')).toBe(true)
  })
})
