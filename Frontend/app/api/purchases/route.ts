import { db } from '@/db';
import { purchases, inventoryItems, inventoryLots } from '@/db/schemas';
import { and, eq } from 'drizzle-orm';
import { getSession } from '@/lib/server/session';
import { ok, created, unauthorized, forbidden, badRequest } from '@/lib/server/http';
import type { Role } from '@/lib/types';

const ALLOWED: Role[] = ['owner', 'manager'];

// GET /api/purchases — list (tenant-scoped).
export async function GET() {
  const session = await getSession();
  if (!session) return unauthorized();
  if (!ALLOWED.includes(session.role)) return forbidden();
  return ok(await db.select().from(purchases).where(eq(purchases.tenantId, session.tenantId)));
}

// POST /api/purchases — record a delivery: creates an inventory LOT (stock in) + a purchase (expense).
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return unauthorized();
  if (!ALLOWED.includes(session.role)) return forbidden();

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const s = (v: unknown, d = '') => (typeof v === 'string' ? v : d);
  const n = (v: unknown) => (typeof v === 'number' ? v : Number(v) || 0);
  const quantity = n(body.quantity);
  const unitCost = n(body.unitCost);
  if (!quantity || !unitCost) return badRequest('quantity and unitCost required');

  // Resolve or create the inventory item.
  let itemId = s(body.itemId);
  let unit = 'kg';
  if (itemId) {
    const [item] = await db.select().from(inventoryItems)
      .where(and(eq(inventoryItems.tenantId, session.tenantId), eq(inventoryItems.id, itemId))).limit(1);
    if (!item) return badRequest('unknown item');
    unit = item.unit;
  } else {
    if (!body.itemName) return badRequest('itemId or itemName required');
    itemId = crypto.randomUUID();
    unit = s(body.unit, 'kg');
    await db.insert(inventoryItems).values({
      id: itemId, tenantId: session.tenantId, name: s(body.itemName), category: s(body.category, 'CONSUMABLE'),
      unit, lowStockThreshold: 0,
    });
  }

  const lotId = crypto.randomUUID();
  const now = new Date().toISOString();
  await db.insert(inventoryLots).values({
    id: lotId, tenantId: session.tenantId, itemId, lotNo: `PO-${now.slice(0, 10)}-${lotId.slice(0, 4)}`,
    qtyOnHand: quantity, unit, unitCost, receivedDate: now.slice(0, 10),
    withdrawalDays: body.withdrawalDays ? n(body.withdrawalDays) : null,
  });

  const purchaseId = crypto.randomUUID();
  await db.insert(purchases).values({
    id: purchaseId, tenantId: session.tenantId, itemId, lotId, supplier: s(body.supplier, 'Supplier'),
    quantity, unitCost, totalCost: quantity * unitCost, createdAt: now,
  });

  return created({ id: purchaseId, lotId, itemId });
}
