import { NextResponse } from 'next/server'
import { db } from '@/db'
import { tasks, approvalRequests, employees } from '@/db/schemas'
import { and, eq } from 'drizzle-orm'
import { requireTenantSession, forbidden } from '@/lib/api-auth'
import { canEdit, MODULES } from '@/lib/permissions'
import { isRecurrence, spawnNextOccurrence } from '@/lib/tasks'
import { resolveAssignee, resolveApprover } from '@/lib/task-people'
import { notifyApprovalRaised } from '@/lib/governance'
import { createAndEmailNotification } from '@/lib/notification-email'

// ── GET/PATCH/DELETE /api/tasks/[id] (issue #243) ───────────────────────────
// Tenant-scoped: an id only reads/updates/deletes when its tenantId matches
// the caller's (session tenant, or the `tenantId` query param in standalone
// mock mode) — otherwise 404, same convention as GET/PATCH /api/batches/[id].
//
// ── Completion -> approval transition ──
// PATCH-ing `status: 'DONE'` on a task whose `requiresApproval` is true does
// NOT complete the task directly: it creates an `approval_requests` row
// (type: 'task_completion') and parks the task at `PENDING_APPROVAL` instead.
// Approving/rejecting that request (POST /api/approvals/[id]/approve|reject)
// is what actually resolves the task to DONE/REJECTED. This is the v1
// approval-scope decision — see db/schemas/governance.ts's header comment for
// why task-completion is the only trigger built in this issue.

const ok = <T>(data: T) => NextResponse.json({ success: true, data }, { status: 200 })
const badRequest = (msg: string) => NextResponse.json({ success: false, error: msg }, { status: 400 })
const notFound = () => NextResponse.json({ success: false, error: 'Task not found' }, { status: 404 })

const VALID_PRIORITIES = new Set(['low', 'medium', 'high'])

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const auth = await requireTenantSession({ explicitTenantId: new URL(req.url).searchParams.get('tenantId') })
  if ('error' in auth) return auth.error
  const { tenantId } = auth

  const rows = await db.select().from(tasks).where(and(eq(tasks.id, id), eq(tasks.tenantId, tenantId)))
  if (rows.length === 0) return notFound()
  return ok(rows[0])
}

