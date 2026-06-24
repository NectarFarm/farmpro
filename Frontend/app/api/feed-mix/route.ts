import { db } from '@/db';
import { inventoryItems, inventoryLots, feedFormulas } from '@/db/schemas';
import { and, eq } from 'drizzle-orm';
import { getSession } from '@/lib/server/session';
import { ok, created, unauthorized, forbidden, badRequest, notFound } from '@/lib/server/http';
import type { Role } from '@/lib/types';

const ALLOWED: Role[] = ['owner', 'manager'];

// PATCH /api/feed-mix?id=... { name?, components? } — edit a saved recipe in place.
// Recomputes the recipe's cost from current ingredient prices; does NOT consume stock.
export async function PATCH(req: Request) {
  const session = await getSession();
  if (!session) return unauthorized();
  if (!ALLOWED.includes(session.role)) return forbidden();
  const id = new URL(req.url).searchParams.get('id');
  if (!id) return badRequest('id required');
  const [formula] = await db.select().from(feedFormulas).where(and(eq(feedFormulas.tenantId, session.tenantId), eq(feedFormulas.id, id))).limit(1);
  if (!formula) return notFound('Recipe not found.');

  const body = (await req.json().catch(() => ({}))) as { name?: string; components?: { itemId: string; kg: number }[] };
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
  await db.update(feedFormulas).set({ name, components, totalKg, unitCost }).where(and(eq(feedFormulas.tenantId, session.tenantId), eq(feedFormulas.id, id)));
  return ok({ id, unitCost, totalKg });
}

// GET /api/feed-mix — saved formulas (recipes), newest first, so they can be reused.
export async function GET() {
  const session = await getSession();
  if (!session) return unauthorized();
  if (!ALLOWED.includes(session.role)) return forbidden();
  const rows = await db.select().from(feedFormulas).where(eq(feedFormulas.tenantId, session.tenantId));
  rows.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  return ok(rows);
}

// DELETE /api/feed-mix?id=... — remove a saved formula (does not undo past mixes).
export async function DELETE(req: Request) {
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
  const session = await getSession();
  if (!session) return unauthorized();
  if (!ALLOWED.includes(session.role)) return forbidden();

  const body = (await req.json().catch(() => ({}))) as { name?: string; components?: { itemId: string; kg: number }[] };
  const name = (body.name ?? '').trim();
  const components = (body.components ?? []).filter((c) => c.itemId && Number(c.kg) > 0);
  if (!name) return badRequest('formula name required');
  if (!components.length) return badRequest('at least one ingredient required');

  let totalKg = 0;
  let totalCost = 0;

  for (const c of components) {
    const kg = Number(c.kg);
    const lots = await db.select().from(inventoryLots)
      .where(and(eq(inventoryLots.tenantId, session.tenantId), eq(inventoryLots.itemId, c.itemId)));
    lots.sort((a, b) => (a.receivedDate < b.receivedDate ? -1 : 1)); // FIFO
    const available = lots.reduce((s, l) => s + l.qtyOnHand, 0);
    if (available < kg) return badRequest(`insufficient stock for one ingredient (need ${kg}, have ${available})`);

    let remaining = kg;
    for (const lot of lots) {
      if (remaining <= 0) break;
      const take = Math.min(remaining, lot.qtyOnHand);
      totalCost += take * lot.unitCost;
      await db.update(inventoryLots).set({ qtyOnHand: lot.qtyOnHand - take }).where(eq(inventoryLots.id, lot.id));
      remaining -= take;
    }
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
    qtyOnHand: totalKg, unit: 'kg', unitCost: Math.round(unitCost * 100) / 100, receivedDate: now.slice(0, 10),
  });

  await db.insert(feedFormulas).values({
    id: crypto.randomUUID(), tenantId: session.tenantId, name, components, totalKg,
    unitCost: Math.round(unitCost * 100) / 100, createdAt: now,
  });

  return created({ itemId, lotId, totalKg, unitCost: Math.round(unitCost * 100) / 100 });
}
