import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { setPasswordTokens, users } from '@/db/schemas'
import { requirePlatformCapability } from '@/lib/api-auth'
import { writeAuditLog } from '@/lib/audit'
import { issueSetPasswordToken, setPasswordWaitFor } from '@/lib/set-password'
import { resolveAppBaseUrl } from '@/lib/email'

// ── POST /api/admin/users/[id]/set-password-link ────────────────────────────
// The platform-admin twin of PATCH /api/employees/[id]/email-login. A
// set-password link is minted exactly once when an onboarding request is
// approved (app/api/onboard-requests/[id]/route.ts); if the farmer opens it
// after it expires they are locked out and, until this, nobody could mint
// another. issueSetPasswordToken voids whatever link is outstanding before
// minting, so this can never leave two live links for one account.
//
// It changes no password and reveals none — the account keeps whatever
// credential it has; the person chooses their own through the link. The link
// is returned once for the admin to copy (this app sends no email here).
//
// Refusals, each deliberate:
//   - a user whose newest link was already redeemed (or who never had one):
//     that is a password RESET, a separate flow with its own route
//     (reset-password), not a way to mint a takeover link;
//   - platform staff (super_admin) and workers (phone + PIN, no password);
//   - a suspended account.
const bad = (msg: string, status = 400) => NextResponse.json({ success: false, error: msg }, { status })

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePlatformCapability('users.manage')
  if ('error' in auth) return auth.error
  const { session } = auth

  const { id } = await params
  const [user] = await db
    .select({ id: users.id, tenantId: users.tenantId, email: users.email, role: users.role, status: users.status })
    .from(users)
    .where(eq(users.id, id))
    .limit(1)
  if (!user) return bad('User not found', 404)

  if (user.role === 'super_admin') return bad('Platform staff accounts are managed elsewhere — use Reset password.', 403)
  if (user.role === 'worker') return bad('Workers sign in with a phone and PIN, not a password link.', 400)
  if (user.status !== 'ACTIVE') return bad('This account is suspended — reactivate it first.', 409)

  const waiting = (await setPasswordWaitFor([user.id])).get(user.id)
  if (!waiting) {
    const [anyToken] = await db.select({ id: setPasswordTokens.id }).from(setPasswordTokens).where(eq(setPasswordTokens.userId, user.id)).limit(1)
    return bad(
      anyToken
        ? 'This person has already set a password. If they cannot sign in, use Reset password instead.'
        : 'This account was never sent a set-password link. If they cannot sign in, use Reset password instead.',
      409,
    )
  }

  await writeAuditLog({
    tenantId: user.tenantId,
    actor: session.id,
    action: 'user.set-password-link.reissued',
    entity: 'user',
    entityId: user.id,
    // Never the token or URL itself — only that one was issued and what it replaced.
    meta: { email: user.email, role: user.role, previousLink: waiting.state },
  })

  const { token, expiresAt } = await issueSetPasswordToken(user.id)
  const setPasswordUrl = `${resolveAppBaseUrl(req)}/set-password/${token}`

  return NextResponse.json({ success: true, data: { userId: user.id, email: user.email, setPasswordUrl, expiresAt } }, { status: 200 })
}
