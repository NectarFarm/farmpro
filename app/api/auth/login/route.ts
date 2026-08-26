import { NextResponse } from 'next/server'
import { and, eq, lt } from 'drizzle-orm'
import { db } from '@/db'
import { users, sessions, tenantSettings } from '@/db/schemas'
import {
  attachSessionCookie,
  checkLoginThrottle,
  clearLoginThrottle,
  createSession,
  isTenantActive,
  MAX_PIN_GLOBAL_ATTEMPTS,
  recordLoginFailure,
  SESSION_TTL_MS,
  verifySecret,
} from '@/lib/auth'
import { isValidPhone, normalizePhone, toStoredPhone } from '@/lib/validation'

// A tenant-configured sessionTimeoutMinutes (settings-reorg) overrides the
// platform's default 30-day session length for every user on that tenant.
// Unset (null, the common case — most tenants never touch this) or a
// super_admin (no tenantId at all) both fall through to SESSION_TTL_MS
// unchanged, so this is additive: no tenant's session gets shorter without
// its owner deliberately setting it.
async function sessionTtlMsFor(tenantId: string | null): Promise<number> {
  if (!tenantId) return SESSION_TTL_MS
  const rows = await db
    .select({ minutes: tenantSettings.sessionTimeoutMinutes })
    .from(tenantSettings)
    .where(eq(tenantSettings.tenantId, tenantId))
    .limit(1)
  const minutes = rows[0]?.minutes
  return minutes ? minutes * 60_000 : SESSION_TTL_MS
}

const PIN_GLOBAL_IDENTIFIER = 'pin:global'

// ── POST /api/auth/login (issue #221, phone+PIN fix) ───────────────────────
// Real credentials against the seeded `users` table (db/seed.mjs). Body:
//   { email, password }  — owner / manager / vet / auditor / super_admin
//   { phone, pin }        — worker PIN login
// Success sets the httpOnly `ifms_session` cookie and returns the session user.
// Failure returns the standard envelope — never a bare 500.
//
// Security history:
//  - PIN login used to resolve a candidate by PIN ALONE, via the peppered
//    `pin_prefilter` column: `pin_prefilter` is a pure function of the PIN, so
//    every worker who picked the same 4-digit PIN had an IDENTICAL prefilter,
//    and `.limit(1)` with no ordering returned an ARBITRARY one of them — a
//    worker entering their own correct PIN could be authenticated as a
//    DIFFERENT worker who happened to share it. With only 10,000 possible
//    PINs and no per-user scoping this was inevitable, not theoretical. PIN
//    login now REQUIRES a phone number: `users.phone` carries a partial
//    unique index (WHERE phone IS NOT NULL, db/schemas/auth.ts), so a
//    normalized phone resolves to at most one account, and the PIN only ever
//    authenticates THAT account. A PIN-only submission (no phone) is rejected
//    outright — there is no fallback to the old lookup.
//  - Per-identifier lockout: email attempts throttle on `email:<addr>`; PIN
//    attempts throttle on `phone:<normalized>` (NOT `pin:<pin>` — keying on
//    the shared PIN, as before, meant one worker's failed attempts could lock
//    out every other worker who picked the same PIN). Checked BEFORE any
//    credential work, so a locked identifier costs nothing to the server.
//  - PIN attempts ALSO hit a shared `pin:global` guard first, kept alongside
//    the per-phone throttle rather than replaced by it: a 4-digit PIN space
//    (10k) can't be meaningfully bounded by per-identifier locks alone — an
//    attacker who is willing to try many different (real) phone numbers would
//    otherwise get a fresh throttle budget for each one. `pin:global` caps the
//    total PIN-guessing volume across the whole worker base regardless of
//    which phone is being targeted.
//  - PIN lookup is by the unique `phone` column (single row, then one scrypt
//    verify) — no full-worker scan per attempt, and no `.limit(1)` on a
//    non-unique predicate anywhere in this path.
//  - Same-origin SPA only: no CORS headers on this endpoint.
//  - Generic failure message — no account enumeration. An unknown phone, a
//    phone with no PIN set, and a phone with the wrong PIN all return the
//    exact same status and body.

const json = (body: object, status: number, headers?: Record<string, string>) =>
  NextResponse.json(body, { status, ...(headers ? { headers } : {}) })

