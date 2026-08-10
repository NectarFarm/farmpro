import 'server-only';
// Costing engine (FR-M10) — demo computes on-read; the heavy/scheduled version
// belongs to the Celery tier per ARCHITECTURE. Activity-based roll-up per batch.
import { db } from '@/db';
import {
  batches, feedingRecords, mortalityRecords, productionRecords, sales, inventoryLots, alerts, tasks,
  healthRecords, laborLogs, overheads, employees, payslips, products,
} from '@/db/schemas';
import { and, eq } from 'drizzle-orm';
import { resolveEnterprise } from './productTemplates';
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

// How feed-conversion is expressed for a given enterprise, keyed EXPLICITLY per
// enterprise — never inferred from a product's baseUnit or name. baseUnit alone
// is ambiguous (maize's driver is also 'kg' but has no FCR concept at all; a duck
// driver is 'piece' just like an egg driver but with the same per-dozen meaning).
// See #23.
export type FcrMode = 'PER_KG' | 'PER_BASE_UNIT' | 'PER_DOZEN' | 'NONE';

const FCR_MODE_BY_ENTERPRISE: Record<string, FcrMode> = {
  layers: 'PER_DOZEN',     // driver: Eggs (piece) — feed kg / dozen eggs
  ducks: 'PER_DOZEN',      // driver: Eggs (duck) (piece) — feed kg / dozen eggs
  broilers: 'NONE',        // driver: Live bird (head) — no mass without an optional weight sample
  pig_fatten: 'PER_KG',    // driver: Pork (live weight) (kg)
  pig_breed: 'NONE',       // driver: Piglets (head) — feed-per-piglet-born isn't a conversion ratio
  tilapia: 'PER_KG',       // driver: Fish (kg)
  catfish: 'PER_KG',       // driver: Fish (kg)
  rabbits: 'PER_KG',       // driver: Rabbit meat (kg)
  maize: 'NONE',           // driver: Maize grain (kg) — a crop; no feed-conversion concept at all
  goats: 'PER_BASE_UNIT',  // driver: Milk (litre) — feed kg / litre milk
  dairy: 'PER_BASE_UNIT',  // driver: Milk (litre) — feed kg / litre milk
  bees: 'NONE',            // driver: Honey (kg) — forage-based, not a purchased-feed conversion animal
};

// Only 'kg' is a mass-dimensioned base unit among the ones products.ts uses
// (piece | head | kg | litre) — litre is volume, not mass, and is deliberately
// NOT treated as kg (no density conversion is stored anywhere).
const MASS_BASE_UNIT = 'kg';

