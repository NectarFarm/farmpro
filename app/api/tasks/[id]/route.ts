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
import { writeAuditLog } from '@/lib/audit'
import { taskShapeFieldsPresent } from '@/lib/task-fields'

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

  // ── Who may restructure a task, and who may only report on one ───────────
  // Gated on the `governance` module rather than a hardcoded
  // ['owner','manager'] list, for the same reason POST
  // /api/approvals/[id]/approve is: that module resolves to exactly owner +
  // manager under the code defaults (lib/permissions.ts's DEFAULT_MATRIX) —
  // so this is behaviour-preserving for them — while still letting a tenant's
  // owner widen or narrow it from the Governance screen instead of needing a
  // code change. Owner and super_admin bypass the matrix outright.
  //
  // vet and worker hold `tasks: 'edit'` but not `governance`, so both keep
  // marking their own work done and neither can reassign it. That is the
  // intended narrowing, not an oversight.
  const canReshape = await canEdit(tenantId, session.role, MODULES.governance)
  const attempted = taskShapeFieldsPresent(b)
  if (!canReshape && attempted.length > 0) {
    // Names the way forward rather than a bare 403: the person hitting this
    // is a worker who wants the job moved, and "ask your manager" is the
    // actual next step. Reassignment stays a conversation, not a silent write.
    return forbidden(
      `Only an owner or manager can change ${attempted.join(', ')} on a task. `
      + 'Ask them to reassign it — you can still mark your own task done.'
    )
  }

  // A worker/vet may report on their OWN work. `assigneeId` is an employees.id
  // (db/schemas/dashboard.ts), so the session user is resolved to their
  // employee row to compare.
  //
  // An UNASSIGNED task stays completable by anyone who can see it, and that is
  // deliberate: tasks are routinely created with no assigneeId and the
  // assignee's name carried only in the `notes` prefix, so refusing those
  // would stop workers completing most of the tenant's real work — the
  // behaviour tests/tasks-governance.test.ts and
  // tests/worker-tasks-today.test.ts both assert. It is also the same call
  // GET /api/approvals already makes for `scope=mine`, which counts
  // unassigned approvals as "work that genuinely is mine to do".
  if (!canReshape && existing.assigneeId) {
    const [mine] = await db
      .select({ id: employees.id })
      .from(employees)
      .where(and(eq(employees.userId, session.id), eq(employees.tenantId, tenantId)))
      .limit(1)
    if (!mine || mine.id !== existing.assigneeId) {
      return forbidden('That task is assigned to someone else — only they, an owner or a manager can update it.')
    }
  }

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

  // ── Audit: who moved the work, and who may now sign it off ───────────────
  // Called exactly once per request, from whichever of the two update
  // branches below actually runs — the deferred-completion branch returns
  // early, so a single call after each update is what keeps this to one row
  // per action rather than two.
  //
  // Only accountability changes are logged, not every field patch: a
  // retitled task is housekeeping, whereas moving who is answerable for the
  // job (or who is allowed to approve it) is the thing that had no trace at
  // all before this. A patch that changes neither writes nothing, matching
  // the "no audit row for a no-op save" pattern PATCH /api/farms/[id] and
  // PATCH /api/employees/[id] already follow.
  async function auditAccountabilityChange(): Promise<void> {
    const assigneeChanged = patch.assigneeId !== undefined && patch.assigneeId !== existing.assigneeId
    const approverChanged = patch.approverId !== undefined && patch.approverId !== existing.approverId
    const approvalFlagChanged = patch.requiresApproval !== undefined
      && patch.requiresApproval !== existing.requiresApproval
    if (!assigneeChanged && !approverChanged && !approvalFlagChanged) return
    await writeAuditLog({
      tenantId,
      actor: session.id,
      action: 'task.reassigned',
      entity: 'task',
      entityId: id,
      meta: {
        ...(assigneeChanged ? { assigneeFrom: existing.assigneeId, assigneeTo: patch.assigneeId } : {}),
        ...(approverChanged ? { approverFrom: existing.approverId, approverTo: patch.approverId } : {}),
        ...(approvalFlagChanged
          ? { requiresApprovalFrom: existing.requiresApproval, requiresApprovalTo: patch.requiresApproval }
          : {}),
      },
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
    await auditAccountabilityChange()
    return ok({ ...updated, approvalRequestId: approvalRequest.id })
  }

  if (requestedStatus) patch.status = requestedStatus

  if (Object.keys(patch).length === 0) return badRequest('No updatable fields provided')

  const rows = await db.update(tasks).set(patch).where(and(eq(tasks.id, id), eq(tasks.tenantId, tenantId))).returning()
  if (rows.length === 0) return notFound()

  await notifyNewAssignee(rows[0].title)
  await auditAccountabilityChange()

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
//
// Held to the same bar as reshaping a task, not to plain `tasks: edit`.
// Deleting somebody's task is the most complete form of reassignment there
// is — the work simply stops existing — and `tasks: edit` is granted to
// workers so they can mark their own jobs done. A worker being able to erase
// any task in the tenant is the same hole PATCH had, with no way to notice
// afterwards because the row is gone.
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const auth = await requireTenantSession({ explicitTenantId: new URL(req.url).searchParams.get('tenantId') })
  if ('error' in auth) return auth.error
  const { session, tenantId } = auth

  if (!(await canEdit(tenantId, session.role, MODULES.tasks))) {
    return forbidden('Your role does not have edit access to tasks')
  }
  if (!(await canEdit(tenantId, session.role, MODULES.governance))) {
    return forbidden('Only an owner or manager can delete a task. Mark it done, or ask them to remove it.')
  }

  const rows = await db.delete(tasks).where(and(eq(tasks.id, id), eq(tasks.tenantId, tenantId))).returning()
  if (rows.length === 0) return notFound()

  // This is a genuine hard delete, so the audit row is the only remaining
  // evidence the task ever existed. Title and assignee are recorded in `meta`
  // for that reason — an entityId pointing at a vanished row answers nothing.
  await writeAuditLog({
    tenantId,
    actor: session.id,
    action: 'task.deleted',
    entity: 'task',
    entityId: id,
    meta: { title: rows[0].title, assigneeId: rows[0].assigneeId, status: rows[0].status },
  })
  return ok(rows[0])
}
