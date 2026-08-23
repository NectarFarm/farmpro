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
import { approvalRequests, auditLog, records, tasks } from '@/db/schemas'
import { spawnNextOccurrence } from '@/lib/tasks'
import { applyCount, applyMovement } from '@/lib/batch-ledger'
import { createAndEmailNotification } from '@/lib/notification-email'

export type ApprovalDecision = 'approved' | 'rejected'

export class ApprovalError extends Error {
  constructor(message: string, public status: number) {
    super(message)
  }
}

// Task-completion resolution: approved -> DONE, rejected -> REJECTED.
//
// batch-ledger task: two more types branch below — 'mortality' and
// 'physical_count'. Those exist because a tenant can mark those modules
// approval-required for a role (role_permissions.approval_required), in
// which case the record is filed immediately but the batch's headcount does
// not move until someone signs it off. Approving is therefore not a status
// flip: it is when the count actually changes, and it has to happen in THIS
// transaction or an approved death could be recorded as approved while the
// batch it came out of never lost a bird.
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

// ── Approval-raised notification (notifications-wiring task) ───────────────
// Shared by both places an approval_requests row gets inserted —
// PATCH /api/tasks/[id] (task_completion) and POST /api/records (mortality /
// physical_count) — so they can't drift on who gets told or how the source
// id is keyed. Call this AFTER the insert has actually committed (in
// particular: after the records route's transaction resolves, not from
// inside it) for the same reason `decideApproval` below notifies after its
// own transaction — a notification/email for a row that then gets rolled
// back would be a lie.
//
// Targeting: a named `assignedApproverId` means the request belongs to that
// person specifically, so only they are told. Left null, it broadcasts to
// 'owner' and 'manager' — the two roles that pass `canEdit(..., MODULES.
// governance)` by default (lib/permissions.ts) and so can actually act on it
// without a tenant having customised the matrix; picking just one of the two
// would arbitrarily leave the other blind to work sitting in their own
// queue. The two role rows use suffixed source ids (`:owner`/`:manager`) —
// without the suffix both would resolve to the exact same
// (tenantId, sourceType, sourceId), and the unique index would let only the
// first one through.
export async function notifyApprovalRaised(approval: {
  id: string
  tenantId: string
  title: string
  assignedApproverId: string | null
}): Promise<void> {
  if (approval.assignedApproverId) {
    await createAndEmailNotification({
      tenantId: approval.tenantId,
      sourceType: 'approval',
      sourceId: approval.id,
      title: `Approval needed: ${approval.title}`,
      message: approval.title,
      userId: approval.assignedApproverId,
    })
    return
  }
  for (const role of ['owner', 'manager']) {
    await createAndEmailNotification({
      tenantId: approval.tenantId,
      sourceType: 'approval',
      sourceId: `${approval.id}:${role}`,
      title: `Approval needed: ${approval.title}`,
      message: approval.title,
      role,
    })
  }
}

export async function decideApproval(
  id: string,
  tenantId: string,
  actor: string,
  decision: ApprovalDecision,
  actorRole?: string
) {
  const result = await db.transaction(async (tx) => {
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

    // ── Headcount approvals (batch-ledger task) ──────────────────────────
    let ledgerNote: Record<string, unknown> = {}
    if (approval.type === 'mortality' || approval.type === 'physical_count') {
      const [record] = await tx.select().from(records).where(eq(records.id, approval.entityId)).limit(1)
      if (!record) throw new ApprovalError('The record this approval refers to no longer exists', 404)

      const data = (record.data ?? {}) as Record<string, unknown>
      if (decision === 'approved') {
        if (approval.type === 'mortality') {
          const deaths = Math.trunc(Number(data.count ?? data.deaths ?? 0))
          const applied = await applyMovement(tx, {
            tenantId,
            batchId: record.batchId,
            type: 'mortality',
            qtyDelta: -deaths,
            reason: typeof data.cause === 'string' && data.cause ? String(data.cause) : 'Mortality approved',
            allowClamp: true,
            sourceType: 'record',
            sourceId: record.id,
            actor,
          })
          ledgerNote = { headcountAfter: applied.currentQty, applied: -deaths }
        } else {
          const counted = Math.trunc(Number(data.counted ?? data.physicalCount ?? data.count ?? 0))
          const result = await applyCount(tx, {
            tenantId, batchId: record.batchId, counted, sourceType: 'record', sourceId: record.id, actor,
          })
          ledgerNote = { headcountAfter: result.batch.currentQty, applied: result.delta }
        }
      }

      // Either way the record stops saying "waiting": rejected means the
      // count stands as it was, and a record still flagged pending would
      // keep looking like something was about to happen.
      const rest = { ...data }
      delete rest.pendingApproval
      await tx
        .update(records)
        .set({ data: { ...rest, approvalDecision: decision, decidedBy: actor } })
        .where(eq(records.id, record.id))
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
        ...ledgerNote,
      },
    })

    return { approval: updatedApproval, task: resolvedTask, nextOccurrenceId }
  })

  // Notify the requester AFTER the transaction has committed, not from
  // inside it: raising the notification/email in there and then having a
  // later statement in the same transaction fail would leave a real email
  // already sent for a decision that never actually took effect. `:decided`
  // keys this event's sourceId apart from the approval-RAISED notification
  // (app/api/tasks/[id]/route.ts, app/api/records/route.ts), which is keyed
  // to the same approval id with no suffix — without the suffix the two
  // events would collide on idx_notifications_source and only one of them
  // would ever be created.
  await createAndEmailNotification({
    tenantId,
    sourceType: 'approval',
    sourceId: `${id}:decided`,
    title: `Request ${decision}: ${result.approval.title}`,
    message: result.approval.title,
    userId: result.approval.requestedBy,
  })

  return result
}
