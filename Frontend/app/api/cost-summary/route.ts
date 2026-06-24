import { getSession } from '@/lib/server/session';
import { computeBatchCost } from '@/lib/server/costing';
import { hiddenFieldKeysFor, stripForRead } from '@/lib/server/fieldPermissions';
import { ok, unauthorized, forbidden, badRequest, notFound } from '@/lib/server/http';
import type { Role } from '@/lib/types';

const ALLOWED: Role[] = ['owner', 'manager', 'auditor'];

// GET /api/cost-summary?batchId=... — financial; gated + field-permission filtered.
export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return unauthorized();
  if (!ALLOWED.includes(session.role)) return forbidden();

  const batchId = new URL(req.url).searchParams.get('batchId');
  if (!batchId) return badRequest('batchId required');

  const summary = await computeBatchCost(session.tenantId, batchId);
  if (!summary) return notFound();

  const hidden = await hiddenFieldKeysFor(session);
  const [filtered] = stripForRead('cost-summary', [summary as unknown as Record<string, unknown>], hidden);
  return ok(filtered);
}
