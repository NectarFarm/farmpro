// ── Shared approval-decision transaction (issue #243) ───────────────────────
// Both POST /api/approvals/[id]/approve and .../reject do the same three
// things atomically: flip the approval_requests row, resolve the linked
// record (v1: always a task — see db/schemas/governance.ts's approval-scope
// decision), and write the decision to audit_log with the real actor. Shared
// here so the two routes can't drift on that sequence, same reasoning as
// lib/tenant-provisioning.ts factoring out the provisioning transaction.
import 'server-only'
import { randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { db } from '@/db'
import { approvalRequests, auditLog, tasks } from '@/db/schemas'
import { spawnNextOccurrence } from '@/lib/tasks'

export type ApprovalDecision = 'approved' | 'rejected'

export class ApprovalError extends Error {
  constructor(message: string, public status: number) {
    super(message)
  }
}

// Task-completion resolution: approved -> DONE, rejected -> REJECTED. The
// only entity type v1 wires up (see governance.ts decision note); a future
// approval type would branch on `approval.type` here.
const TASK_RESOLUTION: Record<ApprovalDecision, string> = {
  approved: 'DONE',
  rejected: 'REJECTED',
}

// Who is allowed to decide a given request.
//
// A request raised against a task with a named approver belongs to THAT
// person: anyone else with governance rights seeing it in their queue, and
// being able to sign it off, is the thing "properly gated" rules out.
//
// The owner is the one exception, and it is a deliberate one. An approver
// who leaves, loses their login, or simply isn't around would otherwise
// deadlock every task pointed at them with no way out from inside the app.
// The owner can decide anyway — and the audit row records it as an override,
// so the exception is visible rather than silent.
export function approverCanDecide(
  assignedApproverId: string | null,
  actorId: string,
  actorRole: string
): { allowed: boolean; override: boolean } {
  if (!assignedApproverId) return { allowed: true, override: false }
  if (assignedApproverId === actorId) return { allowed: true, override: false }
  if (actorRole === 'owner') return { allowed: true, override: true }
  return { allowed: false, override: false }
}

export async function decideApproval(
  id: string,
  tenantId: string,
  actor: string,
  decision: ApprovalDecision,
  actorRole?: string
) {
  return db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(approvalRequests)
      .where(and(eq(approvalRequests.id, id), eq(approvalRequests.tenantId, tenantId)))
    const approval = rows[0]
    if (!approval) throw new ApprovalError('Approval request not found', 404)
    if (approval.status !== 'pending') {
      throw new ApprovalError(`Approval request already ${approval.status}`, 409)
    }

    // Checked inside the transaction, against the row as it actually is —
    // not against a copy the route read a moment earlier.
    const gate = approverCanDecide(approval.assignedApproverId, actor, actorRole ?? '')
    if (!gate.allowed) {
      throw new ApprovalError('This request is waiting on someone else — only the named approver (or the owner) can decide it', 403)
    }

    const [updatedApproval] = await tx
      .update(approvalRequests)
      .set({ status: decision, decidedBy: actor, decidedAt: new Date() })
      .where(and(eq(approvalRequests.id, id), eq(approvalRequests.tenantId, tenantId)))
      .returning()

    let resolvedTask: typeof tasks.$inferSelect | undefined
    let nextOccurrenceId: string | null = null
    if (approval.type === 'task_completion') {
      const [task] = await tx
        .update(tasks)
        .set({ status: TASK_RESOLUTION[decision] })
        .where(and(eq(tasks.id, approval.entityId), eq(tasks.tenantId, tenantId)))
        .returning()
      resolvedTask = task
      // Approval is the second of the two ways a task can finish, so the
      // repeat is scheduled here too — inside this transaction, because a
      // decision that committed without its successor would silently end the
      // chain.
      if (task && task.status === 'DONE') {
        const next = await spawnNextOccurrence(task, tx)
        nextOccurrenceId = next?.id ?? null
      }
    }

    await tx.insert(auditLog).values({
      id: randomUUID(),
      tenantId,
      actor,
      action: `approval.${decision}`,
      entity: 'approval_request',
      entityId: id,
      meta: {
        type: approval.type,
        entityId: approval.entityId,
        resolvedTaskStatus: resolvedTask?.status ?? null,
        // Recorded so an owner deciding on someone else's behalf is visible
        // in the log rather than indistinguishable from the normal path.
        ownerOverride: gate.override,
        assignedApproverId: approval.assignedApproverId,
        nextOccurrenceId,
      },
    })

    return { approval: updatedApproval, task: resolvedTask, nextOccurrenceId }
  })
}
