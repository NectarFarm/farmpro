import { db } from '@/db';
import { productionUnits, batches } from '@/db/schemas';
import { and, eq } from 'drizzle-orm';
import { getSession } from '@/lib/server/session';
import { ok, created, unauthorized, forbidden, notFound, badRequest, tooMany } from '@/lib/server/http';
import { parseBody, createUnitSchema } from '@/lib/server/validate';
import { checkWriteRateLimit } from '@/lib/server/rateLimit';
import { audit, actorLabel } from '@/lib/server/audit';

// POST /api/data/units — create a new production unit.
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return unauthorized();
  const writeLimit = checkWriteRateLimit(req);
  if (!writeLimit.allowed) return tooMany(`Too many requests.`, writeLimit.retryAfter);
  if (session.role !== 'owner' && session.role !== 'manager') return forbidden();

  const parsed = await parseBody(req, createUnitSchema);
  if ('error' in parsed) return parsed.error;
  const body = parsed.data;

  const id = crypto.randomUUID();
  await db.insert(productionUnits).values({
    id, tenantId: session.tenantId, farmId: 'f1', type: body.type, name: body.name,
    code: body.name.slice(0, 10), capacity: body.capacity, status: 'ACTIVE', currentQty: 0,
    species: body.species ?? null,
  });
  return created({ id });
}

// DELETE /api/data/units?id=... — hard-delete an empty unit.
export async function DELETE(req: Request) {
  const session = await getSession();
  if (!session) return unauthorized();
  const writeLimit = checkWriteRateLimit(req);
  if (!writeLimit.allowed) return tooMany(`Too many requests.`, writeLimit.retryAfter);
  if (session.role !== 'owner' && session.role !== 'manager') return forbidden();

  const id = new URL(req.url).searchParams.get('id');
  if (!id) return badRequest('id required');
  const tid = session.tenantId;

  const [u] = await db.select({ id: productionUnits.id, currentQty: productionUnits.currentQty })
    .from(productionUnits).where(and(eq(productionUnits.tenantId, tid), eq(productionUnits.id, id))).limit(1);
  if (!u) return notFound();
  if ((u.currentQty ?? 0) > 0) return badRequest('Cannot delete a unit that still has animals. Remove or close all batches first.');

  const activeBatches = await db.select({ id: batches.id }).from(batches)
    .where(and(eq(batches.tenantId, tid), eq(batches.unitId, id), eq(batches.status, 'ACTIVE'))).limit(1);
  if (activeBatches.length > 0) return badRequest('Cannot delete a unit with active batches. Close all batches first.');

  await db.delete(productionUnits).where(and(eq(productionUnits.tenantId, tid), eq(productionUnits.id, id)));
  await audit({ tenantId: tid, actor: actorLabel(session), action: 'unit.delete', entity: id, before: { id }, after: null });
  return ok({ id, deleted: true });
}
