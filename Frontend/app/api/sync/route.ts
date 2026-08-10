import { db } from '@/db';
import { records } from '@/db/schemas';
import { getSession } from '@/lib/server/session';
import { ok, unauthorized, badRequest, tooMany } from '@/lib/server/http';
import { checkWriteRateLimit } from '@/lib/server/rateLimit';
import { syncBodySchema } from '@/lib/server/validate';
import { routeTyped, type IncomingRecord } from '@/lib/server/syncHandlers';
import { withErrorLogging } from '@/lib/server/apiErrorHandler';

// POST /api/sync  { records: IncomingRecord[] }
// Idempotent by clientUuid (FR-M17-5). Production records additionally get true
// edit-conflict detection (FR-M17-3); conflicts are returned for the client to surface.
async function postHandler(req: Request) {
  const session = await getSession();
  if (!session) return unauthorized();

  const writeLimit = checkWriteRateLimit(req);
  if (!writeLimit.allowed) {
    return tooMany(`Too many sync requests. Try again in ${writeLimit.retryAfter} seconds.`, writeLimit.retryAfter);
  }

  const raw = await req.json().catch(() => null);
  const parsed = syncBodySchema.safeParse(raw);
  if (!parsed.success) {
    return badRequest(parsed.error.issues[0]?.message ?? 'records[] required (max 200)');
  }
  const incoming = parsed.data.records;

  let accepted = 0;
  const conflicts: Array<{ clientUuid: string; recordType: string; resolution: string }> = [];
  const rejected: Array<{ clientUuid: string; error: string }> = [];

  for (const r of incoming) {
    if (!r.clientUuid || !r.type) continue;
    const cap = r.capturedAt ?? new Date().toISOString();

    // One transaction per record: the generic audit insert + its typed row + typed
    // side-effect (stock draw-down / population decrement / conflict resolution) all
    // commit together or not at all. A crash mid-record can no longer leave a record
    // saved with its stock/population side-effect silently skipped. Records stay
    // independent of each other so one bad record in a batch doesn't roll back the
    // ones already accepted before it.
    try {
      const res = await db.transaction(async (tx) => {
        await tx.insert(records).values({
          clientUuid: r.clientUuid, tenantId: session.tenantId, type: r.type,
          payload: r.payload ?? {}, capturedAt: cap, createdBy: session.userId,
        }).onConflictDoNothing({ target: records.clientUuid });

        return routeTyped(
          { clientUuid: r.clientUuid, type: r.type, payload: r.payload ?? {}, capturedAt: cap },
          session.tenantId,
          session.userId,
          tx,
        );
      });

      if (res.conflict) conflicts.push(res.conflict);
      accepted++;
    } catch (e) {
      rejected.push({
        clientUuid: r.clientUuid,
        error: e instanceof Error ? e.message : 'Record rejected',
      });
    }
  }

  return ok({ accepted, conflicts, rejected });
}

export const POST = withErrorLogging('POST /api/sync', postHandler);
