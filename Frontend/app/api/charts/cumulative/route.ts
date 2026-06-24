import { getSession } from '@/lib/server/session';
import { cumulativeSeries } from '@/lib/server/charts';
import { ok, unauthorized, forbidden, badRequest } from '@/lib/server/http';
import type { Role } from '@/lib/types';

const ALLOWED: Role[] = ['owner', 'auditor']; // financial (shows cost)

export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return unauthorized();
  if (!ALLOWED.includes(session.role)) return forbidden();
  const batchId = new URL(req.url).searchParams.get('batchId');
  if (!batchId) return badRequest('batchId required');
  return ok(await cumulativeSeries(session.tenantId, batchId));
}
