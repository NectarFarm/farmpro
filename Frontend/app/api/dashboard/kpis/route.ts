import { getSession } from '@/lib/server/session';
import { computeDashboardKPIs } from '@/lib/server/costing';
import { ok, unauthorized, forbidden } from '@/lib/server/http';
import type { Role } from '@/lib/types';

const ALLOWED: Role[] = ['owner', 'manager', 'auditor'];

// GET /api/dashboard/kpis — computed from DB; non-worker roles only.
export async function GET() {
  const session = await getSession();
  if (!session) return unauthorized();
  if (!ALLOWED.includes(session.role)) return forbidden();

  const kpis = await computeDashboardKPIs(session.tenantId);
  // Managers don't see money (FR-M19-2); owner/auditor do.
  if (session.role === 'manager') {
    return ok({ ...kpis, grossMargin: 0, revenueThisMonth: 0 });
  }
  return ok(kpis);
}
