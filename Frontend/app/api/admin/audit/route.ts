import { db } from '@/db';
import { auditLog, tenants } from '@/db/schemas';
import { desc, eq } from 'drizzle-orm';
import { getSession } from '@/lib/server/session';
import { DEFAULT_LIST_LIMIT, MAX_LIMIT } from '@/lib/server/validate';
import { ok, unauthorized, forbidden } from '@/lib/server/http';
import { readRateLimited } from '@/lib/server/rateLimit';

// GET /api/admin/audit?tenantId=&limit=  — the system audit trail (super_admin).
// Optional ?tenantId filters to one farm (entries persist even after a farm is
// deleted, so its history is never lost). Returns farms for the filter dropdown.
export async function GET(req: Request) {
  const limited = readRateLimited(req);
  if (limited) return limited;
  const session = await getSession();
  if (!session) return unauthorized();
  if (session.role !== 'super_admin') return forbidden();

  const url = new URL(req.url);
  const tenantId = url.searchParams.get('tenantId');
  const limitParam = Number(url.searchParams.get('limit'));
  const limit = limitParam === 0 ? undefined : Math.min(MAX_LIMIT, Math.max(1, limitParam || DEFAULT_LIST_LIMIT));

  const base = db.select().from(auditLog);
  const rows = await (tenantId ? base.where(eq(auditLog.tenantId, tenantId)) : base)
    .orderBy(desc(auditLog.at)).limit(limit ?? 1000000);

  // Farm names for display + the filter (audit rows may reference deleted farms).
  const ts = await db.select({ id: tenants.id, name: tenants.name }).from(tenants);
  const nameOf = new Map(ts.map((t) => [t.id, t.name]));

  return ok({
    farms: ts.map((t) => ({ id: t.id, name: t.name })),
    entries: rows.map((r) => ({
      id: r.id, tenantId: r.tenantId,
      farm: nameOf.get(r.tenantId) ?? (r.tenantId === 'platform' ? 'Platform' : `${r.tenantId} (deleted)`),
      actor: r.actor, action: r.action, entity: r.entity,
      meta: r.meta, before: r.before, after: r.after,
      at: r.at,
    })),
  });
}
