import { db } from '@/db';
import { batches, productionUnits, batchStageEvents } from '@/db/schemas';
import { and, eq } from 'drizzle-orm';
import { getSession } from '@/lib/server/session';
import { audit, actorLabel } from '@/lib/server/audit';
import { ok, badRequest, unauthorized, forbidden, notFound } from '@/lib/server/http';
import type { Role } from '@/lib/types';

const ALLOWED: Role[] = ['owner', 'manager'];

// POST /api/batches/advance  { batchId, toStage, toUnitId?, newQty?, note? }
// Advance a batch's lifecycle stage and/or MOVE it to another unit, optionally
// adjusting the head count for the move (e.g. 120 eggs → 98 chicks, or transfer loss).
// Keeps both unit occupancies in step, records a transition event, and audits it.
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return unauthorized();
  if (!ALLOWED.includes(session.role)) return forbidden();
  const tid = session.tenantId;

  const body = (await req.json().catch(() => ({}))) as { batchId?: string; toStage?: string; toUnitId?: string; newQty?: unknown; note?: string };
  const batchId = (body.batchId ?? '').trim();
  const toStage = (body.toStage ?? '').trim();
  if (!batchId || !toStage) return badRequest('batchId and toStage required');

  const [batch] = await db.select({ id: batches.id, unitId: batches.unitId, currentQty: batches.currentQty, stage: batches.stage })
    .from(batches).where(and(eq(batches.tenantId, tid), eq(batches.id, batchId))).limit(1);
  if (!batch) return notFound();

  const qtyBefore = batch.currentQty;
  const qtyAfter = body.newQty != null && !isNaN(Number(body.newQty)) ? Math.max(0, Math.round(Number(body.newQty))) : qtyBefore;
  const toUnitId = body.toUnitId ? String(body.toUnitId) : null;
  const moving = !!toUnitId && toUnitId !== batch.unitId;

  if (qtyAfter > qtyBefore) return badRequest('The new count cannot be MORE than the current count — a move can only lose animals, not create them.');
  if (moving) {
    const [dest] = await db.select({ id: productionUnits.id }).from(productionUnits)
      .where(and(eq(productionUnits.tenantId, tid), eq(productionUnits.id, toUnitId!))).limit(1);
    if (!dest) return badRequest('Unknown destination unit.');
  }

  await db.update(batches).set({
    stage: toStage, stageEnteredAt: new Date().toISOString().slice(0, 10),
    currentQty: qtyAfter, unitId: toUnitId ?? batch.unitId,
  }).where(and(eq(batches.tenantId, tid), eq(batches.id, batchId)));

  const bump = async (unitId: string, delta: number) => {
    if (!unitId || !delta) return;
    const [u] = await db.select({ q: productionUnits.currentQty }).from(productionUnits)
      .where(and(eq(productionUnits.tenantId, tid), eq(productionUnits.id, unitId))).limit(1);
    if (u) await db.update(productionUnits).set({ currentQty: Math.max(0, (u.q ?? 0) + delta) })
      .where(and(eq(productionUnits.tenantId, tid), eq(productionUnits.id, unitId)));
  };
  if (moving) { await bump(batch.unitId, -qtyBefore); await bump(toUnitId!, qtyAfter); }
  else if (qtyAfter !== qtyBefore) { await bump(batch.unitId, qtyAfter - qtyBefore); }

  await db.insert(batchStageEvents).values({
    id: crypto.randomUUID(), tenantId: tid, batchId,
    fromStage: batch.stage, toStage, fromUnitId: batch.unitId, toUnitId: toUnitId ?? batch.unitId,
    qtyBefore, qtyAfter, note: body.note ? String(body.note) : null,
    at: new Date().toISOString(), by: session.userId,
  });
  await audit({
    tenantId: tid, actor: actorLabel(session), action: 'batch.stage.advance', entity: batchId,
    before: { stage: batch.stage, unitId: batch.unitId, qty: qtyBefore },
    after: { stage: toStage, unitId: toUnitId ?? batch.unitId, qty: qtyAfter },
  });
  return ok({ id: batchId, stage: toStage, currentQty: qtyAfter, unitId: toUnitId ?? batch.unitId });
}
