import { NextResponse } from 'next/server'
import { db } from '@/db'
import { tasks, notifications, products, batches, sales, approvalRequests } from '@/db/schemas'
import { getSessionUser } from '@/lib/auth'
import { and, eq } from 'drizzle-orm'
import { syncTaskNotifications, DONE_STATUSES } from '@/app/api/notifications/route'
import { enterpriseTypeFor } from '@/lib/codes'

// ── GET /api/dashboard/kpis (issue #228, revisited #292, #296) ──────────────
// Built in #228 before `batches` (#231/#232), `sales` (#239) and
// `approval_requests` (#243) existed — activeBatches/mortalityPct/avgFCR/
// revenue/pendingApprovals were honestly returned as `null`/omitted with a
// "pending Epic" comment at the time. All three epics have since merged, so
// this route now computes real numbers from the real tables:
//
//   - activeTasksCount     — tenant's tasks not DONE/CANCELLED
//   - overdueTasksCount    — of those, dueAt is in the past
//   - unreadNotifications  — tenant's unread notification rows (after running
//                            the same lazy task->notification sync GET
//                            /api/notifications uses, so this is accurate even
//                            if that endpoint hasn't been hit yet this session)
//   - productCount         — tenant's tracked product/price rows
//   - activeBatches        — count of the tenant's `batches` rows with
//                            status = 'ACTIVE'.
//   - mortalityPct         — aggregated across those same active batches:
//                            (sum(initialQty) - sum(currentQty)) / sum(initialQty),
//                            i.e. the same per-batch formula
//                            components/farm/crops.tsx already renders
//                            (issue #232: `(initialQty - currentQty) / initialQty`),
//                            applied to the pooled totals rather than averaged
//                            per-batch percentages. Rounded to 1 decimal place
//                            to match that screen's `toFixed(1)` display.
//                            `null` (not 0) when there are no active batches or
//                            every active batch has initialQty 0 — there is no
//                            honest percentage to report in that case.
//   - revenue              — sum of ALL of the tenant's real `sales.amount`
//                            rows, all-time (unchanged from #292 — kept for
//                            back-compat with any existing caller of this
//                            field). Every sale — 'paid' or 'pending' — is
//                            included, matching how lib/finance.ts posts
//                            every sale to the 4001 Sales Revenue account
//                            regardless of payment status. `sales.amount` is
//                            a plain whole-KSh figure (not `*Cents`, see
//                            db/schemas/finance.ts) — summed as-is. Issue #290
//                            (open) documents that this unit convention is
//                            inconsistent with `purchases.totalCostCents`; that
//                            mismatch is a finance-posting-layer bug, not
//                            something this read-only KPI route should paper
//                            over.
//
// ── issue #296: real primary KPI grid + Revenue card ────────────────────────
// The frontend's primary Home-screen tile grid was showing an unrelated
// substitute set (Active Tasks/Overdue Tasks/Unread Notifications/Products
// Tracked) instead of the original design's 4 tiles (Active Batches, Pending
// Approvals, Livestock Units, Crop Batches) + a Revenue card with a real
// Month/Quarter/Year toggle. This issue adds the fields those need:
//
//   - pendingApprovals     — count of the tenant's `approval_requests` rows
//                            with status = 'pending' (issue #243). Same
//                            definition GET /api/approvals?status=pending
//                            uses (components/farm/navigation.tsx's NavCtx
//                            already fetches this for the nav badges, issue
//                            #293) — this route computes it independently
//                            from the same table/status filter rather than
//                            calling that route, so this endpoint stays a
//                            single round-trip.
//   - livestockUnitsCount  — number of DISTINCT `enterprise` groups among the
//                            tenant's ACTIVE batches whose enterprise
//                            classifies as `'livestock'` (via
//                            lib/codes.ts's ENTERPRISE_TYPES map — the
//                            server-safe mirror of ENTERPRISE_REGISTRY's
//                            `type` field in components/farm/data.ts; that
//                            file is "use client" and can't be imported from
//                            a route, same reason BATCH_PREFIXES exists).
//                            Mirrors the original mock's `enterpriseMap` /
//                            `livestock` grouping in
//                            components/farm/dashboard.tsx@80ab7db exactly —
//                            group active batches by `enterprise`, skip any
//                            subtype the registry doesn't recognise (never
//                            guess a classification).
//   - livestockUnitsQty    — sum of `currentQty` across those same livestock
//                            groups (the mock's `livestock.reduce((s,[,v]) =>
//                            s+v.qty, 0)` — its `Batch.qty` is the *current*
//                            headcount, distinct from `initialQty`, so this
//                            reads `batches.currentQty`, not `initialQty`).
//   - cropBatchGroupsCount — same grouping, counting `'crop'`-classified
//                            distinct enterprise groups instead.
//   - period               — the resolved Month/Quarter/Year toggle value
//                            (`?period=month|quarter|year`, defaults to
//                            'month' on an omitted/invalid value — this route
//                            never 400s on the toggle, it just falls back).
//                            Echoed back so the frontend can confirm what the
//                            server actually computed periodRevenue/
//                            revenueTrend against.
//   - periodRevenue        — sum of the tenant's `sales.amount` rows whose
//                            `soldAt` falls in [periodStart, now] for the
//                            resolved `period` (calendar month/quarter/year
//                            to date, UTC). This is the number the Revenue
//                            card's toggle actually drives — kept as a
//                            separate field from the all-time `revenue`
//                            above rather than overloading that field's
//                            existing meaning.
//   - marginPct            — see the dedicated writeup below (same
//                            "document the formula choice" instruction issue
//                            #239's trial-balance decision followed).
//   - revenueTrend         — one { date: 'YYYY-MM-DD', amount } entry per
//                            calendar day (UTC) in [periodStart, now]
//                            inclusive, amount = that day's summed
//                            `sales.amount` for the tenant. Zero-filled for
//                            days with no sales so the frontend's bar chart
//                            has a complete, continuous x-axis instead of
//                            gaps — replaces the static PROD_BARS mock array.
//                            A quarter/year period produces many more bars
//                            than the original mock's fixed 7; the frontend
//                            renders this in a horizontally-scrollable strip
//                            (same overflow-x pattern the livestock/crop
//                            summary cards already use) rather than capping
//                            the range, since the issue asks for the full
//                            selected period, not last-7-days.
//
// ── Margin % formula decision (issue #296, same "document the choice"
// instruction as #239's trial-balance posting-engine writeup) ───────────────
// What's realistically computable today: `sales.amount` (real revenue) minus
// the ONLY real per-batch cost figure this branch tracks anywhere —
// `batches.acquisitionCostCents` (see GET /api/batches/[id]/cost-breakdown's
// header comment: no purchases/expenses/labor_logs table links a cost to a
// batch yet, so feed/health/labour/overhead stay untracked, `tracked: false`).
// This is EXACTLY the same cost basis lib/reports.ts's computeBatchPlReport
// already uses for its "Margin %" column (`revenue - cost` where `cost` is
// `acquisitionCostCents` converted to whole KSh) — reusing it here means this
// tile can never drift from what the Finance/Batch P&L report shows for the
// same tenant.
//
// Two deliberate choices, both inherited from that same precedent:
//   1. Cost is summed across ALL of the tenant's batches (any status), NOT
//      filtered to the selected Month/Quarter/Year period. Acquisition cost
//      is a one-time, point-in-time cost incurred when a batch starts, not a
//      recurring expense that accrues day-by-day the way revenue does — there
//      is no honest way to "bucket" a single acquisition cost into whichever
//      calendar period the period toggle currently selects. Bucketing it by
//      period would silently misrepresent an old batch's cost as belonging to
//      this month. computeBatchPlReport documents the identical caveat
//      (`costCaveat`: "not filtered by the report date range").
//   2. Because of (1), this is a "revenue vs. tracked acquisition cost"
//      approximation, not a full accounting margin — it does NOT subtract
//      feed/labour/overhead (none of that has a data source yet, same honesty
//      stance as avgFCR below and the cost-breakdown route). Renamed from the
//      mock's generic "Margin %" is not attempted (issue asks to keep the
//      same label) but this comment is the paper trail for what it actually
//      measures.
// `marginPct` is `null` (not 0) when `periodRevenue` is 0 — no honest
// percentage to report against zero revenue, same "null over a fabricated
// number" convention `mortalityPct` above already uses.
//
// Still honestly not computable — no FCR-capable data source exists anywhere
// on this branch. `batches` has no feed-consumption or weight-gain columns,
// and there is no feed-log/weigh-in table (checked db/schemas/*.ts and
// grepped the repo, same "don't fabricate, don't assume" rule the original
// #228 comment used):
//   - avgFCR — needs feed-intake + weight-gain records that don't exist yet.
//
// Same tenant-resolution + envelope conventions as the rest of #227's routes:
// session tenant wins, `tenantId` query param is the standalone-mock-mode
// fallback.

