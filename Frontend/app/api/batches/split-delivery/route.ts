import { db } from '@/db';
import { batches, productionUnits, lifecycleStages } from '@/db/schemas';
import { and, eq } from 'drizzle-orm';
import { getSession } from '@/lib/server/session';
import { created, unauthorized, forbidden, badRequest, tooMany } from '@/lib/server/http';
import { parseBody, splitDeliverySchema } from '@/lib/server/validate';
import { toCents, fromCents } from '@/lib/server/money';
import { checkWriteRateLimit } from '@/lib/server/rateLimit';
import { createProductsForBatch, defaultsForBatch } from '@/lib/server/products';
import { defaultLiveWeightKg, enterpriseFromSpecies } from '@/lib/server/productTemplates';
import { defaultStages } from '@/lib/lifecycle';
import { audit, actorLabel } from '@/lib/server/audit';
import type { Role } from '@/lib/types';

const ALLOWED: Role[] = ['owner', 'manager'];

class UnknownUnitError extends Error {
  constructor(public unitId: string) { super(`Unknown unit "${unitId}".`); }
}

// POST /api/batches/split-delivery — one delivery, several units in one action
// (e.g. 3600 fries: 1200 into each of 3 tanks). Creates one ordinary
// single-unit batch per allocation (everything downstream — mortality, health
// records, sales, costing — keeps working exactly as it does for any other
// batch), tagged with a shared deliveryGroupId, with totalCost split
// proportionally to each allocation's share of totalQty.
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return unauthorized();
  const writeLimit = checkWriteRateLimit(req);
  if (!writeLimit.allowed) return tooMany('Too many requests.', writeLimit.retryAfter);
  if (!ALLOWED.includes(session.role)) return forbidden();

  const parsed = await parseBody(req, splitDeliverySchema);
  if ('error' in parsed) return parsed.error;
  const body = parsed.data;
  const now = new Date().toISOString();
  const acquiredDate = body.acquiredDate || now.slice(0, 10);
  const enterprise = body.enterprise || enterpriseFromSpecies(body.species) || null;
  const totalCostCents = toCents(body.totalCost);

  let createdIds: string[];
  try {
    createdIds = await db.transaction(async (tx) => {
      const groupId = crypto.randomUUID();
      const ids: string[] = [];
      let allocatedCents = 0;

      // First configured stage name for this enterprise — same lookup app/api/data/batches/route.ts
      // POST does, computed once here since every allocation shares the same species/enterprise.
      let initialStage: string | undefined;
      if (enterprise) {
        initialStage = (await tx.select({ name: lifecycleStages.name }).from(lifecycleStages)
          .where(and(eq(lifecycleStages.tenantId, session.tenantId), eq(lifecycleStages.enterprise, enterprise)))
          .orderBy(lifecycleStages.ord).limit(1))[0]?.name;
      }
      initialStage = initialStage || defaultStages(enterprise)[0]?.name || 'GROWING';

      for (const [idx, a] of body.allocations.entries()) {
        const isLast = idx === body.allocations.length - 1;
        // Exact-to-the-cent split: every allocation but the last gets its
        // proportional floor; the last absorbs the rounding remainder so the
        // sum always reconciles exactly to totalCost, never drifts by a cent.
        const shareCents = isLast ? totalCostCents - allocatedCents : Math.floor(totalCostCents * a.qty / body.totalQty);
        allocatedCents += shareCents;
        const shareCost = fromCents(shareCents);

        const [unit] = await tx.select({ id: productionUnits.id, currentQty: productionUnits.currentQty })
          .from(productionUnits)
          .where(and(eq(productionUnits.tenantId, session.tenantId), eq(productionUnits.id, a.unitId)))
          .for('update').limit(1);
        if (!unit) throw new UnknownUnitError(a.unitId);

        const id = crypto.randomUUID();
        await tx.insert(batches).values({
          id, tenantId: session.tenantId, unitId: a.unitId, name: body.name,
          species: body.species, enterprise, breed: body.breed ?? null, source: body.source,
          acquiredDate, ageAtAcquire: body.ageAtAcquire ?? 0,
          initialQty: a.qty, currentQty: a.qty, stage: initialStage, stageEnteredAt: acquiredDate,
          acquisitionCost: shareCost, acquisitionCostCents: shareCents,
          status: 'ACTIVE', avgWeightKg: defaultLiveWeightKg(body.species, enterprise),
          deliveryGroupId: groupId,
        });
        await tx.update(productionUnits).set({ currentQty: Math.max(0, (unit.currentQty ?? 0) + a.qty) })
          .where(and(eq(productionUnits.tenantId, session.tenantId), eq(productionUnits.id, a.unitId)));
        ids.push(id);
      }
      return ids;
    });
  } catch (err) {
    if (err instanceof UnknownUnitError) return badRequest(err.message);
    throw err;
  }

  // Same as the regular single-unit "Add Batch" flow — auto-create default
  // sellable products for each resulting batch, outside the qty/cost transaction.
  const defs = defaultsForBatch(body.species, body.enterprise || undefined);
  if (defs.length) await Promise.all(createdIds.map((id) => createProductsForBatch(session.tenantId, id, defs)));

  await audit({
    tenantId: session.tenantId, actor: actorLabel(session), action: 'batch.split_delivery',
    entity: createdIds[0], meta: { name: body.name, totalQty: body.totalQty, totalCost: body.totalCost, batchIds: createdIds },
  });

  return created({ batchIds: createdIds, count: createdIds.length });
}
