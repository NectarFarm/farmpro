import 'server-only';
// Costing engine (FR-M10) — demo computes on-read; the heavy/scheduled version
// belongs to the Celery tier per ARCHITECTURE. Activity-based roll-up per batch.
import { db } from '@/db';
import {
  batches, feedingRecords, mortalityRecords, productionRecords, sales, inventoryLots, alerts, tasks,
  healthRecords, laborLogs, overheads, employees, payslips,
} from '@/db/schemas';
import { and, eq } from 'drizzle-orm';
import { enterpriseFromSpecies } from './productTemplates';
import { labourByBatch } from '@/lib/payroll';
import type { BatchCostSummary } from '@/lib/types';

// ACTUAL labour cost per batch, from real payroll: each worker's total RUN payroll
// gross (summed across their payslips, whichever period, whether paid or still
// pending) allocated across the batches they're assigned to by head share. This is
// the committed/run wage figure, not a live-salary estimate — a payslip's gross is
// snapshotted at run time, so changing a salary never rewrites a batch's historical
// labour. Computed once per request and fed into computeBatchCost (keeps it query-stable).
export async function batchLabour(tenantId: string): Promise<Record<string, number>> {
  const [emps, bs, slips] = await Promise.all([
    db.select({ id: employees.id, assignedBatchIds: employees.assignedBatchIds }).from(employees).where(eq(employees.tenantId, tenantId)),
    db.select({ id: batches.id, currentQty: batches.currentQty, status: batches.status }).from(batches).where(eq(batches.tenantId, tenantId)),
    db.select({ employeeId: payslips.employeeId, gross: payslips.gross }).from(payslips).where(eq(payslips.tenantId, tenantId)),
  ]);
  const grossByEmp = new Map<string, number>();
  for (const s of slips) grossByEmp.set(s.employeeId, (grossByEmp.get(s.employeeId) ?? 0) + s.gross);
  return labourByBatch(emps.map((e) => ({ paidGross: grossByEmp.get(e.id) ?? 0, assignedBatchIds: e.assignedBatchIds })), bs);
}

const round = (n: number) => Math.round(n * 100) / 100;

type BatchRow = {
  id: string;
  species: string | null;
  acquisitionCost: number;
  initialQty: number;
  currentQty: number;
  status: string;
  acquiredDate: string;
};

type CostInputs = {
  lotCost: Map<string, number>;
  feedings: { quantityKg: number; lotId: string | null }[];
  morts: { count: number }[];
  prod: { type: string; qty: number; weightKg: number | null }[];
  salesRows: { totalAmount: number; weightKg: number | null }[];
  healthRows: { quantity: number; productLotId: string | null }[];
  laborRows: { hours: number; ratePerHour: number }[];
  totalOverhead: number;
  totalActiveQty: number;
  batchLabourCost: number;
};

/**
 * Pure cost roll-up for one batch given pre-loaded activity rows.
 * Shared by single-batch computeBatchCost and bulk dashboard KPIs (avoids N+1).
 */
