import 'server-only';
import { db } from '@/db';
import type { DbClient } from '@/db';
import { and, eq } from 'drizzle-orm';
import { productionRecords, sales, inventoryLots, healthRecords } from '@/db/schemas';
import { defaultLiveWeightKg } from './productTemplates';

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
export type StockBasis = 'headcount' | 'harvested' | 'biomass';

export interface SellableStock {
  basis: StockBasis;
  available: number;     // base units still sellable
  produced?: number;     // harvested basis only
  sold?: number;         // harvested basis only
  avgWeightKg?: number;  // biomass basis only (kg per live animal)
}

interface ProductLike { name: string; isAnimalProduct?: boolean | null; baseUnit?: string | null }
interface BatchLike { id: string; currentQty: number; species?: string | null; avgWeightKg?: number | null }

// The avg live weight to value a weight-sold animal by: the batch's sampled weight,
// else a sensible per-species default. 0 means "unknown" (no cap can be derived).
export function liveWeightFor(batch: BatchLike): number {
  if (batch.avgWeightKg && batch.avgWeightKg > 0) return batch.avgWeightKg;
  const d = batch.species ? defaultLiveWeightKg(batch.species) : null;
  return d && d > 0 ? d : 0;
}

// Single source of truth for "how much of this product can still be sold".
// - The MAIN animal itself is LIVE STOCK, never "collected": a live bird/piglet
//   sold per head is capped by the head count; a fish/pig sold by weight is capped
//   by biomass (head × avg live weight).
// - Genuinely collected/harvested outputs (eggs, manure, maize) — collected minus sold.
export async function sellableStock(
  tenantId: string,
  batch: BatchLike,
  product: ProductLike,
): Promise<SellableStock> {
  if (product.isAnimalProduct) {
    if ((product.baseUnit ?? 'head') === 'head') {
      return { basis: 'headcount', available: Math.max(0, batch.currentQty) };
    }
    const avg = liveWeightFor(batch);
    return { basis: 'biomass', available: avg > 0 ? round3(Math.max(0, batch.currentQty) * avg) : 0, avgWeightKg: avg };
  }
  const a = await productAvailability(tenantId, batch.id, product.name);
  return { basis: 'harvested', available: a.available, produced: a.produced, sold: a.sold };
}

export interface WithdrawalStatus {
  cleared: boolean;
  until: string | null;
  daysLeft: number;
}

// BR-WD: is this batch cleared for sale? A batch is NOT cleared if any of its
// health records carry a withdrawal period that hasn't elapsed yet (capturedAt +
// withdrawalDays days > today). `healthRecords.withdrawalDays` is a snapshot
// taken at the time the record was written (see app/api/sync/route.ts's health
// handler and app/api/prescriptions/route.ts) — NOT re-derived from the current
// state of whatever lot the treatment happened to reference, because a lot's
// withdrawalDays is a single mutable value shared by every record that ever used
// it: a later, unrelated dispense from the same lot with a shorter (or unset)
// withdrawal period would otherwise retroactively "clear" an earlier treatment
// whose real window hasn't passed yet. Cleared only once ALL windows have passed.
//
// This is called both by the read-only /api/withdrawal-check endpoint (for the
// UI banner) AND by the sales-creation path itself (app/api/data/[resource]/route.ts)
// — the UI banner alone is advisory only; this function is the actual enforcement.
export async function checkWithdrawal(tenantId: string, batchId: string, client: DbClient = db): Promise<WithdrawalStatus> {
  const rows = await client.select({
    capturedAt: healthRecords.capturedAt,
    withdrawalDays: healthRecords.withdrawalDays,
  })
    .from(healthRecords)
    .where(and(eq(healthRecords.tenantId, tenantId), eq(healthRecords.batchId, batchId)));

  let latestClearAt: number | null = null;
  for (const r of rows) {
    if (r.withdrawalDays == null) continue;
    const capturedMs = new Date(r.capturedAt).getTime();
    if (Number.isNaN(capturedMs)) continue;
    const clearMs = capturedMs + r.withdrawalDays * 86400000;
    if (latestClearAt == null || clearMs > latestClearAt) latestClearAt = clearMs;
  }

  const now = Date.now();
  const cleared = latestClearAt == null || now >= latestClearAt;
  const daysLeft = cleared ? 0 : Math.ceil((latestClearAt! - now) / 86400000);
  const until = cleared ? null : new Date(latestClearAt!).toISOString().slice(0, 10);
  return { cleared, until, daysLeft };
}

export async function feedOnHand(tenantId: string, itemId: string) {
  const lots = await db.select().from(inventoryLots).where(and(eq(inventoryLots.tenantId, tenantId), eq(inventoryLots.itemId, itemId)));
  return lots.reduce((s, l) => s + l.qtyOnHand, 0);
}

// Decrement an item's lots FIFO (oldest first) by qty. Returns what was actually
// consumed and any shortfall (when more was logged than exists on hand).
//
// Runs its own transaction (a real one, or — if `client` is already a transaction
// handle — a nested savepoint) and locks the candidate lot rows FOR UPDATE before
// reading them. Without this, two concurrent syncs consuming from the same lot can
// both read the same qtyOnHand and both write back a decrement from that stale
// value, silently losing one of the two consumptions.
export async function consumeFeedFIFO(tenantId: string, itemId: string, qty: number, client: DbClient = db) {
  if (!itemId || qty <= 0) return { consumed: 0, shortfall: Math.max(0, qty) };
  return client.transaction(async (tx) => {
    const lots = (await tx.select().from(inventoryLots)
      .where(and(eq(inventoryLots.tenantId, tenantId), eq(inventoryLots.itemId, itemId)))
      .for('update'))
      .filter((l) => l.qtyOnHand > 0)
      .sort((a, b) => (a.receivedDate < b.receivedDate ? -1 : 1));
    let remaining = qty;
    for (const lot of lots) {
      if (remaining <= 0) break;
      const take = Math.min(lot.qtyOnHand, remaining);
      await tx.update(inventoryLots).set({ qtyOnHand: Math.round((lot.qtyOnHand - take) * 1000) / 1000 }).where(eq(inventoryLots.id, lot.id));
      remaining -= take;
    }
    return { consumed: qty - remaining, shortfall: Math.max(0, remaining) };
  });
}
