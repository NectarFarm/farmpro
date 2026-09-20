// ── Moving a batch's headcount (batch-ledger task) ──────────────────────────
// One place where `batches.currentQty` is allowed to change, so the number
// and the explanation for it can never come apart. Callers describe WHAT
// happened; this writes the movement and the new total together, in the
// caller's transaction.
import 'server-only'
import { randomUUID } from 'node:crypto'
import { and, desc, eq, inArray, sum } from 'drizzle-orm'
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

// ── How many, of THIS batch, actually died (owner-roast finding #1) ────────
// Mortality % used to be `(initialQty - currentQty) / initialQty` — a raw
// headcount deficit that counted a SALE, a TRANSFER off the batch, or a hand
// correction exactly like a death, and that a later correction back up could
// erase from the number entirely with no trace. `qtyDelta` is signed and the
// `type` column already distinguishes why a count moved (see this file's
// header) — this sums only the movements actually classified as deaths, so
// selling half a flock never reads as "50% mortality", and a batch's real
// death toll survives an unrelated correction to the count.
//
// Returns a Map so a caller can `.get(batchId) ?? 0` for every batch it
// cares about in one query, instead of one query per batch.
export async function mortalityQtyForBatches(tenantId: string, batchIds: string[]): Promise<Map<string, number>> {
  const result = new Map<string, number>()
  if (batchIds.length === 0) return result
  const rows = await db
    .select({ batchId: batchMovements.batchId, total: sum(batchMovements.qtyDelta) })
    .from(batchMovements)
    .where(and(
      eq(batchMovements.tenantId, tenantId),
      eq(batchMovements.type, 'mortality'),
      inArray(batchMovements.batchId, batchIds),
    ))
    .groupBy(batchMovements.batchId)
  for (const r of rows) {
    // qtyDelta is negative for a death; the deaths COUNT is its magnitude.
    result.set(r.batchId, Math.abs(Number(r.total ?? 0)))
  }
  return result
}

// Convenience single-batch form of the above, for routes that only ever look
// at one batch at a time (GET/PATCH /api/batches/[id]).
export async function mortalityQtyForBatch(tenantId: string, batchId: string): Promise<number> {
  const map = await mortalityQtyForBatches(tenantId, [batchId])
  return map.get(batchId) ?? 0
}
