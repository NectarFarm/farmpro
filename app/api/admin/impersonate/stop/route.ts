import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { sessions, users } from '@/db/schemas'
import {
  ADMIN_SESSION_COOKIE,
  attachSessionCookie,
  clearAdminSessionCookie,
  clearSessionCookie,
  SESSION_COOKIE,
} from '@/lib/auth'
import { writeAuditLog } from '@/lib/audit'

// ── POST /api/admin/impersonate/stop (admin user-management feature) ───────
// Ends an impersonation session early (the "Return to admin" button) —
// callable by whoever currently holds the impersonated (target's) cookie,
// which only exists because an admin started it. Also the codepath a client
// can call right as its own countdown hits zero, so "ended by expiry" is
// recorded accurately even when the DB row would otherwise have simply
// stopped authenticating on its own (getSessionUser's expiry check) with no
// audit trail of the actual end time.
//
// No session/role check beyond "this token really is an impersonation
// session" — the caller IS the target's browser at this point (ifms_session
// was swapped to the target's token by the impersonate route), so there is no
// separate "admin session" to re-verify here; the audit entry's actor is the
// ORIGINAL admin (sessions.impersonatedBy), not whoever holds the cookie now.

const bad = (msg: string, status = 400) =>
  NextResponse.json({ success: false, error: msg }, { status })

export async function POST(req: Request) {
  const store = await cookies()
  const token = store.get(SESSION_COOKIE)?.value
  if (!token) return bad('No active session', 401)

  const rows = await db.select().from(sessions).where(eq(sessions.token, token)).limit(1)
  const row = rows[0]
  if (!row) return bad('No active session', 401)
  if (!row.impersonatedBy) return bad('This session is not an impersonation session', 400)

  const now = new Date()
  const endedEarly = now.getTime() < row.expiresAt.getTime()

  await db.delete(sessions).where(eq(sessions.token, token))

  const targetRows = await db.select({ tenantId: users.tenantId }).from(users).where(eq(users.id, row.userId)).limit(1)
  const targetTenantId = targetRows[0]?.tenantId ?? null

  await writeAuditLog({
    tenantId: targetTenantId,
    actor: row.impersonatedBy,
    action: 'impersonation.end',
    entity: 'user',
    entityId: row.userId,
    meta: { endedEarly, endedAt: now.toISOString(), scheduledExpiresAt: row.expiresAt.toISOString() },
  })

  const res = NextResponse.json({ success: true, data: { endedEarly, endedAt: now.toISOString() } }, { status: 200 })

  const adminToken = store.get(ADMIN_SESSION_COOKIE)?.value
  if (adminToken) {
    attachSessionCookie(res, adminToken, req)
    clearAdminSessionCookie(res)
  } else {
    // Nothing to restore (shouldn't happen — impersonate always sets this) —
    // fail safe to logged-out rather than leaving a dangling target cookie.
    clearSessionCookie(res)
  }
  return res
}
