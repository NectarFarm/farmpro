import { getSession } from '@/lib/server/session';
import { productionSeries } from '@/lib/server/charts';
import { ok, unauthorized, forbidden } from '@/lib/server/http';
import type { Role } from '@/lib/types';

const ALLOWED: Role[] = ['owner', 'manager', 'auditor'];

export async function GET() {
  const session = await getSession();
  if (!session) return unauthorized();
  if (!ALLOWED.includes(session.role)) return forbidden();
  return ok(await productionSeries(session.tenantId));
}
