import { db } from '@/db';
import { records } from '@/db/schemas';
import { and, eq, like } from 'drizzle-orm';
import { getSession } from '@/lib/server/session';
import { ok, unauthorized } from '@/lib/server/http';

// GET /api/my-activity[?date=YYYY-MM-DD] — the SIGNED-IN worker's own records for the
// day, so the app can show "what you've already done today" and warn before a likely
// duplicate (e.g. feeding the same batch twice). Any signed-in user; self-scoped, so
// it leaks nothing about the farm. Reads the generic `records` table (every record
// type lands there) → a uniform {type, at, batchId} list the client summarises.
export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return unauthorized();

  const day = new URL(req.url).searchParams.get('date') || new Date().toISOString().slice(0, 10);
  const rows = await db
    .select({ type: records.type, capturedAt: records.capturedAt, payload: records.payload })
    .from(records)
    .where(and(eq(records.tenantId, session.tenantId), eq(records.createdBy, session.userId), like(records.capturedAt, `${day}%`)));

  const items = rows.map((r) => {
    const p = (r.payload ?? {}) as { batchId?: unknown };
    // A morning round covers every unit, so it isn't tied to one batch.
    const batchId = r.type === 'morning_round' || typeof p.batchId !== 'string' ? null : p.batchId;
    return { type: r.type, at: r.capturedAt, batchId };
  });
  return ok(items);
}
