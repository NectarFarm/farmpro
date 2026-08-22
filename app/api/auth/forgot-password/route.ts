import { NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { notifications, passwordResetRequests, users } from '@/db/schemas'
import { checkLoginThrottle, clearLoginThrottle, recordLoginFailure } from '@/lib/auth'
import { PLATFORM_TENANT_SENTINEL } from '@/lib/audit'
import { isValidEmail, isValidPhone, normalizeEmail, normalizePhone, toStoredPhone } from '@/lib/validation'
import { notifyRecipientsByEmail } from '@/lib/notification-email'

// ── POST /api/auth/forgot-password (admin user-management feature) ────────
// Public, no session. There is no email/SMS infrastructure anywhere in this
// codebase (checked package.json + grepped the repo — no nodemailer / resend
// / sendgrid / smtp), so a self-service reset email is not something this
// route can ever send. Instead: prove you know BOTH the account's email AND
// its registered phone, and an admin is notified to act on your behalf
// (POST /api/admin/users/[id]/reset-password) and relay the result out of
// band — exactly the flow auth.tsx's LoginScreen already tells users to
// expect ("Contact your farm administrator to reset your password").
//
// Body: { email, phone }.
//
// ── Enumeration-safety contract (READ BEFORE TOUCHING THIS ROUTE) ──────────
// The response body and status code for a matched pair, a real email with the
// WRONG phone, and an email that doesn't exist at all MUST be byte-for-byte
// identical. Otherwise this endpoint becomes an oracle: an attacker who
// already suspects an email is registered could use different response
// shapes to confirm it, or brute-force which phone number is bound to it.
// Do NOT add a "no account found" / "phone doesn't match" message later —
// that is exactly the leak this contract exists to prevent. The only
// responses that are allowed to differ are ones that reveal nothing about any
// specific account: malformed input (format is not a secret) and rate
// limiting (triggered by request volume against one identifier, not by
// whether the account is real).

const badFields = (fields: Record<string, string>) => {
  const firstKey = Object.keys(fields)[0]
  return NextResponse.json({ success: false, error: fields[firstKey], fields }, { status: 400 })
}

// Built fresh per call, never shared. A Response body can only be read ONCE,
// so a module-scope singleton returned from more than one path meant the
// endpoint worked exactly once per server process and then handed every later
// caller an already-consumed body ("Body is unusable"). It must also stay
// byte-identical between the matched and unmatched paths — see the callers.
function genericAck() {
  return NextResponse.json(
    {
      success: true,
      data: { received: true, message: 'If these details match an account, an administrator has been notified.' },
    },
    { status: 200 }
  )
}

export async function POST(req: Request) {
  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 })
  }
  const b = (raw ?? {}) as Record<string, unknown>

  const fields: Record<string, string> = {}
  const email = normalizeEmail(b.email)
  if (!email) fields.email = 'email is required'
  else if (!isValidEmail(email)) fields.email = 'A valid email is required'

  const phoneNormalized = normalizePhone(b.phone)
  let phone = ''
  if (!phoneNormalized) fields.phone = 'phone is required'
  else if (!isValidPhone(phoneNormalized)) {
    fields.phone = 'A valid phone number is required (e.g. +2547XXXXXXXX or 07XXXXXXXX)'
  } else {
    phone = toStoredPhone(phoneNormalized)
  }

  if (Object.keys(fields).length > 0) return badFields(fields)

  // Rate-limit by the submitted email — reuses the exact same DB-backed
  // throttle login already uses (lib/auth.ts), not a second mechanism. This
  // bounds how many different phone guesses an attacker can try against one
  // known/guessed email before being locked out, the concern this route's
  // brief calls out explicitly. Locked-out responses are allowed to differ
  // from the generic ack (429 vs 200) — being locked reveals nothing about
  // whether the account is real, only that this identifier was hit a lot.
  const identifier = `forgot:${email}`
  const throttle = await checkLoginThrottle(identifier)
  if (throttle.locked) {
    const mins = Math.max(1, Math.ceil(throttle.retryAfterSeconds / 60))
    return NextResponse.json(
      { success: false, error: `Too many attempts — try again in ${mins} min` },
      { status: 429, headers: { 'Retry-After': String(throttle.retryAfterSeconds) } }
    )
  }

  const rows = await db.select().from(users).where(eq(users.email, email)).limit(1)
  const user = rows[0]
  const matches = !!user && user.status === 'ACTIVE' && !!user.phone && user.phone === phone

  if (!matches) {
    // Deliberately vague on WHY it didn't match (no such email vs wrong phone
    // vs inactive account) — recording a failure either way is what makes the
    // throttle above actually bound repeated phone guessing against a real email.
    await recordLoginFailure(identifier)
    return genericAck()
  }

  await clearLoginThrottle(identifier)

  const requestId = randomUUID()
  await db.insert(passwordResetRequests).values({
    id: requestId,
    userId: user.id,
    email,
    phone,
    status: 'pending',
  })

  // Surface it to the admin queue the same way every other "an admin needs to
  // look at this" flow in this codebase does (db/schemas/dashboard.ts). This
  // row carries the requester's name and email, so it must NOT be a
  // tenant-wide broadcast (that was the exact leak this fix closes — any
  // user in the requester's own tenant could previously read it). Only a
  // super_admin can act on it at all (GET /api/admin/password-resets is
  // super_admin-only and, notably, does not filter by tenant — any
  // super_admin can see and handle any tenant's pending request), so target
  // consistently with that: role: 'super_admin', filed under the same
  // tenantless PLATFORM_TENANT_SENTINEL scope every super_admin session
  // resolves to (see lib/audit.ts and GET /api/notifications), regardless of
  // which real tenant the requesting user belongs to. userId is left null —
  // any super_admin, not one specific admin, is the intended recipient.
  const notificationId = randomUUID()
  await db.insert(notifications).values({
    id: notificationId,
    tenantId: PLATFORM_TENANT_SENTINEL,
    sourceType: 'password_reset',
    sourceId: requestId,
    title: 'Password reset requested',
    message: `${user.name} (${user.email}) asked for a password reset.`,
    role: 'super_admin',
  })
  // Emails every super_admin (the role this row is targeted at) — never the
  // requester, and never the requester's own tenant. See
  // lib/notification-email.ts for the recipient-resolution rule this reuses
  // from GET /api/notifications, and this route's own header for why
  // super_admin (not the requester) is the intended recipient in the first
  // place.
  await notifyRecipientsByEmail(notificationId)

  return genericAck()
}
