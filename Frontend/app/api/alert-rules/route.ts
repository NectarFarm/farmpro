import { db } from '@/db';
import { alertRules } from '@/db/schemas';
import { eq } from 'drizzle-orm';
import { getSession } from '@/lib/server/session';
import { ok, unauthorized, forbidden, badRequest } from '@/lib/server/http';
import type { Role } from '@/lib/types';

const ALLOWED: Role[] = ['owner', 'manager'];

interface RuleInput { metric: string; label: string; threshold: number; unit?: string; severity?: string; enabled?: boolean }

// GET /api/alert-rules
export async function GET() {
  const session = await getSession();
  if (!session) return unauthorized();
  if (!ALLOWED.includes(session.role)) return forbidden();
  return ok(await db.select().from(alertRules).where(eq(alertRules.tenantId, session.tenantId)));
}

// PUT /api/alert-rules  { rules: RuleInput[] } — owner only; replaces the set.
export async function PUT(req: Request) {
  const session = await getSession();
  if (!session) return unauthorized();
  if (session.role !== 'owner') return forbidden();

  const { rules } = (await req.json().catch(() => ({}))) as { rules?: RuleInput[] };
  if (!Array.isArray(rules)) return badRequest('rules[] required');

  await db.delete(alertRules).where(eq(alertRules.tenantId, session.tenantId));
  if (rules.length) {
    await db.insert(alertRules).values(rules.map((r) => ({
      id: crypto.randomUUID(), tenantId: session.tenantId,
      metric: String(r.metric), label: String(r.label), threshold: Number(r.threshold) || 0,
      unit: String(r.unit ?? ''), severity: String(r.severity ?? 'warning'), enabled: r.enabled !== false,
    })));
  }
  return ok({ saved: rules.length });
}
