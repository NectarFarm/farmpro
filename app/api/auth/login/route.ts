import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { users } from '@/db/schemas'
import {
  attachSessionCookie,
  checkLoginThrottle,
  clearLoginThrottle,
  createSession,
  MAX_PIN_GLOBAL_ATTEMPTS,
  pinPrefilter,
  recordLoginFailure,
  verifySecret,
} from '@/lib/auth'

const PIN_GLOBAL_IDENTIFIER = 'pin:global'

// ── POST /api/auth/login (issue #221) ──────────────────────────────────────
// Real credentials against the seeded `users` table (db/seed.mjs). Body:
//   { email, password }  — owner / manager / vet / auditor / super_admin
//   { pin }              — worker PIN login
// Success sets the httpOnly `ifms_session` cookie and returns the session user.
// Failure returns the standard envelope — never a bare 500.
//
// Security (issue #221 review):
//  - Per-identifier lockout (email:<addr> / pin:<pin>): 5 failures → 15 min,
//    10 → 30 min, 15 → 60 min (DB-backed, survives restarts). Checked BEFORE
//    any credential work, so a locked identifier costs nothing to the server.
//  - PIN lookup is O(1) via the peppered `pin_prefilter` column (single row,
//    then one scrypt verify) — no full-worker scan per attempt.
//  - Same-origin SPA only: no CORS headers on this endpoint.
//  - Generic failure message — no account enumeration.

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
  const email = typeof b.email === 'string' ? b.email.trim().toLowerCase() : ''
  const password = typeof b.password === 'string' ? b.password : ''

  const identifier = pin ? `pin:${pin}` : `email:${email}`
  // PIN attempts also hit the shared `pin:global` guard first — a 4-digit PIN
  // space can't be protected by per-PIN locks alone (the attacker would just
  // move to the next PIN), so all PIN attempts share one escalating counter.
  if (pin) {
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
  if (pin) {
    const rows = await db.select().from(users).where(eq(users.pinPrefilter, pinPrefilter(pin))).limit(1)
    const candidate = rows[0] ?? null
    if (candidate?.pinHash && verifySecret(pin, candidate.passwordSalt, candidate.pinHash)) user = candidate
  } else if (email && password) {
    const rows = await db.select().from(users).where(eq(users.email, email)).limit(1)
    const candidate = rows[0] ?? null
    if (candidate && verifySecret(password, candidate.passwordSalt, candidate.passwordHash)) user = candidate
  }

  if (!user) {
    await recordLoginFailure(identifier)
    if (pin) await recordLoginFailure(PIN_GLOBAL_IDENTIFIER, MAX_PIN_GLOBAL_ATTEMPTS)
    return json({ success: false, error: 'Invalid email or password' }, 401)
  }
  if (user.status !== 'ACTIVE') {
    return json({ success: false, error: 'This account is not active — contact support' }, 403)
  }

  await clearLoginThrottle(identifier)
  const token = await createSession(user.id)
  const res = json({
    success: true,
    data: { id: user.id, name: user.name, email: user.email, role: user.role, tenantId: user.tenantId },
  }, 200)
  return attachSessionCookie(res, token)
}
