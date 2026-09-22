import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { users } from '@/db/schemas'
import { getSessionDetails } from '@/lib/auth'
import { computeAccessState } from '@/lib/billing/access-state'
import { getCurrentSubscription, toSnapshot } from '@/lib/billing/subscriptions'

// ── GET /api/auth/session (issue #220/#221; extended for admin user-management) ──
// The shell's bootstrap calls this on load. 200 + the session user
// ({ id, name, email, role, tenantId }) when the cookie is valid, otherwise the
// standard 401 envelope — the shell treats any non-200 as logged-out.
// Same-origin SPA only (the shell calls it from its own origin), so this
// endpoint sets no CORS headers (issue #221 review).
//
// Additive extension (admin user-management feature): when the active session
// is a time-boxed impersonation (sessions.impersonatedBy is set), the response
// also carries `impersonatedBy` — the admin's id/name/email and the session's
// real expiresAt — so the shell can render the global "you are impersonating
// X, admin Y is responsible, N minutes left" banner. A normal session gets
// `impersonatedBy: null`; every field a normal session already returned is
// unchanged, so existing callers that only read id/name/email/role/tenantId
// keep working exactly as before.
//
// Additive extension (SaaS back-office backend): tenant-scoped sessions
// (role !== 'super_admin', tenantId set) also carry `subscription` — status
// run through lib/billing/access-state.ts (never the raw, possibly-stale DB
// column), the plan name, trialEndsAt/currentPeriodEnd, and `needsPlan`. The
// UI is expected to route to plan selection before the dashboard when
// needsPlan is true — deliberately NOT enforced at the API level here (no
// route currently blocks farm data on an unpaid subscription); see
// docs/backoffice-api.md for that follow-up. A super_admin session gets
// `subscription: null` — the concept doesn't apply to a platform account.

export async function GET() {
  const details = await getSessionDetails()
  if (!details) {
    return NextResponse.json({ success: false, error: 'No active session' }, { status: 401 })
  }
  const { user, impersonatedBy, expiresAt } = details

  let impersonatedByInfo: { adminId: string; adminName: string; adminEmail: string; expiresAt: string } | null = null
  if (impersonatedBy) {
    const adminRows = await db
      .select({ id: users.id, name: users.name, email: users.email })
      .from(users)
      .where(eq(users.id, impersonatedBy))
      .limit(1)
    const admin = adminRows[0]
    impersonatedByInfo = {
      adminId: impersonatedBy,
      adminName: admin?.name ?? 'Unknown admin',
      adminEmail: admin?.email ?? '',
      expiresAt: expiresAt.toISOString(),
    }
  }

  let subscription: {
    status: string
    planName: string | null
    trialEndsAt: string | null
    currentPeriodEnd: string | null
    needsPlan: boolean
  } | null = null

  if (user.tenantId) {
    const sub = await getCurrentSubscription(user.tenantId)
    const access = computeAccessState(sub ? toSnapshot(sub) : null, new Date())
    subscription = {
      status: access.status,
      planName: sub?.plan.name ?? null,
      trialEndsAt: sub?.trialEndsAt?.toISOString() ?? null,
      currentPeriodEnd: sub?.currentPeriodEnd?.toISOString() ?? null,
      needsPlan: access.needsPlan,
    }
  }

  return NextResponse.json(
    { success: true, data: { ...user, impersonatedBy: impersonatedByInfo, subscription } },
    { status: 200 }
  )
}