export function summarizeBatchCost(batch: BatchRow, inputs: CostInputs): BatchCostSummary {
  const { lotCost, feedings, morts, prod, salesRows, healthRows, laborRows,
    totalOverhead, totalActiveQty, batchLabourCost } = inputs;

  let feedKg = 0, feedCost = 0;
  for (const f of feedings) {
    feedKg += f.quantityKg;
    feedCost += f.quantityKg * (lotCost.get(f.lotId ?? '') ?? 0);
  }

  const deaths = morts.reduce((s, m) => s + m.count, 0);
  const eggs = prod.filter((p) => p.type.toLowerCase().includes('egg')).reduce((s, p) => s + p.qty, 0);
  const totalRevenue = salesRows.reduce((s, x) => s + x.totalAmount, 0);

  const enterprise = enterpriseFromSpecies(batch.species || '');
  const isLayer = enterprise === 'layers';
  const producedKg = prod.reduce((s, p) => s + (p.weightKg ?? 0), 0)
    + salesRows.reduce((s, x) => s + (x.weightKg ?? 0), 0);

  const healthCost = healthRows.reduce((s, h) => s + h.quantity * (lotCost.get(h.productLotId ?? '') ?? 0), 0);
  const laborCost = laborRows.reduce((s, l) => s + l.hours * l.ratePerHour, 0);
  const salaryCost = Math.max(0, batchLabourCost);

  const share = totalActiveQty > 0 ? batch.currentQty / totalActiveQty : 0;
  const overheadCost = batch.status === 'ACTIVE' ? totalOverhead * share : 0;

  const totalCost = batch.acquisitionCost + feedCost + healthCost + laborCost + salaryCost + overheadCost;
  const grossMargin = totalRevenue - totalCost;
  const mortalityPct = batch.initialQty ? (deaths / batch.initialQty) * 100 : 0;

  const outputUnit = isLayer ? 'eggs' : 'kg';
  const outputQty = isLayer ? eggs : producedKg;
  const costPerUnit = outputQty > 0 ? totalCost / outputQty : 0;
  const fcr = isLayer
    ? (eggs > 0 ? (feedKg / eggs) * 12 : undefined)
    : (producedKg > 0 ? feedKg / producedKg : undefined);

  let henDayPct: number | undefined;
  let henHousedPct: number | undefined;
  if (isLayer && eggs > 0) {
    const daysInCycle = Math.max(1, Math.floor((Date.now() - new Date(batch.acquiredDate).getTime()) / 86400000));
    const avgHens = Math.max(1, (batch.initialQty + Math.max(0, batch.initialQty - deaths)) / 2);
    henDayPct = Math.min(100, Math.round((eggs / (avgHens * daysInCycle)) * 100));
    henHousedPct = Math.min(100, Math.round((eggs / (batch.initialQty * daysInCycle)) * 100));
  }

  const currentQty = batch.currentQty;
  const survivors = Math.max(0, batch.initialQty - deaths);
  const soldHead = Math.max(0, survivors - currentQty);
  const remainingQty = Math.max(0, currentQty);
  const costPerBird = survivors > 0 ? totalCost / survivors : 0;
  const neededFromRemaining = totalCost - totalRevenue;
  const breakEvenPricePerRemaining = remainingQty > 0 && neededFromRemaining > 0
    ? neededFromRemaining / remainingQty
    : 0;

  return {
    batchId: batch.id,
    acquisitionCost: batch.acquisitionCost,
    feedCost: round(feedCost), healthCost: round(healthCost), laborCost: round(laborCost), salaryCost: round(salaryCost), overheadCost: round(overheadCost),
    totalCost: round(totalCost), totalRevenue: round(totalRevenue), grossMargin: round(grossMargin),
    costPerUnit: round(costPerUnit), outputUnit,
    mortalityPct: round(mortalityPct),
    fcr: fcr !== undefined ? round(fcr) : undefined,
    henDayPct, henHousedPct,
    currentQty,
    costPerBird: round(costPerBird),
    breakEvenPricePerRemaining: round(breakEvenPricePerRemaining),
    remainingQty,
    survivors,
    soldHead,
    deaths,
  };
}

