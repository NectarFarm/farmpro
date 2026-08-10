import { db } from '@/db';
import { products } from '@/db/schemas';
import { and, eq } from 'drizzle-orm';
import { getSession } from '@/lib/server/session';
import { createProductsForBatch } from '@/lib/server/products';
import { hiddenFieldKeysFor, stripProductSaleUnitPrices } from '@/lib/server/fieldPermissions';
import { ok, created, unauthorized, forbidden, badRequest } from '@/lib/server/http';
import { parseBody, productCreateSchema, productUpdateSchema } from '@/lib/server/validate';
import { readRateLimited, writeRateLimited } from '@/lib/server/rateLimit';
import { withErrorLogging } from '@/lib/server/apiErrorHandler';
import type { Role } from '@/lib/types';

const ALLOWED: Role[] = ['owner', 'manager'];

// GET /api/products?batchId=...  — price stripped for any role without financial
// access (same default-deny rule as every other resource, via fieldPermissions.ts).
async function getHandler(req: Request) {
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
async function deleteHandler(req: Request) {
  const limited = writeRateLimited(req);
  if (limited) return limited;
  const session = await getSession();
  if (!session) return unauthorized();
  if (!ALLOWED.includes(session.role)) return forbidden();
  const id = new URL(req.url).searchParams.get('id');
  if (!id) return badRequest('id required');
  try {
    await db.delete(products).where(and(eq(products.tenantId, session.tenantId), eq(products.id, id)));
  } catch (e) {
    // production_records.product_id is a real FK with ON DELETE RESTRICT
    // (migration 0039) — Postgres raises SQLSTATE 23503 when production has
    // already been recorded against this product. That's an expected, user-
    // actionable outcome, not a server failure: catch it specifically (never
    // a bare catch-all, which would mislabel unrelated failures) and steer
    // toward the existing soft-delete (`products.active = false`) instead.
    if ((e as { code?: string }).code === '23503') {
      return badRequest('This product has recorded production and cannot be deleted. Deactivate it instead.');
    }
    throw e;
  }
  return ok({ id, deleted: true });
}

// POST /api/products — add a custom product to a batch (owner/manager).
async function postHandler(req: Request) {
  const limited = writeRateLimited(req);
  if (limited) return limited;
  const session = await getSession();
  if (!session) return unauthorized();
  if (!ALLOWED.includes(session.role)) return forbidden();
  const parsed = await parseBody(req, productCreateSchema);
  if ('error' in parsed) return parsed.error;
  const body = parsed.data;
  const def = {
    name: body.name, baseUnit: body.baseUnit,
    collectFrequency: body.collectFrequency,
    flow: body.flow, saleUnits: body.saleUnits,
    isAnimalProduct: body.isAnimalProduct,
  };
  const res = await createProductsForBatch(session.tenantId, body.batchId, [def]);
  return created({ id: res[0]?.id });
}

// PATCH /api/products?id=...  — edit units/price/frequency/name (owner/manager).
async function patchHandler(req: Request) {
  const limited = writeRateLimited(req);
  if (limited) return limited;
  const session = await getSession();
  if (!session) return unauthorized();
  if (!ALLOWED.includes(session.role)) return forbidden();
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

export const GET = withErrorLogging('GET /api/products', getHandler);
export const DELETE = withErrorLogging('DELETE /api/products', deleteHandler);
export const POST = withErrorLogging('POST /api/products', postHandler);
export const PATCH = withErrorLogging('PATCH /api/products', patchHandler);
