import { getSession } from '@/lib/server/session';
import { buildReport } from '@/lib/server/reports';
import { ok, unauthorized, forbidden } from '@/lib/server/http';
import type { Role } from '@/lib/types';

const ALLOWED: Role[] = ['owner', 'manager', 'auditor'];
// Reports that expose money — managers don't get these (FR-M19-2).
const FINANCIAL = new Set(['pl', 'sales', 'batch_card', 'fcr', 'labor', 'baseline']);

// GET /api/reports/<type>?from=YYYY-MM-DD&to=YYYY-MM-DD
export async function GET(req: Request, ctx: { params: Promise<{ type: string }> }) {
  const session = await getSession();
  if (!session) return unauthorized();
  if (!ALLOWED.includes(session.role)) return forbidden();

  const { type } = await ctx.params;
  if (session.role === 'manager' && FINANCIAL.has(type)) return forbidden();

  const url = new URL(req.url);
  const from = url.searchParams.get('from') ?? '2000-01-01';
  const to = url.searchParams.get('to') ?? '2999-12-31';
  const unitId = url.searchParams.get('unitId') || null;

  return ok(await buildReport(session.tenantId, type, from, to, unitId));
}
