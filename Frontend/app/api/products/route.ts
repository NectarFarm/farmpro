import { db } from '@/db';
import { products } from '@/db/schemas';
import { and, eq } from 'drizzle-orm';
import { getSession } from '@/lib/server/session';
import { createProductsForBatch } from '@/lib/server/products';
import { ok, created, unauthorized, forbidden, badRequest } from '@/lib/server/http';
import type { Role } from '@/lib/types';

type SaleUnit = { name: string; perBase: number; price: number };

// GET /api/products?batchId=...  — workers get prices stripped (they only collect).
export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return unauthorized();
  const batchId = new URL(req.url).searchParams.get('batchId');

  const where = batchId
    ? and(eq(products.tenantId, session.tenantId), eq(products.batchId, batchId))
    : eq(products.tenantId, session.tenantId);
  const rows = await db.select().from(products).where(where);

  if (session.role === 'worker') {
    return ok(rows.map((p) => ({
      ...p,
      saleUnits: (p.saleUnits as SaleUnit[]).map((u) => ({ name: u.name, perBase: u.perBase })), // no price
    })));
  }
  return ok(rows);
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
  await db.update(products).set(patch).where(and(eq(products.tenantId, session.tenantId), eq(products.id, id)));
  return ok({ id });
}
