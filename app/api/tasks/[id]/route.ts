import { NextResponse } from 'next/server'
import { db } from '@/db'
import { tasks, approvalRequests, auditLog } from '@/db/schemas'
import { getSessionUser } from '@/lib/auth'
import { and, eq } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'

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

function resolveTenantId(req: Request, sessionTenantId: string | null | undefined): string {
  return sessionTenantId ?? new URL(req.url).searchParams.get('tenantId')?.trim() ?? ''
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = await getSessionUser()
  const tenantId = resolveTenantId(req, session?.tenantId)
  if (!tenantId) return badRequest('tenantId is required')

  const rows = await db.select().from(tasks).where(and(eq(tasks.id, id), eq(tasks.tenantId, tenantId)))
  if (rows.length === 0) return notFound()
  return ok(rows[0])
}

// PATCH /api/tasks/[id] — partial update. Every field is optional; only
// fields present in the body are changed. Supported fields: title, dueAt,
// status, priority, requiresApproval, notes, blockedByTaskId, clarification.
//
// ── Status history / governance trail ──
// Every status change here writes an `audit_log` row (entity: 'task',
// entityId: the task id) attributed to the real actor — session user id, or
// the `actorId` fallback in standalone mock mode. That's what the Governance
// → Activity Log screen surfaces (it already lists audit_log with
// actorName/actorRole resolved), so "who started/blocked/completed this task"
// is auditable across the system instead of living only in the task row.
//
// ── Blocked-by ──
// `blockedByTaskId` is only meaningful alongside status BLOCKED: the worker
// picks an existing tenant task that blocks this one, validated here (bad /
// foreign/other-tenant ids → 400/404, same convention as POST /api/batches's
// `unitId`). Setting BLOCKED without a blocker, or clearing status away from
// BLOCKED, drops the reference.
//
// ── Clarification ──
// `clarification` is a free-text note ("what do you need clarified?") the
// worker appends when they need more info — stored as an audit entry, not a
// new column, so the request-and-response trail stays in one place.
//
// Body may also include `actorId` — the user requesting the change, used as
// `approval_requests.requestedBy` when a completion routes through approval
// (session user id wins when a session is present, same
// session-then-fallback convention as tenantId elsewhere on this branch).
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = await getSessionUser()
  const tenantId = resolveTenantId(req, session?.tenantId)
  if (!tenantId) return badRequest('tenantId is required')

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

  const requestedStatus = typeof b.status === 'string' && b.status.trim() ? b.status.trim().toUpperCase() : undefined
  const effectiveRequiresApproval = patch.requiresApproval ?? existing.requiresApproval

  // A task can only be blocked with a real blocker, and can't be blocked by
  // itself. The blocker must belong to this tenant — validated against real
  // rows (bad/foreign ids get a clean 400/404, not a bare FK-violation 500).
  if (requestedStatus === 'BLOCKED') {
    const blocker = typeof b.blockedByTaskId === 'string' && b.blockedByTaskId.trim() ? b.blockedByTaskId.trim() : ''
    if (!blocker) return badRequest('blockedByTaskId is required when blocking a task')
    if (blocker === id) return badRequest('A task cannot block itself')
    const blockerRows = await db.select({ id: tasks.id }).from(tasks).where(and(eq(tasks.id, blocker), eq(tasks.tenantId, tenantId)))
    if (blockerRows.length === 0) return notFound()
    patch.blockedByTaskId = blocker
  } else if (typeof b.blockedByTaskId === 'string' && b.blockedByTaskId.trim()) {
    // Blocked-by reference without BLOCKED status (or while unblocking) —
    // treat as "not blocked" rather than silently storing a dangling ref.
    patch.blockedByTaskId = null
  }

  // Clarification request: free-text note from the worker, stored as an audit
  // entry so it appears in the tenant's activity trail with the requester.
  const clarification = typeof b.clarification === 'string' ? b.clarification.trim() : ''
  if (clarification) {
    await db.insert(auditLog).values({
      id: randomUUID(),
      tenantId,
      actor: session?.id ?? (typeof b.actorId === 'string' ? b.actorId.trim() : 'unknown'),
      action: 'task.clarification_requested',
      entity: 'task',
      entityId: id,
      meta: { note: clarification, title: existing.title },
    })
  }

  if (requestedStatus && requestedStatus.toUpperCase() === 'DONE' && effectiveRequiresApproval) {
    const actor = session?.id ?? (typeof b.actorId === 'string' ? b.actorId.trim() : '')
    if (!actor) return badRequest('actorId is required to request approval for a task that requires it')

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
        })
        .returning()
      approvalRequest = inserted
    }

    patch.status = 'PENDING_APPROVAL'
    const [updated] = await db.update(tasks).set(patch).where(and(eq(tasks.id, id), eq(tasks.tenantId, tenantId))).returning()
    // Completion requested — audited so "who asked for approval" is on the
    // record alongside the later approve/reject (which writes its own entry).
    await db.insert(auditLog).values({
      id: randomUUID(),
      tenantId,
      actor: session?.id ?? (typeof b.actorId === 'string' ? b.actorId.trim() : 'unknown'),
      action: 'task.completion_requested',
      entity: 'task',
      entityId: id,
      meta: { title: updated.title, from: existing.status, to: 'PENDING_APPROVAL' },
    })
    return ok({ ...updated, approvalRequestId: approvalRequest.id })
  }

  // Direct status change (STARTED / BLOCKED / DONE-without-approval / back to
  // PENDING): record the transition + who did it. `from` is the pre-change
  // status so the audit trail shows the full lifecycle, not just the latest.
  if (requestedStatus) {
    patch.status = requestedStatus
    await db.insert(auditLog).values({
      id: randomUUID(),
      tenantId,
      actor: session?.id ?? (typeof b.actorId === 'string' ? b.actorId.trim() : 'unknown'),
      action: `task.${requestedStatus.toLowerCase()}`,
      entity: 'task',
      entityId: id,
      meta: { title: existing.title, from: existing.status, to: requestedStatus, blockedByTaskId: patch.blockedByTaskId ?? null },
    })
  }

  if (Object.keys(patch).length === 0) {
    // Clarification-only PATCH — the note lives in audit_log (inserted above),
    // not on the task row, so an empty field-patch is a valid request here.
    if (clarification) return ok(existing)
    return badRequest('No updatable fields provided')
  }

  const rows = await db.update(tasks).set(patch).where(and(eq(tasks.id, id), eq(tasks.tenantId, tenantId))).returning()
  if (rows.length === 0) return notFound()
  return ok(rows[0])
}

// DELETE /api/tasks/[id] — hard delete, tenant-scoped.
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = await getSessionUser()
  const tenantId = resolveTenantId(req, session?.tenantId)
  if (!tenantId) return badRequest('tenantId is required')

  const rows = await db.delete(tasks).where(and(eq(tasks.id, id), eq(tasks.tenantId, tenantId))).returning()
  if (rows.length === 0) return notFound()
  return ok(rows[0])
}
