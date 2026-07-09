import { db } from '@/db';
import { products } from '@/db/schemas';
import { and, eq } from 'drizzle-orm';
import { getSession } from '@/lib/server/session';
import { createProductsForBatch } from '@/lib/server/products';
import { hiddenFieldKeysFor, stripProductSaleUnitPrices } from '@/lib/server/fieldPermissions';
import { ok, created, unauthorized, forbidden, badRequest } from '@/lib/server/http';
import { parseBody, productCreateSchema, productUpdateSchema } from '@/lib/server/validate';
import { readRateLimited, writeRateLimited } from '@/lib/server/rateLimit';
import type { Role } from '@/lib/types';

type SaleUnit = { name: string; perBase: number; price: number };

// GET /api/products?batchId=...  — price stripped for any role without financial
// access (same default-deny rule as every other resource, via fieldPermissions.ts).
export async function GET(req: Request) {
  const limited = readRateLimited(req);
  if (limited) return limited;
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
  const limited = writeRateLimited(req);
  if (limited) return limited;
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
  const limited = writeRateLimited(req);
  if (limited) return limited;
  const session = await getSession();
  if (!session) return unauthorized();
  if (!(['owner', 'manager'] as Role[]).includes(session.role)) return forbidden();
  const parsed = await parseBody(req, productCreateSchema);
  if ('error' in parsed) return parsed.error;
  const body = parsed.data;
  const def = {
    name: body.name, baseUnit: body.baseUnit,
    collectFrequency: body.collectFrequency,
    flow: body.flow, saleUnits: body.saleUnits as { name: string; perBase: number; price: number }[],
    isAnimalProduct: body.isAnimalProduct,
  };
  const res = await createProductsForBatch(session.tenantId, body.batchId, [def]);
  return created({ id: res[0]?.id });
}

// PATCH /api/products?id=...  — edit units/price/frequency/name (owner/manager).
export async function PATCH(req: Request) {
  const limited = writeRateLimited(req);
  if (limited) return limited;
  const session = await getSession();
  if (!session) return unauthorized();
  if (!(['owner', 'manager'] as Role[]).includes(session.role)) return forbidden();
  const id = new URL(req.url).searchParams.get('id');
  if (!id) return badRequest('id required');
  const parsed = await parseBody(req, productUpdateSchema);
  if ('error' in parsed) return parsed.error;
  const b = parsed.data;
  const patch: Record<string, unknown> = {};
  if (b.name !== undefined) patch.name = b.name;
  if (b.collectFrequency !== undefined) patch.collectFrequency = b.collectFrequency;
  if (b.baseUnit !== undefined) patch.baseUnit = b.baseUnit;
  if (b.saleUnits !== undefined) patch.saleUnits = b.saleUnits;
  if (b.active !== undefined) patch.active = b.active;
  if (b.isAnimalProduct !== undefined) patch.isAnimalProduct = b.isAnimalProduct;
  await db.update(products).set(patch).where(and(eq(products.tenantId, session.tenantId), eq(products.id, id)));
  return ok({ id });
}
