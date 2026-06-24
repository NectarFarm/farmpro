import { getSession } from '@/lib/server/session';
import { productAvailability } from '@/lib/server/inventory';
import { ok, unauthorized, forbidden, badRequest } from '@/lib/server/http';
import type { Role } from '@/lib/types';

const ALLOWED: Role[] = ['owner', 'manager'];

// GET /api/availability?batchId=&product=Name — base units left to sell for a product.
export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return unauthorized();
  if (!ALLOWED.includes(session.role)) return forbidden();
  const u = new URL(req.url);
  const batchId = u.searchParams.get('batchId');
  const product = u.searchParams.get('product');
  if (!batchId || !product) return badRequest('batchId and product required');
  return ok(await productAvailability(session.tenantId, batchId, product));
}
