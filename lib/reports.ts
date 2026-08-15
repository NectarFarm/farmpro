// ── Shared reports logic (issue #263) ───────────────────────────────────────
// Query/aggregation logic for the four real report types lives here (not
// duplicated per-route) — same convention as lib/finance.ts / lib/inventory.ts.
//
// Every report returns the same envelope shape so a single client-side CSV/PDF
// exporter can handle all four (see components/farm/reports.tsx):
//   { title, meta, columns, rows }
// `columns` are the header labels; `rows` are already display-ready primitives
// (string | number), in the same order as `columns` — no further shaping
// needed client-side beyond stringifying for CSV and handing straight to
// jspdf-autotable for PDF.
import 'server-only'
import { and, asc, eq, gte, lte } from 'drizzle-orm'
import { db } from '@/db'
import { batches, sales, purchases, records } from '@/db/schemas'
import { computeTrialBalance } from '@/lib/finance'
import type { ReportRow, ReportPayload } from '@/lib/report-types'

export type { ReportRow, ReportPayload } from '@/lib/report-types'

export class InvalidDateRangeError extends Error {}

// Parses `from`/`to` query params (plain "YYYY-MM-DD" or any Date-parseable
// string) into a Date range. Both optional — a missing bound means
// unbounded on that side. `to` is treated as inclusive through the end of
// that calendar day, matching what a date-range picker's "To" field means to
// a user (components/farm/reports.tsx's date inputs).
export function parseDateRange(fromParam: string | null, toParam: string | null): { from: Date | null; to: Date | null } {
  let from: Date | null = null
  let to: Date | null = null
  if (fromParam) {
    from = new Date(fromParam)
    if (Number.isNaN(from.getTime())) throw new InvalidDateRangeError('Invalid "from" date')
  }
  if (toParam) {
    const parsed = new Date(toParam)
    if (Number.isNaN(parsed.getTime())) throw new InvalidDateRangeError('Invalid "to" date')
    to = new Date(parsed.getTime() + 24 * 60 * 60 * 1000 - 1)
  }
  return { from, to }
}

function isoDate(d: Date | null | undefined): string {
  if (!d) return ''
  return d.toISOString().slice(0, 10)
}

async function batchCodeMap(tenantId: string): Promise<Map<string, string>> {
  const rows = await db.select({ id: batches.id, code: batches.code }).from(batches).where(eq(batches.tenantId, tenantId))
  return new Map(rows.map((b) => [b.id, b.code]))
}

