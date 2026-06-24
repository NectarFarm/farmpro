import 'server-only';
import { db } from '@/db';
import { productionRecords, sales, batches, inventoryLots, feedingRecords, healthRecords, laborLogs } from '@/db/schemas';
import { and, eq } from 'drizzle-orm';

// Daily production per real product (Eggs, Manure, Pork…) + revenue, last 14 days.
export async function productionSeries(tenantId: string) {
  const prod = await db.select().from(productionRecords).where(eq(productionRecords.tenantId, tenantId));
  const salesRows = await db.select().from(sales).where(eq(sales.tenantId, tenantId));
  const days: string[] = [];
  for (let i = 13; i >= 0; i--) { const d = new Date(); d.setDate(d.getDate() - i); days.push(d.toISOString().slice(0, 10)); }
  const products = [...new Set(prod.map((p) => p.type))];
  const data: Record<string, string | number>[] = days.map((day) => {
    const row: Record<string, string | number> = {
      date: new Date(day).toLocaleDateString('en-KE', { day: 'numeric', month: 'short' }),
      revenue: salesRows.filter((x) => (x.createdAt ?? '').slice(0, 10) === day).reduce((s, x) => s + x.totalAmount, 0),
    };
    for (const name of products) {
      row[name] = prod.filter((p) => p.type === name && p.capturedAt.slice(0, 10) === day).reduce((s, p) => s + p.qty, 0);
    }
    return row;
  });
  return { data, products };
}

// Cumulative cost vs revenue by day for a batch — for the batch P&L area chart.
export async function cumulativeSeries(tenantId: string, batchId: string) {
  const [batch] = await db.select().from(batches).where(and(eq(batches.tenantId, tenantId), eq(batches.id, batchId))).limit(1);
  if (!batch) return [];
  const lots = await db.select().from(inventoryLots).where(eq(inventoryLots.tenantId, tenantId));
  const lotCost = new Map(lots.map((l) => [l.id, l.unitCost]));
  const feed = await db.select().from(feedingRecords).where(and(eq(feedingRecords.tenantId, tenantId), eq(feedingRecords.batchId, batchId)));
  const health = await db.select().from(healthRecords).where(and(eq(healthRecords.tenantId, tenantId), eq(healthRecords.batchId, batchId)));
  const labor = await db.select().from(laborLogs).where(and(eq(laborLogs.tenantId, tenantId), eq(laborLogs.batchId, batchId)));
  const salesRows = await db.select().from(sales).where(and(eq(sales.tenantId, tenantId), eq(sales.batchId, batchId)));

  const start = new Date(batch.acquiredDate);
  const end = new Date();
  const days: string[] = [];
  for (const d = new Date(start); d <= end && days.length < 60; d.setDate(d.getDate() + 1)) days.push(new Date(d).toISOString().slice(0, 10));
  if (days.length === 0) days.push(end.toISOString().slice(0, 10));

  return days.map((day, i) => {
    const feedCost = feed.filter((f) => f.capturedAt.slice(0, 10) <= day).reduce((s, f) => s + f.quantityKg * (lotCost.get(f.lotId ?? '') ?? 0), 0);
    const healthCost = health.filter((h) => h.capturedAt.slice(0, 10) <= day).reduce((s, h) => s + h.quantity * (lotCost.get(h.productLotId ?? '') ?? 0), 0);
    const laborCost = labor.filter((l) => l.capturedAt.slice(0, 10) <= day).reduce((s, l) => s + l.hours * l.ratePerHour, 0);
    const revenue = salesRows.filter((x) => (x.createdAt ?? '').slice(0, 10) <= day).reduce((s, x) => s + x.totalAmount, 0);
    return { day: i + 1, cost: Math.round(batch.acquisitionCost + feedCost + healthCost + laborCost), revenue: Math.round(revenue) };
  });
}
