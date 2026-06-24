import 'server-only';
// Report data builder — computes real, exportable datasets from the DB.
import { db } from '@/db';
import {
  batches, productionRecords, mortalityRecords, sales, healthRecords, laborLogs, feedingRecords,
} from '@/db/schemas';
import { eq } from 'drizzle-orm';
import { computeBatchCost, computeDashboardKPIs } from './costing';

export interface ReportData {
  title: string;
  columns: string[];
  rows: (string | number)[][];
  meta: Record<string, string | number>;
}

const inRange = (d: string | null | undefined, from: string, to: string) => {
  if (!d) return true;
  const day = d.slice(0, 10);
  return day >= from && day <= to;
};

export async function buildReport(tenantId: string, type: string, from: string, to: string): Promise<ReportData> {
  const meta: Record<string, string | number> = { 'Date range': `${from} to ${to}`, Generated: new Date().toISOString().slice(0, 10) };
  const bs = await db.select().from(batches).where(eq(batches.tenantId, tenantId));
  const bn = new Map(bs.map((b) => [b.id, b.name]));
  const name = (id: string) => bn.get(id) ?? id;

  switch (type) {
    case 'pl': {
      const rows: (string | number)[][] = [];
      for (const b of bs) {
        const c = await computeBatchCost(tenantId, b.id);
        if (!c) continue;
        rows.push([b.name, c.feedCost, c.healthCost, c.laborCost, c.overheadCost, c.acquisitionCost, c.totalCost, c.totalRevenue, c.grossMargin]);
      }
      return { title: 'Profit & Loss by Batch (KES)', columns: ['Batch', 'Feed', 'Health', 'Labor', 'Overhead', 'Acquisition', 'Total Cost', 'Revenue', 'Gross Margin'], rows, meta };
    }
    case 'batch_card': {
      const rows: (string | number)[][] = [];
      for (const b of bs) {
        const c = await computeBatchCost(tenantId, b.id);
        if (!c) continue;
        rows.push([b.name, b.species, b.stage, c.fcr ?? '-', `${c.mortalityPct}%`, c.costPerUnit, c.totalCost, c.totalRevenue, c.grossMargin]);
      }
      return { title: 'Batch Performance Cards', columns: ['Batch', 'Species', 'Stage', 'FCR', 'Mortality', 'Cost/Unit', 'Total Cost', 'Revenue', 'Margin'], rows, meta };
    }
    case 'fcr': {
      const rows: (string | number)[][] = [];
      for (const b of bs) { const c = await computeBatchCost(tenantId, b.id); if (!c) continue; rows.push([b.name, c.fcr ?? '-', `${c.mortalityPct}%`, c.feedCost]); }
      return { title: 'FCR & Efficiency', columns: ['Batch', 'FCR', 'Mortality', 'Feed Cost (KES)'], rows, meta };
    }
    case 'production': {
      const rows = (await db.select().from(productionRecords).where(eq(productionRecords.tenantId, tenantId)))
        .filter((r) => inRange(r.capturedAt, from, to))
        .map((r) => [r.capturedAt.slice(0, 10), name(r.batchId), r.type, r.qty] as (string | number)[]);
      return { title: 'Production Summary', columns: ['Date', 'Batch', 'Type', 'Qty'], rows, meta };
    }
    case 'mortality': {
      const rows = (await db.select().from(mortalityRecords).where(eq(mortalityRecords.tenantId, tenantId)))
        .filter((r) => inRange(r.capturedAt, from, to))
        .map((r) => [r.capturedAt.slice(0, 10), name(r.batchId), r.count, r.cause ?? '-'] as (string | number)[]);
      return { title: 'Mortality Report', columns: ['Date', 'Batch', 'Deaths', 'Cause'], rows, meta };
    }
    case 'sales': {
      const rows = (await db.select().from(sales).where(eq(sales.tenantId, tenantId)))
        .filter((r) => inRange(r.createdAt, from, to))
        .map((r) => [r.createdAt.slice(0, 10), name(r.batchId), r.productType, r.quantity, r.unitPrice, r.totalAmount, r.buyer] as (string | number)[]);
      return { title: 'Sales & Receivables (KES)', columns: ['Date', 'Batch', 'Product', 'Qty', 'Unit Price', 'Total', 'Buyer'], rows, meta };
    }
    case 'vax': {
      const rows = (await db.select().from(healthRecords).where(eq(healthRecords.tenantId, tenantId)))
        .filter((r) => inRange(r.capturedAt, from, to))
        .map((r) => [r.capturedAt.slice(0, 10), name(r.batchId), r.type, r.productLotId ?? '-', r.quantity] as (string | number)[]);
      return { title: 'Vaccination & Treatment Log', columns: ['Date', 'Batch', 'Type', 'Lot', 'Qty'], rows, meta };
    }
    case 'labor': {
      const rows = (await db.select().from(laborLogs).where(eq(laborLogs.tenantId, tenantId)))
        .filter((r) => inRange(r.capturedAt, from, to))
        .map((r) => [r.capturedAt.slice(0, 10), r.batchId ? name(r.batchId) : '-', r.hours, r.ratePerHour, r.hours * r.ratePerHour] as (string | number)[]);
      return { title: 'Labor & Task Cost (KES)', columns: ['Date', 'Batch', 'Hours', 'Rate', 'Cost'], rows, meta };
    }
    case 'feed_var': {
      const feed = await db.select().from(feedingRecords).where(eq(feedingRecords.tenantId, tenantId));
      const byBatch = new Map<string, number>();
      for (const f of feed) byBatch.set(f.batchId, (byBatch.get(f.batchId) ?? 0) + f.quantityKg);
      const rows = [...byBatch.entries()].map(([b, kg]) => [name(b), kg] as (string | number)[]);
      return { title: 'Feed Consumption by Batch', columns: ['Batch', 'Feed kg'], rows, meta };
    }
    case 'baseline': {
      const k = await computeDashboardKPIs(tenantId);
      const labels: Record<string, string> = {
        activeBatches: 'Active batches', totalBirds: 'Total animals', mortalityPct: 'Mortality %',
        avgFCR: 'Average FCR', grossMargin: 'Gross margin (KES)', pendingAlerts: 'Pending alerts',
        taskCompletionPct: 'Task completion %', revenueThisMonth: 'Revenue this month (KES)',
      };
      const rows = Object.entries(k).map(([key, val]) => [labels[key] ?? key, String(val)] as (string | number)[]);
      return { title: 'Period Impact Summary', columns: ['Metric', 'Value'], rows, meta };
    }
    default:
      return { title: 'Report', columns: ['Info'], rows: [['This report type is not available yet']], meta };
  }
}
