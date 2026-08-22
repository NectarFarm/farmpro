// ── Notification -> email bridge (feat/email-notifications, Task 3) ────────
// Delivers a `notifications` row to the people it is actually addressed to,
// by email — resolving recipients through the EXACT SAME visibility rule GET
// /api/notifications applies (see that route's header):
//   userId set              -> exactly that user
//   role set (userId null)  -> every ACTIVE user in the tenant with that role
//   both null                -> every ACTIVE user in the tenant (broadcast)
// Never "everyone in the tenant" for a targeted row — that would re-create
// the exact leak notification-recipient-scoping fixed (a password-reset row
// naming a real person's name and email, previously readable tenant-wide).
//
// Called by the two producers named in the task: syncTaskNotifications
// (app/api/notifications/route.ts) and POST /api/auth/forgot-password.
import 'server-only'
import { and, eq, isNull } from 'drizzle-orm'
import { db } from '@/db'
import { notifications, tenantSettings, users } from '@/db/schemas'
import { PLATFORM_TENANT_SENTINEL } from '@/lib/audit'
import { sendNotificationEmail } from '@/lib/email'

// Mirrors app/api/settings/route.ts's own default object — no tenant_settings
// row (never configured, or the tenantless PLATFORM_TENANT_SENTINEL scope,
// which owns no row of its own) means notifications are on by default.
async function tenantNotificationsEnabled(tenantId: string): Promise<boolean> {
  const rows = await db
    .select({ enabled: tenantSettings.notificationsEnabled })
    .from(tenantSettings)
    .where(eq(tenantSettings.tenantId, tenantId))
    .limit(1)
  return rows[0]?.enabled ?? true
}

interface RecipientRow {
  id: string
  email: string
}

async function resolveRecipients(n: { tenantId: string; userId: string | null; role: string | null }): Promise<RecipientRow[]> {
  if (n.userId) {
    const rows = await db
      .select({ id: users.id, email: users.email })
      .from(users)
      .where(and(eq(users.id, n.userId), eq(users.status, 'ACTIVE')))
      .limit(1)
    return rows
  }

  // The tenantless PLATFORM_TENANT_SENTINEL scope (super_admin's own feed)
  // has no real tenants.id row — its "tenant" is every user with
  // tenantId IS NULL, i.e. every super_admin, not a literal
  // tenantId = 'platform' match (which would never match any real user).
  const tenantFilter = n.tenantId === PLATFORM_TENANT_SENTINEL ? isNull(users.tenantId) : eq(users.tenantId, n.tenantId)

  if (n.role) {
    return db
      .select({ id: users.id, email: users.email })
      .from(users)
      .where(and(tenantFilter, eq(users.role, n.role), eq(users.status, 'ACTIVE')))
  }

  // Broadcast — both null.
  return db
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(and(tenantFilter, eq(users.status, 'ACTIVE')))
}

// Emails one notification row to its resolved recipients, at most once ever.
// The dedup guard is an atomic `UPDATE ... WHERE emailed_at IS NULL
// RETURNING id`: if two callers race for the same row (e.g. two concurrent
// GET /api/notifications requests both syncing the same overdue task), only
// one of them wins the claim and only that one sends anything — the other
// sees zero rows returned and returns immediately. This is what makes
// "running the task sync twice does not send twice" true even under a race,
// not just on the happy path.
//
// `notificationsEnabled: false` still claims the row (so it's never
// reconsidered if this function is somehow called on it again) but skips
// resolving/sending — there is no retry/backfill path anywhere in this
// codebase for a flag flipped back on later, so that's a deliberate
// simplification, not an oversight.
//
// Never throws: a bounced/misconfigured send must not fail the request that
// triggered it (the task sync running on a dashboard GET, or the
// forgot-password POST). Every failure is logged and swallowed.
export async function notifyRecipientsByEmail(notificationId: string): Promise<void> {
  try {
    const claimed = await db
      .update(notifications)
      .set({ emailedAt: new Date() })
      .where(and(eq(notifications.id, notificationId), isNull(notifications.emailedAt)))
      .returning()

    const n = claimed[0]
    if (!n) return // already claimed/handled, or the row doesn't exist

    const enabled = await tenantNotificationsEnabled(n.tenantId)
    if (!enabled) return

    const recipients = await resolveRecipients({ tenantId: n.tenantId, userId: n.userId, role: n.role })
    for (const recipient of recipients) {
      const result = await sendNotificationEmail({ to: recipient.email, title: n.title, message: n.message })
      if (!result.ok) {
        console.error('[notification-email] send failed', { notificationId, recipient: recipient.id, result })
      }
    }
  } catch (err) {
    console.error('[notification-email] failed to process notification for email', { notificationId, err })
  }
}
