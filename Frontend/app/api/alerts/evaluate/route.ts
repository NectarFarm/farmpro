import type { Session } from '@/lib/server/session';
import { evaluateAlerts } from '@/lib/server/alertEngine';
import { ok, forbidden } from '@/lib/server/http';
import { withFeature } from '@/lib/server/entitlements';
import type { Role } from '@/lib/types';

const ALLOWED: Role[] = ['owner', 'manager'];

// POST /api/alerts/evaluate — run the rules against live data, raise alerts.
// #29: gated behind the `alerts` feature (the rule-based alert engine).
async function postHandler(_req: Request, session: Session) {
  if (!ALLOWED.includes(session.role)) return forbidden();
  return ok(await evaluateAlerts(session.tenantId));
}

export const POST = withFeature('POST /api/alerts/evaluate', postHandler);
