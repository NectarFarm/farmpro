import { NextResponse } from 'next/server'
import { db } from '@/db'
import { tasks, notifications, products, batches, sales } from '@/db/schemas'
import { getSessionUser } from '@/lib/auth'
import { eq } from 'drizzle-orm'
import { syncTaskNotifications, DONE_STATUSES } from '@/app/api/notifications/route'

// ── GET /api/dashboard/kpis (issue #228, revisited #292) ────────────────────
// Built in #228 before `batches` (#231/#232) and `sales` (#239) existed —
// activeBatches/mortalityPct/avgFCR/revenue were honestly returned as `null`
// with a "pending Epic" comment at the time. Both epics have since merged, so
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
//   - revenue              — sum of the tenant's real `sales.amount` rows
//                            (issue #239). Every sale — 'paid' or 'pending' —
//                            is included, matching how lib/finance.ts posts
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

export async function GET(req: Request) {
  const session = await getSessionUser()
  const tenantId = session?.tenantId ?? new URL(req.url).searchParams.get('tenantId')?.trim()
  if (!tenantId) return badRequest('tenantId is required')

  // Keep unreadNotifications consistent with GET /api/notifications even when
  // this is the first dashboard-backed endpoint hit in the session.
  await syncTaskNotifications(tenantId)

  const [taskRows, notificationRows, productRows, batchRows, salesRows] = await Promise.all([
    db.select().from(tasks).where(eq(tasks.tenantId, tenantId)),
    db.select().from(notifications).where(eq(notifications.tenantId, tenantId)),
    db.select().from(products).where(eq(products.tenantId, tenantId)),
    db.select().from(batches).where(eq(batches.tenantId, tenantId)),
    db.select().from(sales).where(eq(sales.tenantId, tenantId)),
  ])

  const now = new Date()
  const openTasks = taskRows.filter((t) => !DONE_STATUSES.includes(t.status))
  const activeTasksCount = openTasks.length
  const overdueTasksCount = openTasks.filter((t) => t.dueAt !== null && (t.dueAt as Date) < now).length
  const unreadNotifications = notificationRows.filter((n) => !n.read).length
  const productCount = productRows.length

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

  const revenue = salesRows.reduce((s, sale) => s + sale.amount, 0)

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
  })
}