type CostInputs = {
  lotCost: Map<string, number>;
  feedings: { quantityKg: number; lotId: string | null }[];
  morts: { count: number }[];
  prod: { type: string; qty: number; weightKg: number | null; productId: string | null; baseUnit: string | null }[];
  salesRows: { totalAmount: number; weightKg: number | null }[];
  healthRows: { quantity: number; productLotId: string | null }[];
  laborRows: { hours: number; ratePerHour: number }[];
  // This batch's own products (from productTemplates.ts, one per batch). Exactly
  // one is expected to have isCostDriver=true, but a batch predating #21, or a
  // batch whose products were hand-edited, may have none — costPerUnit/fcr must
  // then come back `undefined`, never a division against a driver that isn't there.
  products: { id: string; baseUnit: string; isCostDriver: boolean }[];
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
    products: batchProducts, totalOverhead, totalActiveQty, batchLabourCost } = inputs;

  let feedKg = 0, feedCost = 0;
  for (const f of feedings) {
    feedKg += f.quantityKg;
    feedCost += f.quantityKg * (lotCost.get(f.lotId ?? '') ?? 0);
  }

  const deaths = morts.reduce((s, m) => s + m.count, 0);
  const eggs = prod.filter((p) => p.type.toLowerCase().includes('egg')).reduce((s, p) => s + p.qty, 0);
  const totalRevenue = salesRows.reduce((s, x) => s + x.totalAmount, 0);

  const enterprise = resolveEnterprise(batch);
  const isLayer = enterprise === 'layers';

  const healthCost = healthRows.reduce((s, h) => s + h.quantity * (lotCost.get(h.productLotId ?? '') ?? 0), 0);
  const laborCost = laborRows.reduce((s, l) => s + l.hours * l.ratePerHour, 0);
  const salaryCost = Math.max(0, batchLabourCost);

  const share = totalActiveQty > 0 ? batch.currentQty / totalActiveQty : 0;
  const overheadCost = batch.status === 'ACTIVE' ? totalOverhead * share : 0;

  const totalCost = batch.acquisitionCost + feedCost + healthCost + laborCost + salaryCost + overheadCost;
  const grossMargin = totalRevenue - totalCost;
  const mortalityPct = batch.initialQty ? (deaths / batch.initialQty) * 100 : 0;

  // The costing denominator: the batch's own cost-driver product (see #21 —
  // products.isCostDriver, exactly one per batch). No driver configured (batches
  // predating #21, or hand-edited products) → outputQty/costPerUnit/fcr all come
  // back `undefined`, distinguishable from a driver that exists but has zero
  // output recorded (outputQty === 0, also undefined costPerUnit/fcr, but NOT the
  // same absence — see outputQty on the returned summary).
  const driver = batchProducts.find((p) => p.isCostDriver);

  // Sum ONLY rows that reference the driver product by id — a NULL product_id
  // (unresolved legacy/backfill rows, or rows for a different product entirely)
  // is excluded by this strict equality, never coerced to 0 or matched via `??`.
  // Also guard against unit drift: production_records.baseUnit is a snapshot of
  // the product's base unit AT CAPTURE TIME (see migration 0039); products.baseUnit
  // is the CURRENT value. If a product's base unit was edited after some records
  // were captured, those older qty values are not on the same scale as newer ones
  // and must not be silently summed together — only rows whose snapshot still
  // matches the driver's current base unit (or rows with no snapshot at all, i.e.
  // pre-0039 legacy data) count toward output.
  const driverRows = driver
    ? prod.filter((p) => p.productId === driver.id && (p.baseUnit == null || p.baseUnit === driver.baseUnit))
    : [];
  const outputQty = driver ? driverRows.reduce((s, p) => s + p.qty, 0) : undefined;
  const outputUnit = driver?.baseUnit ?? '';
  const costPerUnit = outputQty !== undefined && outputQty > 0 ? totalCost / outputQty : undefined;

  // producedKg exists only when the driver's OWN base unit is already mass
  // (kg) — no unit-conversion table is maintained for turning head/piece/litre
  // into kg, so anything else stays `undefined` rather than guessing a factor.
  const producedKg = outputQty !== undefined && outputUnit === MASS_BASE_UNIT ? outputQty : undefined;

  const fcrMode = FCR_MODE_BY_ENTERPRISE[enterprise ?? ''] ?? 'NONE';
  let fcr: number | undefined;
  if (feedKg > 0) {
    if (fcrMode === 'PER_DOZEN' && outputQty !== undefined && outputQty > 0) fcr = feedKg / (outputQty / 12);
    else if (fcrMode === 'PER_KG' && producedKg !== undefined && producedKg > 0) fcr = feedKg / producedKg;
    else if (fcrMode === 'PER_BASE_UNIT' && outputQty !== undefined && outputQty > 0) fcr = feedKg / outputQty;
    // fcrMode === 'NONE' → fcr stays undefined; meaningless for this enterprise
    // (e.g. maize is a crop, not an animal converting feed into product).
  }
  // weightKg on production/sales rows is kept ONLY as an optional secondary
  // measurement (e.g. a bag of maize that was also weighed) — it is never read
  // here as the primary source of output. See #23.

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
    costPerUnit: costPerUnit !== undefined ? round(costPerUnit) : undefined, outputUnit,
    // Distinguishes the three states callers may need to react to differently:
    // undefined = no cost-driver product configured for this batch at all;
    // 0         = a driver exists but nothing has been recorded against it yet
    //             (e.g. a "goats" batch run for meat, never milked);
    // >0        = a real output figure. costPerUnit/fcr collapse the first two
    // into `undefined` (both make a division meaningless), but outputQty keeps
    // them distinguishable for any caller that wants to tell "not set up" apart
    // from "set up, nothing recorded yet".
    outputQty,
    fcrMode,
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
  // This batch's own products — needed to find the cost-driver (see #23).
  const batchProducts = await db.select({ id: products.id, baseUnit: products.baseUnit, isCostDriver: products.isCostDriver })
    .from(products).where(and(eq(products.tenantId, tenantId), eq(products.batchId, batchId)));

  return summarizeBatchCost(batch, {
    lotCost,
    feedings: feedings.map((f) => ({ quantityKg: f.quantityKg, lotId: f.lotId })),
    morts: morts.map((m) => ({ count: m.count })),
    prod: prod.map((p) => ({ type: p.type, qty: p.qty, weightKg: p.weightKg, productId: p.productId, baseUnit: p.baseUnit })),
    salesRows: salesRows.map((x) => ({ totalAmount: x.totalAmount, weightKg: x.weightKg })),
    healthRows: healthRows.map((h) => ({ quantity: h.quantity, productLotId: h.productLotId })),
    laborRows: laborRows.map((l) => ({ hours: l.hours, ratePerHour: l.ratePerHour })),
    products: batchProducts,
    totalOverhead,
    totalActiveQty,
    batchLabourCost,
  });
}

