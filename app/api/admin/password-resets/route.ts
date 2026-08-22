import { NextResponse } from 'next/server'
import { desc, eq } from 'drizzle-orm'
import { db } from '@/db'
import { passwordResetRequests, users } from '@/db/schemas'
import { getSessionUser } from '@/lib/auth'

// ── GET /api/admin/password-resets (admin user-management feature) ─────────
// super_admin only. The pending queue POST /api/auth/forgot-password feeds —
// "an admin gets a [reset] notification for the user" from the brief. Newest
// first, joined to the user so the admin sees who's asking without a second
// round trip. Only the safe user columns are joined in (name/email/role) —
// no credential columns.

const bad = (msg: string, status = 400) =>
  NextResponse.json({ success: false, error: msg }, { status })

export async function GET() {
  const session = await getSessionUser()
  if (!session) return bad('Unauthorized', 401)
  if (session.role !== 'super_admin') return bad('Forbidden', 403)

  const rows = await db
    .select({
      id: passwordResetRequests.id,
      userId: passwordResetRequests.userId,
      email: passwordResetRequests.email,
      phone: passwordResetRequests.phone,
      status: passwordResetRequests.status,
      requestedAt: passwordResetRequests.requestedAt,
      handledBy: passwordResetRequests.handledBy,
      handledAt: passwordResetRequests.handledAt,
      notes: passwordResetRequests.notes,
      userName: users.name,
      userRole: users.role,
      userStatus: users.status,
      userTenantId: users.tenantId,
    })
    .from(passwordResetRequests)
    .innerJoin(users, eq(passwordResetRequests.userId, users.id))
    .where(eq(passwordResetRequests.status, 'pending'))
    .orderBy(desc(passwordResetRequests.requestedAt))

  return NextResponse.json({ success: true, data: rows }, { status: 200 })
}
