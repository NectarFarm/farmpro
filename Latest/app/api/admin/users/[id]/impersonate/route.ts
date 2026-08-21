import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { users } from '@/db/schemas'
import {
  attachAdminSessionCookie,
  attachSessionCookie,
  createImpersonationSession,
  getSessionUser,
  SESSION_COOKIE,
} from '@/lib/auth'
import { writeAuditLog } from '@/lib/audit'

// ── POST /api/admin/users/[id]/impersonate (admin user-management feature) ─
// super_admin only. Body: { minutes }. This is the "time-boxed, fully
// audited impersonation" the user chose in place of the (impossible, and
// dangerous) "prefill the user's real credentials" — see the audit_log entry
// this writes and GET /api/admin/impersonation-log for the "show the login of
// who logged in and when he was logged out" half of that request.
//
// - `minutes` must be one of ALLOWED_MINUTES — never an arbitrary
//   caller-supplied duration.
// - Refuses to impersonate another super_admin or the caller's own account.
// - Creates a session row for the TARGET with `impersonatedBy` set to the
//   admin's id and `expiresAt` = now + minutes; expiry is enforced by the
//   exact same `gt(sessions.expiresAt, now())` check every session already
//   goes through (lib/auth.ts's getSessionDetails) — no separate timer.
// - The admin's OWN session token is preserved in a second cookie
//   (`ifms_admin_session`, see lib/auth.ts) rather than destroyed, so
//   POST /api/admin/impersonate/stop can restore it without a fresh login.

const bad = (msg: string, status = 400) =>
  NextResponse.json({ success: false, error: msg }, { status })

const badFields = (fields: Record<string, string>, status = 400) => {
  const firstKey = Object.keys(fields)[0]
  return NextResponse.json({ success: false, error: fields[firstKey], fields }, { status })
}

const ALLOWED_MINUTES = [5, 10, 15, 30] as const

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSessionUser()
  if (!session) return bad('Unauthorized', 401)
  if (session.role !== 'super_admin') return bad('Forbidden', 403)

  const { id } = await params

  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return bad('Invalid JSON body')
  }
  const b = (raw ?? {}) as Record<string, unknown>
  const minutes = Number(b.minutes)
  if (!(ALLOWED_MINUTES as readonly number[]).includes(minutes)) {
    return badFields({ minutes: `minutes must be one of: ${ALLOWED_MINUTES.join(', ')}` })
  }

  if (id === session.id) return bad('You cannot impersonate yourself')

  const rows = await db.select().from(users).where(eq(users.id, id)).limit(1)
  const target = rows[0]
  if (!target) return bad('User not found', 404)
  if (target.role === 'super_admin') return bad('Cannot impersonate another super_admin account', 403)
  if (target.status !== 'ACTIVE') return bad('Cannot impersonate a non-active account', 403)

  const store = await cookies()
  const adminToken = store.get(SESSION_COOKIE)?.value
  if (!adminToken) return bad('Unauthorized', 401)

  const { token: targetToken, expiresAt } = await createImpersonationSession(target.id, session.id, minutes)

  await writeAuditLog({
    tenantId: target.tenantId,
    actor: session.id,
    action: 'impersonation.start',
    entity: 'user',
    entityId: target.id,
    meta: { minutes, expiresAt: expiresAt.toISOString() },
  })

  const res = NextResponse.json(
    {
      success: true,
      data: {
        target: { id: target.id, name: target.name, email: target.email, role: target.role },
        minutesGranted: minutes,
        expiresAt: expiresAt.toISOString(),
      },
    },
    { status: 200 }
  )
  attachAdminSessionCookie(res, adminToken, req)
  attachSessionCookie(res, targetToken, req, minutes * 60 * 1000)
  return res
}