// Bulk-loads every activity table for a tenant ONCE and rolls up per-batch costs
// in memory — shared by the dashboard KPIs, reports, and admin analytics so none
// of them fall back to N calls of computeBatchCost (one query round-trip per batch).
export async function computeAllBatchCosts(tenantId: string): Promise<Map<string, BatchCostSummary>> {
  const [allBatches, morts, salesRows, lots, feedings, allProd, healthRows, laborRows, overheadRows, allProducts, alloc] =
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
      db.select({ id: products.id, batchId: products.batchId, baseUnit: products.baseUnit, isCostDriver: products.isCostDriver })
        .from(products).where(eq(products.tenantId, tenantId)),
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
  const productsByBatch = groupBy(allProducts, (p) => p.batchId ?? '');

  const out = new Map<string, BatchCostSummary>();
  for (const b of allBatches) {
    out.set(b.id, summarizeBatchCost(b, {
      lotCost,
      feedings: (feedByBatch.get(b.id) ?? []).map((f) => ({ quantityKg: f.quantityKg, lotId: f.lotId })),
      morts: (mortByBatch.get(b.id) ?? []).map((m) => ({ count: m.count })),
      prod: (productionByBatch.get(b.id) ?? []).map((p) => ({ type: p.type, qty: p.qty, weightKg: p.weightKg, productId: p.productId, baseUnit: p.baseUnit })),
      salesRows: (salesByBatch.get(b.id) ?? []).map((x) => ({ totalAmount: x.totalAmount, weightKg: x.weightKg })),
      healthRows: (healthByBatch.get(b.id) ?? []).map((h) => ({ quantity: h.quantity, productLotId: h.productLotId })),
      laborRows: (laborByBatchMap.get(b.id) ?? []).map((l) => ({ hours: l.hours, ratePerHour: l.ratePerHour })),
      products: (productsByBatch.get(b.id) ?? []).map((p) => ({ id: p.id, baseUnit: p.baseUnit, isCostDriver: p.isCostDriver })),
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
    const ent = resolveEnterprise(b) || 'other';
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
    const ent = resolveEnterprise(batch) || 'other';
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
    // How many active batches actually contributed a real fcr to the average
    // above. Since #23, fcr is legitimately `undefined` for whole enterprises
    // (maize, pig breeding, bees…) and for any batch whose driver has zero
    // output recorded — avgFCR alone can't tell "genuinely 0" apart from "no
    // batch had FCR data at all". Consumers that must not present a 0 as a real
    // figure (e.g. the AI Advisor prompt) should check this before trusting avgFCR.
    avgFCRSampleSize: fcrN,
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