// ── GET /api/reports/pl (issue #263 task 1) ─────────────────────────────────
// `meta.glTotalRevenue`/`glTotalExpense`/`glNetIncome` are the all-time
// REVENUE/EXPENSE-class balances straight from the real trial balance
// (reused, not forked, from lib/finance.ts's computeTrialBalance) — these are
// NOT date-filtered (a trial balance is a cumulative ledger position, not a
// period query). `meta.periodRevenue`/`periodExpense`/`periodNetIncome` and
// every exportable `rows` entry ARE filtered to `from`/`to`, built directly
// from `sales`/`purchases` rows in range — the period breakdown the issue
// asks for.
//
// Unit note (issue #290 fixed the underlying bug this comment used to warn
// about): `sales.amount` is a whole-currency-unit figure while
// `purchases.totalCostCents` is in cents; lib/finance.ts's
// postPurchaseJournal now converts cents -> whole units when posting to the
// ledger (matching the convention this file already used below), so
// `glTotalRevenue`/`glTotalExpense` (straight from computeTrialBalance) share
// the same unit. The period `rows`/`periodExpense` figures below still
// convert purchases cents -> whole units themselves (dividing by 100) since
// they're built directly from raw `purchases` rows, not from the GL — same
// conversion components/farm/finance.tsx's `batchPLRows` already applies for
// Batch P&L.
export async function computePlReport(tenantId: string, from: Date | null, to: Date | null): Promise<ReportPayload> {
  const trialBalance = await computeTrialBalance(tenantId)
  const glTotalRevenue = trialBalance.rows.filter((r) => r.class === 'REVENUE').reduce((s, r) => s + r.balance, 0)
  const glTotalExpense = trialBalance.rows.filter((r) => r.class === 'EXPENSE').reduce((s, r) => s + r.balance, 0)

  const saleConditions = [eq(sales.tenantId, tenantId)]
  if (from) saleConditions.push(gte(sales.soldAt, from))
  if (to) saleConditions.push(lte(sales.soldAt, to))
  const periodSales = await db.select().from(sales).where(and(...saleConditions)).orderBy(asc(sales.soldAt))

  const purchaseConditions = [eq(purchases.tenantId, tenantId)]
  if (from) purchaseConditions.push(gte(purchases.createdAt, from))
  if (to) purchaseConditions.push(lte(purchases.createdAt, to))
  const periodPurchases = await db.select().from(purchases).where(and(...purchaseConditions)).orderBy(asc(purchases.createdAt))

  const codeById = await batchCodeMap(tenantId)

  type Row = { date: Date; type: string; description: string; batch: string; amount: number; status: string }
  const combined: Row[] = [
    ...periodSales.map((s): Row => ({
      date: s.soldAt,
      type: 'Sale',
      description: s.item,
      batch: s.batchId ? codeById.get(s.batchId) ?? s.batchId : '',
      amount: s.amount,
      status: s.status,
    })),
    ...periodPurchases.map((p): Row => ({
      date: p.createdAt,
      type: 'Purchase',
      description: p.supplier,
      batch: '',
      amount: Math.round(p.totalCostCents / 100),
      status: p.amountPaidCents >= p.totalCostCents ? 'paid' : p.amountPaidCents > 0 ? 'partial' : 'pending',
    })),
  ].sort((a, b) => a.date.getTime() - b.date.getTime())

  const periodRevenue = periodSales.reduce((s, r) => s + r.amount, 0)
  const periodExpense = Math.round(periodPurchases.reduce((s, r) => s + r.totalCostCents, 0) / 100)

  return {
    title: 'Profit & Loss Summary',
    meta: {
      tenantId,
      from: isoDate(from),
      to: isoDate(to),
      generatedAt: new Date().toISOString(),
      glTotalRevenue,
      glTotalExpense,
      glNetIncome: glTotalRevenue - glTotalExpense,
      glUnitCaveat:
        'GL totals are cumulative (all-time), not date-filtered — see lib/reports.ts comment. (Sales/purchases now post in the same unit; issue #290.)',
      periodRevenue,
      periodExpense,
      periodNetIncome: periodRevenue - periodExpense,
      transactionCount: combined.length,
    },
    columns: ['Date', 'Type', 'Description', 'Batch', 'Amount', 'Status'],
    rows: combined.map((r) => [isoDate(r.date), r.type, r.description, r.batch, r.amount, r.status]),
  }
}

// ── GET /api/reports/batch-pl (issue #263 task 2) ───────────────────────────
// Composes GET /api/batches (list) + each batch's real cost-breakdown,
// server-side, in one shot — the same composition
// components/farm/finance.tsx's Batch P&L tab already does client-side
// (issue #240), moved server-side here since a report needs one response,
// not React state.
//
// `revenue` is this batch's real sales, filtered to `from`/`to` (the report's
// date range). `cost` is the batch's cost-breakdown total tracked cost
// (currently just acquisitionCostCents — see
// app/api/batches/[id]/cost-breakdown/route.ts) which is NOT date-filtered:
// acquisition cost is a point-in-time fact about the batch, not a
// period-bucketed cost stream, so it always reflects the full tracked total
// regardless of `from`/`to` — flagged in `meta` rather than silently
// pretending it's period-scoped.
export async function computeBatchPlReport(tenantId: string, from: Date | null, to: Date | null): Promise<ReportPayload> {
  const batchRows = await db.select().from(batches).where(eq(batches.tenantId, tenantId)).orderBy(asc(batches.createdAt))

  const saleConditions = [eq(sales.tenantId, tenantId)]
  if (from) saleConditions.push(gte(sales.soldAt, from))
  if (to) saleConditions.push(lte(sales.soldAt, to))
  const periodSales = await db.select().from(sales).where(and(...saleConditions))

  const revenueByBatch = new Map<string, number>()
  for (const s of periodSales) {
    if (!s.batchId) continue
    revenueByBatch.set(s.batchId, (revenueByBatch.get(s.batchId) ?? 0) + s.amount)
  }

  const rows = batchRows.map((b) => {
    const costCents = b.acquisitionCostCents ?? 0
    const cost = Math.round(costCents / 100)
    const revenue = revenueByBatch.get(b.id) ?? 0
    const margin = revenue - cost
    const marginPct = revenue > 0 ? Math.round((margin / revenue) * 1000) / 10 : 0
    return { code: b.code, name: b.name, status: b.status, revenue, cost, margin, marginPct }
  })

  return {
    title: 'Batch P&L',
    meta: {
      tenantId,
      from: isoDate(from),
      to: isoDate(to),
      generatedAt: new Date().toISOString(),
      batchCount: rows.length,
      totalRevenue: rows.reduce((s, r) => s + r.revenue, 0),
      totalCost: rows.reduce((s, r) => s + r.cost, 0),
      costCaveat:
        'Cost is each batch\'s cumulative tracked cost-breakdown total (acquisition cost only today; feed/health/labour/overhead are untracked — see cost-breakdown route), not filtered by the report date range.',
    },
    columns: ['Batch', 'Name', 'Status', 'Revenue', 'Cost', 'Margin', 'Margin %'],
    rows: rows.map((r) => [r.code, r.name, r.status, r.revenue, r.cost, r.margin, r.marginPct]),
  }
}

