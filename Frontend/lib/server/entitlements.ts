import 'server-only';
import { db } from '@/db';
import { tenants } from '@/db/schemas';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { getSession, type Session } from '@/lib/server/session';
import { unauthorized, forbidden } from '@/lib/server/http';
import { FEATURES, type FeatureKey } from '@/lib/features';

// #29: plan entitlements (`tenants.features`) were enforced only in the client —
// app/owner/layout.tsx filtered nav items and floating widgets, but no API route
// ever checked the tenant's plan. A farm on the free plan could curl
// /api/reports/pl, /api/ai/advise or /api/alerts/evaluate and get a full
// response; the "paywall" was `display: none`.
//
// #152 depends on this exact mechanism ("same mechanism, do not build two") for
// its future kill-switch/rollout system, so this is deliberately ONE small,
// data-driven registry + ONE guard function, not a per-route
// `if (!features.includes(...))` scattered across route files.

// ── The route → feature registry (single source of truth) ─────────────────
//
// Decided during the #29 audit of every app/api/**/route.ts file (62 at the
// time of the audit). A route appears here iff it exposes something the
// FEATURES list (lib/features.ts) actually sells; everything else runs on
// every plan (including free) and is intentionally absent:
//
//   - `finance` is included in EVERY plan, even free (see PLANS.free in
//     lib/features.ts) — so sales/purchases/payroll/cost-summary/products need
//     no gate at all; there is no plan where they're withheld.
//   - `setup_guide` has no server surface (purely the floating UI widget).
//   - GET /api/batch-activity is the per-batch history tab on the Farm page,
//     which every plan can already reach (the nav item has no `feature` key)
//     — it is not the dedicated "Worker Activity Log" (activity_log) page.
//   - GET /api/backup/export is an owner disaster-recovery JSON dump, not the
//     "Reports & Exports" (PDF/Excel/CSV) feature described in FEATURES.
//   - GET/PATCH /api/data/alerts (viewing/acknowledging alerts that already
//     fired) is left ungated: the owner layout fetches it unconditionally for
//     the header bell badge regardless of plan, so gating it here would be a
//     product-scope change (belongs with #12/#152's billing work), not a
//     security fix. Only the paid ACTIONS around alerts — running the rule
//     engine, and authoring rules — are gated.
export const ROUTE_FEATURES = {
  'POST /api/ai/advise': 'ai_advisor',
  'GET /api/reports/[type]': 'reports',
  'POST /api/alerts/evaluate': 'alerts',
  'GET /api/alert-rules': 'alerts',
  'PUT /api/alert-rules': 'alerts',
  'GET /api/worker-activity': 'activity_log',
} as const satisfies Record<string, FeatureKey>;

export type GatedRouteKey = keyof typeof ROUTE_FEATURES;

// Deliberately catches to an EMPTY array, not ALL_FEATURE_KEYS. /api/me uses
// the all-features fallback because it only ever feeds a display-only nav
// filter — failing open there just means a stale/missing row shows an extra
// menu item. This is the enforcement path: a malformed `features` column or a
// tenant row that's gone missing must deny by default, never grant every
// feature, or the one bug #29 exists to fix (fail open on entitlements)
// reappears inside its own fix.
const featuresSchema = z.array(z.string()).catch([]);

/**
 * A tenant's live feature list, read fresh from the DB on every call — never
 * trusted from the session/JWT, so a plan change (or an admin's manual
 * override via /api/admin/tenants) takes effect on the tenant's very next
 * request instead of requiring every signed-in user to log out and back in.
 */
export async function getTenantFeatures(tenantId: string): Promise<string[]> {
  const [tenant] = await db.select({ features: tenants.features }).from(tenants).where(eq(tenants.id, tenantId)).limit(1);
  return featuresSchema.parse(tenant?.features);
}

const FEATURE_LABEL: Record<FeatureKey, string> = Object.fromEntries(
  FEATURES.map((f) => [f.key, f.label]),
) as Record<FeatureKey, string>;

/**
 * The one entitlement check every feature-gated route goes through. Returns a
 * ready-to-return 403 (standard error envelope, see lib/server/http.ts) when
 * the tenant's plan doesn't include `feature`, or `null` when it does — reads
 * at the call site exactly like the existing role guards:
 *
 *   const gate = await requireFeature(session.tenantId, 'reports');
 *   if (gate) return gate;
 *
 * Fails CLOSED: any DB error propagates (routes already run inside
 * withErrorLogging or an equivalent try/catch) rather than defaulting open.
 */
export async function requireFeature(tenantId: string, feature: FeatureKey): Promise<Response | null> {
  const features = await getTenantFeatures(tenantId);
  if (features.includes(feature)) return null;
  return forbidden(`Your plan does not include ${FEATURE_LABEL[feature]}. Ask the account owner to upgrade.`);
}

/**
 * Wraps a route handler with the session check AND the feature gate, so a
 * gated route opts into one mechanism instead of re-deriving
 * `getSession()` + `requireFeature()` inline every time. Modeled on
 * withErrorLogging (lib/server/apiErrorHandler.ts): same "wrap the handler,
 * not the caller" shape, for the same reason — a control that has to be
 * remembered per-route eventually is a control that, somewhere, isn't there
 * (#29's actual bug, and the same class as #203/#36).
 *
 * The wrapped handler receives the already-verified `session` as its second
 * argument so it never needs to call getSession() itself.
 */
export function withFeature<Args extends unknown[]>(
  routeKey: GatedRouteKey,
  handler: (req: Request, session: Session, ...args: Args) => Promise<Response>,
): (req: Request, ...args: Args) => Promise<Response> {
  const feature = ROUTE_FEATURES[routeKey];
  return async (req: Request, ...args: Args): Promise<Response> => {
    const session = await getSession();
    if (!session) return unauthorized();
    const gate = await requireFeature(session.tenantId, feature);
    if (gate) return gate;
    return handler(req, session, ...args);
  };
}
