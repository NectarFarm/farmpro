import { db } from '@/db';
import { purchases, inventoryItems, inventoryLots } from '@/db/schemas';
import { and, eq } from 'drizzle-orm';
import { getSession } from '@/lib/server/session';
import { ok, created, unauthorized, forbidden, notFound, badRequest } from '@/lib/server/http';
import { parseBody, purchaseSchema, purchasePaymentSchema } from '@/lib/server/validate';
import { toCents, sumMoney } from '@/lib/server/money';
import { readRateLimited, writeRateLimited } from '@/lib/server/rateLimit';
import type { Role } from '@/lib/types';

const ALLOWED: Role[] = ['owner', 'manager'];

class PurchaseNotFound extends Error {}
class PurchaseValidationError extends Error {}

// Blank/absent → today; a present-but-unparseable value is rejected rather
// than silently mis-dating the delivery (same convention as app/api/setup/route.ts's dt()).
function parseDateOrToday(v: string | undefined | null, field: string, today: string): string {
  if (v === undefined || v === null || v.trim() === '') return today;
  if (Number.isNaN(new Date(v).getTime())) throw new PurchaseValidationError(`"${field}" must be a valid date (got "${v}").`);
  return v.trim();
}

// GET /api/purchases — list (tenant-scoped). ?owed=1 returns the total still
// owed to suppliers instead of the full list (a lightweight read, not a
// stored aggregate — computed fresh from every purchase with amountPaid < totalCost).
export async function GET(req: Request) {
  const limited = readRateLimited(req);
  if (limited) return limited;
  const session = await getSession();
  if (!session) return unauthorized();
  if (!ALLOWED.includes(session.role)) return forbidden();

  const rows = await db.select().from(purchases).where(eq(purchases.tenantId, session.tenantId));

  if (new URL(req.url).searchParams.get('owed') === '1') {
    const outstanding = rows.filter((r) => r.amountPaid < r.totalCost);
    return ok({
      amountOwed: sumMoney(outstanding.map((r) => r.totalCost - r.amountPaid)),
      count: outstanding.length,
    });
  }

  return ok(rows);
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
  const now = new Date().toISOString();
  const today = now.slice(0, 10);

  let receivedAt: string;
  try {
    receivedAt = parseDateOrToday(body.receivedAt, 'received date', today);
  } catch (err) {
    if (err instanceof PurchaseValidationError) return badRequest(err.message);
    throw err;
  }

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
  await db.insert(inventoryLots).values({
    id: lotId, tenantId: session.tenantId, itemId, lotNo: `PO-${today}-${lotId.slice(0, 4)}`,
    qtyOnHand: body.quantity, unit, unitCost: body.unitCost,
    unitCostCents: toCents(body.unitCost),
    receivedDate: receivedAt,
    withdrawalDays: body.withdrawalDays ?? null,
  });

  const purchaseTotal = body.quantity * body.unitCost;
  const purchaseId = crypto.randomUUID();
  // Cash-on-delivery is the common case: paid in full, same day. A purchase
  // only diverges from that when a paymentMethod/amountPaid was explicitly
  // supplied (e.g. 'credit' with amountPaid omitted/0 — nothing paid yet).
  const paymentMethod = body.paymentMethod ?? 'cash';
  const amountPaid = body.amountPaid ?? (paymentMethod === 'credit' ? 0 : purchaseTotal);
  const paidAt = amountPaid >= purchaseTotal ? (body.paidAt || now) : (body.paidAt ?? null);
  await db.insert(purchases).values({
    id: purchaseId, tenantId: session.tenantId, itemId, lotId, supplier: body.supplier,
    quantity: body.quantity, unitCost: body.unitCost,
    unitCostCents: toCents(body.unitCost),
    totalCost: purchaseTotal,
    totalCostCents: toCents(purchaseTotal),
    createdAt: now, receivedAt,
    paidAt, paymentMethod, amountPaid, amountPaidCents: toCents(amountPaid),
  });

  return created({ id: purchaseId, lotId, itemId });
}

// PATCH /api/purchases?id= — record a later/partial payment against an
// already-recorded purchase (e.g. settling a credit delivery via M-Pesa weeks
// after receipt). Locked so two concurrent settlements can't race each other.
export async function PATCH(req: Request) {
  const limited = writeRateLimited(req);
  if (limited) return limited;
  const session = await getSession();
  if (!session) return unauthorized();
  if (!ALLOWED.includes(session.role)) return forbidden();
  const tid = session.tenantId;

  const id = new URL(req.url).searchParams.get('id');
  if (!id) return badRequest('id required');
  const parsed = await parseBody(req, purchasePaymentSchema);
  if ('error' in parsed) return parsed.error;
  const body = parsed.data;

  try {
    await db.transaction(async (tx) => {
      const [row] = await tx.select().from(purchases)
        .where(and(eq(purchases.tenantId, tid), eq(purchases.id, id))).for('update').limit(1);
      if (!row) throw new PurchaseNotFound();
      const amountPaid = Math.min(Math.max(0, body.amountPaid), row.totalCost);
      await tx.update(purchases).set({
        amountPaid, amountPaidCents: toCents(amountPaid),
        paidAt: amountPaid >= row.totalCost ? (body.paidAt || new Date().toISOString()) : (body.paidAt ?? null),
        paymentMethod: body.paymentMethod ?? row.paymentMethod,
      }).where(and(eq(purchases.tenantId, tid), eq(purchases.id, id)));
    });
  } catch (err) {
    if (err instanceof PurchaseNotFound) return notFound();
    throw err;
  }
  return ok({ id });
}
