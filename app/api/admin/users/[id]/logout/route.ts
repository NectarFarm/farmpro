import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { sessions, users } from '@/db/schemas'
import { requirePlatformCapability } from '@/lib/api-auth'
import { writeAuditLog } from '@/lib/audit'

// ── POST /api/admin/users/[id]/logout (users.manage) ────────────────────────
// Force-logout: deletes every live session row for this user. The one real
// gap left in GET/PATCH /api/admin/users' existing capabilities (list/
// filter, create via onboarding, disable via PATCH status, reset password,
// impersonate) — there was no way to end a user's CURRENT sessions without
// also changing their password or suspending the account outright.
const bad = (msg: string, status = 400) => NextResponse.json({ success: false, error: msg }, { status })

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePlatformCapability('users.manage')
  if ('error' in auth) return auth.error
  const { session } = auth

  const { id } = await params
  const rows = await db.select({ id: users.id, tenantId: users.tenantId }).from(users).where(eq(users.id, id)).limit(1)
  const user = rows[0]
  if (!user) return bad('User not found', 404)

  const deleted = await db.delete(sessions).where(eq(sessions.userId, id)).returning({ token: sessions.token })

  await writeAuditLog({
    tenantId: user.tenantId,
    actor: session.id,
    action: 'user.force-logout',
    entity: 'user',
    entityId: id,
    meta: { sessionsEnded: deleted.length },
  })

  return NextResponse.json({ success: true, data: { sessionsEnded: deleted.length } }, { status: 200 })
}
