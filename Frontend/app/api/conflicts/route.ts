import { db } from '@/db';
import { conflictLog, productionRecords } from '@/db/schemas';
import { and, eq, inArray } from 'drizzle-orm';
import { getSession } from '@/lib/server/session';
import { audit, actorLabel } from '@/lib/server/audit';
import { ok, badRequest, unauthorized, forbidden, notFound } from '@/lib/server/http';
import type { Role } from '@/lib/types';

const ALLOWED: Role[] = ['owner', 'manager'];

// GET /api/conflicts — sync edit-conflicts still awaiting the owner's review. Two
// workers recorded the same day's production for a batch; the server kept one
// (last-write-wins) and logged the loser. The owner can accept or override.
export async function GET() {
  const session = await getSession();
  if (!session) return unauthorized();
  if (!ALLOWED.includes(session.role)) return forbidden();
  const rows = (await db.select().from(conflictLog).where(and(eq(conflictLog.tenantId, session.tenantId), eq(conflictLog.reviewed, false))))
    .sort((a, b) => ((a.capturedAtServer ?? '') < (b.capturedAtServer ?? '') ? 1 : -1));
  return ok(rows.map((c) => ({
    id: c.id, recordType: c.recordType, recordId: c.recordId,
    myVersion: c.myVersion, serverVersion: c.serverVersion,
    capturedAtMine: c.capturedAtMine, capturedAtServer: c.capturedAtServer, resolution: c.resolution,
  })));
}

// POST /api/conflicts { id, resolution: 'kept_mine' | 'kept_server' | 'accept' }
// accept → keep the auto (last-write-wins) result, just mark reviewed.
// kept_mine/kept_server → OVERRIDE: set the surviving production record's quantity to
// the chosen version, then mark reviewed. Idempotent-safe (reviewed guards re-apply).
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return unauthorized();
  if (!ALLOWED.includes(session.role)) return forbidden();
  const tid = session.tenantId;

  const body = (await req.json().catch(() => ({}))) as { id?: string; resolution?: string };
  const id = (body.id ?? '').trim();
  const resolution = body.resolution ?? 'accept';
  if (!id) return badRequest('id required');
  if (!['accept', 'kept_mine', 'kept_server'].includes(resolution)) return badRequest('bad resolution');

  const [c] = await db.select().from(conflictLog).where(and(eq(conflictLog.tenantId, tid), eq(conflictLog.id, id))).limit(1);
  if (!c) return notFound();
  if (c.reviewed) return badRequest('This conflict has already been reviewed.');

  if (resolution !== 'accept' && c.recordType === 'production') {
    const chosen = (resolution === 'kept_mine' ? c.myVersion : c.serverVersion) as { qty?: unknown } | null;
    const qty = Number(chosen?.qty);
    // Scope the override to the exact record(s) this conflict was about — the incoming
    // ("mine") and the pre-existing ("server") clientUuids stashed on the conflict row —
    // never a day-wide pattern, so other legitimate same-day entries are untouched.
    // Only one of the two survives in the table (handleProduction deleted or never
    // inserted the loser), so this updates exactly that one row.
    const myUuid = (c.myVersion as { clientUuid?: unknown } | null)?.clientUuid;
    const serverUuid = (c.serverVersion as { clientUuid?: unknown } | null)?.clientUuid;
    const targets = [myUuid, serverUuid].filter((u): u is string => typeof u === 'string' && u.length > 0);
    if (targets.length && Number.isFinite(qty)) {
      await db.update(productionRecords).set({ qty })
        .where(and(eq(productionRecords.tenantId, tid), inArray(productionRecords.clientUuid, targets)));
    }
  }

  await db.update(conflictLog).set({ reviewed: true, resolution, resolvedAt: new Date().toISOString() })
    .where(and(eq(conflictLog.tenantId, tid), eq(conflictLog.id, id)));
  await audit({ tenantId: tid, actor: actorLabel(session), action: 'conflict.review', entity: c.recordId ?? id, after: { resolution } });
  return ok({ id, resolution });
}
