import { NextResponse } from 'next/server'
import { db } from '@/db'
import { notifications, notificationReads, tasks, employees } from '@/db/schemas'
import { getSessionUser } from '@/lib/auth'
import { PLATFORM_TENANT_SENTINEL } from '@/lib/audit'
import { and, desc, eq, inArray, isNull, lt, notInArray, or } from 'drizzle-orm'
import { startOfUtcDay } from '@/app/api/tasks/route'
import { notifyRecipientsByEmail } from '@/lib/notification-email'

// ── GET /api/notifications (issue #227 task 3; recipient-scoping fix) ─────
// This is real new work, not a rewire — no `notifications` table existed on
// this branch before this issue. Minimal shape: one row per notification,
// aggregated from other tables (see db/schemas/dashboard.ts for the full
// rationale). Sources implemented here:
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
// ── Recipient scoping (data-leak fix) ───────────────────────────────────────
// Previously every notification was tenant-wide by construction (no
// recipient column at all) — any user in the tenant could read every other
// user's notifications, including a password-reset row naming another user
// and their email, AND an unauthenticated request could read them all just
// by guessing a tenantId (tenantId used to fall back to a query param). Both
// holes are closed here:
//   - a session is REQUIRED; there is no `tenantId` query-param fallback on
//     this route any more (unlike most other GETs in this codebase, which
//     still support standalone-mock-mode — that is a separate, wider task).
//     Tenant comes from the session ONLY.
//   - visibility predicate per row: userId = me OR role = my role OR
//     (userId IS NULL AND role IS NULL) — see db/schemas/dashboard.ts's
//     notifications table comment for why both-null means "broadcast".
//   - `read` in the response is computed PER CALLER from `notification_reads`
//     (one row per user who has actually marked it read), not from the
//     legacy shared `notifications.read` column — a shared boolean can't
//     express "read by the owner, unread for the manager".
//
// A tenantless session (super_admin) resolves to the documented
// PLATFORM_TENANT_SENTINEL tenant scope — the same scope POST
// /api/auth/forgot-password now files its password-reset notification
// under, so a super_admin's own feed is where that notification actually
// lives (see that route's header for the full reasoning).

const ok = <T>(data: T) => NextResponse.json({ success: true, data }, { status: 200 })
const unauthorized = () => NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })

// Exported so GET /api/dashboard/kpis (issue #228) can reuse the same
// "what counts as done" definition and lazy-sync step instead of forking a
// second copy of this logic.
export const DONE_STATUSES = ['DONE', 'CANCELLED']

// One row per notification, targeting decision documented at the call site
// in the producer that creates it. Task due/overdue notifications target the
// task's own assignee when it has one AND that employee has a linked login
// (tasks.assigneeId -> employees.userId): this used to be an unconditional
// tenant-wide broadcast because "tasks has no assignee column" — the
// tasks-scheduling task since added `assigneeId`, so that's no longer true,
// and the honest default is now "tell the person actually on the hook", not
// everyone. A task with no assignee, or one whose employee has no login yet,
// still broadcasts — there is no single role that legitimately covers
// "everyone who should know an UNASSIGNED task is overdue" (an owner tracks
// it, a manager acts on it, a worker may end up doing it), and a task title
// carries nothing sensitive the way a password-reset notification does.
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

  // One batched lookup for every due task's assignee rather than one query
  // per task — this sync runs on every dashboard GET, so an N+1 here would
  // mean N+1 on every page load.
  const assigneeIds = Array.from(new Set(dueRows.map((t) => t.assigneeId).filter((v): v is string => !!v)))
  const userIdByEmployeeId = new Map<string, string | null>()
  if (assigneeIds.length > 0) {
    const employeeRows = await db
      .select({ id: employees.id, userId: employees.userId })
      .from(employees)
      // Tenant-scoped as well as id-scoped. The ids come from this tenant's
      // own tasks, so today it cannot match anything foreign — but that is a
      // property of the write path, not of this query, and an unscoped read
      // is one bad assigneeId away from mailing another farm's worker.
      .where(and(eq(employees.tenantId, tenantId), inArray(employees.id, assigneeIds)))
    for (const e of employeeRows) userIdByEmployeeId.set(e.id, e.userId)
  }

  // .returning() on an ON CONFLICT DO NOTHING insert gives back ONLY the
  // rows actually inserted (Postgres never returns a skipped conflict) —
  // that is what makes emailing exactly these rows safe from a mail-storm:
  // a task already synced on an earlier GET conflicts on
  // idx_notifications_source and is silently omitted here, so it is never
  // handed to notifyRecipientsByEmail a second time. notifyRecipientsByEmail
  // itself adds a second, independent guard (an atomic emailed_at claim) on
  // top of this for the concurrent-request case.
  const insertedRows = await db
    .insert(notifications)
    .values(
      dueRows.map((t) => {
        // Null when unassigned, when the assignee lookup came up empty
        // (shouldn't happen — assigneeId is only ever set to a real
        // employees.id — but a stale/deleted row must fail safe to
        // broadcast, not to silently notifying nobody), or when that
        // employee has no linked login.
        const targetUserId = t.assigneeId ? userIdByEmployeeId.get(t.assigneeId) ?? null : null
        return {
          id: crypto.randomUUID(),
          tenantId,
          sourceType: 'task',
          sourceId: t.id,
          title: (t.dueAt as Date) < startOfUtcDay(new Date()) ? `Task overdue: ${t.title}` : `Task due today: ${t.title}`,
          message: '',
          read: false,
          // Targeted to the assignee's login when there is one; broadcast
          // (both null) otherwise — see the function-level comment above.
          userId: targetUserId,
          role: null,
        }
      })
    )
    .onConflictDoNothing()
    .returning({ id: notifications.id })

  for (const row of insertedRows) {
    await notifyRecipientsByEmail(row.id)
  }
}

export async function GET() {
  const session = await getSessionUser()
  if (!session) return unauthorized()
  const tenantId = session.tenantId ?? PLATFORM_TENANT_SENTINEL

  await syncTaskNotifications(tenantId)

  // Row visible to this caller: addressed to them by id, addressed to their
  // role, or a genuine broadcast (both null) — see this file's header.
  const visibility = or(
    eq(notifications.userId, session.id),
    eq(notifications.role, session.role),
    and(isNull(notifications.userId), isNull(notifications.role))
  )!

  const rows = await db
    .select({
      id: notifications.id,
      tenantId: notifications.tenantId,
      sourceType: notifications.sourceType,
      sourceId: notifications.sourceId,
      title: notifications.title,
      message: notifications.message,
      userId: notifications.userId,
      role: notifications.role,
      createdAt: notifications.createdAt,
      readAt: notificationReads.readAt,
    })
    .from(notifications)
    .leftJoin(
      notificationReads,
      and(eq(notificationReads.notificationId, notifications.id), eq(notificationReads.userId, session.id))
    )
    .where(and(eq(notifications.tenantId, tenantId), visibility))
    .orderBy(desc(notifications.createdAt))

  return ok(
    rows.map(({ readAt, ...row }) => ({
      ...row,
      // Per-caller read state, not the legacy shared column. Loose check:
      // an unmatched LEFT JOIN row comes back as either null or undefined
      // depending on the driver, and both mean "no read row -> unread".
      read: readAt != null,
    }))
  )
}
