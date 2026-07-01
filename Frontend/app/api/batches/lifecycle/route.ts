import { db } from '@/db';
import { batches, lifecycleStages, batchStageEvents, productionUnits } from '@/db/schemas';
import { and, eq } from 'drizzle-orm';
import { getSession } from '@/lib/server/session';
import { enterpriseFromSpecies } from '@/lib/server/productTemplates';
import { ageDays, dueToAdvance } from '@/lib/lifecycle';
import { ok, badRequest, unauthorized, forbidden, notFound } from '@/lib/server/http';
import type { Role } from '@/lib/types';

const ALLOWED: Role[] = ['owner', 'manager', 'vet', 'auditor'];

// GET /api/batches/lifecycle?batchId= — everything the batch page needs to show the
// lifecycle: the configured stages, the batch's age, the current stage, whether it's
// due to move, the transition history, and the units it can move to.
export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return unauthorized();
  if (!ALLOWED.includes(session.role)) return forbidden();
  const batchId = new URL(req.url).searchParams.get('batchId');
  if (!batchId) return badRequest('batchId required');

  const [b] = await db.select().from(batches).where(and(eq(batches.tenantId, session.tenantId), eq(batches.id, batchId))).limit(1);
  if (!b) return notFound();

  const enterprise = enterpriseFromSpecies(b.species);
  const stages = enterprise
    ? (await db.select().from(lifecycleStages).where(and(eq(lifecycleStages.tenantId, session.tenantId), eq(lifecycleStages.enterprise, enterprise))))
        .sort((a, c) => a.ord - c.ord).map((s) => ({ name: s.name, startDay: s.startDay }))
    : [];
  const age = ageDays(b.acquiredDate, b.ageAtAcquire ?? 0);
  const due = dueToAdvance(stages, b.stage, age);
  const events = (await db.select().from(batchStageEvents).where(and(eq(batchStageEvents.tenantId, session.tenantId), eq(batchStageEvents.batchId, batchId))))
    .sort((a, c) => (a.at < c.at ? 1 : -1));
  const units = await db.select({ id: productionUnits.id, name: productionUnits.name }).from(productionUnits).where(eq(productionUnits.tenantId, session.tenantId));

  return ok({
    enterprise, stage: b.stage, stageEnteredAt: b.stageEnteredAt, age, stages, due, unitId: b.unitId,
    events: events.map((e) => ({ fromStage: e.fromStage, toStage: e.toStage, fromUnitId: e.fromUnitId, toUnitId: e.toUnitId, qtyBefore: e.qtyBefore, qtyAfter: e.qtyAfter, note: e.note, at: e.at })),
    units: units.map((u) => ({ id: u.id, name: u.name })),
  });
}
