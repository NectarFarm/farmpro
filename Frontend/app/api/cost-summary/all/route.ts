import { getSession } from '@/lib/server/session';
import { computeAllBatchCosts } from '@/lib/server/costing';
import { hiddenFieldKeysFor, stripForRead } from '@/lib/server/fieldPermissions';
import { ok, unauthorized, forbidden } from '@/lib/server/http';
import type { Role } from '@/lib/types';

const ALLOWED: Role[] = ['owner', 'manager', 'auditor'];

// GET /api/cost-summary/all — every batch's cost summary in ONE server-side pass.
// Uses computeAllBatchCosts (bulk-loads each activity table once, rolls up per-batch
// in memory) so a page rendering all batches makes a single request instead of the
// N+1 storm of one /api/cost-summary call — and 9 sequential DB queries — per batch.
// Same gating + field-permission filtering as the single-batch route.
export async function GET() {
  const session = await getSession();
  if (!session) return unauthorized();
  if (!ALLOWED.includes(session.role)) return forbidden();

  const costs = await computeAllBatchCosts(session.tenantId);
  const summaries = Array.from(costs.values());

  const hidden = await hiddenFieldKeysFor(session);
  const filtered = stripForRead(
    'cost-summary',
    summaries as unknown as Record<string, unknown>[],
    hidden,
  );
  return ok(filtered);
}
