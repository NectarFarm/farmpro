// Pure reporting core — no DB, no I/O — so report shapes & arithmetic can be
// unit-tested exhaustively. The server module (lib/server/reports.ts) fetches the
// rows and delegates assembly here.
//
// Two kinds of report, with DIFFERENT scope (kept honest & explicit):
//   • 'range'     — transaction logs filtered to [from, to] (sales, production…).
//   • 'lifecycle' — per-batch economics over the batch's whole life (P&L, FCR…),
//                   which is NOT date-filtered. The UI labels each accordingly.
import type { BatchCostSummary } from './types';

export type ReportScope = 'range' | 'lifecycle';

export interface ReportData {
  title: string;
  columns: string[];
  rows: (string | number)[][];
  meta: Record<string, string | number>;
  scope: ReportScope;
}

// A row is in range when its date (day precision) is within [from, to] inclusive.
// Undated rows are EXCLUDED from a date-scoped report (a dated report must not
// silently include records with no date).
export function dateInRange(iso: string | null | undefined, from: string, to: string): boolean {
  if (!iso) return false;
  const day = iso.slice(0, 10);
  return day >= from && day <= to;
}

export function filterRange<T>(rows: readonly T[], getIso: (r: T) => string | null | undefined, from: string, to: string): T[] {
  return rows.filter((r) => dateInRange(getIso(r), from, to));
}

const r2 = (n: number) => Math.round(n * 100) / 100;

// ─── Per-batch economics (lifecycle) ────────────────────────────────────────
export const PL_COLUMNS = ['Batch', 'Feed', 'Health', 'Labour', 'Salaries', 'Overhead', 'Acquisition', 'Total Cost', 'Revenue', 'Gross Margin'];

export function plRow(name: string, c: BatchCostSummary): (string | number)[] {
  return [name, c.feedCost, c.healthCost, c.laborCost, c.salaryCost ?? 0, c.overheadCost, c.acquisitionCost, c.totalCost, c.totalRevenue, c.grossMargin];
}

// A bottom-line TOTAL row across every batch — what donors/lenders read first.
export function plTotalsRow(costs: readonly BatchCostSummary[]): (string | number)[] {
  const t = costs.reduce((a, c) => ({
    feed: a.feed + c.feedCost, health: a.health + c.healthCost, labour: a.labour + c.laborCost,
    salary: a.salary + (c.salaryCost ?? 0), overhead: a.overhead + c.overheadCost, acq: a.acq + c.acquisitionCost,
    cost: a.cost + c.totalCost, rev: a.rev + c.totalRevenue, margin: a.margin + c.grossMargin,
  }), { feed: 0, health: 0, labour: 0, salary: 0, overhead: 0, acq: 0, cost: 0, rev: 0, margin: 0 });
  return ['TOTAL', r2(t.feed), r2(t.health), r2(t.labour), r2(t.salary), r2(t.overhead), r2(t.acq), r2(t.cost), r2(t.rev), r2(t.margin)];
}

export function profitAndLoss(items: readonly { name: string; cost: BatchCostSummary }[], meta: ReportData['meta']): ReportData {
  const rows = items.map((i) => plRow(i.name, i.cost));
  if (rows.length > 0) rows.push(plTotalsRow(items.map((i) => i.cost)));
  return { title: 'Profit & Loss by Batch (KSh)', columns: PL_COLUMNS, rows, meta, scope: 'lifecycle' };
}

export function fcrReport(items: readonly { name: string; species: string; cost: BatchCostSummary }[], meta: ReportData['meta']): ReportData {
  const rows = items.map((i) => [
    i.name, i.species,
    i.cost.fcr ?? '—',
    i.cost.outputUnit === 'eggs' ? 'feed/dozen' : 'feed/kg',
    `${i.cost.mortalityPct ?? 0}%`,
    i.cost.feedCost,
  ] as (string | number)[]);
  return { title: 'FCR & Efficiency', columns: ['Batch', 'Species', 'FCR', 'FCR basis', 'Mortality', 'Feed Cost (KSh)'], rows, meta, scope: 'lifecycle' };
}

export function batchCard(items: readonly { name: string; species: string; stage: string; cost: BatchCostSummary }[], meta: ReportData['meta']): ReportData {
  const rows = items.map((i) => [
    i.name, i.species, i.stage,
    i.cost.fcr ?? '—', `${i.cost.mortalityPct ?? 0}%`,
    i.cost.survivors ?? 0, i.cost.soldHead ?? 0, i.cost.currentQty,
    i.cost.costPerUnit, i.cost.totalCost, i.cost.totalRevenue, i.cost.grossMargin,
  ] as (string | number)[]);
  return { title: 'Batch Performance Cards', columns: ['Batch', 'Species', 'Stage', 'FCR', 'Mortality', 'Survived', 'Sold', 'On farm', 'Cost/Unit', 'Total Cost', 'Revenue', 'Margin'], rows, meta, scope: 'lifecycle' };
}

// ─── Period financial summary (date-filtered, reliable from transactions) ────
// Revenue and direct costs that ACTUALLY fall inside [from, to]. This is the
// donor-facing "what happened this period" number — distinct from lifecycle P&L.
export interface PeriodInput {
  revenue: number;        // Σ sales.totalAmount in range
  feedCost: number;       // Σ feeding kg × lot cost in range
  healthCost: number;     // Σ health qty × lot cost in range
  labourCost: number;     // Σ labour hours × rate in range
  salaryCost: number;     // wage bill × months overlapping range
  acquisitionCost: number;// Σ acquisition for batches acquired in range
}

export function periodSummary(p: PeriodInput, meta: ReportData['meta']): ReportData {
  const expenses = r2(p.feedCost + p.healthCost + p.labourCost + p.salaryCost + p.acquisitionCost);
  const net = r2(p.revenue - expenses);
  const rows: (string | number)[][] = [
    ['Revenue', r2(p.revenue)],
    ['Feed', r2(p.feedCost)],
    ['Health / treatments', r2(p.healthCost)],
    ['Labour (logged)', r2(p.labourCost)],
    ['Salaries', r2(p.salaryCost)],
    ['Stock acquired', r2(p.acquisitionCost)],
    ['Total expenses', expenses],
    ['Net for period', net],
  ];
  return { title: 'Period Financial Summary (KSh)', columns: ['Line', 'Amount'], rows, meta, scope: 'range' };
}

// Whole calendar months (fractional) overlapping [from,to] ∩ a batch's life,
// for spreading a recurring monthly salary into a period. Min 0.
export function monthsOverlapping(from: string, to: string, acquiredDay: string, today: string): number {
  const start = acquiredDay > from ? acquiredDay : from;
  const end = today < to ? today : to;
  if (end < start) return 0;
  const days = (Date.parse(end) - Date.parse(start)) / 86400000 + 1; // inclusive
  return Math.max(0, days / 30);
}
