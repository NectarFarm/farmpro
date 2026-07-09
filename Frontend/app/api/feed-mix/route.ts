import { db } from '@/db';
import { inventoryItems, inventoryLots, feedFormulas } from '@/db/schemas';
import { and, eq } from 'drizzle-orm';
import { getSession } from '@/lib/server/session';
import { ok, created, unauthorized, forbidden, badRequest, notFound } from '@/lib/server/http';
import { parseBody, feedMixCreateSchema, feedMixUpdateSchema } from '@/lib/server/validate';
import { toCents } from '@/lib/server/money';
import { readRateLimited, writeRateLimited } from '@/lib/server/rateLimit';
import type { Role } from '@/lib/types';

const ALLOWED: Role[] = ['owner', 'manager'];

// PATCH /api/feed-mix?id=... { name?, components? } — edit a saved recipe in place.
// Recomputes the recipe's cost from current ingredient prices; does NOT consume stock.
export async function PATCH(req: Request) {
  const limited = writeRateLimited(req);
  if (limited) return limited;
  const session = await getSession();
  if (!session) return unauthorized();
  if (!ALLOWED.includes(session.role)) return forbidden();
  const id = new URL(req.url).searchParams.get('id');
  if (!id) return badRequest('id required');
  const [formula] = await db.select().from(feedFormulas).where(and(eq(feedFormulas.tenantId, session.tenantId), eq(feedFormulas.id, id))).limit(1);
  if (!formula) return notFound('Recipe not found.');

  const parsed = await parseBody(req, feedMixUpdateSchema);
  if ('error' in parsed) return parsed.error;
  const body = parsed.data;
  const name = (body.name ?? formula.name).trim();
  const components = (body.components ?? formula.components).filter((c) => c.itemId && Number(c.kg) > 0);
  if (!name) return badRequest('Recipe name required.');
  if (!components.length) return badRequest('Add at least one ingredient.');

  let totalKg = 0, totalCost = 0;
  for (const c of components) {
    const lots = await db.select().from(inventoryLots).where(and(eq(inventoryLots.tenantId, session.tenantId), eq(inventoryLots.itemId, c.itemId)));
    const avg = lots.length ? lots.reduce((s, l) => s + l.unitCost, 0) / lots.length : 0;
    totalKg += Number(c.kg);
    totalCost += Number(c.kg) * avg;
  }
  const unitCost = totalKg > 0 ? Math.round((totalCost / totalKg) * 100) / 100 : 0;
  await db.update(feedFormulas).set({ name, components, totalKg, unitCost, unitCostCents: toCents(unitCost) })
    .where(and(eq(feedFormulas.tenantId, session.tenantId), eq(feedFormulas.id, id)));
  return ok({ id, unitCost, totalKg });
}

// GET /api/feed-mix — saved formulas (recipes), newest first, so they can be reused.
export async function GET(req: Request) {
  const limited = readRateLimited(req);
  if (limited) return limited;
  const session = await getSession();
  if (!session) return unauthorized();
  if (!ALLOWED.includes(session.role)) return forbidden();
  const rows = await db.select().from(feedFormulas).where(eq(feedFormulas.tenantId, session.tenantId));
  rows.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  return ok(rows);
}

// DELETE /api/feed-mix?id=... — remove a saved formula (does not undo past mixes).
export async function DELETE(req: Request) {
  const limited = writeRateLimited(req);
  if (limited) return limited;
  const session = await getSession();
  if (!session) return unauthorized();
  if (!ALLOWED.includes(session.role)) return forbidden();
  const id = new URL(req.url).searchParams.get('id');
  if (!id) return badRequest('id required');
  await db.delete(feedFormulas).where(and(eq(feedFormulas.tenantId, session.tenantId), eq(feedFormulas.id, id)));
  return ok({ id, deleted: true });
}

// POST /api/feed-mix  { name, components: [{ itemId, kg }] }
// Consumes ingredient lots (FIFO), produces a finished-feed lot with rolled-up cost.
export async function POST(req: Request) {
  const limited = writeRateLimited(req);
  if (limited) return limited;
  const session = await getSession();
  if (!session) return unauthorized();
  if (!ALLOWED.includes(session.role)) return forbidden();

  const parsed = await parseBody(req, feedMixCreateSchema);
  if ('error' in parsed) return parsed.error;
  const body = parsed.data;
  const name = body.name;
  const components = body.components.filter((c) => c.itemId && c.kg > 0);

  let totalKg = 0;
  let totalCost = 0;

  // Same FIFO-consumption shape as lib/server/inventory.ts's consumeFeedFIFO, locked
  // per ingredient FOR UPDATE inside one transaction so a concurrent sync/purchase
  // touching the same lot can't read the same qtyOnHand and lose this decrement.
  for (const c of components) {
    const kg = Number(c.kg);
    const result = await db.transaction(async (tx) => {
      const lots = (await tx.select().from(inventoryLots)
        .where(and(eq(inventoryLots.tenantId, session.tenantId), eq(inventoryLots.itemId, c.itemId)))
        .for('update'))
        .sort((a, b) => (a.receivedDate < b.receivedDate ? -1 : 1)); // FIFO
      const available = lots.reduce((s, l) => s + l.qtyOnHand, 0);
      if (available < kg) return { ok: false as const, available };

      let remaining = kg;
      let cost = 0;
      for (const lot of lots) {
        if (remaining <= 0) break;
        const take = Math.min(remaining, lot.qtyOnHand);
        cost += take * lot.unitCost;
        await tx.update(inventoryLots).set({ qtyOnHand: lot.qtyOnHand - take }).where(eq(inventoryLots.id, lot.id));
        remaining -= take;
      }
      return { ok: true as const, cost };
    });
    if (!result.ok) return badRequest(`insufficient stock for one ingredient (need ${kg}, have ${result.available})`);

    totalCost += result.cost;
    totalKg += kg;
  }

  const unitCost = totalKg > 0 ? totalCost / totalKg : 0;

  // Find or create the finished-feed item by name.
  const existing = await db.select().from(inventoryItems)
    .where(and(eq(inventoryItems.tenantId, session.tenantId), eq(inventoryItems.name, name)));
  let itemId = existing[0]?.id;
  if (!itemId) {
    itemId = crypto.randomUUID();
    await db.insert(inventoryItems).values({
      id: itemId, tenantId: session.tenantId, name, category: 'FEED_FINISHED', unit: 'kg', lowStockThreshold: 0,
    });
  }

  const now = new Date().toISOString();
  const lotId = crypto.randomUUID();
  await db.insert(inventoryLots).values({
    id: lotId, tenantId: session.tenantId, itemId, lotNo: `MIX-${now.slice(0, 10)}-${lotId.slice(0, 4)}`,
    qtyOnHand: totalKg, unit: 'kg', unitCost: Math.round(unitCost * 100) / 100,
    unitCostCents: toCents(Math.round(unitCost * 100) / 100), receivedDate: now.slice(0, 10),
  });

  const roundedUnitCost = Math.round(unitCost * 100) / 100;
  await db.insert(feedFormulas).values({
    id: crypto.randomUUID(), tenantId: session.tenantId, name, components, totalKg,
    unitCost: roundedUnitCost, unitCostCents: toCents(roundedUnitCost), createdAt: now,
  });

  return created({ itemId, lotId, totalKg, unitCost: Math.round(unitCost * 100) / 100 });
}
