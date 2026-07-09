import { db } from '@/db';
import { batches, productionUnits, lifecycleStages, sales, products, batchStageEvents, mortalityRecords, feedingRecords, healthRecords, productionRecords, laborLogs, physicalCounts, weightSamples, observations, tasks } from '@/db/schemas';
import { and, eq } from 'drizzle-orm';
import { getSession } from '@/lib/server/session';
import { ok, created, unauthorized, forbidden, notFound, badRequest, tooMany } from '@/lib/server/http';
import { parseBody, createBatchSchema } from '@/lib/server/validate';
import { toCents } from '@/lib/server/money';
import { checkWriteRateLimit } from '@/lib/server/rateLimit';
import { createProductsForBatch, defaultsForBatch } from '@/lib/server/products';
import { defaultLiveWeightKg, enterpriseFromSpecies } from '@/lib/server/productTemplates';
import { defaultStages } from '@/lib/lifecycle';
import { audit, actorLabel } from '@/lib/server/audit';

// POST /api/data/batches — create a new batch with lifecycle stage + auto-products.
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return unauthorized();
  const writeLimit = checkWriteRateLimit(req);
  if (!writeLimit.allowed) return tooMany(`Too many requests.`, writeLimit.retryAfter);
  if (session.role !== 'owner' && session.role !== 'manager') return forbidden();

  const parsed = await parseBody(req, createBatchSchema);
  if ('error' in parsed) return parsed.error;
  const body = parsed.data;
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  const [unit] = await db.select({ id: productionUnits.id }).from(productionUnits)
    .where(and(eq(productionUnits.tenantId, session.tenantId), eq(productionUnits.id, body.unitId))).limit(1);
  if (!unit) return badRequest('unknown unit');

  const qty = body.qty ?? body.quantity ?? 0;
  const acquiredDate = body.acquiredDate || now.slice(0, 10);
  const enterprise = body.enterprise || enterpriseFromSpecies(body.species) || null;

  let initialStage = body.stage;
  if (!initialStage) {
    const first = enterprise
      ? (await db.select({ name: lifecycleStages.name }).from(lifecycleStages)
          .where(and(eq(lifecycleStages.tenantId, session.tenantId), eq(lifecycleStages.enterprise, enterprise)))
          .orderBy(lifecycleStages.ord).limit(1))[0]?.name
      : undefined;
    initialStage = first || defaultStages(enterprise)[0]?.name || 'GROWING';
  }

  const acquisitionCost = body.cost ?? body.acquisitionCost ?? 0;
  await db.insert(batches).values({
    id, tenantId: session.tenantId, unitId: body.unitId, name: body.name,
    species: body.species, breed: body.breed ?? null, source: body.source,
    acquiredDate, ageAtAcquire: body.ageAtAcquire ?? 0,
    initialQty: qty, currentQty: qty, stage: initialStage, stageEnteredAt: acquiredDate,
    acquisitionCost, acquisitionCostCents: toCents(acquisitionCost),
    status: 'ACTIVE', avgWeightKg: defaultLiveWeightKg(body.species),
  });

  const defs = defaultsForBatch(body.species, body.enterprise || undefined);
  const prod = defs.length ? await createProductsForBatch(session.tenantId, id, defs) : [];
  return created({ id, products: prod.length });
}

