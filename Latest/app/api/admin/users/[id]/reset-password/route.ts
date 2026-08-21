import { NextResponse } from 'next/server'
import { randomBytes } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { db } from '@/db'
import { passwordResetRequests, users } from '@/db/schemas'
import { getSessionUser, hashSecret } from '@/lib/auth'
import { writeAuditLog } from '@/lib/audit'

// ── POST /api/admin/users/[id]/reset-password (admin user-management feature) ──
// super_admin only. Generates a strong random temp password, hashes it (the
// same scrypt helper every other password on this codebase uses — no second
// hashing scheme), overwrites the target's passwordHash/passwordSalt, marks
// any pending password_reset_requests row for this user 'completed', writes
// an audit entry, and returns the temp password IN THE RESPONSE EXACTLY ONCE
// — same one-time-reveal contract as provisionTenant's ownerTempPassword
// (lib/tenant-provisioning.ts / app/api/onboard-requests/[id]/route.ts). It is
// never persisted anywhere in plaintext and never appears in the audit log.

const bad = (msg: string, status = 400) =>
  NextResponse.json({ success: false, error: msg }, { status })

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSessionUser()
  if (!session) return bad('Unauthorized', 401)
  if (session.role !== 'super_admin') return bad('Forbidden', 403)

  const { id } = await params
  const rows = await db.select().from(users).where(eq(users.id, id)).limit(1)
  const user = rows[0]
  if (!user) return bad('User not found', 404)

  const tempPassword = randomBytes(9).toString('base64url')
  const salt = randomBytes(16).toString('hex')

  await db
    .update(users)
    .set({ passwordHash: hashSecret(tempPassword, salt), passwordSalt: salt })
    .where(eq(users.id, id))

  // Best-effort — a reset can be admin-initiated with no prior forgot-password
  // request on file (e.g. the admin just picked "Reset password" in the UI),
  // so there may be nothing pending to mark. Multiple pending rows for the
  // same user (repeat requests before an admin acted) are all closed by this
  // one action, since one new password satisfies all of them at once.
  await db
    .update(passwordResetRequests)
    .set({ status: 'completed', handledBy: session.id, handledAt: new Date() })
    .where(and(eq(passwordResetRequests.userId, id), eq(passwordResetRequests.status, 'pending')))

  await writeAuditLog({
    tenantId: user.tenantId,
    actor: session.id,
    action: 'user.reset-password',
    entity: 'user',
    entityId: id,
    // Deliberately no password/hash/salt in meta — see lib/audit.ts's comment.
    meta: { resetAt: new Date().toISOString() },
  })

  return NextResponse.json(
    { success: true, data: { id: user.id, email: user.email, tempPassword } },
    { status: 200 }
  )
}
