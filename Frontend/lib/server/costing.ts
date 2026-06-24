import 'server-only';
// Costing engine (FR-M10) — demo computes on-read; the heavy/scheduled version
// belongs to the Celery tier per ARCHITECTURE. Activity-based roll-up per batch.
import { db } from '@/db';
import {
  batches, feedingRecords, mortalityRecords, productionRecords, sales, inventoryLots, alerts, tasks,
  healthRecords, laborLogs, overheads,
} from '@/db/schemas';
import { and, eq } from 'drizzle-orm';
import type { BatchCostSummary } from '@/lib/types';

const round = (n: number) => Math.round(n * 100) / 100;

export async function computeBatchCost(tenantId: string, batchId: string): Promise<BatchCostSummary | null> {
  const [batch] = await db.select().from(batches)
    .where(and(eq(batches.tenantId, tenantId), eq(batches.id, batchId))).limit(1);
  if (!batch) return null;

  const lots = await db.select().from(inventoryLots).where(eq(inventoryLots.tenantId, tenantId));
  const lotCost = new Map(lots.map((l) => [l.id, l.unitCost]));

  const feedings = await db.select().from(feedingRecords)
    .where(and(eq(feedingRecords.tenantId, tenantId), eq(feedingRecords.batchId, batchId)));
  let feedKg = 0, feedCost = 0;
  for (const f of feedings) {
    feedKg += f.quantityKg;
    feedCost += f.quantityKg * (lotCost.get(f.lotId ?? '') ?? 0);
  }

  const morts = await db.select().from(mortalityRecords)
    .where(and(eq(mortalityRecords.tenantId, tenantId), eq(mortalityRecords.batchId, batchId)));
  const deaths = morts.reduce((s, m) => s + m.count, 0);

  const prod = await db.select().from(productionRecords)
    .where(and(eq(productionRecords.tenantId, tenantId), eq(productionRecords.batchId, batchId)));
  const eggs = prod.filter((p) => p.type === 'eggs').reduce((s, p) => s + p.qty, 0);

  const salesRows = await db.select().from(sales)
    .where(and(eq(sales.tenantId, tenantId), eq(sales.batchId, batchId)));
  const totalRevenue = salesRows.reduce((s, x) => s + x.totalAmount, 0);

  const healthRows = await db.select().from(healthRecords)
    .where(and(eq(healthRecords.tenantId, tenantId), eq(healthRecords.batchId, batchId)));
  const healthCost = healthRows.reduce((s, h) => s + h.quantity * (lotCost.get(h.productLotId ?? '') ?? 0), 0);

  const laborRows = await db.select().from(laborLogs)
    .where(and(eq(laborLogs.tenantId, tenantId), eq(laborLogs.batchId, batchId)));
  const laborCost = laborRows.reduce((s, l) => s + l.hours * l.ratePerHour, 0);

  // Overhead allocated to this batch by population share (driver=population).
  const overheadRows = await db.select().from(overheads).where(eq(overheads.tenantId, tenantId));
  const totalOverhead = overheadRows.reduce((s, o) => s + o.amount, 0);
  const activeBatches = await db.select({ id: batches.id, qty: batches.currentQty, status: batches.status })
    .from(batches).where(eq(batches.tenantId, tenantId));
  const totalActiveQty = activeBatches.filter((b) => b.status === 'ACTIVE').reduce((s, b) => s + b.qty, 0);
  const share = totalActiveQty > 0 ? batch.currentQty / totalActiveQty : 0;
  const overheadCost = batch.status === 'ACTIVE' ? totalOverhead * share : 0;

  const totalCost = batch.acquisitionCost + feedCost + healthCost + laborCost + overheadCost;
  const grossMargin = totalRevenue - totalCost;
  const mortalityPct = batch.initialQty ? (deaths / batch.initialQty) * 100 : 0;
  const costPerUnit = eggs > 0 ? totalCost / eggs : 0;
  // Indicative layer FCR: feed kg per dozen eggs.
  const fcr = eggs > 0 ? (feedKg / eggs) * 12 : undefined;

  return {
    batchId,
    acquisitionCost: batch.acquisitionCost,
    feedCost: round(feedCost), healthCost: round(healthCost), laborCost: round(laborCost), overheadCost: round(overheadCost),
    totalCost: round(totalCost), totalRevenue: round(totalRevenue), grossMargin: round(grossMargin),
    costPerUnit: round(costPerUnit), outputUnit: 'eggs',
    mortalityPct: round(mortalityPct),
    fcr: fcr !== undefined ? round(fcr) : undefined,
  };
}

export async function computeDashboardKPIs(tenantId: string) {
  const allBatches = await db.select().from(batches).where(eq(batches.tenantId, tenantId));
  const active = allBatches.filter((b) => b.status === 'ACTIVE');
  const totalBirds = active.reduce((s, b) => s + b.currentQty, 0);
  const initial = allBatches.reduce((s, b) => s + b.initialQty, 0);

  const morts = await db.select().from(mortalityRecords).where(eq(mortalityRecords.tenantId, tenantId));
  const deaths = morts.reduce((s, m) => s + m.count, 0);

  const salesRows = await db.select().from(sales).where(eq(sales.tenantId, tenantId));
  const totalRevenue = salesRows.reduce((s, x) => s + x.totalAmount, 0);
  const month = new Date().toISOString().slice(0, 7);
  const revenueThisMonth = salesRows
    .filter((x) => (x.createdAt ?? '').slice(0, 7) === month)
    .reduce((s, x) => s + x.totalAmount, 0);

  let totalCost = 0, fcrSum = 0, fcrN = 0;
  for (const b of allBatches) {
    const c = await computeBatchCost(tenantId, b.id);
    if (!c) continue;
    totalCost += c.totalCost;
    if (b.status === 'ACTIVE' && c.fcr) { fcrSum += c.fcr; fcrN++; }
  }

  const alertRows = await db.select().from(alerts).where(eq(alerts.tenantId, tenantId));
  const taskRows = await db.select().from(tasks).where(eq(tasks.tenantId, tenantId));

  return {
    activeBatches: active.length,
    totalBirds,
    mortalityPct: initial ? round((deaths / initial) * 100) : 0,
    avgFCR: fcrN ? round(fcrSum / fcrN) : 0,
    grossMargin: Math.round(totalRevenue - totalCost),
    pendingAlerts: alertRows.filter((a) => !a.acknowledged).length,
    taskCompletionPct: taskRows.length
      ? Math.round((taskRows.filter((t) => t.status === 'DONE').length / taskRows.length) * 100)
      : 0,
    revenueThisMonth: Math.round(revenueThisMonth),
  };
}
