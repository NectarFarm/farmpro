import { db } from '@/db';
import { batches, productionUnits, lifecycleStages, sales, products, batchStageEvents, mortalityRecords, feedingRecords, healthRecords, productionRecords, laborLogs, physicalCounts, weightSamples, observations, tasks } from '@/db/schemas';
import { and, eq, asc } from 'drizzle-orm';
import { getSession } from '@/lib/server/session';
import { ok, created, unauthorized, forbidden, notFound, badRequest, tooMany } from '@/lib/server/http';
import { parseBody, createBatchSchema } from '@/lib/server/validate';
import { toCents } from '@/lib/server/money';
import { checkWriteRateLimit, checkReadRateLimit } from '@/lib/server/rateLimit';
import { createProductsForBatch, defaultsForBatch } from '@/lib/server/products';
import { defaultLiveWeightKg, enterpriseFromSpecies } from '@/lib/server/productTemplates';
import { defaultStages } from '@/lib/lifecycle';
import { audit, actorLabel } from '@/lib/server/audit';
import { vetAssignedBatchIds } from '@/lib/server/resources';
import { hiddenFieldKeysFor, stripForRead } from '@/lib/server/fieldPermissions';

// Thrown inside a transaction below and translated back to the matching HTTP
// response outside it.
class UnknownUnitError extends Error {}
class BatchGoneError extends Error {}
class AlreadyClosedError extends Error {}