// `batchLabourCost` is this batch's ACTUAL labour-to-date from payroll (via
// costing.batchLabour), computed by the caller so this function stays query-stable.
export async function computeBatchCost(
  tenantId: string,
  batchId: string,
  batchLabourCost = 0,
): Promise<BatchCostSummary | null> {
  const [batch] = await db.select().from(batches)
    .where(and(eq(batches.tenantId, tenantId), eq(batches.id, batchId))).limit(1);
  if (!batch) return null;

  const lots = await db.select().from(inventoryLots).where(eq(inventoryLots.tenantId, tenantId));
  const lotCost = new Map(lots.map((l) => [l.id, l.unitCost]));

  const feedings = await db.select().from(feedingRecords)
    .where(and(eq(feedingRecords.tenantId, tenantId), eq(feedingRecords.batchId, batchId)));
  const morts = await db.select().from(mortalityRecords)
    .where(and(eq(mortalityRecords.tenantId, tenantId), eq(mortalityRecords.batchId, batchId)));
  const prod = await db.select().from(productionRecords)
    .where(and(eq(productionRecords.tenantId, tenantId), eq(productionRecords.batchId, batchId)));
  const salesRows = await db.select().from(sales)
    .where(and(eq(sales.tenantId, tenantId), eq(sales.batchId, batchId)));
  const healthRows = await db.select().from(healthRecords)
    .where(and(eq(healthRecords.tenantId, tenantId), eq(healthRecords.batchId, batchId)));
  const laborRows = await db.select().from(laborLogs)
    .where(and(eq(laborLogs.tenantId, tenantId), eq(laborLogs.batchId, batchId)));
  const overheadRows = await db.select().from(overheads).where(eq(overheads.tenantId, tenantId));
  const totalOverhead = overheadRows.reduce((s, o) => s + o.amount, 0);
  const activeBatches = await db.select({ id: batches.id, qty: batches.currentQty, status: batches.status })
    .from(batches).where(eq(batches.tenantId, tenantId));
  const totalActiveQty = activeBatches.filter((b) => b.status === 'ACTIVE').reduce((s, b) => s + b.qty, 0);

  return summarizeBatchCost(batch, {
    lotCost,
    feedings: feedings.map((f) => ({ quantityKg: f.quantityKg, lotId: f.lotId })),
    morts: morts.map((m) => ({ count: m.count })),
    prod: prod.map((p) => ({ type: p.type, qty: p.qty, weightKg: p.weightKg })),
    salesRows: salesRows.map((x) => ({ totalAmount: x.totalAmount, weightKg: x.weightKg })),
    healthRows: healthRows.map((h) => ({ quantity: h.quantity, productLotId: h.productLotId })),
    laborRows: laborRows.map((l) => ({ hours: l.hours, ratePerHour: l.ratePerHour })),
    totalOverhead,
    totalActiveQty,
    batchLabourCost,
  });
}

// Bulk-loads every activity table for a tenant ONCE and rolls up per-batch costs
// in memory — shared by the dashboard KPIs, reports, and admin analytics so none
// of them fall back to N calls of computeBatchCost (one query round-trip per batch).
export async function computeAllBatchCosts(tenantId: string): Promise<Map<string, BatchCostSummary>> {
  const [allBatches, morts, salesRows, lots, feedings, allProd, healthRows, laborRows, overheadRows, alloc] =
    await Promise.all([
      db.select().from(batches).where(eq(batches.tenantId, tenantId)),
      db.select().from(mortalityRecords).where(eq(mortalityRecords.tenantId, tenantId)),
      db.select().from(sales).where(eq(sales.tenantId, tenantId)),
      db.select().from(inventoryLots).where(eq(inventoryLots.tenantId, tenantId)),
      db.select().from(feedingRecords).where(eq(feedingRecords.tenantId, tenantId)),
      db.select().from(productionRecords).where(eq(productionRecords.tenantId, tenantId)),
      db.select().from(healthRecords).where(eq(healthRecords.tenantId, tenantId)),
      db.select().from(laborLogs).where(eq(laborLogs.tenantId, tenantId)),
      db.select().from(overheads).where(eq(overheads.tenantId, tenantId)),
      batchLabour(tenantId),
    ]);

  const lotCost = new Map(lots.map((l) => [l.id, l.unitCost]));
  const totalOverhead = overheadRows.reduce((s, o) => s + o.amount, 0);
  const totalActiveQty = allBatches.filter((b) => b.status === 'ACTIVE').reduce((s, b) => s + b.currentQty, 0);

  const feedByBatch = groupBy(feedings, (f) => f.batchId);
  const mortByBatch = groupBy(morts, (m) => m.batchId);
  const productionByBatch = groupBy(allProd, (p) => p.batchId);
  const salesByBatch = groupBy(salesRows, (s) => s.batchId);
  const healthByBatch = groupBy(healthRows, (h) => h.batchId);
  const laborByBatchMap = groupBy(laborRows, (l) => l.batchId ?? '');

  const out = new Map<string, BatchCostSummary>();
  for (const b of allBatches) {
    out.set(b.id, summarizeBatchCost(b, {
      lotCost,
      feedings: (feedByBatch.get(b.id) ?? []).map((f) => ({ quantityKg: f.quantityKg, lotId: f.lotId })),
      morts: (mortByBatch.get(b.id) ?? []).map((m) => ({ count: m.count })),
      prod: (productionByBatch.get(b.id) ?? []).map((p) => ({ type: p.type, qty: p.qty, weightKg: p.weightKg })),
      salesRows: (salesByBatch.get(b.id) ?? []).map((x) => ({ totalAmount: x.totalAmount, weightKg: x.weightKg })),
      healthRows: (healthByBatch.get(b.id) ?? []).map((h) => ({ quantity: h.quantity, productLotId: h.productLotId })),
      laborRows: (laborByBatchMap.get(b.id) ?? []).map((l) => ({ hours: l.hours, ratePerHour: l.ratePerHour })),
      totalOverhead,
      totalActiveQty,
      batchLabourCost: alloc[b.id] ?? 0,
    }));
  }
  return out;
}

