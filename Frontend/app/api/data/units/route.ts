import { db } from '@/db';
import { productionUnits, batches } from '@/db/schemas';
import { and, eq, asc } from 'drizzle-orm';
import { getSession } from '@/lib/server/session';
import { ok, created, unauthorized, forbidden, notFound, badRequest, tooMany } from '@/lib/server/http';
import { parseBody, createUnitSchema } from '@/lib/server/validate';
import { checkWriteRateLimit, checkReadRateLimit } from '@/lib/server/rateLimit';
import { audit, actorLabel } from '@/lib/server/audit';
import { hiddenFieldKeysFor, stripForRead } from '@/lib/server/fieldPermissions';

// GET /api/data/units[?id=]  — this is a static route, so it shadows
// app/api/data/[resource]/route.ts's GET for this exact path (Next.js prefers
// a static segment match over a dynamic one) — that catch-all's GET is never
// reached for 'units' once this file exists, so it must handle GET itself.
export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return unauthorized();
  const readLimit = checkReadRateLimit(req);
  if (!readLimit.allowed) return tooMany(`Too many requests.`, readLimit.retryAfter);

  const url = new URL(req.url);
  const id = url.searchParams.get('id');
  const hidden = await hiddenFieldKeysFor(session);

  if (id) {
    const [row] = await db.select().from(productionUnits)
      .where(and(eq(productionUnits.tenantId, session.tenantId), eq(productionUnits.id, id))).limit(1);
    if (!row) return notFound();
    return ok(stripForRead('units', [row as unknown as Record<string, unknown>], hidden)[0]);
  }

  const limitParam = Number(url.searchParams.get('limit'));
  let limit: number | undefined;
  if (limitParam === 0) limit = undefined;
  else if (Number.isFinite(limitParam) && limitParam > 0) limit = Math.min(5000, Math.floor(limitParam));
  else limit = 2000;
  const offsetParam = Number(url.searchParams.get('offset'));
  const offset = Number.isFinite(offsetParam) && offsetParam > 0 ? Math.floor(offsetParam) : 0;

  const baseQuery = db.select().from(productionUnits).where(eq(productionUnits.tenantId, session.tenantId)).orderBy(asc(productionUnits.id));
  const rows = limit != null ? await baseQuery.limit(limit).offset(offset) : await baseQuery;
  return ok(stripForRead('units', rows as unknown as Record<string, unknown>[], hidden));
}

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
