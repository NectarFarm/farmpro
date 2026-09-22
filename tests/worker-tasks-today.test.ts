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

let mockCookie: string | undefined
vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({ get: () => (mockCookie ? { value: mockCookie } : undefined) })),
}))

import { GET as tasksGET, POST as tasksPOST } from '@/app/api/tasks/route'
import { PATCH as taskPATCH } from '@/app/api/tasks/[id]/route'
import { db } from '@/db'
import { tenants, employees, tasks, approvalRequests, users, sessions } from '@/db/schemas'
import { buildNotes, type ApiTask } from '@/components/farm/tasks'
import { selectMyTasksToday } from '@/components/farm/worker'
import { createSession, hashSecret } from '@/lib/auth'

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

  it('matches on the real assigneeId column, with no "Assigned:" text in the notes at all', () => {
    const mine = task({ id: 'mine', assigneeId: 'emp-john', notes: 'Use the morning mash' })
    const someoneElses = task({ id: 'other', assigneeId: 'emp-sarah', notes: null })
    const unassigned = task({ id: 'unassigned', assigneeId: null, notes: null })

    const result = selectMyTasksToday([mine, someoneElses, unassigned], 'emp-john', 'John Kamau')
    expect(result.map((t) => t.id)).toEqual(['mine'])
  })

  it('falls back to the notes-encoded assignee only for legacy rows with no assigneeId set', () => {
    const legacyMine = task({ id: 'legacy-mine', assigneeId: null, notes: buildNotes('John Kamau', '') })
    const legacyOther = task({ id: 'legacy-other', assigneeId: null, notes: buildNotes('Sarah Mwangi', '') })
    // A row that HAS a real assigneeId is never re-checked against notes,
    // even if stale notes text would otherwise have matched — the column is
    // authoritative once set.
    const staleNotesButNotMine = task({ id: 'stale-notes', assigneeId: 'emp-sarah', notes: buildNotes('John Kamau', '') })

    const result = selectMyTasksToday([legacyMine, legacyOther, staleNotesButNotMine], 'emp-john', 'John Kamau')
    expect(result.map((t) => t.id)).toEqual(['legacy-mine'])
  })

  it('matches the notes fallback case-insensitively and ignores surrounding whitespace', () => {
    const mine = task({ id: 'mine', assigneeId: null, notes: buildNotes('  John Kamau  ', '') })
    const result = selectMyTasksToday([mine], 'emp-john', 'john kamau')
    expect(result.map((t) => t.id)).toEqual(['mine'])
  })

  it('returns nothing for an unassigned legacy row when the worker name is empty', () => {
    const mine = task({ id: 'mine', assigneeId: null, notes: buildNotes('John Kamau', '') })
    expect(selectMyTasksToday([mine], 'emp-john', '')).toEqual([])
  })
})

run('worker home "My Tasks Today": GET /api/tasks?due=today + assignee filter (issue #303)', () => {
  const tenantId = `t-worker-tasks-${randomUUID()}`
  const workerId = randomUUID()
  const workerUserId = randomUUID()
  let workerSessionToken: string

  beforeAll(async () => {
    await db.insert(tenants).values({ id: tenantId, name: 'Worker Tasks Test Co.', active: true })
    await db.insert(employees).values({ id: workerId, tenantId, name: 'John Kamau', role: 'worker' })
    const salt = randomUUID()
    await db.insert(users).values({
      id: workerUserId, tenantId, name: 'John Kamau', email: `worker-tasks-${randomUUID()}@test.ifms`,
      role: 'worker', passwordHash: hashSecret('pw', salt), passwordSalt: salt, status: 'ACTIVE',
    })
    workerSessionToken = await createSession(workerUserId)
    mockCookie = workerSessionToken
  })

  afterAll(async () => {
    mockCookie = undefined
    await db.delete(approvalRequests).where(inArray(approvalRequests.tenantId, [tenantId]))
    await db.delete(tasks).where(inArray(tasks.tenantId, [tenantId]))
    await db.delete(employees).where(inArray(employees.tenantId, [tenantId]))
    await db.delete(sessions).where(inArray(sessions.userId, [workerUserId]))
    await db.delete(users).where(inArray(users.id, [workerUserId]))
    await db.delete(tenants).where(inArray(tenants.id, [tenantId]))
  })

  it('surfaces a task assigned to the worker (real assigneeId column, no "Assigned:" notes text) and due today, and excludes others', async () => {
    const now = new Date()
    const todayNoon = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 12))
    const tomorrow = new Date(todayNoon.getTime() + 24 * 60 * 60 * 1000)

    // P1 e2e finding: the owner's Assign-work sheet writes `assigneeId`
    // (components/farm/tasks.tsx), not a notes-encoded name — this is the
    // exact shape a task created that way actually has.
    const myTaskRes = await tasksPOST(
      postRequest('http://localhost/api/tasks', {
        tenantId,
        title: 'Feeding — House A1',
        dueAt: todayNoon.toISOString(),
        assigneeId: workerId,
        notes: 'Use the morning mash',
      })
    )
    expect(myTaskRes.status).toBe(201)
    const myTask = (await myTaskRes.json()).data
    expect(myTask.assigneeId).toBe(workerId)

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
        assigneeId: workerId,
      })
    )

    const res = await tasksGET(getRequest(`http://localhost/api/tasks?tenantId=${tenantId}&due=today`))
    expect(res.status).toBe(200)
    const payload = await res.json()
    expect(payload.success).toBe(true)

    const mine = selectMyTasksToday(payload.data, workerId, 'John Kamau')
    expect(mine).toHaveLength(1)
    expect(mine[0].id).toBe(myTask.id)
    expect(mine[0].title).toBe('Feeding — House A1')
    expect(mine[0].notes).toBe('Use the morning mash')
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
