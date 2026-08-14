import { NextResponse } from 'next/server'
import { db } from '@/db'
import { notifications, tasks } from '@/db/schemas'
import { getSessionUser } from '@/lib/auth'
import { and, desc, eq, lt, notInArray } from 'drizzle-orm'
import { startOfUtcDay } from '@/app/api/tasks/route'

// ── GET /api/notifications (issue #227 task 3) ─────────────────────────────
// This is real new work, not a rewire — no `notifications` table existed on
// this branch before this issue. Minimal shape: one row per notification,
// `read` boolean, aggregated from other tables (see db/schemas/dashboard.ts
// for the full rationale). Sources implemented here:
//
//   - `task`  — synced lazily on every GET: any of the tenant's tasks that
//     are due today or overdue (and not DONE/CANCELLED) get a notification
//     row upserted (ON CONFLICT DO NOTHING on (tenantId, sourceType,
//     sourceId), so re-running the sync never duplicates or resurfaces a row
//     the user already marked read).
//
// Sources intentionally NOT implemented (flagged, not silently skipped):
//   - `alert`    — TODO: no `alerts` table exists anywhere on this branch.
//     Out of scope for this issue; wire in once one exists.
//   - `approval` — TODO: blocked on Epic: Tasks & Governance's approvals
//     table (issue #243), per this issue's own instruction not to block on it.
//
// Same tenant-resolution + envelope conventions as GET /api/farms. No CORS
// headers (same-origin SPA only).

const ok = <T>(data: T) => NextResponse.json({ success: true, data }, { status: 200 })
const badRequest = (msg: string) => NextResponse.json({ success: false, error: msg }, { status: 400 })

// Exported so GET /api/dashboard/kpis (issue #228) can reuse the same
// "what counts as done" definition and lazy-sync step instead of forking a
// second copy of this logic.
export const DONE_STATUSES = ['DONE', 'CANCELLED']

export async function syncTaskNotifications(tenantId: string): Promise<void> {
  const endOfToday = new Date(startOfUtcDay(new Date()).getTime() + 24 * 60 * 60 * 1000)

  // `dueAt < endOfToday` on a nullable column already excludes tasks with no
  // due date at the SQL level (NULL comparisons are neither true nor false).
  const dueRows = await db
    .select()
    .from(tasks)
    .where(
      and(
        eq(tasks.tenantId, tenantId),
        lt(tasks.dueAt, endOfToday),
        notInArray(tasks.status, DONE_STATUSES)
      )
    )
  if (dueRows.length === 0) return

  await db
    .insert(notifications)
    .values(
      dueRows.map((t) => ({
        id: crypto.randomUUID(),
        tenantId,
        sourceType: 'task',
        sourceId: t.id,
        title: (t.dueAt as Date) < startOfUtcDay(new Date()) ? `Task overdue: ${t.title}` : `Task due today: ${t.title}`,
        message: '',
        read: false,
      }))
    )
    .onConflictDoNothing()
}

export async function GET(req: Request) {
  const session = await getSessionUser()
  const tenantId = session?.tenantId ?? new URL(req.url).searchParams.get('tenantId')?.trim()
  if (!tenantId) return badRequest('tenantId is required')

  await syncTaskNotifications(tenantId)

  const rows = await db
    .select()
    .from(notifications)
    .where(eq(notifications.tenantId, tenantId))
    .orderBy(desc(notifications.createdAt))

  return ok(rows)
}
