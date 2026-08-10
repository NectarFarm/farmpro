import type { Session } from '@/lib/server/session';
import { buildReport } from '@/lib/server/reports';
import { ok, forbidden } from '@/lib/server/http';
import { withFeature } from '@/lib/server/entitlements';
import type { Role } from '@/lib/types';

const ALLOWED: Role[] = ['owner', 'manager', 'auditor'];
// Reports that expose money — managers don't get these (FR-M19-2).
const FINANCIAL = new Set(['pl', 'sales', 'batch_card', 'fcr', 'labor', 'baseline']);

// GET /api/reports/<type>?from=YYYY-MM-DD&to=YYYY-MM-DD
// #29: gated behind the `reports` feature ("Reports & Exports").
async function getHandler(req: Request, session: Session, ctx: { params: Promise<{ type: string }> }) {
  if (!ALLOWED.includes(session.role)) return forbidden();

  const { type } = await ctx.params;
  if (session.role === 'manager' && FINANCIAL.has(type)) return forbidden();

  const url = new URL(req.url);
  const from = url.searchParams.get('from') ?? '2000-01-01';
  const to = url.searchParams.get('to') ?? '2999-12-31';
  const unitId = url.searchParams.get('unitId') || null;

  return ok(await buildReport(session.tenantId, type, from, to, unitId));
}

export const GET = withFeature('GET /api/reports/[type]', getHandler);
