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

export async function decideApproval(
  id: string,
  tenantId: string,
  actor: string,
  decision: ApprovalDecision
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

    const [updatedApproval] = await tx
      .update(approvalRequests)
      .set({ status: decision })
      .where(and(eq(approvalRequests.id, id), eq(approvalRequests.tenantId, tenantId)))
      .returning()

    let resolvedTask: typeof tasks.$inferSelect | undefined
    if (approval.type === 'task_completion') {
      const [task] = await tx
        .update(tasks)
        .set({ status: TASK_RESOLUTION[decision] })
        .where(and(eq(tasks.id, approval.entityId), eq(tasks.tenantId, tenantId)))
        .returning()
      resolvedTask = task
    }

    await tx.insert(auditLog).values({
      id: randomUUID(),
      tenantId,
      actor,
      action: `approval.${decision}`,
      entity: 'approval_request',
      entityId: id,
      meta: { type: approval.type, entityId: approval.entityId, resolvedTaskStatus: resolvedTask?.status ?? null },
    })

    return { approval: updatedApproval, task: resolvedTask }
  })
}