// DELETE /api/data/batches?id=...&action=close — close or hard-delete a batch.
export async function DELETE(req: Request) {
  const session = await getSession();
  if (!session) return unauthorized();
  const writeLimit = checkWriteRateLimit(req);
  if (!writeLimit.allowed) return tooMany(`Too many requests.`, writeLimit.retryAfter);
  if (session.role !== 'owner' && session.role !== 'manager') return forbidden();

  const id = new URL(req.url).searchParams.get('id');
  if (!id) return badRequest('id required');
  const tid = session.tenantId;

  const [b] = await db.select({ id: batches.id, status: batches.status, currentQty: batches.currentQty, unitId: batches.unitId, name: batches.name })
    .from(batches).where(and(eq(batches.tenantId, tid), eq(batches.id, id))).limit(1);
  if (!b) return notFound();

  const isClose = new URL(req.url).searchParams.get('action') === 'close';

  if (isClose) {
    if (b.status === 'CLOSED') return badRequest('Batch is already closed.');
    if ((b.currentQty ?? 0) > 0 && b.unitId) {
      const [u] = await db.select({ q: productionUnits.currentQty }).from(productionUnits)
        .where(and(eq(productionUnits.tenantId, tid), eq(productionUnits.id, b.unitId))).limit(1);
      if (u) {
        await db.update(productionUnits).set({ currentQty: Math.max(0, (u.q ?? 0) - b.currentQty) })
          .where(and(eq(productionUnits.tenantId, tid), eq(productionUnits.id, b.unitId)));
      }
    }
    await db.update(batches).set({ status: 'CLOSED', stage: 'CLOSED' })
      .where(and(eq(batches.tenantId, tid), eq(batches.id, id)));
    await audit({ tenantId: tid, actor: actorLabel(session), action: 'batch.close', entity: id, before: { status: b.status }, after: { status: 'CLOSED' } });
    return ok({ id, closed: true });
  }

  // Hard-delete: check for related data first.
  const hasData = await Promise.all([
    db.select({ id: sales.id }).from(sales).where(and(eq(sales.tenantId, tid), eq(sales.batchId, id))).limit(1),
    db.select({ id: batchStageEvents.id }).from(batchStageEvents).where(and(eq(batchStageEvents.tenantId, tid), eq(batchStageEvents.batchId, id))).limit(1),
    db.select({ id: mortalityRecords.clientUuid }).from(mortalityRecords).where(and(eq(mortalityRecords.tenantId, tid), eq(mortalityRecords.batchId, id))).limit(1),
    db.select({ id: feedingRecords.clientUuid }).from(feedingRecords).where(and(eq(feedingRecords.tenantId, tid), eq(feedingRecords.batchId, id))).limit(1),
    db.select({ id: healthRecords.clientUuid }).from(healthRecords).where(and(eq(healthRecords.tenantId, tid), eq(healthRecords.batchId, id))).limit(1),
    db.select({ id: productionRecords.clientUuid }).from(productionRecords).where(and(eq(productionRecords.tenantId, tid), eq(productionRecords.batchId, id))).limit(1),
    db.select({ id: laborLogs.clientUuid }).from(laborLogs).where(and(eq(laborLogs.tenantId, tid), eq(laborLogs.batchId, id))).limit(1),
    db.select({ id: physicalCounts.clientUuid }).from(physicalCounts).where(and(eq(physicalCounts.tenantId, tid), eq(physicalCounts.batchId, id))).limit(1),
    db.select({ id: weightSamples.clientUuid }).from(weightSamples).where(and(eq(weightSamples.tenantId, tid), eq(weightSamples.batchId, id))).limit(1),
    db.select({ id: observations.clientUuid }).from(observations).where(and(eq(observations.tenantId, tid), eq(observations.batchId, id))).limit(1),
    db.select({ id: tasks.id }).from(tasks).where(and(eq(tasks.tenantId, tid), eq(tasks.batchId, id))).limit(1),
  ]);
  if (hasData.some(([r]) => r)) return badRequest('Batch has sales or activity — close it instead of deleting.');

  await db.delete(products).where(and(eq(products.tenantId, tid), eq(products.batchId, id)));
  await db.delete(batchStageEvents).where(and(eq(batchStageEvents.tenantId, tid), eq(batchStageEvents.batchId, id)));
  await db.delete(batches).where(and(eq(batches.tenantId, tid), eq(batches.id, id)));
  await audit({ tenantId: tid, actor: actorLabel(session), action: 'batch.delete', entity: id, before: { name: b.name }, after: null });
  return ok({ id, deleted: true });
}
