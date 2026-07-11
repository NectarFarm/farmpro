import { db } from '@/db';
import { physicalCounts, batches, productionUnits } from '@/db/schemas';
import { and, eq, desc } from 'drizzle-orm';
import { getSession } from '@/lib/server/session';
import { audit, actorLabel } from '@/lib/server/audit';
import { ok, badRequest, unauthorized, forbidden, notFound } from '@/lib/server/http';
import { parseBody, physicalCountSchema } from '@/lib/server/validate';
import { readRateLimited, writeRateLimited } from '@/lib/server/rateLimit';
import type { Role } from '@/lib/types';

const ALLOWED: Role[] = ['owner', 'manager'];

// Thrown inside the transaction below and translated back to the matching HTTP
// response outside it — the transaction either fully commits or fully rolls
// back, never leaving the count reconciled without the qty change applied (or
// vice versa).
class NotFoundMarker extends Error {}
class AlreadyHandledMarker extends Error {}
class BatchGoneMarker extends Error {}

// GET /api/physical-counts — pending (unreconciled) head counts for the owner to act on,
// newest first, with the batch name for display.
export async function GET(req: Request) {
  const limited = readRateLimited(req);
  if (limited) return limited;
  const session = await getSession();
  if (!session) return unauthorized();
  if (!ALLOWED.includes(session.role)) return forbidden();

  const rows = await db.select().from(physicalCounts)
    .where(and(eq(physicalCounts.tenantId, session.tenantId), eq(physicalCounts.reconciled, false)))
    .orderBy(desc(physicalCounts.capturedAt));
  const bs = await db.select({ id: batches.id, name: batches.name }).from(batches).where(eq(batches.tenantId, session.tenantId));
  const nameOf = (id: string) => bs.find((b) => b.id === id)?.name ?? id;
  return ok(rows.map((c) => ({ ...c, batchName: nameOf(c.batchId) })));
}

// POST /api/physical-counts  { action: 'apply' | 'dismiss', id }
// apply  → set the batch's live count to the worker's count, shift the unit by the same
//          delta, write an audit row, and mark the count reconciled.
// dismiss→ just mark it reconciled (keep the system count).
export async function POST(req: Request) {
  const limited = writeRateLimited(req);
  if (limited) return limited;
  const session = await getSession();
  if (!session) return unauthorized();
  if (!ALLOWED.includes(session.role)) return forbidden();

  const parsed = await parseBody(req, physicalCountSchema);
  if ('error' in parsed) return parsed.error;
  const body = parsed.data;
  const id = body.id;
  const action = body.action;

  let auditPayload: { batchId: string; before: number; after: number; variance: number; reason: string | null } | null = null;
  try {
    await db.transaction(async (tx) => {
      // Locked — without this, two concurrent `apply` calls for the same count
      // could both pass the `reconciled` check below and both apply the qty
      // delta, double-counting the correction.
      const [count] = await tx.select().from(physicalCounts)
        .where(and(eq(physicalCounts.tenantId, session.tenantId), eq(physicalCounts.clientUuid, id))).for('update').limit(1);
      if (!count) throw new NotFoundMarker();
      if (count.reconciled) throw new AlreadyHandledMarker();

      if (action === 'apply') {
        const [batch] = await tx.select({ id: batches.id, currentQty: batches.currentQty, unitId: batches.unitId })
          .from(batches).where(and(eq(batches.tenantId, session.tenantId), eq(batches.id, count.batchId))).for('update').limit(1);
        if (!batch) throw new BatchGoneMarker();

        const delta = count.physicalCount - batch.currentQty; // shift applied to the unit too
        await tx.update(batches).set({ currentQty: Math.max(0, count.physicalCount) })
          .where(and(eq(batches.tenantId, session.tenantId), eq(batches.id, batch.id)));
        if (batch.unitId) {
          const [u] = await tx.select({ q: productionUnits.currentQty }).from(productionUnits)
            .where(and(eq(productionUnits.tenantId, session.tenantId), eq(productionUnits.id, batch.unitId))).for('update').limit(1);
          if (u) await tx.update(productionUnits).set({ currentQty: Math.max(0, (u.q ?? 0) + delta) })
            .where(and(eq(productionUnits.tenantId, session.tenantId), eq(productionUnits.id, batch.unitId)));
        }
        auditPayload = { batchId: batch.id, before: batch.currentQty, after: count.physicalCount, variance: count.variance, reason: count.reason ?? null };
      }

      await tx.update(physicalCounts).set({ reconciled: true })
        .where(and(eq(physicalCounts.tenantId, session.tenantId), eq(physicalCounts.clientUuid, id)));
    });
  } catch (err) {
    if (err instanceof NotFoundMarker) return notFound();
    if (err instanceof AlreadyHandledMarker) return badRequest('This count has already been handled.');
    if (err instanceof BatchGoneMarker) return badRequest('The batch for this count no longer exists.');
    throw err;
  }

  if (auditPayload) {
    const p: { batchId: string; before: number; after: number; variance: number; reason: string | null } = auditPayload;
    await audit({
      tenantId: session.tenantId, actor: actorLabel(session), action: 'batch.reconcile.headcount', entity: p.batchId,
      before: { currentQty: p.before }, after: { currentQty: p.after, variance: p.variance, reason: p.reason },
    });
  }
  return ok({ id, action });
}
