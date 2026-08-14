import { NextResponse } from 'next/server'
import { db } from '@/db'
import { tasks, notifications, products } from '@/db/schemas'
import { getSessionUser } from '@/lib/auth'
import { eq } from 'drizzle-orm'
import { syncTaskNotifications, DONE_STATUSES } from '@/app/api/notifications/route'

// ── GET /api/dashboard/kpis (issue #228) ────────────────────────────────────
// New, minimal endpoint — nothing built it before this issue (#227 only built
// current-prices/due-today/notifications; no one was ever scoped to build a
// KPI backend). Returns exactly what's honestly computable today from tables
// that exist on this branch (`tasks`, `notifications`, `products`):
//
//   - activeTasksCount     — tenant's tasks not DONE/CANCELLED
//   - overdueTasksCount    — of those, dueAt is in the past
//   - unreadNotifications  — tenant's unread notification rows (after running
//                            the same lazy task->notification sync GET
//                            /api/notifications uses, so this is accurate even
//                            if that endpoint hasn't been hit yet this session)
//   - productCount         — tenant's tracked product/price rows
//
// Explicitly NOT computable yet — no `batches`/`sales` table exists anywhere
// on this branch (Epic: Crops & Batches / Epic: Finance haven't landed).
// Returned as `null`, never a fabricated number, so the frontend can render an
// honest "not yet tracked" state instead of a made-up figure:
//   - activeBatches  — needs `batches` (Epic: Crops & Batches)
//   - mortalityPct   — needs `batches` mortality records (Epic: Crops & Batches)
//   - avgFCR         — needs `batches` feed/weight records (Epic: Crops & Batches)
//   - revenue        — needs a `sales` table (Epic: Finance)
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

  const [taskRows, notificationRows, productRows] = await Promise.all([
    db.select().from(tasks).where(eq(tasks.tenantId, tenantId)),
    db.select().from(notifications).where(eq(notifications.tenantId, tenantId)),
    db.select().from(products).where(eq(products.tenantId, tenantId)),
  ])

  const now = new Date()
  const openTasks = taskRows.filter((t) => !DONE_STATUSES.includes(t.status))
  const activeTasksCount = openTasks.length
  const overdueTasksCount = openTasks.filter((t) => t.dueAt !== null && (t.dueAt as Date) < now).length
  const unreadNotifications = notificationRows.filter((n) => !n.read).length
  const productCount = productRows.length

  return ok({
    activeTasksCount,
    overdueTasksCount,
    unreadNotifications,
    productCount,
    // Pending Epic: Crops & Batches — see file header.
    activeBatches: null,
    mortalityPct: null,
    avgFCR: null,
    // Pending Epic: Finance — see file header.
    revenue: null,
  })
}