// PATCH /api/tasks/[id] — partial update. Every field is optional; only
// fields present in the body are changed. Supported fields: title, dueAt,
// status, priority, requiresApproval, notes.
//
// Body may also include `actorId` — the user requesting the change, used as
// `approval_requests.requestedBy` when a completion routes through approval
// (session user id wins when a session is present, same
// session-then-fallback convention as tenantId elsewhere on this branch).
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const auth = await requireTenantSession({ explicitTenantId: new URL(req.url).searchParams.get('tenantId') })
  if ('error' in auth) return auth.error
  const { session, tenantId } = auth

  if (!(await canEdit(tenantId, session.role, MODULES.tasks))) {
    return forbidden('Your role does not have edit access to tasks')
  }

  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return badRequest('Invalid JSON body')
  }
  const b = (raw ?? {}) as Record<string, unknown>

  const existingRows = await db.select().from(tasks).where(and(eq(tasks.id, id), eq(tasks.tenantId, tenantId)))
  const existing = existingRows[0]
  if (!existing) return notFound()

  const patch: Partial<typeof tasks.$inferInsert> = {}
  if (typeof b.title === 'string' && b.title.trim()) patch.title = b.title.trim()
  if (typeof b.dueAt === 'string') patch.dueAt = b.dueAt ? new Date(b.dueAt) : null
  if (typeof b.priority === 'string' && VALID_PRIORITIES.has(b.priority.trim())) patch.priority = b.priority.trim()
  if (b.requiresApproval !== undefined) patch.requiresApproval = b.requiresApproval === true
  if (typeof b.notes === 'string') patch.notes = b.notes.trim()

  // Reassignment. An explicit null clears it — "nobody in particular" is a
  // real state, distinct from "leave whoever is on it alone" (field absent).
  if (b.assigneeId === null) patch.assigneeId = null
  else if (typeof b.assigneeId === 'string' && b.assigneeId.trim()) {
    const resolved = await resolveAssignee(tenantId, b.assigneeId.trim())
    if (!resolved) return badRequest('That employee is not on this farm')
    patch.assigneeId = resolved
  }

  if (b.approverId === null) patch.approverId = null
  else if (typeof b.approverId === 'string' && b.approverId.trim()) {
    const approver = await resolveApprover(tenantId, b.approverId.trim())
    if ('problem' in approver) {
      return badRequest(approver.problem === 'not-found'
        ? 'That approver is not a user on this farm'
        : `${approver.name} cannot approve tasks — give their role governance access first, or pick someone else`)
    }
    patch.approverId = approver.id
  }

  if (isRecurrence(b.recurrence)) patch.recurrence = b.recurrence
  if (b.recurrenceUntil === null) patch.recurrenceUntil = null
  else if (typeof b.recurrenceUntil === 'string' && b.recurrenceUntil) patch.recurrenceUntil = new Date(b.recurrenceUntil)

  const effectiveRecurrence = patch.recurrence ?? existing.recurrence
  const effectiveDueAt = patch.dueAt !== undefined ? patch.dueAt : existing.dueAt
  if (effectiveRecurrence !== 'none' && !effectiveDueAt) {
    return badRequest('A repeating task needs a due date — that is what each repeat is counted from')
  }

  // ── Notify a newly-assigned employee (notifications-wiring task) ─────────
  // Only when the assignee actually CHANGES to someone new — re-saving a
  // task with the same assigneeId (or any other field patch that leaves
  // assigneeId untouched) must not re-notify. Clearing the assignee
  // (explicit null) has nobody new to tell, so it's excluded too.
  const assigneeChangedTo = patch.assigneeId !== undefined && patch.assigneeId !== existing.assigneeId
    ? patch.assigneeId
    : null
  async function notifyNewAssignee(taskTitle: string): Promise<void> {
    if (!assigneeChangedTo) return
    const [employee] = await db
      .select({ userId: employees.userId })
      .from(employees)
      .where(eq(employees.id, assigneeChangedTo))
      .limit(1)
    // Not every employee has a login (see db/schemas/people.ts) — nobody to
    // email, so this is a silent no-op, not an error.
    if (!employee?.userId) return
    await createAndEmailNotification({
      tenantId,
      sourceType: 'task',
      // Suffixed with the assignee id, not just the task id: the task-
      // due/overdue sync (syncTaskNotifications) also keys off sourceType
      // 'task' + the bare task id, and a reassignment must not collide with
      // (or get silently skipped by) that unrelated notification.
      sourceId: `${id}:assigned:${assigneeChangedTo}`,
      title: `You were assigned: ${taskTitle}`,
      message: taskTitle,
      userId: employee.userId,
    })
  }

  const requestedStatus = typeof b.status === 'string' && b.status.trim() ? b.status.trim() : undefined
  const effectiveRequiresApproval = patch.requiresApproval ?? existing.requiresApproval

  if (requestedStatus && requestedStatus.toUpperCase() === 'DONE' && effectiveRequiresApproval) {
    const actor = session.id

    // Idempotent: a task already parked at PENDING_APPROVAL with a live
    // pending request just returns that request instead of creating a
    // second one for the same completion.
    const pendingRows = await db
      .select()
      .from(approvalRequests)
      .where(
        and(
          eq(approvalRequests.tenantId, tenantId),
          eq(approvalRequests.entityId, id),
          eq(approvalRequests.type, 'task_completion'),
          eq(approvalRequests.status, 'pending')
        )
      )
    let approvalRequest = pendingRows[0]

    if (!approvalRequest) {
      const [inserted] = await db
        .insert(approvalRequests)
        .values({
          id: crypto.randomUUID(),
          tenantId,
          type: 'task_completion',
          title: `Task completion: ${patch.title ?? existing.title}`,
          requestedBy: actor,
          batchId: null,
          entityId: id,
          details: patch.notes ?? existing.notes ?? '',
          status: 'pending',
          priority: patch.priority ?? existing.priority,
          // Snapshot, not a live lookup: the queue records who was ASKED.
          // Reassigning the task's approver later must not rewrite who was
          // accountable for a decision already taken on this request.
          assignedApproverId: patch.approverId !== undefined ? patch.approverId : existing.approverId,
        })
        .returning()
      approvalRequest = inserted
      // Only for a genuinely new request — the idempotent branch above
      // returns an already-raised one, which was already notified on.
      await notifyApprovalRaised(approvalRequest)
    }

    patch.status = 'PENDING_APPROVAL'
    const [updated] = await db.update(tasks).set(patch).where(and(eq(tasks.id, id), eq(tasks.tenantId, tenantId))).returning()
    await notifyNewAssignee(updated.title)
    return ok({ ...updated, approvalRequestId: approvalRequest.id })
  }

  if (requestedStatus) patch.status = requestedStatus

  if (Object.keys(patch).length === 0) return badRequest('No updatable fields provided')

  const rows = await db.update(tasks).set(patch).where(and(eq(tasks.id, id), eq(tasks.tenantId, tenantId))).returning()
  if (rows.length === 0) return notFound()

  await notifyNewAssignee(rows[0].title)

  // A repeating task that just finished schedules its own successor. The
  // other place a task can finish is an approval being granted, which spawns
  // it inside that decision's transaction (lib/governance.ts) — both go
  // through the same helper so a chain can't break depending on which route
  // completed it.
  const completedNow = rows[0].status === 'DONE' && existing.status !== 'DONE'
  const next = completedNow ? await spawnNextOccurrence(rows[0]) : null

  return ok(next ? { ...rows[0], nextOccurrenceId: next.id, nextOccurrenceDueAt: next.dueAt } : rows[0])
}

// DELETE /api/tasks/[id] — hard delete, tenant-scoped.
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const auth = await requireTenantSession({ explicitTenantId: new URL(req.url).searchParams.get('tenantId') })
  if ('error' in auth) return auth.error
  const { session, tenantId } = auth

  if (!(await canEdit(tenantId, session.role, MODULES.tasks))) {
    return forbidden('Your role does not have edit access to tasks')
  }

  const rows = await db.delete(tasks).where(and(eq(tasks.id, id), eq(tasks.tenantId, tenantId))).returning()
  if (rows.length === 0) return notFound()
  return ok(rows[0])
}
