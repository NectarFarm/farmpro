import { getSession } from '@/lib/server/session';
import { computeDashboardKPIs } from '@/lib/server/costing';
import { ok, unauthorized, forbidden } from '@/lib/server/http';
import { withTtlCache } from '@/lib/server/ttlCache';
import type { Role } from '@/lib/types';

const ALLOWED: Role[] = ['owner', 'manager', 'auditor'];
const KPI_CACHE_TTL_MS = 45_000;

// GET /api/dashboard/kpis — computed from DB; non-worker roles only.
export async function GET() {
  const session = await getSession();
  if (!session) return unauthorized();
  if (!ALLOWED.includes(session.role)) return forbidden();

  // computeDashboardKPIs is the single most expensive on-read query in the
  // app (full-tenant aggregation across batches/records). Cached by tenant,
  // not by role — the manager money-redaction below is applied per-request
  // on top of the shared cached result, so it never leaks into the cache.
  const kpis = await withTtlCache(
    `dashboard-kpis:${session.tenantId}`,
    KPI_CACHE_TTL_MS,
    () => computeDashboardKPIs(session.tenantId),
  );
  // Managers don't see money (FR-M19-2); owner/auditor do.
  if (session.role === 'manager') {
    return ok({ ...kpis, grossMargin: 0, revenueThisMonth: 0 });
  }
  return ok(kpis);
}
