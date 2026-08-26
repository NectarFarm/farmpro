// ── Shared reports logic (issue #263; extended by issue #376 Gap 3/7) ──────
// Query/aggregation logic for every real report type lives here (not
// duplicated per-route) — same convention as lib/finance.ts / lib/inventory.ts.
// Seven real types today: pl, batch-pl, mortality, feed-consumption,
// production, vaccination, fcr. Only "labour" remains unavailable — see
// NOT_AVAILABLE_REASONS in components/farm/reports.tsx for the honest reason
// (hours-worked has no record type; payroll COST does exist via payslips).
//
// Every report returns the same envelope shape so ONE client-side CSV/PDF
// exporter can handle all seven with no per-report-type branching (see
// lib/report-types.ts and lib/report-export.ts):
//   { title, meta, columns, rows, headline?, notes?, totals?, basis?,
//     columnAlign?, columnFormats? }
// `columns` are the header labels; `rows` are already display-ready primitives
// (string | number | null, null meaning "not measurable" — never 0), in the
// same order as `columns`. The presentation fields are what make an export
// read as a document rather than a table dump: `headline` is the 2–4 figures
// set large above the table, `notes`/`basis` are the caveats as readable
// prose (NOT camelCase meta keys — see the note in computePlReport), and
// `columnFormats` tells the renderer which columns are money/weight so the
// screen, the CSV and the PDF cannot disagree about a number.
import 'server-only'
import { and, asc, eq, gte, inArray, lte } from 'drizzle-orm'
import { db } from '@/db'
import {
  batches, sales, purchases, records, products, employees, tenantSettings, farms,
} from '@/db/schemas'
import { computeTrialBalance } from '@/lib/finance'
import { batchIdsForFarm, unitIdsForFarm } from '@/lib/farm-scope'
import type { ReportRow, ReportPayload } from '@/lib/report-types'
import { centsToMajor } from '@/lib/money'
import {
  formatDate, DEFAULT_TIMEZONE, DEFAULT_DATE_FORMAT, type DateFormat,
} from '@/lib/datetime'

export type { ReportRow, ReportPayload } from '@/lib/report-types'

// ── Report-route role gate (vet/auditor screens task) ───────────────────────
// Before this task, GET /api/reports/pl|batch-pl|mortality|feed-consumption
// had NO role check at all — any authenticated session (any role, including
// worker) could read a tenant's full P&L. The four routes now share this
// allowlist: owner/manager run the existing Reports screen, super_admin is
// included for parity with the rest of the admin surface, and auditor is the
// new read-only role this task wires up. worker and vet are excluded — vet
// gets its own herd-health data (batches/records), not the financial reports.
export const REPORT_VIEWER_ROLES = new Set(['owner', 'manager', 'super_admin', 'auditor'])

// Every compute* function below takes an already-VALIDATED farmId (or
// undefined for unfiltered) — the routes resolve/validate it via
// lib/farm-scope.ts's resolveFarmFilter before calling in, same contract
// every other farmId-accepting endpoint in this task uses. `meta.farmId`
// echoes what was actually applied, same as GET /api/dashboard/kpis, so a
// generated report is self-describing about its own scope (important for a
// report someone might export/print and read later, detached from the
// screen that generated it).

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

// ── Presentation settings + formatting (issue #376 Gap 7) ───────────────────
// Every compute* function formats its OWN headline figures, notes and period
// label server-side — this file is the one place that knows the tenant's
// currencySymbol/weightUnit/timezone/dateFormat (db/schemas/settings.ts).
// Downstream renderers (components/farm/reports.tsx's preview,
// lib/report-export.ts's PDF/CSV) print those strings VERBATIM, so the
// screen and the exported document cannot disagree about what the report
// says, and no second formatter gets hand-rolled in the export path.
type PresentationSettings = { currencySymbol: string; weightUnit: string; timezone: string; dateFormat: DateFormat; notesEnabled: boolean }

async function presentationSettings(tenantId: string): Promise<PresentationSettings> {
  const rows = await db.select().from(tenantSettings).where(eq(tenantSettings.tenantId, tenantId)).limit(1)
  const s = rows[0]
  return {
    currencySymbol: s?.currencySymbol || 'KSh',
    weightUnit: s?.weightUnit || 'kg',
    timezone: s?.timezone || DEFAULT_TIMEZONE,
    // Loose-text column; anything outside DATE_FORMATS falls back rather
    // than producing an undefined format code downstream.
    dateFormat: (DATE_FORMAT_SET.has(s?.dateFormat ?? '') ? s?.dateFormat : DEFAULT_DATE_FORMAT) as DateFormat,
    // Defaults to true for a tenant with no settings row — the notes are the
    // honest default and must not disappear just because nobody has visited
    // Settings yet.
    notesEnabled: s?.reportNotesEnabled ?? true,
  }
}

