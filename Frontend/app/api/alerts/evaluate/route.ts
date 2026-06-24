import { getSession } from '@/lib/server/session';
import { evaluateAlerts } from '@/lib/server/alertEngine';
import { ok, unauthorized, forbidden } from '@/lib/server/http';
import type { Role } from '@/lib/types';

const ALLOWED: Role[] = ['owner', 'manager'];

// POST /api/alerts/evaluate — run the rules against live data, raise alerts.
export async function POST() {
  const session = await getSession();
  if (!session) return unauthorized();
  if (!ALLOWED.includes(session.role)) return forbidden();
  return ok(await evaluateAlerts(session.tenantId));
}
