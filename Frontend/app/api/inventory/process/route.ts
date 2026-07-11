import { db } from '@/db';
import { inventoryItems, inventoryLots, processingEvents } from '@/db/schemas';
import { and, eq } from 'drizzle-orm';
import { getSession } from '@/lib/server/session';
import { ok, created, unauthorized, forbidden, badRequest } from '@/lib/server/http';
import { parseBody, processSchema } from '@/lib/server/validate';
import { toCents, fromCents } from '@/lib/server/money';
import { readRateLimited, writeRateLimited } from '@/lib/server/rateLimit';
import { consumeFeedFIFO } from '@/lib/server/inventory';
import type { Role } from '@/lib/types';

const ALLOWED: Role[] = ['owner', 'manager'];

// GET /api/inventory/process — recent milling/processing events (tenant-scoped).
export async function GET(req: Request) {
  const limited = readRateLimited(req);
  if (limited) return limited;
  const session = await getSession();
  if (!session) return unauthorized();
  if (!ALLOWED.includes(session.role)) return forbidden();
  return ok(await db.select().from(processingEvents).where(eq(processingEvents.tenantId, session.tenantId)));
}

// POST /api/inventory/process — mill/convert one item into a different,
// already-existing item at less than 1:1 (e.g. 74kg whole maize -> 73kg
// flour, optionally plus a milling fee). Consumes the input item's stock FIFO
// (same locked convention as feed-mix), then creates a new lot for the output
// item costed at (input cost consumed + fee) / output qty — so the flour's
// cost basis correctly reflects the raw maize cost spread over the smaller
// yielded quantity, not re-priced at the input's per-kg cost.
export async function POST(req: Request) {
  const limited = writeRateLimited(req);
  if (limited) return limited;
  const session = await getSession();
  if (!session) return unauthorized();
  if (!ALLOWED.includes(session.role)) return forbidden();

  const parsed = await parseBody(req, processSchema);
  if ('error' in parsed) return parsed.error;
  const body = parsed.data;
  const tid = session.tenantId;

  if (body.inputItemId === body.outputItemId) return badRequest('Input and output must be different items.');

  let outputItemId = body.outputItemId;
  let outputUnit = body.outputUnit;
  if (outputItemId === '__new') {
    if (!body.outputItemName) return badRequest('outputItemId or outputItemName required');
    outputItemId = crypto.randomUUID();
    await db.insert(inventoryItems).values({
      id: outputItemId, tenantId: tid, name: body.outputItemName, category: body.outputCategory,
      unit: outputUnit, lowStockThreshold: 0,
    });
  } else {
    const [outputItem] = await db.select().from(inventoryItems)
      .where(and(eq(inventoryItems.tenantId, tid), eq(inventoryItems.id, outputItemId))).limit(1);
    if (!outputItem) return badRequest('unknown output item');
    outputUnit = outputItem.unit;
  }

  const result = await consumeFeedFIFO(tid, body.inputItemId, body.inputQty, db);
  if (result.shortfall > 0) return badRequest(`Not enough stock of the input item — short by ${result.shortfall}.`);

  const outputUnitCost = (result.costConsumed + body.fee) / body.outputQty;
  const lotId = crypto.randomUUID();
  const now = new Date().toISOString();
  await db.insert(inventoryLots).values({
    id: lotId, tenantId: tid, itemId: outputItemId, lotNo: `PROC-${now.slice(0, 10)}-${lotId.slice(0, 4)}`,
    qtyOnHand: body.outputQty, unit: outputUnit,
    unitCost: outputUnitCost, unitCostCents: toCents(outputUnitCost),
    receivedDate: now.slice(0, 10),
  });

  const eventId = crypto.randomUUID();
  await db.insert(processingEvents).values({
    id: eventId, tenantId: tid,
    inputItemId: body.inputItemId, inputQty: body.inputQty,
    outputItemId, outputQty: body.outputQty,
    fee: body.fee, feeCents: toCents(body.fee), note: body.note ?? null,
    recordedBy: session.userId, capturedAt: now,
  });

  return created({ id: eventId, lotId, outputUnitCost: fromCents(toCents(outputUnitCost)) });
}
