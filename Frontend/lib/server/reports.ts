import 'server-only';
// Report data builder — fetches rows from the DB and delegates all shaping &
// arithmetic to the pure core in lib/reports.ts (which is unit-tested).
import { db } from '@/db';
import {
  batches, productionRecords, mortalityRecords, sales, healthRecords, laborLogs, feedingRecords,
  inventoryLots, employees,
} from '@/db/schemas';
import { eq } from 'drizzle-orm';
import { computeBatchCost, batchLabour } from './costing';
import { totalMonthlyWageBill } from '@/lib/payroll';
import {
  type ReportData, filterRange, dateInRange, profitAndLoss, fcrReport, batchCard,
  periodSummary, monthsOverlapping,
} from '@/lib/reports';

export type { ReportData };

export async function buildReport(tenantId: string, type: string, from: string, to: string): Promise<ReportData> {
  const today = new Date().toISOString().slice(0, 10);
  const rangeMeta: Record<string, string | number> = { 'Date range': `${from} to ${to}`, Generated: today };
  const lifeMeta: Record<string, string | number> = { Scope: 'Full batch lifecycle (all-time)', Generated: today };

  const bs = await db.select().from(batches).where(eq(batches.tenantId, tenantId));
  const bn = new Map(bs.map((b) => [b.id, b.name]));
  const name = (id: string) => bn.get(id) ?? id;

  // Per-batch lifecycle economics share one salary-allocation pass so Reports,
  // Dashboard and the batch page all show the SAME totals.
  const batchCosts = async () => {
    const alloc = await batchLabour(tenantId);
    const out: { batch: typeof bs[number]; cost: NonNullable<Awaited<ReturnType<typeof computeBatchCost>>> }[] = [];
    for (const b of bs) {
      const cost = await computeBatchCost(tenantId, b.id, alloc[b.id] ?? 0);
      if (cost) out.push({ batch: b, cost });
    }
    return out;
  };

  switch (type) {
    case 'pl': {
      const items = (await batchCosts()).map(({ batch, cost }) => ({ name: batch.name, cost }));
      return profitAndLoss(items, lifeMeta);
    }
    case 'fcr': {
      const items = (await batchCosts()).map(({ batch, cost }) => ({ name: batch.name, species: batch.species, cost }));
      return fcrReport(items, lifeMeta);
    }
    case 'batch_card': {
      const items = (await batchCosts()).map(({ batch, cost }) => ({ name: batch.name, species: batch.species, stage: batch.stage, cost }));
      return batchCard(items, lifeMeta);
    }
    case 'production': {
      const rows = filterRange(await db.select().from(productionRecords).where(eq(productionRecords.tenantId, tenantId)), (r) => r.capturedAt, from, to)
        .map((r) => [r.capturedAt.slice(0, 10), name(r.batchId), r.type, r.qty] as (string | number)[]);
      return { title: 'Production Summary', columns: ['Date', 'Batch', 'Type', 'Qty'], rows, meta: rangeMeta, scope: 'range' };
    }
    case 'mortality': {
      const rows = filterRange(await db.select().from(mortalityRecords).where(eq(mortalityRecords.tenantId, tenantId)), (r) => r.capturedAt, from, to)
        .map((r) => [r.capturedAt.slice(0, 10), name(r.batchId), r.count, r.cause ?? '-'] as (string | number)[]);
      return { title: 'Mortality Report', columns: ['Date', 'Batch', 'Deaths', 'Cause'], rows, meta: rangeMeta, scope: 'range' };
    }
    case 'sales': {
      const rows = filterRange(await db.select().from(sales).where(eq(sales.tenantId, tenantId)), (r) => r.createdAt, from, to)
        .map((r) => [r.createdAt.slice(0, 10), name(r.batchId), r.productType, r.quantity, r.unitPrice, r.totalAmount, r.buyer] as (string | number)[]);
      return { title: 'Sales & Receivables (KSh)', columns: ['Date', 'Batch', 'Product', 'Qty', 'Unit Price', 'Total', 'Buyer'], rows, meta: rangeMeta, scope: 'range' };
    }
    case 'vax': {
      const rows = filterRange(await db.select().from(healthRecords).where(eq(healthRecords.tenantId, tenantId)), (r) => r.capturedAt, from, to)
        .map((r) => [r.capturedAt.slice(0, 10), name(r.batchId), r.type, r.productLotId ?? '-', r.quantity] as (string | number)[]);
      return { title: 'Vaccination & Treatment Log', columns: ['Date', 'Batch', 'Type', 'Lot', 'Qty'], rows, meta: rangeMeta, scope: 'range' };
    }
    case 'labor': {
      const rows = filterRange(await db.select().from(laborLogs).where(eq(laborLogs.tenantId, tenantId)), (r) => r.capturedAt, from, to)
        .map((r) => [r.capturedAt.slice(0, 10), r.batchId ? name(r.batchId) : '-', r.hours, r.ratePerHour, r.hours * r.ratePerHour] as (string | number)[]);
      return { title: 'Labor & Task Cost (KSh)', columns: ['Date', 'Batch', 'Hours', 'Rate', 'Cost'], rows, meta: rangeMeta, scope: 'range' };
    }
    case 'feed_var': {
      // Date-filtered: feed CONSUMED within the range, per batch.
      const feed = filterRange(await db.select().from(feedingRecords).where(eq(feedingRecords.tenantId, tenantId)), (r) => r.capturedAt, from, to);
      const byBatch = new Map<string, number>();
      for (const f of feed) byBatch.set(f.batchId, (byBatch.get(f.batchId) ?? 0) + f.quantityKg);
      const rows = [...byBatch.entries()].map(([b, kg]) => [name(b), Math.round(kg * 100) / 100] as (string | number)[]);
      return { title: 'Feed Consumption by Batch', columns: ['Batch', 'Feed kg'], rows, meta: rangeMeta, scope: 'range' };
    }
    case 'baseline': {
      // Real, date-filtered period P&L from transactions (not a lifetime snapshot).
      const lots = await db.select().from(inventoryLots).where(eq(inventoryLots.tenantId, tenantId));
      const lotCost = new Map(lots.map((l) => [l.id, l.unitCost]));
      const feed = filterRange(await db.select().from(feedingRecords).where(eq(feedingRecords.tenantId, tenantId)), (r) => r.capturedAt, from, to);
      const health = filterRange(await db.select().from(healthRecords).where(eq(healthRecords.tenantId, tenantId)), (r) => r.capturedAt, from, to);
      const labor = filterRange(await db.select().from(laborLogs).where(eq(laborLogs.tenantId, tenantId)), (r) => r.capturedAt, from, to);
      const salesRows = filterRange(await db.select().from(sales).where(eq(sales.tenantId, tenantId)), (r) => r.createdAt, from, to);
      const emps = await db.select().from(employees).where(eq(employees.tenantId, tenantId));

      const revenue = salesRows.reduce((s, x) => s + x.totalAmount, 0);
      const feedCost = feed.reduce((s, f) => s + f.quantityKg * (lotCost.get(f.lotId ?? '') ?? 0), 0);
      const healthCost = health.reduce((s, h) => s + h.quantity * (lotCost.get(h.productLotId ?? '') ?? 0), 0);
      const labourCost = labor.reduce((s, l) => s + l.hours * l.ratePerHour, 0);
      const acquisitionCost = bs.filter((b) => dateInRange(b.acquiredDate, from, to)).reduce((s, b) => s + b.acquisitionCost, 0);
      // Wage bill applied to the elapsed portion of the range (current staff).
      const salaryCost = totalMonthlyWageBill(emps) * monthsOverlapping(from, to, from, today);

      return periodSummary({ revenue, feedCost, healthCost, labourCost, salaryCost, acquisitionCost }, rangeMeta);
    }
    default:
      return { title: 'Report', columns: ['Info'], rows: [['This report type is not available yet']], meta: rangeMeta, scope: 'range' };
  }
}
