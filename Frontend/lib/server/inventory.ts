import 'server-only';
import { db } from '@/db';
import { and, eq } from 'drizzle-orm';
import { productionRecords, sales, inventoryLots } from '@/db/schemas';

const round3 = (n: number) => Math.round(n * 1000) / 1000;

// How many BASE units of a HARVESTED OUTPUT (eggs, pork-by-weight, fish, maize,
// manure…) are still available to sell: everything collected/harvested
// (production records) minus everything already sold (in base units).
export async function productAvailability(tenantId: string, batchId: string, productName: string) {
  const name = productName.toLowerCase();
  const [prod, sld] = await Promise.all([
    db.select().from(productionRecords).where(and(eq(productionRecords.tenantId, tenantId), eq(productionRecords.batchId, batchId))),
    db.select().from(sales).where(and(eq(sales.tenantId, tenantId), eq(sales.batchId, batchId))),
  ]);
  const produced = prod.filter((p) => p.type.toLowerCase() === name).reduce((s, p) => s + p.qty, 0);
  const sold = sld.filter((x) => x.productType.toLowerCase() === name).reduce((s, x) => s + (x.baseQty ?? x.quantity), 0);
  return { produced, sold, available: round3(produced - sold) };
}

// Stock basis: a live animal sold per head draws down the batch headcount; every
// other product (eggs, pork-by-weight, fish, crops, manure) draws down what has
// been collected/harvested. `basis` lets the caller phrase the right error + know
// whether to decrement the living population on sale.
export type StockBasis = 'headcount' | 'harvested';

export interface SellableStock {
  basis: StockBasis;
  available: number; // base units still sellable
  produced?: number; // harvested basis only
  sold?: number;     // harvested basis only
}

interface ProductLike { name: string; isAnimalProduct?: boolean | null }
interface BatchLike { id: string; currentQty: number }

// Single source of truth for "how much of this product can still be sold".
// - Animal-per-head products: the living headcount IS the stock (no collection
//   step exists for a live bird/piglet — it's already alive in the batch).
// - Everything else: harvested/collected minus already sold.
export async function sellableStock(
  tenantId: string,
  batch: BatchLike,
  product: ProductLike,
): Promise<SellableStock> {
  if (product.isAnimalProduct) {
    return { basis: 'headcount', available: Math.max(0, batch.currentQty) };
  }
  const a = await productAvailability(tenantId, batch.id, product.name);
  return { basis: 'harvested', available: a.available, produced: a.produced, sold: a.sold };
}

export async function feedOnHand(tenantId: string, itemId: string) {
  const lots = await db.select().from(inventoryLots).where(and(eq(inventoryLots.tenantId, tenantId), eq(inventoryLots.itemId, itemId)));
  return lots.reduce((s, l) => s + l.qtyOnHand, 0);
}

// Decrement an item's lots FIFO (oldest first) by qty. Returns what was actually
// consumed and any shortfall (when more was logged than exists on hand).
export async function consumeFeedFIFO(tenantId: string, itemId: string, qty: number) {
  if (!itemId || qty <= 0) return { consumed: 0, shortfall: Math.max(0, qty) };
  const lots = (await db.select().from(inventoryLots).where(and(eq(inventoryLots.tenantId, tenantId), eq(inventoryLots.itemId, itemId))))
    .filter((l) => l.qtyOnHand > 0)
    .sort((a, b) => (a.receivedDate < b.receivedDate ? -1 : 1));
  let remaining = qty;
  for (const lot of lots) {
    if (remaining <= 0) break;
    const take = Math.min(lot.qtyOnHand, remaining);
    await db.update(inventoryLots).set({ qtyOnHand: Math.round((lot.qtyOnHand - take) * 1000) / 1000 }).where(eq(inventoryLots.id, lot.id));
    remaining -= take;
  }
  return { consumed: qty - remaining, shortfall: Math.max(0, remaining) };
}
