import { db } from '@/db';
import { alertRules } from '@/db/schemas';
import { eq } from 'drizzle-orm';
import type { Session } from '@/lib/server/session';
import { ok, forbidden, badRequest } from '@/lib/server/http';
import { withFeature } from '@/lib/server/entitlements';
import type { Role } from '@/lib/types';

const ALLOWED: Role[] = ['owner', 'manager'];

interface RuleInput { metric: string; label: string; threshold: number; unit?: string; severity?: string; enabled?: boolean }

// GET /api/alert-rules
// #29: gated behind the `alerts` feature — authoring rules is part of the
// same paid "rule-based alert engine" as POST /api/alerts/evaluate.
async function getHandler(_req: Request, session: Session) {
  if (!ALLOWED.includes(session.role)) return forbidden();
  return ok(await db.select().from(alertRules).where(eq(alertRules.tenantId, session.tenantId)));
}

// PUT /api/alert-rules  { rules: RuleInput[] } — owner only; replaces the set.
async function putHandler(req: Request, session: Session) {
  if (session.role !== 'owner') return forbidden();

  const { rules } = (await req.json().catch(() => ({}))) as { rules?: RuleInput[] };
  if (!Array.isArray(rules)) return badRequest('rules[] required');

  // Delete + re-insert must be one transaction — a failure between the two steps would
  // otherwise leave the tenant with ZERO alert rules (not stale data, total loss),
  // silently turning off every alert for that tenant.
  await db.transaction(async (tx) => {
    await tx.delete(alertRules).where(eq(alertRules.tenantId, session.tenantId));
    if (rules.length) {
      await tx.insert(alertRules).values(rules.map((r) => ({
        id: crypto.randomUUID(), tenantId: session.tenantId,
        metric: String(r.metric), label: String(r.label), threshold: Number(r.threshold) || 0,
        unit: String(r.unit ?? ''), severity: String(r.severity ?? 'warning'), enabled: r.enabled !== false,
      })));
    }
  });
  return ok({ saved: rules.length });
}

export const GET = withFeature('GET /api/alert-rules', getHandler);
export const PUT = withFeature('PUT /api/alert-rules', putHandler);
