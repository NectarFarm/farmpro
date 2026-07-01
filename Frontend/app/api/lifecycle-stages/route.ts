import { db } from '@/db';
import { lifecycleStages } from '@/db/schemas';
import { and, eq } from 'drizzle-orm';
import { getSession } from '@/lib/server/session';
import { ok, badRequest, unauthorized, forbidden } from '@/lib/server/http';
import type { Role } from '@/lib/types';

const ALLOWED: Role[] = ['owner', 'manager'];

// GET /api/lifecycle-stages[?enterprise=] — the tenant's stage sets (ordered), flat
// [{enterprise, ord, name, startDay}]. The Farm + config UIs group by enterprise.
export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return unauthorized();
  if (!ALLOWED.includes(session.role)) return forbidden();
  const enterprise = new URL(req.url).searchParams.get('enterprise');
  const rows = (await db.select().from(lifecycleStages).where(eq(lifecycleStages.tenantId, session.tenantId)))
    .filter((r) => !enterprise || r.enterprise === enterprise)
    .sort((a, b) => (a.enterprise === b.enterprise ? a.ord - b.ord : a.enterprise.localeCompare(b.enterprise)));
  return ok(rows.map((r) => ({ enterprise: r.enterprise, ord: r.ord, name: r.name, startDay: r.startDay })));
}

// PUT /api/lifecycle-stages { enterprise, stages: [{name, startDay}] } — replace one
// enterprise's stage set. Stages are sorted by startDay and the first is pinned to 0.
export async function PUT(req: Request) {
  const session = await getSession();
  if (!session) return unauthorized();
  if (!ALLOWED.includes(session.role)) return forbidden();
  const body = (await req.json().catch(() => ({}))) as { enterprise?: string; stages?: { name?: string; startDay?: unknown }[] };
  const enterprise = (body.enterprise ?? '').trim();
  if (!enterprise) return badRequest('enterprise required');

  const clean = (body.stages ?? [])
    .map((s) => ({ name: (s.name ?? '').trim(), startDay: Math.max(0, Math.round(Number(s.startDay) || 0)) }))
    .filter((s) => s.name)
    .sort((a, b) => a.startDay - b.startDay);
  if (!clean.length) return badRequest('Add at least one stage.');
  clean[0].startDay = 0; // the lifecycle always starts at age 0

  await db.delete(lifecycleStages).where(and(eq(lifecycleStages.tenantId, session.tenantId), eq(lifecycleStages.enterprise, enterprise)));
  await db.insert(lifecycleStages).values(clean.map((s, i) => ({
    id: crypto.randomUUID(), tenantId: session.tenantId, enterprise, ord: i, name: s.name, startDay: s.startDay,
  })));
  return ok({ enterprise, count: clean.length });
}