export async function computeDashboardKPIs(tenantId: string) {
  // Bulk-load tenant data once (was N× per-batch computeBatchCost = severe N+1).
  const [
    allBatches,
    morts,
    salesRows,
    alertRows,
    taskRows,
    batchCosts,
  ] = await Promise.all([
    db.select().from(batches).where(eq(batches.tenantId, tenantId)),
    db.select().from(mortalityRecords).where(eq(mortalityRecords.tenantId, tenantId)),
    db.select().from(sales).where(eq(sales.tenantId, tenantId)),
    db.select().from(alerts).where(eq(alerts.tenantId, tenantId)),
    db.select().from(tasks).where(eq(tasks.tenantId, tenantId)),
    computeAllBatchCosts(tenantId),
  ]);

  const active = allBatches.filter((b) => b.status === 'ACTIVE');
  const totalBirds = active.reduce((s, b) => s + b.currentQty, 0);
  const initial = allBatches.reduce((s, b) => s + b.initialQty, 0);
  const deaths = morts.reduce((s, m) => s + m.count, 0);
  const totalRevenue = salesRows.reduce((s, x) => s + x.totalAmount, 0);

  const now = new Date();
  const month = now.toISOString().slice(0, 7);
  const year = month.slice(0, 4);
  const quarter = Math.floor(now.getMonth() / 3);
  const sumWhere = (pred: (createdAt: string) => boolean) =>
    salesRows.filter((x) => pred(x.createdAt ?? '')).reduce((s, x) => s + x.totalAmount, 0);
  const revenueThisMonth = sumWhere((d) => d.slice(0, 7) === month);
  const revenueThisYear = sumWhere((d) => d.slice(0, 4) === year);
  const revenueThisQuarter = sumWhere((d) => d.slice(0, 4) === year && Math.floor((Number(d.slice(5, 7)) - 1) / 3) === quarter);

  let totalCost = 0, fcrSum = 0, fcrN = 0;
  for (const b of allBatches) {
    const c = batchCosts.get(b.id);
    if (!c) continue;
    totalCost += c.totalCost;
    if (b.status === 'ACTIVE' && c.fcr) { fcrSum += c.fcr; fcrN++; }
  }

  const enterpriseBreaks: Record<string, { batches: number; animals: number; mortalityPct: number }> = {};
  const entDeaths: Record<string, number> = {};
  const entInitial: Record<string, number> = {};
  for (const b of allBatches) {
    const ent = enterpriseFromSpecies(b.species || '') || 'other';
    if (!enterpriseBreaks[ent]) enterpriseBreaks[ent] = { batches: 0, animals: 0, mortalityPct: 0 };
    if (b.status === 'ACTIVE') {
      enterpriseBreaks[ent].batches++;
      enterpriseBreaks[ent].animals += b.currentQty;
    }
    entInitial[ent] = (entInitial[ent] ?? 0) + b.initialQty;
  }
  for (const m of morts) {
    const batch = allBatches.find((b) => b.id === m.batchId);
    if (!batch) continue;
    const ent = enterpriseFromSpecies(batch.species || '') || 'other';
    entDeaths[ent] = (entDeaths[ent] ?? 0) + m.count;
  }
  for (const ent of Object.keys(enterpriseBreaks)) {
    enterpriseBreaks[ent].mortalityPct = entInitial[ent] > 0 ? round(((entDeaths[ent] ?? 0) / entInitial[ent]) * 100) : 0;
  }

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
    revenueThisQuarter: Math.round(revenueThisQuarter),
    revenueThisYear: Math.round(revenueThisYear),
    revenueAllTime: Math.round(totalRevenue),
    enterpriseBreaks,
  };
}

export function groupBy<T>(rows: T[], key: (r: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const r of rows) {
    const k = key(r);
    const arr = m.get(k);
    if (arr) arr.push(r);
    else m.set(k, [r]);
  }
  return m;
}
