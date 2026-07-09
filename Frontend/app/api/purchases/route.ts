import { db } from '@/db';
import { purchases, inventoryItems, inventoryLots } from '@/db/schemas';
import { and, eq } from 'drizzle-orm';
import { getSession } from '@/lib/server/session';
import { ok, created, unauthorized, forbidden, badRequest } from '@/lib/server/http';
import { parseBody, purchaseSchema } from '@/lib/server/validate';
import { toCents } from '@/lib/server/money';
import { readRateLimited, writeRateLimited } from '@/lib/server/rateLimit';
import type { Role } from '@/lib/types';

const ALLOWED: Role[] = ['owner', 'manager'];

// GET /api/purchases — list (tenant-scoped).
export async function GET(req: Request) {
  const limited = readRateLimited(req);
  if (limited) return limited;
  const session = await getSession();
  if (!session) return unauthorized();
  if (!ALLOWED.includes(session.role)) return forbidden();
  return ok(await db.select().from(purchases).where(eq(purchases.tenantId, session.tenantId)));
}

// POST /api/purchases — record a delivery: creates an inventory LOT (stock in) + a purchase (expense).
export async function POST(req: Request) {
  const limited = writeRateLimited(req);
  if (limited) return limited;
  const session = await getSession();
  if (!session) return unauthorized();
  if (!ALLOWED.includes(session.role)) return forbidden();

  const parsed = await parseBody(req, purchaseSchema);
  if ('error' in parsed) return parsed.error;
  const body = parsed.data;

  // Resolve or create the inventory item. The picker sends '__new' (or nothing)
  // when the user is adding a brand-new item alongside this delivery.
  let itemId = body.itemId ?? '';
  let unit = body.unit;
  if (itemId && itemId !== '__new') {
    const [item] = await db.select().from(inventoryItems)
      .where(and(eq(inventoryItems.tenantId, session.tenantId), eq(inventoryItems.id, itemId))).limit(1);
    if (!item) return badRequest('unknown item');
    unit = item.unit;
  } else {
    if (!body.itemName) return badRequest('itemId or itemName required');
    itemId = crypto.randomUUID();
    await db.insert(inventoryItems).values({
      id: itemId, tenantId: session.tenantId, name: body.itemName, category: body.category,
      unit, lowStockThreshold: 0,
    });
  }

  const lotId = crypto.randomUUID();
  const now = new Date().toISOString();
  await db.insert(inventoryLots).values({
    id: lotId, tenantId: session.tenantId, itemId, lotNo: `PO-${now.slice(0, 10)}-${lotId.slice(0, 4)}`,
    qtyOnHand: body.quantity, unit, unitCost: body.unitCost,
    unitCostCents: toCents(body.unitCost),
    receivedDate: now.slice(0, 10),
    withdrawalDays: body.withdrawalDays ?? null,
  });

  const purchaseTotal = body.quantity * body.unitCost;
  const purchaseId = crypto.randomUUID();
  await db.insert(purchases).values({
    id: purchaseId, tenantId: session.tenantId, itemId, lotId, supplier: body.supplier,
    quantity: body.quantity, unitCost: body.unitCost,
    unitCostCents: toCents(body.unitCost),
    totalCost: purchaseTotal,
    totalCostCents: toCents(purchaseTotal),
    createdAt: now,
  });

  return created({ id: purchaseId, lotId, itemId });
}