// ── GET /api/reports/mortality (issue #263 task 3) ──────────────────────────
// Derived from the real `records` table (`type: 'mortality'`), filtered by
// tenant + date range on `createdAt` (mortality records have no separate
// "occurred at" field — see db/schemas/people.ts / components/farm/worker.tsx's
// MortalityForm, which posts `data: { count, cause }` at submit time).
export async function computeMortalityReport(tenantId: string, from: Date | null, to: Date | null): Promise<ReportPayload> {
  const conditions = [eq(records.tenantId, tenantId), eq(records.type, 'mortality')]
  if (from) conditions.push(gte(records.createdAt, from))
  if (to) conditions.push(lte(records.createdAt, to))
  const rows = await db.select().from(records).where(and(...conditions)).orderBy(asc(records.createdAt))

  const codeById = await batchCodeMap(tenantId)

  let totalDeaths = 0
  const tableRows: ReportRow[] = rows.map((r) => {
    const data = r.data as { count?: unknown; cause?: unknown }
    const count = Number(data?.count) || 0
    const cause = typeof data?.cause === 'string' ? data.cause : ''
    totalDeaths += count
    return [isoDate(r.createdAt), r.batchId ? codeById.get(r.batchId) ?? r.batchId : '', count, cause]
  })

  return {
    title: 'Mortality Report',
    meta: {
      tenantId,
      from: isoDate(from),
      to: isoDate(to),
      generatedAt: new Date().toISOString(),
      recordCount: rows.length,
      totalDeaths,
    },
    columns: ['Date', 'Batch', 'Deaths', 'Cause'],
    rows: tableRows,
  }
}

// ── GET /api/reports/feed-consumption (issue #263 task 3) ───────────────────
// Derived from the real `records` table (`type: 'feeding'`), filtered by
// tenant + date range on `createdAt`. Each feeding submission carries a
// `feedItems: [{ item, qtyKg }]` array (components/farm/worker.tsx's
// FeedingForm) — flattened to one exported row per feed item, since a single
// submission can cover several feed types in one round.
export async function computeFeedConsumptionReport(tenantId: string, from: Date | null, to: Date | null): Promise<ReportPayload> {
  const conditions = [eq(records.tenantId, tenantId), eq(records.type, 'feeding')]
  if (from) conditions.push(gte(records.createdAt, from))
  if (to) conditions.push(lte(records.createdAt, to))
  const rows = await db.select().from(records).where(and(...conditions)).orderBy(asc(records.createdAt))

  const codeById = await batchCodeMap(tenantId)

  let totalKg = 0
  const tableRows: ReportRow[] = []
  for (const r of rows) {
    const data = r.data as { feedItems?: unknown }
    const items = Array.isArray(data?.feedItems) ? data.feedItems : []
    const batchLabel = r.batchId ? codeById.get(r.batchId) ?? r.batchId : ''
    const date = isoDate(r.createdAt)
    for (const item of items) {
      const rec = item as { item?: unknown; qtyKg?: unknown }
      const qty = Number(rec?.qtyKg) || 0
      totalKg += qty
      tableRows.push([date, batchLabel, typeof rec?.item === 'string' ? rec.item : '', qty])
    }
  }

  return {
    title: 'Feed Consumption',
    meta: {
      tenantId,
      from: isoDate(from),
      to: isoDate(to),
      generatedAt: new Date().toISOString(),
      recordCount: rows.length,
      totalKg,
    },
    columns: ['Date', 'Batch', 'Feed Item', 'Qty (kg)'],
    rows: tableRows,
  }
}
