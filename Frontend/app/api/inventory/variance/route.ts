import { db } from '@/db';
import { inventoryItems, inventoryLots, closingStockCounts } from '@/db/schemas';
import { eq } from 'drizzle-orm';
import { getSession } from '@/lib/server/session';
import { ok, unauthorized, forbidden } from '@/lib/server/http';
import type { Role } from '@/lib/types';

const ALLOWED: Role[] = ['owner', 'manager'];
const round = (n: number) => Math.round(n * 100) / 100;

// GET /api/inventory/variance — for each feed item with a closing-stock count,
// compare the worker's latest count vs the system's on-hand (FR-M4-4 / BR-11).
export async function GET() {
  const session = await getSession();
  if (!session) return unauthorized();
  if (!ALLOWED.includes(session.role)) return forbidden();

  const items = await db.select().from(inventoryItems).where(eq(inventoryItems.tenantId, session.tenantId));
  const lots = await db.select().from(inventoryLots).where(eq(inventoryLots.tenantId, session.tenantId));
  const counts = await db.select().from(closingStockCounts).where(eq(closingStockCounts.tenantId, session.tenantId));

  const onHand = (itemId: string) => lots.filter((l) => l.itemId === itemId).reduce((s, l) => s + l.qtyOnHand, 0);
  const latest = (itemId: string) =>
    counts.filter((c) => c.itemId === itemId).sort((a, b) => (a.capturedAt < b.capturedAt ? 1 : -1))[0];

  const out: { item: string; unit: string; expected: number; counted: number; variance: number }[] = [];
  for (const it of items.filter((i) => i.category.startsWith('FEED'))) {
    const c = latest(it.id);
    if (!c) continue;
    const expected = onHand(it.id);
    const variance = c.closingQty - expected;
    if (Math.abs(variance) > 0.5) {
      out.push({ item: it.name, unit: it.unit, expected: round(expected), counted: round(c.closingQty), variance: round(variance) });
    }
  }
  return ok(out);
}