// One gate for every report's notes, so a new report cannot forget to honour
// the setting: each compute* function passes its notes through this instead of
// assigning the array directly. `basis` is deliberately NOT gated — it is one
// line saying where the numbers came from, which is attribution rather than a
// caveat, and a report that does not say what it was compiled from is not a
// document anyone should sign.
function notesFor(pres: PresentationSettings, notes: string[]): string[] {
  return pres.notesEnabled ? notes : []
}

const DATE_FORMAT_SET = new Set(['DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD'])

function fmtInt(n: number): string {
  return Math.round(n).toLocaleString('en-US')
}

function fmtMajor(n: number, currencySymbol: string): string {
  return `${currencySymbol} ${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

// Human date range for the report header — e.g. "01/08/2026 – 31/08/2026".
// Raw ISO `from`/`to` stay in meta for machines; this is what humans read.
function humanPeriodLabel(from: Date | null, to: Date | null, s: PresentationSettings): string {
  const opts = { timezone: s.timezone, dateFormat: s.dateFormat }
  if (!from && !to) return 'All time'
  if (!to) return `From ${formatDate(from!, opts)}`
  if (!from) return `Through ${formatDate(to, opts)}`
  return `${formatDate(from, opts)} – ${formatDate(to, opts)}`
}

// Employee names for "Recorded by" style columns — one query per report,
// same shape as batchCodeMap above.
async function employeeNameMap(tenantId: string): Promise<Map<string, string>> {
  const rows = await db.select({ id: employees.id, name: employees.name }).from(employees).where(eq(employees.tenantId, tenantId))
  return new Map(rows.map((e) => [e.id, e.name]))
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
// Unit note (issue: money-unit-enforcement, supersedes #290): every money
// column this report reads (`sales.amountCents`, `purchases.totalCostCents`,
// `journalLines.debitCents`/`creditCents`) is cents now — no mismatched
// units to reconcile between them. This report's OWN external contract
// (`meta.glTotalRevenue`/`periodRevenue`/`periodExpense`/the exported rows'
// "Amount" column) stays in whole currency units for display, same as
// before this issue — every cents->major conversion below goes through
// `lib/money.ts`'s `centsToMajor` (replacing the ad-hoc `/ 100` this file
// used to have) instead of being removed, since these numbers are read
// directly off the screen and exported to CSV/PDF with no currency
// formatting applied downstream.
// `farmId` (farm-scoped-data task): scopes the PERIOD rows only — sales via
// the batches->units->farm join (sales has no farm_id of its own) and
// purchases via its own direct farmId column. `glTotalRevenue`/
// `glTotalExpense` (straight from computeTrialBalance) stay tenant-wide
// regardless — see finance.tsx's loadGL comment for why journal_entries has
// no farm relationship to scope by; a farm-filtered P&L report therefore
// carries both a scoped period figure AND an unavoidably tenant-wide GL
// figure side by side, and `meta.farmId` says so rather than leaving that
// implicit.
export async function computePlReport(tenantId: string, from: Date | null, to: Date | null, farmId?: string): Promise<ReportPayload> {
  const trialBalance = await computeTrialBalance(tenantId)
  const pres = await presentationSettings(tenantId)
  const glTotalRevenueCents = trialBalance.rows.filter((r) => r.class === 'REVENUE').reduce((s, r) => s + r.balanceCents, 0)
  const glTotalExpenseCents = trialBalance.rows.filter((r) => r.class === 'EXPENSE').reduce((s, r) => s + r.balanceCents, 0)
  const glTotalRevenue = centsToMajor(glTotalRevenueCents)
  const glTotalExpense = centsToMajor(glTotalExpenseCents)

  const farmBatchIds = farmId ? await batchIdsForFarm(tenantId, farmId) : null

  const saleConditions = [eq(sales.tenantId, tenantId)]
  if (from) saleConditions.push(gte(sales.soldAt, from))
  if (to) saleConditions.push(lte(sales.soldAt, to))
  if (farmBatchIds !== null) saleConditions.push(inArray(sales.batchId, farmBatchIds.length ? farmBatchIds : ['__none__']))
  const periodSales = await db.select().from(sales).where(and(...saleConditions)).orderBy(asc(sales.soldAt))

  const purchaseConditions = [eq(purchases.tenantId, tenantId)]
  if (from) purchaseConditions.push(gte(purchases.createdAt, from))
  if (to) purchaseConditions.push(lte(purchases.createdAt, to))
  if (farmId) purchaseConditions.push(eq(purchases.farmId, farmId))
  const periodPurchases = await db.select().from(purchases).where(and(...purchaseConditions)).orderBy(asc(purchases.createdAt))

  const codeById = await batchCodeMap(tenantId)

  type Row = { date: Date; type: string; description: string; batch: string; amount: number; status: string }
  const combined: Row[] = [
    ...periodSales.map((s): Row => ({
      date: s.soldAt,
      type: 'Sale',
      description: s.item,
      batch: s.batchId ? codeById.get(s.batchId) ?? s.batchId : '',
      amount: centsToMajor(s.amountCents),
      status: s.status,
    })),
    ...periodPurchases.map((p): Row => ({
      date: p.createdAt,
      type: 'Purchase',
      description: p.supplier,
      batch: '',
      amount: centsToMajor(p.totalCostCents),
      status: p.amountPaidCents >= p.totalCostCents ? 'paid' : p.amountPaidCents > 0 ? 'partial' : 'pending',
    })),
  ].sort((a, b) => a.date.getTime() - b.date.getTime())

  const periodRevenue = centsToMajor(periodSales.reduce((s, r) => s + r.amountCents, 0))
  const periodExpense = centsToMajor(periodPurchases.reduce((s, r) => s + r.totalCostCents, 0))

  const periodNetIncome = periodRevenue - periodExpense
  // farms row for the basis line — a real farm id resolves to its name; the
  // 'ALL' sentinel never looks anything up.
  const farmLabel = farmId
    ? (await db.select({ name: farms.name }).from(farms).where(and(eq(farms.id, farmId), eq(farms.tenantId, tenantId))).limit(1))[0]?.name
    : null

  return {
    title: 'Profit & Loss Summary',
    meta: {
      tenantId,
      from: isoDate(from),
      to: isoDate(to),
      generatedAt: new Date().toISOString(),
      farmId: farmId ?? 'ALL',
      glTotalRevenue,
      glTotalExpense,
      glNetIncome: glTotalRevenue - glTotalExpense,
      // The GL caveat that used to live here as `glUnitCaveat` is now the
      // first entry in `notes` below (#376 Gap 7). Keeping both duplicated it:
      // presentableMeta() passes strings straight through, so the Reports
      // screen rendered a 200-character caveat as a "Gl unit caveat" chip AND
      // again as prose under "Notes & basis". `notes` is its home — it is
      // readable there, and the exporter wraps it instead of clipping it.
      periodRevenue,
      periodExpense,
      periodNetIncome,
      transactionCount: combined.length,
      // Human-readable period, formatted in the tenant's own timezone/date
      // order — what the masthead and preview show instead of raw ISO keys.
      periodLabel: humanPeriodLabel(from, to, pres),
    },
    columns: ['Date', 'Type', 'Description', 'Batch', 'Amount', 'Status'],
    rows: combined.map((r) => [isoDate(r.date), r.type, r.description, r.batch, r.amount, r.status]),
    // Issue #376 Gap 7: presentation fields rendered verbatim by the preview
    // and the PDF/CSV exporter — the caveats moved out of raw camelCase meta
    // keys into readable prose.
    headline: [
      { label: 'Period revenue', value: fmtMajor(periodRevenue, pres.currencySymbol), caption: `${fmtInt(periodSales.length)} sale${periodSales.length === 1 ? '' : 's'} in range` },
      { label: 'Period expenses', value: fmtMajor(periodExpense, pres.currencySymbol), caption: `${fmtInt(periodPurchases.length)} purchase${periodPurchases.length === 1 ? '' : 's'} in range` },
      { label: 'Period net', value: fmtMajor(periodNetIncome, pres.currencySymbol), caption: 'Revenue minus purchases' },
      { label: 'GL net position', value: fmtMajor(glTotalRevenue - glTotalExpense, pres.currencySymbol), caption: 'Cumulative, all-time' },
    ],
    notes: notesFor(pres, [
      'GL totals are all-time and cover every farm — not this period, not this farm.',
      'Costs are tracked purchases only. Untracked feed, health and labour costs mean expenses may be understated.',
    ]),
    basis: `Compiled from recorded sales and purchase transactions for the period above${farmId ? `, scoped to the selected farm (${farmLabel ?? farmId}) where a farm relationship exists` : ', across all farms'}.`,
    totals: [null, null, 'Period net', null, periodNetIncome, null],
    columnAlign: ['left', 'left', 'left', 'left', 'right', 'left'],
    columnFormats: ['text', 'text', 'text', 'text', 'money', 'text'],
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
// `farmId` (farm-scoped-data task): restricts the batch list itself (via
// unitId -> production_units.farmId — the same JOIN GET /api/batches uses),
// which naturally restricts `revenueByBatch` too since it's only ever
// looked up for batches in `batchRows`.
export async function computeBatchPlReport(tenantId: string, from: Date | null, to: Date | null, farmId?: string): Promise<ReportPayload> {
  const pres = await presentationSettings(tenantId)
  const batchConditions = [eq(batches.tenantId, tenantId)]
  if (farmId) {
    const unitIds = await unitIdsForFarm(tenantId, farmId)
    batchConditions.push(inArray(batches.unitId, unitIds.length ? unitIds : ['__none__']))
  }
  const batchRows = await db.select().from(batches).where(and(...batchConditions)).orderBy(asc(batches.createdAt))

  const saleConditions = [eq(sales.tenantId, tenantId)]
  if (from) saleConditions.push(gte(sales.soldAt, from))
  if (to) saleConditions.push(lte(sales.soldAt, to))
  const periodSales = await db.select().from(sales).where(and(...saleConditions))

  // Kept in cents through this map — only converted to whole units at the
  // final `rows.map` below, right next to `cost`'s own conversion, so both
  // sides of the margin arithmetic use the same unit for the same reason at
  // the same place (see lib/money.ts).
  const revenueByBatchCents = new Map<string, number>()
  for (const s of periodSales) {
    if (!s.batchId) continue
    revenueByBatchCents.set(s.batchId, (revenueByBatchCents.get(s.batchId) ?? 0) + s.amountCents)
  }

  const rows = batchRows.map((b) => {
    const costCents = b.acquisitionCostCents ?? 0
    const cost = centsToMajor(costCents)
    const revenue = centsToMajor(revenueByBatchCents.get(b.id) ?? 0)
    const margin = revenue - cost
    const marginPct = revenue > 0 ? Math.round((margin / revenue) * 1000) / 10 : 0
    return { code: b.code, name: b.name, status: b.status, revenue, cost, margin, marginPct }
  })

  const totalRevenue = rows.reduce((s, r) => s + r.revenue, 0)
  const totalCost = rows.reduce((s, r) => s + r.cost, 0)
  const totalMargin = totalRevenue - totalCost

  return {
    title: 'Batch P&L',
    meta: {
      tenantId,
      from: isoDate(from),
      to: isoDate(to),
      generatedAt: new Date().toISOString(),
      farmId: farmId ?? 'ALL',
      batchCount: rows.length,
      totalRevenue,
      totalCost,
      // Same reason as computePlReport's glUnitCaveat above: this caveat is
      // now the first `notes` entry rather than a camelCase meta string that
      // rendered twice on screen.
      periodLabel: humanPeriodLabel(from, to, pres),
    },
    columns: ['Batch', 'Name', 'Status', 'Revenue', 'Cost', 'Margin', 'Margin %'],
    rows: rows.map((r) => [r.code, r.name, r.status, r.revenue, r.cost, r.margin, r.marginPct]),
    headline: [
      { label: 'Batches', value: fmtInt(rows.length), caption: farmId ? 'In selected farm' : 'All farms' },
      { label: 'Total revenue', value: fmtMajor(totalRevenue, pres.currencySymbol), caption: 'Period sales' },
      { label: 'Tracked cost', value: fmtMajor(totalCost, pres.currencySymbol), caption: 'Acquisition cost only' },
      { label: 'Margin', value: fmtMajor(totalMargin, pres.currencySymbol), caption: totalRevenue > 0 ? `${Math.round((totalMargin / totalRevenue) * 1000) / 10}% of revenue` : 'No period revenue' },
    ],
    notes: notesFor(pres, [
      'Cost is acquisition cost only — feed, health and labour are untracked, so margins read high.',
      'Revenue covers the report period; acquisition cost is the batch total, not period-filtered.',
    ]),
    basis: 'Compiled from real sales against each batch and each batch\'s tracked cost breakdown.',
    totals: [null, 'TOTAL', null, totalRevenue, totalCost, totalMargin, totalRevenue > 0 ? Math.round((totalMargin / totalRevenue) * 1000) / 10 : 0],
    columnAlign: ['left', 'left', 'left', 'right', 'right', 'right', 'right'],
    columnFormats: ['text', 'text', 'text', 'money', 'money', 'money', 'number'],
  }
}

// ── GET /api/reports/mortality (issue #263 task 3) ──────────────────────────
// Derived from the real `records` table (`type: 'mortality'`), filtered by
// tenant + date range on `createdAt` (mortality records have no separate
// "occurred at" field — see db/schemas/people.ts / components/farm/worker.tsx's
// MortalityForm, which posts `data: { count, cause }` at submit time).
// `farmId` (farm-scoped-data task): records has no farm_id of its own —
// scoped via the same two-hop join GET /api/records uses (batchId ->
// batches.unitId -> production_units.farmId).
export async function computeMortalityReport(tenantId: string, from: Date | null, to: Date | null, farmId?: string): Promise<ReportPayload> {
  const pres = await presentationSettings(tenantId)
  const conditions = [eq(records.tenantId, tenantId), eq(records.type, 'mortality')]
  if (from) conditions.push(gte(records.createdAt, from))
  if (to) conditions.push(lte(records.createdAt, to))
  if (farmId) {
    const batchIds = await batchIdsForFarm(tenantId, farmId)
    conditions.push(inArray(records.batchId, batchIds.length ? batchIds : ['__none__']))
  }
  const rows = await db.select().from(records).where(and(...conditions)).orderBy(asc(records.createdAt))

  const codeById = await batchCodeMap(tenantId)

  let totalDeaths = 0
  const batchesAffected = new Set<string>()
  const tableRows: ReportRow[] = rows.map((r) => {
    const data = r.data as { count?: unknown; cause?: unknown }
    const count = Number(data?.count) || 0
    const cause = typeof data?.cause === 'string' ? data.cause : ''
    totalDeaths += count
    if (r.batchId && count > 0) batchesAffected.add(r.batchId)
    return [isoDate(r.createdAt), r.batchId ? codeById.get(r.batchId) ?? r.batchId : '', count, cause]
  })

  return {
    title: 'Mortality Report',
    meta: {
      tenantId,
      from: isoDate(from),
      to: isoDate(to),
      generatedAt: new Date().toISOString(),
      farmId: farmId ?? 'ALL',
      recordCount: rows.length,
      totalDeaths,
      periodLabel: humanPeriodLabel(from, to, pres),
    },
    columns: ['Date', 'Batch', 'Deaths', 'Cause'],
    rows: tableRows,
    headline: [
      { label: 'Total deaths', value: fmtInt(totalDeaths), caption: `head, ${humanPeriodLabel(from, to, pres).toLowerCase()}` },
      { label: 'Records filed', value: fmtInt(rows.length), caption: 'worker submissions' },
      { label: 'Batches affected', value: fmtInt(batchesAffected.size), caption: 'with at least one death' },
    ],
    notes: notesFor(pres, [
      'Cause is as entered by the worker, not veterinary-confirmed.',
      'The batch headcount ledger remains the authoritative running total.',
    ]),
    basis: `Compiled from worker-submitted mortality records for the period above${farmId ? ', scoped to the selected farm' : ', across all farms'}.`,
    totals: ['Total', null, totalDeaths, null],
    columnAlign: ['left', 'left', 'right', 'left'],
    columnFormats: ['text', 'text', 'number', 'text'],
  }
}

// ── GET /api/reports/feed-consumption (issue #263 task 3) ───────────────────
// Derived from the real `records` table (`type: 'feeding'`), filtered by
// tenant + date range on `createdAt`. Each feeding submission carries a
// `feedItems: [{ item, qtyKg }]` array (components/farm/worker.tsx's
// FeedingForm) — flattened to one exported row per feed item, since a single
// submission can cover several feed types in one round.
// `farmId` — same two-hop join as computeMortalityReport above.
export async function computeFeedConsumptionReport(tenantId: string, from: Date | null, to: Date | null, farmId?: string): Promise<ReportPayload> {
  const pres = await presentationSettings(tenantId)
  const conditions = [eq(records.tenantId, tenantId), eq(records.type, 'feeding')]
  if (from) conditions.push(gte(records.createdAt, from))
  if (to) conditions.push(lte(records.createdAt, to))
  if (farmId) {
    const batchIds = await batchIdsForFarm(tenantId, farmId)
    conditions.push(inArray(records.batchId, batchIds.length ? batchIds : ['__none__']))
  }
  const rows = await db.select().from(records).where(and(...conditions)).orderBy(asc(records.createdAt))

  const codeById = await batchCodeMap(tenantId)

  let totalKg = 0
  const feedTypes = new Set<string>()
  const batchesFed = new Set<string>()
  const tableRows: ReportRow[] = []
  for (const r of rows) {
    const data = r.data as { feedItems?: unknown }
    const items = Array.isArray(data?.feedItems) ? data.feedItems : []
    const batchLabel = r.batchId ? codeById.get(r.batchId) ?? r.batchId : ''
    const date = isoDate(r.createdAt)
    for (const item of items) {
      const rec = item as { item?: unknown; qtyKg?: unknown }
      const qty = Number(rec?.qtyKg) || 0
      const name = typeof rec?.item === 'string' ? rec.item : ''
      totalKg += qty
      if (name) feedTypes.add(name)
      if (r.batchId && qty > 0) batchesFed.add(r.batchId)
      tableRows.push([date, batchLabel, name, qty])
    }
  }

  return {
    title: 'Feed Consumption',
    meta: {
      tenantId,
      from: isoDate(from),
      to: isoDate(to),
      generatedAt: new Date().toISOString(),
      farmId: farmId ?? 'ALL',
      recordCount: rows.length,
      totalKg,
      distinctFeedTypes: feedTypes.size,
      periodLabel: humanPeriodLabel(from, to, pres),
    },
    columns: ['Date', 'Batch', 'Feed Item', `Qty (${pres.weightUnit})`],
    rows: tableRows,
    // Four figures, all counted from the rows above — nothing here is
    // estimated (every report carries at least two, #376 Gap 7).
    headline: [
      { label: 'Total feed issued', value: `${fmtInt(totalKg)} ${pres.weightUnit}`, caption: humanPeriodLabel(from, to, pres).toLowerCase() },
      { label: 'Feeding records', value: fmtInt(rows.length), caption: 'worker submissions' },
      { label: 'Feed types issued', value: fmtInt(feedTypes.size), caption: 'distinct items named on rounds' },
      { label: 'Batches fed', value: fmtInt(batchesFed.size), caption: 'with feed recorded in range' },
    ],
    notes: notesFor(pres, [
      'Quantities are worker-entered against store stock, and each one draws down inventory.',
    ]),
    basis: `Compiled from worker-submitted feeding records for the period above${farmId ? ', scoped to the selected farm' : ', across all farms'}.`,
    totals: [null, null, 'Total', Math.round(totalKg * 100) / 100],
    columnAlign: ['left', 'left', 'left', 'right'],
    columnFormats: ['text', 'text', 'text', 'weight'],
  }
}

// ── GET /api/reports/production (issue #376 Gap 3) ──────────────────────────
// Derived from the real `records` table (`type: 'production'`) — the same
// submissions the worker portal's Collect form files (components/farm/
// worker.tsx's production payload: `{ items: [{ productId, qty }] }`). Each
// item line names a product from the tenant catalogue (products.name); the
// same quantities also land in product_collections as a sellable balance.
// `farmId` — same two-hop join as computeMortalityReport above.
export async function computeProductionReport(tenantId: string, from: Date | null, to: Date | null, farmId?: string): Promise<ReportPayload> {
  const pres = await presentationSettings(tenantId)
  const conditions = [eq(records.tenantId, tenantId), eq(records.type, 'production')]
  if (from) conditions.push(gte(records.createdAt, from))
  if (to) conditions.push(lte(records.createdAt, to))
  if (farmId) {
    const batchIds = await batchIdsForFarm(tenantId, farmId)
    conditions.push(inArray(records.batchId, batchIds.length ? batchIds : ['__none__']))
  }
  const rows = await db.select().from(records).where(and(...conditions)).orderBy(asc(records.createdAt))

  const codeById = await batchCodeMap(tenantId)
  // Product names for item lines — one query, keyed by id.
  const productRows = await db.select({ id: products.id, name: products.name }).from(products).where(eq(products.tenantId, tenantId))
  const productNameById = new Map(productRows.map((p) => [p.id, p.name]))

  let totalQty = 0
  const productsSeen = new Set<string>()
  const tableRows: ReportRow[] = []
  for (const r of rows) {
    const data = r.data as { items?: unknown }
    const items = Array.isArray(data?.items) ? data.items : []
    const batchLabel = r.batchId ? codeById.get(r.batchId) ?? r.batchId : ''
    const date = isoDate(r.createdAt)
    for (const item of items) {
      const rec = item as { productId?: unknown; qty?: unknown }
      const qty = Number(rec?.qty) || 0
      const pid = typeof rec?.productId === 'string' ? rec.productId : ''
      const name = productNameById.get(pid) ?? pid
      if (pid) productsSeen.add(name)
      totalQty += qty
      tableRows.push([date, batchLabel, name, qty])
    }
  }

  return {
    title: 'Production Report',
    meta: {
      tenantId,
      from: isoDate(from),
      to: isoDate(to),
      generatedAt: new Date().toISOString(),
      farmId: farmId ?? 'ALL',
      recordCount: rows.length,
      totalQty: Math.round(totalQty * 100) / 100,
      distinctProducts: productsSeen.size,
      periodLabel: humanPeriodLabel(from, to, pres),
    },
    columns: ['Date', 'Batch', 'Product', 'Qty'],
    rows: tableRows,
    headline: [
      { label: 'Total collected', value: fmtInt(totalQty), caption: 'units across all products' },
      { label: 'Collection entries', value: fmtInt(tableRows.length), caption: `${fmtInt(rows.length)} worker submission${rows.length === 1 ? '' : 's'}` },
      { label: 'Products collected', value: fmtInt(productsSeen.size), caption: 'distinct catalogue products' },
    ],
    notes: notesFor(pres, [
      'Quantities use each product\'s own unit — trays, litres, kg.',
      'This is activity for the period, not the current sellable balance.',
    ]),
    basis: `Compiled from worker-submitted collection records for the period above${farmId ? ', scoped to the selected farm' : ', across all farms'}.`,
    totals: [null, null, 'Total', Math.round(totalQty * 100) / 100],
    columnAlign: ['left', 'left', 'left', 'right'],
    columnFormats: ['text', 'text', 'text', 'number'],
  }
}

// ── GET /api/reports/vaccination (issue #376 Gap 3) ─────────────────────────
// Derived from the real `records` table (`type: 'health'`) — what the worker
// portal's Health & Vaccine form files: `{ treatment, affected, dose, notes }`,
// all free text by design (a fixed drug list would be wrong for every farm
// that keeps something not on it).
// Withdrawal windows are NOT derivable — nothing stores a withdrawal period
// per treatment — so no such column is computed; the omission is stated in
// the notes rather than papered over with an invented figure.
export async function computeVaccinationReport(tenantId: string, from: Date | null, to: Date | null, farmId?: string): Promise<ReportPayload> {
  const pres = await presentationSettings(tenantId)
  const conditions = [eq(records.tenantId, tenantId), eq(records.type, 'health')]
  if (from) conditions.push(gte(records.createdAt, from))
  if (to) conditions.push(lte(records.createdAt, to))
  if (farmId) {
    const batchIds = await batchIdsForFarm(tenantId, farmId)
    conditions.push(inArray(records.batchId, batchIds.length ? batchIds : ['__none__']))
  }
  const rows = await db.select().from(records).where(and(...conditions)).orderBy(asc(records.createdAt))

  const codeById = await batchCodeMap(tenantId)
  const nameByEmployeeId = await employeeNameMap(tenantId)

  let treatmentsWithCount = 0
  let birdsTreated = 0
  const batchesTreated = new Set<string>()
  const tableRows: ReportRow[] = rows.map((r) => {
    const data = r.data as { treatment?: unknown; affected?: unknown; dose?: unknown; notes?: unknown }
    const affectedRaw = Number(data?.affected)
    const affected = Number.isFinite(affectedRaw) && affectedRaw > 0 ? Math.trunc(affectedRaw) : null
    if (affected !== null) { birdsTreated += affected; treatmentsWithCount++ }
    if (r.batchId) batchesTreated.add(r.batchId)
    return [
      isoDate(r.createdAt),
      r.batchId ? codeById.get(r.batchId) ?? r.batchId : '',
      typeof data?.treatment === 'string' ? data.treatment : '',
      affected,
      typeof data?.dose === 'string' ? data.dose : '',
      typeof data?.notes === 'string' ? data.notes : '',
      nameByEmployeeId.get(r.employeeId) ?? r.employeeId.slice(0, 8),
    ]
  })

  return {
    title: 'Vaccination & Treatment Report',
    meta: {
      tenantId,
      from: isoDate(from),
      to: isoDate(to),
      generatedAt: new Date().toISOString(),
      farmId: farmId ?? 'ALL',
      recordCount: rows.length,
      birdsTreated,
      batchesTreated: batchesTreated.size,
      periodLabel: humanPeriodLabel(from, to, pres),
    },
    columns: ['Date', 'Batch', 'Treatment', 'Treated', 'Dose', 'Notes', 'Recorded by'],
    rows: tableRows,
    // "Birds treated" is deliberately an em dash rather than 0 when no
    // submission recorded a count — the treatments still happened.
    headline: [
      { label: 'Treatments filed', value: fmtInt(rows.length), caption: humanPeriodLabel(from, to, pres).toLowerCase() },
      { label: 'Birds treated', value: birdsTreated > 0 ? fmtInt(birdsTreated) : '—', caption: birdsTreated > 0 ? `across ${fmtInt(treatmentsWithCount)} treatment${treatmentsWithCount === 1 ? '' : 's'} that recorded a count` : 'no counts recorded' },
      { label: 'Batches treated', value: fmtInt(batchesTreated.size), caption: 'distinct batches in range' },
    ],
    // The withdrawal-period warning is deliberately NOT in `notes` and so
    // cannot be switched off. Everything else here is a caveat about data
    // quality; that one is about food safety. This app stores no withdrawal
    // period per treatment, and a treatment log with no withdrawal column and
    // no explanation could put meat, milk or eggs into a food chain early.
    // A farmer may hide their bookkeeping caveats from a buyer — not that.
    notes: notesFor(pres, [
      'Treatment names and doses are free text, not validated against a drug list.',
    ]),
    basis: `Compiled from worker-submitted health records for the period above${farmId ? ', scoped to the selected farm' : ', across all farms'}. Treatment is not veterinary-confirmed, and NO withdrawal periods are shown — this system does not record them, so check the treatment notes or consult your vet before selling produce.`,
    columnAlign: ['left', 'left', 'left', 'right', 'left', 'left', 'left'],
    columnFormats: ['text', 'text', 'text', 'number', 'text', 'text', 'text'],
  }
}

// ── GET /api/reports/fcr (issue #376 Gap 3) ────────────────────────────────
// Feed Conversion Ratio per batch: feed issued (existing feeding records) ÷
// weight gained (weight-sample records: `{ samples, averageKg, sampleSize }`).
// A batch needs AT LEAST TWO weight samples in range to have a gain; fewer
// than two yields FCR `null` — never interpolated, never carried forward.
// Gain per bird uses the batch's CURRENT headcount (batches.currentQty) as
// the best available denominator; it is an estimate and the basis note says
// so. Ratios are never averaged ACROSS batches (mathematically meaningless);
// the headline reports the median of the computable batches instead.
export async function computeFcrReport(tenantId: string, from: Date | null, to: Date | null, farmId?: string): Promise<ReportPayload> {
  const pres = await presentationSettings(tenantId)
  // Batches in scope first — every batch appears once, whether or not it has
  // data, so the report shows which batches simply lack samples.
  const batchConditions = [eq(batches.tenantId, tenantId)]
  if (farmId) {
    const unitIds = await unitIdsForFarm(tenantId, farmId)
    batchConditions.push(inArray(batches.unitId, unitIds.length ? unitIds : ['__none__']))
  }
  const batchRows = await db.select().from(batches).where(and(...batchConditions)).orderBy(asc(batches.code))
  const batchById = new Map(batchRows.map((b) => [b.id, b]))
  const batchIds = batchRows.map((b) => b.id)

  const recordConditions = [eq(records.tenantId, tenantId)]
  if (from) recordConditions.push(gte(records.createdAt, from))
  if (to) recordConditions.push(lte(records.createdAt, to))
  if (batchIds.length) recordConditions.push(inArray(records.batchId, batchIds))
  const recRows = batchIds.length
    ? await db.select().from(records).where(and(...recordConditions)).orderBy(asc(records.createdAt))
    : []

  // Feed kg and weight timeline per batch, from one pass over the records.
  const feedKgByBatch = new Map<string, number>()
  const weightsByBatch = new Map<string, number[]>() // averageKg in time order
  for (const r of recRows) {
    if (!batchById.has(r.batchId)) continue
    if (r.type === 'feeding') {
      const data = r.data as { feedItems?: unknown }
      const items = Array.isArray(data?.feedItems) ? data.feedItems : []
      for (const item of items) {
        const qty = Number((item as { qtyKg?: unknown })?.qtyKg) || 0
        feedKgByBatch.set(r.batchId, (feedKgByBatch.get(r.batchId) ?? 0) + qty)
      }
    } else if (r.type === 'weight') {
      const avg = Number((r.data as { averageKg?: unknown })?.averageKg)
      if (Number.isFinite(avg) && avg > 0) {
        const list = weightsByBatch.get(r.batchId) ?? []
        list.push(avg)
        weightsByBatch.set(r.batchId, list)
      }
    }
  }

  type Row = { code: string; feedKg: number | null; firstW: number | null; lastW: number | null; gainPerBird: number | null; head: number; fcr: number | null }
  const computed: Row[] = batchRows.map((b) => {
    const feedKg = feedKgByBatch.get(b.id)
    const ws = weightsByBatch.get(b.id)
    const enoughSamples = !!ws && ws.length >= 2
    const firstW = enoughSamples ? ws![0] : null
    const lastW = enoughSamples ? ws![ws!.length - 1] : null
    const gainPerBird = enoughSamples ? Math.round((lastW! - firstW!) * 1000) / 1000 : null
    const fcr = gainPerBird !== null && gainPerBird > 0 && (feedKg ?? 0) > 0
      ? Math.round(((feedKg ?? 0) / (gainPerBird * Math.max(1, b.currentQty))) * 100) / 100
      : null
    return {
      code: b.code,
      feedKg: feedKg !== undefined ? Math.round(feedKg * 100) / 100 : null,
      firstW,
      lastW,
      gainPerBird,
      head: b.currentQty,
      fcr,
    }
  })

  const fcrValues = computed.map((r) => r.fcr).filter((v): v is number => v !== null).sort((a, b) => a - b)
  const medianFcr = fcrValues.length
    ? fcrValues.length % 2 === 1
      ? fcrValues[(fcrValues.length - 1) / 2]
      : Math.round(((fcrValues[fcrValues.length / 2 - 1] + fcrValues[fcrValues.length / 2]) / 2) * 100) / 100
    : null
  const totalFeed = [...feedKgByBatch.values()].reduce((s, v) => s + v, 0)

  return {
    title: 'FCR & Efficiency',
    meta: {
      tenantId,
      from: isoDate(from),
      to: isoDate(to),
      generatedAt: new Date().toISOString(),
      farmId: farmId ?? 'ALL',
      batchCount: batchRows.length,
      batchesComputable: fcrValues.length,
      totalFeedKg: Math.round(totalFeed * 100) / 100,
      periodLabel: humanPeriodLabel(from, to, pres),
    },
    columns: ['Batch', `Feed (${pres.weightUnit})`, `First wt (${pres.weightUnit})`, `Last wt (${pres.weightUnit})`, `Gain/bird (${pres.weightUnit})`, 'Head', 'FCR'],
    rows: computed.map((r) => [r.code, r.feedKg, r.firstW, r.lastW, r.gainPerBird, r.head, r.fcr]),
    headline: [
      { label: 'Median FCR', value: medianFcr !== null ? String(medianFcr) : '—', caption: fcrValues.length ? `middle of ${fmtInt(fcrValues.length)} computable batch${fcrValues.length === 1 ? '' : 'es'}` : 'not yet measurable' },
      { label: 'Feed issued', value: `${fmtInt(totalFeed)} ${pres.weightUnit}`, caption: humanPeriodLabel(from, to, pres).toLowerCase() },
      { label: 'Batches computable', value: `${fmtInt(fcrValues.length)} of ${fmtInt(batchRows.length)}`, caption: 'need ≥2 weight samples + feed' },
    ],
    notes: notesFor(pres, [
      'FCR = feed issued ÷ (weight gain per bird × head). Needs two weight samples — "—" means not measurable, never zero.',
      'Weight gain spans the first and latest samples in the period; sample more often for accuracy.',
      'The headline is the median of computable ratios, never an average across batches.',
    ]),
    basis: `Compiled from worker-submitted feeding and weight-sample records for the period above${farmId ? ', scoped to the selected farm' : ', across all farms'}.`,
    columnAlign: ['left', 'right', 'right', 'right', 'right', 'right', 'right'],
    columnFormats: ['text', 'weight', 'weight', 'weight', 'weight', 'number', 'number'],
  }
}
