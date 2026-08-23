// ── Moving a batch's headcount (batch-ledger task) ──────────────────────────
// One place where `batches.currentQty` is allowed to change, so the number
// and the explanation for it can never come apart. Callers describe WHAT
// happened; this writes the movement and the new total together, in the
// caller's transaction.
import 'server-only'
import { randomUUID } from 'node:crypto'
import { and, desc, eq } from 'drizzle-orm'
import { db } from '@/db'
import { batchMovements, batches } from '@/db/schemas'

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

export const MOVEMENT_TYPES = [
  'intake', 'mortality', 'sale', 'count_adjustment', 'manual_adjustment', 'transfer',
] as const
export type MovementType = (typeof MOVEMENT_TYPES)[number]

export class BatchLedgerError extends Error {
  constructor(message: string, public status = 400) {
    super(message)
  }
}

export interface MovementInput {
  tenantId: string
  batchId: string
  type: MovementType
  /** Signed: negative for a loss. */
  qtyDelta: number
  reason?: string
  sourceType?: string | null
  sourceId?: string | null
  actor?: string
  /**
   * Take the count to zero instead of refusing, when the movement is larger
   * than the count. See the note below for when that is the right answer.
   */
  allowClamp?: boolean
}

// Applies one movement and returns the batch as it now stands.
//
// What happens when a movement is bigger than the count depends on what kind
// of movement it is, and the difference matters:
//
//   A SALE is refused. Selling twenty birds out of a batch of five is a
//   data-entry error with money attached, and recording the revenue against
//   an impossible headcount is worse than making someone fix the number.
//
//   A DEATH is not. Very often the batch's headcount was simply never
//   entered — it sits at zero while there are real birds in the house — and
//   refusing the record would block a worker from reporting deaths because
//   of an omission somebody else made, losing the report entirely. So the
//   count goes to zero, and the movement's own reason records the full
//   figure that was reported against what was actually on the books. Nothing
//   is hidden; it just doesn't stop the person in front of the animals.
export async function applyMovement(tx: Tx, input: MovementInput) {
  const [batch] = await tx
    .select()
    .from(batches)
    .where(and(eq(batches.id, input.batchId), eq(batches.tenantId, input.tenantId)))
    .limit(1)
  if (!batch) throw new BatchLedgerError('Batch not found for this tenant', 404)

  let qtyDelta = input.qtyDelta
  let reason = input.reason ?? ''
  let qtyAfter = batch.currentQty + qtyDelta

  if (qtyAfter < 0) {
    if (!input.allowClamp) {
      throw new BatchLedgerError(
        `${batch.code} only has ${batch.currentQty} left — this would take it to ${qtyAfter}`
      )
    }
    const reported = Math.abs(qtyDelta)
    qtyDelta = -batch.currentQty
    qtyAfter = 0
    reason = `${reason || 'Recorded'} (${reported} reported, only ${batch.currentQty} were on the count)`.trim()
  }

  await tx.insert(batchMovements).values({
    id: randomUUID(),
    tenantId: input.tenantId,
    batchId: input.batchId,
    type: input.type,
    qtyDelta,
    qtyAfter,
    reason,
    sourceType: input.sourceType ?? null,
    sourceId: input.sourceId ?? null,
    actor: input.actor ?? '',
  })

  const [updated] = await tx
    .update(batches)
    .set({ currentQty: qtyAfter })
    .where(and(eq(batches.id, input.batchId), eq(batches.tenantId, input.tenantId)))
    .returning()

  return updated
}

// A physical count is expressed as the variance it found, not as the new
// total: the whole reason to count is to learn the difference between what
// the system believed and what is actually there. Storing the total would
// record the correction and lose the discrepancy.
export async function applyCount(tx: Tx, input: {
  tenantId: string
  batchId: string
  counted: number
  reason?: string
  sourceType?: string | null
  sourceId?: string | null
  actor?: string
}) {
  const [batch] = await tx
    .select()
    .from(batches)
    .where(and(eq(batches.id, input.batchId), eq(batches.tenantId, input.tenantId)))
    .limit(1)
  if (!batch) throw new BatchLedgerError('Batch not found for this tenant', 404)
  if (input.counted < 0) throw new BatchLedgerError('A count cannot be negative')

  const delta = input.counted - batch.currentQty
  if (delta === 0) {
    // Nothing moved, so nothing is written: a ledger full of "counted, no
    // change" rows buries the counts that did find something.
    return { batch, delta: 0, movementWritten: false }
  }

  const updated = await applyMovement(tx, {
    tenantId: input.tenantId,
    batchId: input.batchId,
    type: 'count_adjustment',
    qtyDelta: delta,
    reason: input.reason ?? (delta < 0
      ? 'Physical count found fewer than recorded'
      : 'Physical count found more than recorded'),
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    actor: input.actor,
  })

  return { batch: updated, delta, movementWritten: true }
}

// The batch's history, newest first — what the batch-detail ledger reads.
export async function movementsForBatch(tenantId: string, batchId: string, limit = 100) {
  return db
    .select()
    .from(batchMovements)
    .where(and(eq(batchMovements.tenantId, tenantId), eq(batchMovements.batchId, batchId)))
    .orderBy(desc(batchMovements.createdAt), desc(batchMovements.id))
    .limit(limit)
}