// GET /api/data/batches[?id=]  — this is a static route, so it shadows
// app/api/data/[resource]/route.ts's GET for this exact path (Next.js prefers
// a static segment match over a dynamic one) — that catch-all's GET (including
// its FR-M5-5 vet-scoping branch) is never reached for 'batches' once this file
// exists, so it must handle GET itself, vet-scoping included.
export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return unauthorized();
  const readLimit = checkReadRateLimit(req);
  if (!readLimit.allowed) return tooMany(`Too many requests.`, readLimit.retryAfter);

  const url = new URL(req.url);
  const id = url.searchParams.get('id');
  const hidden = await hiddenFieldKeysFor(session);

  // FR-M5-5: a vet sees only their assigned batches.
  if (session.role === 'vet') {
    const assigned = await vetAssignedBatchIds(session);
    const rows = await db.select().from(batches).where(eq(batches.tenantId, session.tenantId));
    const scoped = assigned ? rows.filter((b) => assigned.includes(b.id)) : rows;
    const filtered = stripForRead('batches', scoped as unknown as Record<string, unknown>[], hidden);
    if (id) {
      const one = filtered.find((r) => r.id === id);
      return one ? ok(one) : notFound();
    }
    return ok(filtered);
  }

  if (id) {
    const [row] = await db.select().from(batches)
      .where(and(eq(batches.tenantId, session.tenantId), eq(batches.id, id))).limit(1);
    if (!row) return notFound();
    return ok(stripForRead('batches', [row as unknown as Record<string, unknown>], hidden)[0]);
  }

  const limitParam = Number(url.searchParams.get('limit'));
  let limit: number | undefined;
  if (limitParam === 0) limit = undefined;
  else if (Number.isFinite(limitParam) && limitParam > 0) limit = Math.min(5000, Math.floor(limitParam));
  else limit = 2000;
  const offsetParam = Number(url.searchParams.get('offset'));
  const offset = Number.isFinite(offsetParam) && offsetParam > 0 ? Math.floor(offsetParam) : 0;

  const baseQuery = db.select().from(batches).where(eq(batches.tenantId, session.tenantId)).orderBy(asc(batches.id));
  const rows = limit != null ? await baseQuery.limit(limit).offset(offset) : await baseQuery;
  return ok(stripForRead('batches', rows as unknown as Record<string, unknown>[], hidden));
}

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

  const qty = body.qty ?? body.quantity ?? 0;
  const acquiredDate = body.acquiredDate || now.slice(0, 10);
  const enterprise = body.enterprise || enterpriseFromSpecies(body.species) || null;
  const acquisitionCost = body.cost ?? body.acquisitionCost ?? 0;

  try {
    await db.transaction(async (tx) => {
      // Locked — the new batch's headcount is folded into this unit's cached
      // currentQty below, in the same transaction, so a concurrent request
      // touching the same unit (another batch creation, a sale, an advance)
      // serializes against this instead of racing it. Every OTHER path that
      // changes a batch's qty already keeps productionUnits.currentQty in step;
      // creation was the one path that left it untouched, so a fresh unit
      // stayed at 0 while the Farm page's own live recompute (summing batch
      // quantities) showed the real number.
      const [unit] = await tx.select({ id: productionUnits.id, currentQty: productionUnits.currentQty }).from(productionUnits)
        .where(and(eq(productionUnits.tenantId, session.tenantId), eq(productionUnits.id, body.unitId))).for('update').limit(1);
      if (!unit) throw new UnknownUnitError();

      let initialStage = body.stage;
      if (!initialStage) {
        const first = enterprise
          ? (await tx.select({ name: lifecycleStages.name }).from(lifecycleStages)
              .where(and(eq(lifecycleStages.tenantId, session.tenantId), eq(lifecycleStages.enterprise, enterprise)))
              .orderBy(lifecycleStages.ord).limit(1))[0]?.name
          : undefined;
        initialStage = first || defaultStages(enterprise)[0]?.name || 'GROWING';
      }

      await tx.insert(batches).values({
        id, tenantId: session.tenantId, unitId: body.unitId, name: body.name,
        species: body.species, breed: body.breed ?? null, source: body.source,
        acquiredDate, ageAtAcquire: body.ageAtAcquire ?? 0,
        initialQty: qty, currentQty: qty, stage: initialStage, stageEnteredAt: acquiredDate,
        acquisitionCost, acquisitionCostCents: toCents(acquisitionCost),
        status: 'ACTIVE', avgWeightKg: defaultLiveWeightKg(body.species),
      });

      if (qty > 0) {
        await tx.update(productionUnits).set({ currentQty: Math.max(0, (unit.currentQty ?? 0) + qty) })
          .where(and(eq(productionUnits.tenantId, session.tenantId), eq(productionUnits.id, body.unitId)));
      }
    });
  } catch (err) {
    if (err instanceof UnknownUnitError) return badRequest('unknown unit');
    throw err;
  }

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
    let closedFromStatus: string;
    try {
      closedFromStatus = await db.transaction(async (tx) => {
        // Re-select with a lock inside the transaction — the earlier unlocked
        // `[b]` read above is shared with the hard-delete branch below and is
        // fine for that branch's own multi-table existence checks, but closing
        // also adjusts the unit's currentQty and must serialize against a
        // concurrent sale/advance/count touching the same batch or unit.
        const [locked] = await tx.select({ id: batches.id, status: batches.status, currentQty: batches.currentQty, unitId: batches.unitId })
          .from(batches).where(and(eq(batches.tenantId, tid), eq(batches.id, id))).for('update').limit(1);
        if (!locked) throw new BatchGoneError();
        if (locked.status === 'CLOSED') throw new AlreadyClosedError();

        if ((locked.currentQty ?? 0) > 0 && locked.unitId) {
          const [u] = await tx.select({ q: productionUnits.currentQty }).from(productionUnits)
            .where(and(eq(productionUnits.tenantId, tid), eq(productionUnits.id, locked.unitId))).for('update').limit(1);
          if (u) {
            await tx.update(productionUnits).set({ currentQty: Math.max(0, (u.q ?? 0) - locked.currentQty) })
              .where(and(eq(productionUnits.tenantId, tid), eq(productionUnits.id, locked.unitId)));
          }
        }
        await tx.update(batches).set({ status: 'CLOSED', stage: 'CLOSED', stageEnteredAt: new Date().toISOString().slice(0, 10) })
          .where(and(eq(batches.tenantId, tid), eq(batches.id, id)));
        return locked.status;
      });
    } catch (err) {
      if (err instanceof BatchGoneError) return notFound();
      if (err instanceof AlreadyClosedError) return badRequest('Batch is already closed.');
      throw err;
    }
    await audit({ tenantId: tid, actor: actorLabel(session), action: 'batch.close', entity: id, before: { status: closedFromStatus }, after: { status: 'CLOSED' } });
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
