import { db } from '@/db';
import { products } from '@/db/schemas';
import { and, eq } from 'drizzle-orm';
import { getSession } from '@/lib/server/session';
import { createProductsForBatch } from '@/lib/server/products';
import { hiddenFieldKeysFor, stripProductSaleUnitPrices } from '@/lib/server/fieldPermissions';
import { ok, created, unauthorized, forbidden, badRequest } from '@/lib/server/http';
import type { Role } from '@/lib/types';

type SaleUnit = { name: string; perBase: number; price: number };

// GET /api/products?batchId=...  — price stripped for any role without financial
// access (same default-deny rule as every other resource, via fieldPermissions.ts).
export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return unauthorized();
  const batchId = new URL(req.url).searchParams.get('batchId');

  const where = batchId
    ? and(eq(products.tenantId, session.tenantId), eq(products.batchId, batchId))
    : eq(products.tenantId, session.tenantId);
  const rows = await db.select().from(products).where(where);

  const hidden = await hiddenFieldKeysFor(session);
  return ok(stripProductSaleUnitPrices(rows, hidden));
}

// DELETE /api/products?id=...  — delete a product (owner/manager).
export async function DELETE(req: Request) {
  const session = await getSession();
  if (!session) return unauthorized();
  if (!(['owner', 'manager'] as Role[]).includes(session.role)) return forbidden();
  const id = new URL(req.url).searchParams.get('id');
  if (!id) return badRequest('id required');
  await db.delete(products).where(and(eq(products.tenantId, session.tenantId), eq(products.id, id)));
  return ok({ id, deleted: true });
}

// POST /api/products — add a custom product to a batch (owner/manager).
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return unauthorized();
  if (!(['owner', 'manager'] as Role[]).includes(session.role)) return forbidden();
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  if (!b.batchId || !b.name) return badRequest('batchId and name required');
  const saleUnits = Array.isArray(b.saleUnits) ? (b.saleUnits as SaleUnit[]) : [{ name: 'Unit', perBase: 1, price: 0 }];
  const def = {
    name: String(b.name), baseUnit: String(b.baseUnit ?? 'unit'),
    collectFrequency: (String(b.collectFrequency ?? 'per_cycle')) as 'daily' | 'weekly' | 'monthly' | 'per_cycle',
    flow: (String(b.flow ?? 'sale')) as 'sale' | 'expense', saleUnits,
    isAnimalProduct: Boolean(b.isAnimalProduct),
  };
  const res = await createProductsForBatch(session.tenantId, String(b.batchId), [def]);
  return created({ id: res[0]?.id });
}

// PATCH /api/products?id=...  — edit units/price/frequency/name (owner/manager).
export async function PATCH(req: Request) {
  const session = await getSession();
  if (!session) return unauthorized();
  if (!(['owner', 'manager'] as Role[]).includes(session.role)) return forbidden();
  const id = new URL(req.url).searchParams.get('id');
  if (!id) return badRequest('id required');
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const patch: Record<string, unknown> = {};
  if (typeof b.name === 'string') patch.name = b.name;
  if (typeof b.collectFrequency === 'string') patch.collectFrequency = b.collectFrequency;
  if (typeof b.baseUnit === 'string') patch.baseUnit = b.baseUnit;
  if (Array.isArray(b.saleUnits)) patch.saleUnits = b.saleUnits;
  if (typeof b.active === 'boolean') patch.active = b.active;
  if (typeof b.isAnimalProduct === 'boolean') patch.isAnimalProduct = b.isAnimalProduct;
  await db.update(products).set(patch).where(and(eq(products.tenantId, session.tenantId), eq(products.id, id)));
  return ok({ id });
}