const ok = <T>(data: T) => NextResponse.json({ success: true, data }, { status: 200 })
const badRequest = (msg: string) => NextResponse.json({ success: false, error: msg }, { status: 400 })

type Period = 'month' | 'quarter' | 'year'
const VALID_PERIODS: readonly Period[] = ['month', 'quarter', 'year']

function resolvePeriod(raw: string | null): Period {
  const v = raw?.trim().toLowerCase()
  return (VALID_PERIODS as readonly string[]).includes(v ?? '') ? (v as Period) : 'month'
}

// Calendar-period-to-date start, in UTC (avoids server-timezone flakiness —
// `sales.soldAt` is stored as a plain timestamp and compared as a JS Date
// either way, so anchoring the boundary math in UTC keeps this deterministic
// regardless of TZ the process happens to run in).
function periodStart(period: Period, now: Date): Date {
  const y = now.getUTCFullYear()
  if (period === 'year') return new Date(Date.UTC(y, 0, 1))
  if (period === 'quarter') {
    const q = Math.floor(now.getUTCMonth() / 3)
    return new Date(Date.UTC(y, q * 3, 1))
  }
  return new Date(Date.UTC(y, now.getUTCMonth(), 1))
}

function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10)
}

export async function GET(req: Request) {
  const session = await getSessionUser()
  const url = new URL(req.url)
  const tenantId = session?.tenantId ?? url.searchParams.get('tenantId')?.trim()
  if (!tenantId) return badRequest('tenantId is required')

  const period = resolvePeriod(url.searchParams.get('period'))

  // Keep unreadNotifications consistent with GET /api/notifications even when
  // this is the first dashboard-backed endpoint hit in the session.
  await syncTaskNotifications(tenantId)

  const [taskRows, notificationRows, productRows, batchRows, salesRows, pendingApprovalRows] = await Promise.all([
    db.select().from(tasks).where(eq(tasks.tenantId, tenantId)),
    db.select().from(notifications).where(eq(notifications.tenantId, tenantId)),
    db.select().from(products).where(eq(products.tenantId, tenantId)),
    db.select().from(batches).where(eq(batches.tenantId, tenantId)),
    db.select().from(sales).where(eq(sales.tenantId, tenantId)),
    db.select().from(approvalRequests).where(and(eq(approvalRequests.tenantId, tenantId), eq(approvalRequests.status, 'pending'))),
  ])

  const now = new Date()
  const openTasks = taskRows.filter((t) => !DONE_STATUSES.includes(t.status))
  const activeTasksCount = openTasks.length
  const overdueTasksCount = openTasks.filter((t) => t.dueAt !== null && (t.dueAt as Date) < now).length
  const unreadNotifications = notificationRows.filter((n) => !n.read).length
  const productCount = productRows.length
  const pendingApprovals = pendingApprovalRows.length

  const activeBatchRows = batchRows.filter((b) => b.status === 'ACTIVE')
  const activeBatches = activeBatchRows.length

  // Pooled mortality across all active batches — see file header for why this
  // sums initialQty/currentQty across batches rather than averaging each
  // batch's own percentage. `null` when there's nothing to divide by (no
  // active batches, or every active batch has initialQty 0).
  const totalInitialQty = activeBatchRows.reduce((s, b) => s + b.initialQty, 0)
  const totalCurrentQty = activeBatchRows.reduce((s, b) => s + b.currentQty, 0)
  const mortalityPct = totalInitialQty > 0
    ? Math.round(((totalInitialQty - totalCurrentQty) / totalInitialQty) * 1000) / 10
    : null

  // Livestock Units / Crop Batches groups — see file header for why this
  // mirrors the original mock's enterpriseMap exactly (grouped by
  // `enterprise`, classified via lib/codes.ts's ENTERPRISE_TYPES, unknown
  // subtypes skipped rather than guessed).
  const enterpriseGroups = new Map<string, { qty: number; type: 'livestock' | 'crop' }>()
  for (const b of activeBatchRows) {
    const type = enterpriseTypeFor(b.enterprise)
    if (!type) continue
    const existing = enterpriseGroups.get(b.enterprise)
    if (existing) existing.qty += b.currentQty
    else enterpriseGroups.set(b.enterprise, { qty: b.currentQty, type })
  }
  const groups = [...enterpriseGroups.values()]
  const livestockGroups = groups.filter((g) => g.type === 'livestock')
  const cropGroups = groups.filter((g) => g.type === 'crop')
  const livestockUnitsCount = livestockGroups.length
  const livestockUnitsQty = livestockGroups.reduce((s, g) => s + g.qty, 0)
  const cropBatchGroupsCount = cropGroups.length

  const revenue = salesRows.reduce((s, sale) => s + sale.amount, 0)

  // Period-scoped revenue + day-bucketed trend — see file header.
  const start = periodStart(period, now)
  const periodSalesRows = salesRows.filter((s) => (s.soldAt as Date) >= start && (s.soldAt as Date) <= now)
  const periodRevenue = periodSalesRows.reduce((s, sale) => s + sale.amount, 0)

  const startDay = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()))
  const endDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  const buckets = new Map<string, number>()
  for (const d = new Date(startDay); d <= endDay; d.setUTCDate(d.getUTCDate() + 1)) {
    buckets.set(dayKey(d), 0)
  }
  for (const s of periodSalesRows) {
    const key = dayKey(s.soldAt as Date)
    // Guard rather than crash: every periodSalesRows entry should fall within
    // [startDay, endDay] by construction, but a sale exactly at a boundary
    // instant is safer handled defensively than assumed.
    if (buckets.has(key)) buckets.set(key, (buckets.get(key) ?? 0) + s.amount)
  }
  const revenueTrend = [...buckets.entries()].map(([date, amount]) => ({ date, amount }))

  // Margin % — see file header's dedicated writeup for the formula choice.
  const totalCostCents = batchRows.reduce((s, b) => s + (b.acquisitionCostCents ?? 0), 0)
  const totalCostKsh = Math.round(totalCostCents / 100)
  const marginPct = periodRevenue > 0
    ? Math.round(((periodRevenue - totalCostKsh) / periodRevenue) * 1000) / 10
    : null

  return ok({
    activeTasksCount,
    overdueTasksCount,
    unreadNotifications,
    productCount,
    activeBatches,
    mortalityPct,
    // No FCR-capable data source exists yet — see file header.
    avgFCR: null,
    revenue,
    pendingApprovals,
    livestockUnitsCount,
    livestockUnitsQty,
    cropBatchGroupsCount,
    period,
    periodRevenue,
    marginPct,
    revenueTrend,
  })
}
