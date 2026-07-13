import 'server-only';
// Report data builder — fetches rows from the DB and delegates all shaping &
// arithmetic to the pure core in lib/reports.ts (which is unit-tested).
import { db } from '@/db';
import {
  batches, productionRecords, mortalityRecords, sales, healthRecords, laborLogs, feedingRecords,
  inventoryLots, employees, payslips, productionUnits,
} from '@/db/schemas';
import { and, eq, inArray } from 'drizzle-orm';
import { computeAllBatchCosts } from './costing';
import { totalMonthlyWageBill } from '@/lib/payroll';
import { periodsInRange } from '@/lib/payslip';
import {
  type ReportData, filterRange, dateInRange, profitAndLoss, fcrReport, batchCard,
  periodSummary,
} from '@/lib/reports';

export type { ReportData };

export async function buildReport(tenantId: string, type: string, from: string, to: string, unitId?: string | null): Promise<ReportData> {
  const today = new Date().toISOString().slice(0, 10);
  const rangeMeta: Record<string, string | number> = { 'Date range': `${from} to ${to}`, Generated: today };
  const lifeMeta: Record<string, string | number> = { Scope: 'Full batch lifecycle (all-time)', Generated: today };

  const allBs = await db.select().from(batches).where(eq(batches.tenantId, tenantId));
  const bs = unitId ? allBs.filter((b) => b.unitId === unitId) : allBs;
  const bn = new Map(bs.map((b) => [b.id, b.name]));
  const name = (id: string) => bn.get(id) ?? id;

  // Unit id -> name lookup, used both for the "breakdown by unit" column on the
  // per-batch report types and for the scoped-report meta line below.
  const units = await db.select().from(productionUnits).where(eq(productionUnits.tenantId, tenantId));
  const un = new Map(units.map((u) => [u.id, u.name]));
  const unitName = (id: string | null | undefined) => (id ? un.get(id) ?? 'Unassigned' : 'Unassigned');

  if (unitId) {
    rangeMeta.Unit = unitName(unitId);
    lifeMeta.Unit = unitName(unitId);
  }

  // Range-scope report types below query their activity tables independently
  // of `bs` (only by tenantId), so a unit filter has to be re-applied to each
  // one explicitly, restricted to the batch ids present in the (already
  // unit-filtered) `bs`. Rows with no batchId at all (e.g. general labor not
  // tied to any batch) aren't attributable to any single unit, so they drop
  // out of a unit-scoped view — but still show when no unit is selected.
  const batchIds = unitId ? new Set(bs.map((b) => b.id)) : null;
  const inScope = (batchId: string | null | undefined) => batchIds === null || (batchId != null && batchIds.has(batchId));

  // Per-batch lifecycle economics share one bulk-loaded cost pass (computeAllBatchCosts)
  // so Reports, Dashboard and the batch page all show the SAME totals — and this report
  // doesn't re-query every activity table once per batch (was a severe N+1).
  const batchCosts = async () => {
    const costs = await computeAllBatchCosts(tenantId);
    return bs.flatMap((b) => {
      const cost = costs.get(b.id);
      return cost ? [{ batch: b, cost }] : [];
    });
  };

  switch (type) {
    case 'pl': {
      const items = (await batchCosts()).map(({ batch, cost }) => ({ name: batch.name, unit: unitName(batch.unitId), cost }));
      return profitAndLoss(items, lifeMeta);
    }
    case 'fcr': {
      const items = (await batchCosts()).map(({ batch, cost }) => ({ name: batch.name, unit: unitName(batch.unitId), species: batch.species, cost }));
      return fcrReport(items, lifeMeta);
    }
    case 'batch_card': {
      const items = (await batchCosts()).map(({ batch, cost }) => ({ name: batch.name, unit: unitName(batch.unitId), species: batch.species, stage: batch.stage, cost }));
      return batchCard(items, lifeMeta);
    }
    case 'production': {
      const rows = filterRange(await db.select().from(productionRecords).where(eq(productionRecords.tenantId, tenantId)), (r) => r.capturedAt, from, to)
        .filter((r) => inScope(r.batchId))
        .map((r) => [r.capturedAt.slice(0, 10), name(r.batchId), r.type, r.qty] as (string | number)[]);
      return { title: 'Production Summary', columns: ['Date', 'Batch', 'Type', 'Qty'], rows, meta: rangeMeta, scope: 'range' };
    }
    case 'mortality': {
      const rows = filterRange(await db.select().from(mortalityRecords).where(eq(mortalityRecords.tenantId, tenantId)), (r) => r.capturedAt, from, to)
        .filter((r) => inScope(r.batchId))
        .map((r) => [r.capturedAt.slice(0, 10), name(r.batchId), r.count, r.cause ?? '-'] as (string | number)[]);
      return { title: 'Mortality Report', columns: ['Date', 'Batch', 'Deaths', 'Cause'], rows, meta: rangeMeta, scope: 'range' };
    }
    case 'sales': {
      const rows = filterRange(await db.select().from(sales).where(eq(sales.tenantId, tenantId)), (r) => r.createdAt, from, to)
        .filter((r) => inScope(r.batchId))
        .map((r) => [r.createdAt.slice(0, 10), name(r.batchId), r.productType, r.quantity, r.unitPrice, r.totalAmount, r.buyer] as (string | number)[]);
      return { title: 'Sales & Receivables (KSh)', columns: ['Date', 'Batch', 'Product', 'Qty', 'Unit Price', 'Total', 'Buyer'], rows, meta: rangeMeta, scope: 'range' };
    }
    case 'vax': {
      const rows = filterRange(await db.select().from(healthRecords).where(eq(healthRecords.tenantId, tenantId)), (r) => r.capturedAt, from, to)
        .filter((r) => inScope(r.batchId))
        .map((r) => [r.capturedAt.slice(0, 10), name(r.batchId), r.type, r.productLotId ?? '-', r.quantity] as (string | number)[]);
      return { title: 'Vaccination & Treatment Log', columns: ['Date', 'Batch', 'Type', 'Lot', 'Qty'], rows, meta: rangeMeta, scope: 'range' };
    }
    case 'labor': {
      const rows = filterRange(await db.select().from(laborLogs).where(eq(laborLogs.tenantId, tenantId)), (r) => r.capturedAt, from, to)
        .filter((r) => inScope(r.batchId))
        .map((r) => [r.capturedAt.slice(0, 10), r.batchId ? name(r.batchId) : '-', r.hours, r.ratePerHour, r.hours * r.ratePerHour] as (string | number)[]);
      return { title: 'Labor & Task Cost (KSh)', columns: ['Date', 'Batch', 'Hours', 'Rate', 'Cost'], rows, meta: rangeMeta, scope: 'range' };
    }
    case 'feed_var': {
      // Date-filtered: feed CONSUMED within the range, per batch.
      const feed = filterRange(await db.select().from(feedingRecords).where(eq(feedingRecords.tenantId, tenantId)), (r) => r.capturedAt, from, to)
        .filter((f) => inScope(f.batchId));
      const byBatch = new Map<string, number>();
      for (const f of feed) byBatch.set(f.batchId, (byBatch.get(f.batchId) ?? 0) + f.quantityKg);
      const rows = [...byBatch.entries()].map(([b, kg]) => [name(b), Math.round(kg * 100) / 100] as (string | number)[]);
      return { title: 'Feed Consumption by Batch', columns: ['Batch', 'Feed kg'], rows, meta: rangeMeta, scope: 'range' };
    }
    case 'baseline': {
      // Real, date-filtered period P&L from transactions (not a lifetime snapshot).
      const lots = await db.select().from(inventoryLots).where(eq(inventoryLots.tenantId, tenantId));
      const lotCost = new Map(lots.map((l) => [l.id, l.unitCost]));
      const feed = filterRange(await db.select().from(feedingRecords).where(eq(feedingRecords.tenantId, tenantId)), (r) => r.capturedAt, from, to)
        .filter((f) => inScope(f.batchId));
      const health = filterRange(await db.select().from(healthRecords).where(eq(healthRecords.tenantId, tenantId)), (r) => r.capturedAt, from, to)
        .filter((h) => inScope(h.batchId));
      const labor = filterRange(await db.select().from(laborLogs).where(eq(laborLogs.tenantId, tenantId)), (r) => r.capturedAt, from, to)
        .filter((l) => inScope(l.batchId));
      const salesRows = filterRange(await db.select().from(sales).where(eq(sales.tenantId, tenantId)), (r) => r.createdAt, from, to)
        .filter((s) => inScope(s.batchId));
      const emps = await db.select().from(employees).where(eq(employees.tenantId, tenantId));

      // Real payroll for the periods this range overlaps — RUN payroll (any
      // status), not just paid, matching the payroll API's own convention.
      // A period with no payslips at all is a genuine data gap, filled with the
      // current-staff wage-bill estimate for just that one month.
      const periods = periodsInRange(from, to);
      const periodSlips = periods.length
        ? await db.select().from(payslips).where(and(eq(payslips.tenantId, tenantId), inArray(payslips.period, periods)))
        : [];
      const grossByPeriod = new Map<string, number>();
      for (const p of periodSlips) grossByPeriod.set(p.period, (grossByPeriod.get(p.period) ?? 0) + p.gross);
      const finesTotal = periodSlips.reduce((s, p) => s + p.fines, 0);
      const missingPeriods = periods.filter((p) => !grossByPeriod.has(p));
      const realSalary = [...grossByPeriod.values()].reduce((s, g) => s + g, 0);
      const estimateSalary = missingPeriods.length ? totalMonthlyWageBill(emps) * missingPeriods.length : 0;
      const salaryCost = realSalary + estimateSalary;

      // Staff fines are farm income too (see app/owner/finance/page.tsx's monthFines).
      const revenue = salesRows.reduce((s, x) => s + x.totalAmount, 0) + finesTotal;
      const feedCost = feed.reduce((s, f) => s + f.quantityKg * (lotCost.get(f.lotId ?? '') ?? 0), 0);
      const healthCost = health.reduce((s, h) => s + h.quantity * (lotCost.get(h.productLotId ?? '') ?? 0), 0);
      const labourCost = labor.reduce((s, l) => s + l.hours * l.ratePerHour, 0);
      const acquisitionCost = bs.filter((b) => dateInRange(b.acquiredDate, from, to)).reduce((s, b) => s + b.acquisitionCost, 0);

      return periodSummary({ revenue, feedCost, healthCost, labourCost, salaryCost, acquisitionCost }, rangeMeta);
    }
    default:
      return { title: 'Report', columns: ['Info'], rows: [['This report type is not available yet']], meta: rangeMeta, scope: 'range' };
  }
}
