import { db } from '@/db';
import { products, batches } from '@/db/schemas';
import { and, eq } from 'drizzle-orm';
import { getSession } from '@/lib/server/session';
import { sellableStock, productAvailability } from '@/lib/server/inventory';
import { ok, unauthorized, forbidden, badRequest } from '@/lib/server/http';
import type { Role } from '@/lib/types';

const ALLOWED: Role[] = ['owner', 'manager'];

// GET /api/availability?batchId=&productId=  — base units left to sell for a product,
// using the same stock model the sale itself enforces:
//   • a live animal (per head) → the batch headcount IS the stock
//   • a harvested output (eggs/pork/fish/maize…) → collected − already sold
// Returns { basis, available, produced?, sold? }. Falls back to ?product=<name>
// (harvested only) for older callers that don't pass an id.
export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return unauthorized();
  if (!ALLOWED.includes(session.role)) return forbidden();
  const u = new URL(req.url);
  const batchId = u.searchParams.get('batchId');
  const productId = u.searchParams.get('productId');
  const productName = u.searchParams.get('product');
  if (!batchId || (!productId && !productName)) return badRequest('batchId and productId required');

  const [batch] = await db.select({ id: batches.id, currentQty: batches.currentQty, species: batches.species, avgWeightKg: batches.avgWeightKg }).from(batches)
    .where(and(eq(batches.tenantId, session.tenantId), eq(batches.id, batchId))).limit(1);
  if (!batch) return badRequest('unknown batch');

  if (productId) {
    const [product] = await db.select().from(products)
      .where(and(eq(products.tenantId, session.tenantId), eq(products.id, productId))).limit(1);
    if (!product) return badRequest('unknown product');
    return ok(await sellableStock(session.tenantId, batch, product));
  }

  // Legacy name-only path: harvested basis only.
  const a = await productAvailability(session.tenantId, batchId, productName!);
  return ok({ basis: 'harvested', available: a.available, produced: a.produced, sold: a.sold });
}