export async function POST(req: Request) {
  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return json({ success: false, error: 'Invalid JSON body' }, 400)
  }
  const b = (raw ?? {}) as Record<string, unknown>
  const pin = typeof b.pin === 'string' ? b.pin.trim() : ''
  const phoneRaw = typeof b.phone === 'string' ? b.phone : ''
  const email = typeof b.email === 'string' ? b.email.trim().toLowerCase() : ''
  const password = typeof b.password === 'string' ? b.password : ''

  const isPinAttempt = pin.length > 0

  // Reject a PIN-only submission outright — this is the flaw fix, not a
  // fallback to be reasoned around. No DB work happens for this case, so it
  // costs nothing and reveals nothing.
  if (isPinAttempt && !phoneRaw.trim()) {
    return json(
      { success: false, error: 'Phone number is required for PIN sign-in', fields: { phone: 'Phone number is required' } },
      400,
    )
  }

  // Same normalization used when a phone is WRITTEN (PATCH /api/admin/users/[id],
  // POST /api/security/worker-pins): normalizePhone() strips separators, then
  // toStoredPhone() folds a Kenyan local number to +254 form. Lookup must use
  // the identical pipeline or a phone stored as "+2547..." would silently miss
  // a login typed as "07...".
  let storedPhone = ''
  if (isPinAttempt) {
    const normalized = normalizePhone(phoneRaw)
    if (!normalized || !isValidPhone(normalized)) {
      return json(
        { success: false, error: 'Enter a valid phone number', fields: { phone: 'Enter a valid phone number (e.g. +2547XXXXXXXX or 07XXXXXXXX)' } },
        400,
      )
    }
    storedPhone = toStoredPhone(normalized)
  }

  const identifier = isPinAttempt ? `phone:${storedPhone}` : `email:${email}`

  if (isPinAttempt) {
    const global = await checkLoginThrottle(PIN_GLOBAL_IDENTIFIER)
    if (global.locked) {
      const mins = Math.max(1, Math.ceil(global.retryAfterSeconds / 60))
      return json(
        { success: false, error: `Too many failed attempts — try again in ${mins} min` },
        429,
        { 'Retry-After': String(global.retryAfterSeconds) },
      )
    }
  }
  const throttle = await checkLoginThrottle(identifier)
  if (throttle.locked) {
    const mins = Math.max(1, Math.ceil(throttle.retryAfterSeconds / 60))
    return json(
      { success: false, error: `Too many failed attempts — try again in ${mins} min` },
      429,
      { 'Retry-After': String(throttle.retryAfterSeconds) },
    )
  }

  let user: typeof users.$inferSelect | null = null
  if (isPinAttempt) {
    // `phone` carries a partial unique index (WHERE phone IS NOT NULL), so
    // this resolves at most one row — unlike the old pin_prefilter lookup,
    // .limit(1) here is not hiding a collision.
    const rows = await db.select().from(users).where(eq(users.phone, storedPhone)).limit(1)
    const candidate = rows[0] ?? null
    // Role-gated (grepped: only POST /api/security/worker-pins ever sets
    // pinHash, and only for role 'worker' — but check explicitly rather than
    // relying on that invariant holding forever).
    if (
      candidate?.pinHash &&
      candidate.role === 'worker' &&
      verifySecret(pin, candidate.passwordSalt, candidate.pinHash)
    ) {
      user = candidate
    }
  } else if (email && password) {
    const rows = await db.select().from(users).where(eq(users.email, email)).limit(1)
    const candidate = rows[0] ?? null
    if (candidate && verifySecret(password, candidate.passwordSalt, candidate.passwordHash)) user = candidate
  }

  if (!user) {
    await recordLoginFailure(identifier)
    if (isPinAttempt) await recordLoginFailure(PIN_GLOBAL_IDENTIFIER, MAX_PIN_GLOBAL_ATTEMPTS)
    // Deliberately generic and deliberately the SAME for every PIN failure
    // reason (unknown phone / no PIN set / wrong PIN) — never reveal which.
    return json(
      { success: false, error: isPinAttempt ? 'Invalid phone number or PIN' : 'Invalid email or password' },
      401,
    )
  }
  if (user.status !== 'ACTIVE') {
    return json({ success: false, error: 'This account is not active — contact support' }, 403)
  }
  // Suspended-tenant gate (issue #223): a tenant-scoped account at an inactive
  // tenant must not get a session. Correct credentials, so no failure is
  // recorded against the throttle — this is a policy denial, not a bad attempt.
  if (user.tenantId && !(await isTenantActive(user.tenantId))) {
    return json({ success: false, error: 'This account is suspended — contact support' }, 403)
  }

  await clearLoginThrottle(identifier)
  // Reap expired sessions for this user on every successful login. This keeps
  // the `sessions` table from growing without waiting for the daily cron, and
  // the `idx_sessions_user` index keeps the delete cheap.
  // Housekeeping, not part of signing in — so it must never be able to fail a
  // login. This runs after the password has already been verified; if the
  // delete throws (lock contention, a transient connection error), the user
  // still gets their session and the nightly cron clears the rows instead.
  try {
    await db.delete(sessions).where(and(eq(sessions.userId, user.id), lt(sessions.expiresAt, new Date())))
  } catch (err) {
    console.warn('[login] expired-session reap failed; the nightly cron will catch these', err)
  }
  const ttlMs = await sessionTtlMsFor(user.tenantId)
  const token = await createSession(user.id, ttlMs)
  const res = json({
    success: true,
    data: { id: user.id, name: user.name, email: user.email, role: user.role, tenantId: user.tenantId },
  }, 200)
  return attachSessionCookie(res, token, req, ttlMs)
}
