import { NextResponse } from 'next/server'
import { db } from '@/db'
import { notifications, notificationReads } from '@/db/schemas'
import { getSessionUser } from '@/lib/auth'
import { isUniqueViolation } from '@/lib/db-errors'
import { PLATFORM_TENANT_SENTINEL } from '@/lib/audit'
import { and, eq, isNull, or } from 'drizzle-orm'

// ── PATCH /api/notifications/[id] (issue #227 task 3; recipient-scoping fix) ─
// Mark-read, FOR THE CALLING USER ONLY. A session is required — the
// `tenantId` query-param fallback this route used to trust is gone, same as
// GET /api/notifications (see that file's header for why). The target row
// must both belong to the caller's tenant AND be visible to them under the
// same predicate GET uses (userId = me OR role = my role OR broadcast) —
// otherwise 404, same as "not found", so this can't be used to probe another
// tenant's (or another user's/role's) notification ids, and it can't be used
// to silently confirm a notification exists that was never addressed to you.
//
// Read state lives in `notification_reads` (one row per user who marked a
// given notification read), NOT the legacy shared `notifications.read`
// column — that column drove a single boolean for the whole tenant, so one
// person marking a broadcast read hid it for everyone. Marking read is an
// insert; marking unread is a delete. Both are idempotent: inserting twice
// hits the (notificationId, userId) unique constraint, which is treated as
// success (already read) rather than an error — via lib/db-errors.ts's
// isUniqueViolation, which unwraps drizzle's wrapped driver error to find the
// underlying 23505.

const ok = <T>(data: T) => NextResponse.json({ success: true, data }, { status: 200 })
const unauthorized = () => NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
const notFound = () => NextResponse.json({ success: false, error: 'Notification not found' }, { status: 404 })

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = await getSessionUser()
  if (!session) return unauthorized()
  const tenantId = session.tenantId ?? PLATFORM_TENANT_SENTINEL

  let read = true
  try {
    const raw = await req.json()
    if (raw && typeof raw === 'object' && 'read' in raw) {
      const b = raw as Record<string, unknown>
      if (typeof b.read === 'boolean') read = b.read
    }
  } catch {
    // No/empty body — default to marking read, the only action this route
    // supports today.
  }

  const visibility = or(
    eq(notifications.userId, session.id),
    eq(notifications.role, session.role),
    and(isNull(notifications.userId), isNull(notifications.role))
  )!

  const rows = await db
    .select()
    .from(notifications)
    .where(and(eq(notifications.id, id), eq(notifications.tenantId, tenantId), visibility))
    .limit(1)
  const notification = rows[0]
  if (!notification) return notFound()

  if (read) {
    try {
      await db.insert(notificationReads).values({ id: crypto.randomUUID(), notificationId: id, userId: session.id })
    } catch (err) {
      if (!isUniqueViolation(err)) throw err
      // Already marked read by this user — idempotent no-op.
    }
  } else {
    await db
      .delete(notificationReads)
      .where(and(eq(notificationReads.notificationId, id), eq(notificationReads.userId, session.id)))
  }

  return ok({ ...notification, read })
}
