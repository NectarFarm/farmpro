import { db } from '@/db';
import { batches, productionUnits, batchStageEvents } from '@/db/schemas';
import { and, eq } from 'drizzle-orm';
import { getSession } from '@/lib/server/session';
import { audit, actorLabel } from '@/lib/server/audit';
import { ok, badRequest, unauthorized, forbidden, notFound } from '@/lib/server/http';
import { parseBody, batchAdvanceSchema } from '@/lib/server/validate';
import { writeRateLimited } from '@/lib/server/rateLimit';
import type { Role } from '@/lib/types';

const ALLOWED: Role[] = ['owner', 'manager'];

// Thrown inside the transaction below and translated back to the matching HTTP
// response outside it — the transaction itself only ever fully commits or fully
// rolls back, never partially applies stage/qty/unit changes.
class BatchNotFound extends Error {}
class AdvanceValidationError extends Error {}

// POST /api/batches/advance  { batchId, toStage, toUnitId?, newQty?, note? }
// Advance a batch's lifecycle stage and/or MOVE it to another unit, optionally
// adjusting the head count for the move (e.g. 120 eggs → 98 chicks, or transfer loss).
// Keeps both unit occupancies in step, records a transition event, and audits it.
export async function POST(req: Request) {
  const limited = writeRateLimited(req);
  if (limited) return limited;
  const session = await getSession();
  if (!session) return unauthorized();
  if (!ALLOWED.includes(session.role)) return forbidden();
  const tid = session.tenantId;

  const parsed = await parseBody(req, batchAdvanceSchema);
  if ('error' in parsed) return parsed.error;
  const body = parsed.data;
  const batchId = body.batchId;
  const toStage = body.toStage;

  let result: { fromStage: string | null; fromUnitId: string; qtyBefore: number; qtyAfter: number; toUnitId: string };
  try {
    result = await db.transaction(async (tx) => {
      // Locked — a concurrent sale/advance/count on this same batch must serialize
      // against this read, or one request's write can silently clobber the other's
      // (the exact lost-update race already fixed elsewhere this session for
      // consumeFeedFIFO and createSale).
      const [batch] = await tx.select({ id: batches.id, unitId: batches.unitId, currentQty: batches.currentQty, stage: batches.stage })
        .from(batches).where(and(eq(batches.tenantId, tid), eq(batches.id, batchId))).for('update').limit(1);
      if (!batch) throw new BatchNotFound();

      const qtyBefore = batch.currentQty;
      const qtyAfter = body.newQty != null && !isNaN(Number(body.newQty)) ? Math.max(0, Math.round(Number(body.newQty))) : qtyBefore;
      const toUnitId = body.toUnitId ? String(body.toUnitId) : null;
      const moving = !!toUnitId && toUnitId !== batch.unitId;

      if (qtyAfter > qtyBefore) {
        throw new AdvanceValidationError('The new count cannot be MORE than the current count — a move can only lose animals, not create them.');
      }

      // Lock every unit row this request touches up front, in a deterministic
      // (sorted-id) order — locking "from unit, then to unit" every time would let
      // two concurrent moves between the same pair of units in opposite directions
      // deadlock against each other.
      const unitIds = Array.from(new Set(moving ? [batch.unitId, toUnitId!] : [batch.unitId])).sort();
      const unitQtyById = new Map<string, number>();
      for (const uid of unitIds) {
        const [u] = await tx.select({ id: productionUnits.id, q: productionUnits.currentQty }).from(productionUnits)
          .where(and(eq(productionUnits.tenantId, tid), eq(productionUnits.id, uid))).for('update').limit(1);
        if (!u) {
          if (uid === toUnitId) throw new AdvanceValidationError('Unknown destination unit.');
          continue; // the batch's current unit failing to resolve isn't this route's concern
        }
        unitQtyById.set(uid, u.q ?? 0);
      }

      await tx.update(batches).set({
        stage: toStage, stageEnteredAt: new Date().toISOString().slice(0, 10),
        currentQty: qtyAfter, unitId: toUnitId ?? batch.unitId,
      }).where(and(eq(batches.tenantId, tid), eq(batches.id, batchId)));

      const bump = async (unitId: string, delta: number) => {
        if (!unitId || !delta) return;
        const cur = unitQtyById.get(unitId);
        if (cur === undefined) return;
        await tx.update(productionUnits).set({ currentQty: Math.max(0, cur + delta) })
          .where(and(eq(productionUnits.tenantId, tid), eq(productionUnits.id, unitId)));
      };
      if (moving) { await bump(batch.unitId, -qtyBefore); await bump(toUnitId!, qtyAfter); }
      else if (qtyAfter !== qtyBefore) { await bump(batch.unitId, qtyAfter - qtyBefore); }

      await tx.insert(batchStageEvents).values({
        id: crypto.randomUUID(), tenantId: tid, batchId,
        fromStage: batch.stage, toStage, fromUnitId: batch.unitId, toUnitId: toUnitId ?? batch.unitId,
        qtyBefore, qtyAfter, note: body.note ? String(body.note) : null,
        at: new Date().toISOString(), by: session.userId,
      });

      return { fromStage: batch.stage, fromUnitId: batch.unitId, qtyBefore, qtyAfter, toUnitId: toUnitId ?? batch.unitId };
    });
  } catch (err) {
    if (err instanceof BatchNotFound) return notFound();
    if (err instanceof AdvanceValidationError) return badRequest(err.message);
    throw err;
  }

  // Best-effort by design (lib/server/audit.ts) — never participates in the
  // transaction above, called only after it has durably committed.
  await audit({
    tenantId: tid, actor: actorLabel(session), action: 'batch.stage.advance', entity: batchId,
    before: { stage: result.fromStage, unitId: result.fromUnitId, qty: result.qtyBefore },
    after: { stage: toStage, unitId: result.toUnitId, qty: result.qtyAfter },
  });
  return ok({ id: batchId, stage: toStage, currentQty: result.qtyAfter, unitId: result.toUnitId });
}
