// ── Server-only auth helpers (issue #221) ──────────────────────────────────
// Session token stored in an httpOnly cookie (`ifms_session`), row in `sessions`.
// Password/PIN hashing uses scrypt (node:crypto — no extra deps). This module is
// imported only by route handlers (server side), never by client components.
import 'server-only'
import { cookies } from 'next/headers'
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { and, eq, gt } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import { db } from '@/db'
import { loginThrottle, sessions, tenants, users } from '@/db/schemas'

export const SESSION_COOKIE = 'ifms_session'
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000 // 30 days

// Bounds for tenant_settings.sessionTimeoutMinutes (settings-reorg) —
// validated in app/api/settings/route.ts, applied at login in
// app/api/auth/login/route.ts. Floor of 15 minutes keeps a mis-set value
// from locking a shared farm-office device out mid-task; ceiling is just the
// platform default itself, so a tenant can only ever shorten a session, not
// lengthen it past what an unconfigured tenant already gets.
export const MIN_SESSION_TIMEOUT_MINUTES = 15
export const MAX_SESSION_TIMEOUT_MINUTES = SESSION_TTL_MS / 60_000

export interface SessionUser {
  id: string
  name: string
  email: string
  role: string
  tenantId: string | null
}

/* ── Password/PIN hashing (scrypt, per-user salt) ── */
export function hashSecret(secret: string, salt: string): string {
  return scryptSync(secret, salt, 64).toString('hex')
}

export function verifySecret(secret: string, salt: string, expectedHash: string): boolean {
  const candidate = scryptSync(secret, salt, 64)
  const expected = Buffer.from(expectedHash, 'hex')
  return candidate.length === expected.length && timingSafeEqual(candidate, expected)
}

/* ── PIN lookup prefilter (issue #221 review) ──
 * Worker PINs are only 4 digits, so a per-row scrypt scan on every attempt is
 * both slow and, without throttling, a CPU-exhaustion vector. Each worker row
 * therefore stores HMAC-SHA256(pepper, pin) in `pin_prefilter` for an indexed,
 * O(1) lookup; the real verification still runs scrypt on that single candidate
 * row. The key comes from AUTH_PIN_PEPPER (env) — without it the digest is not
 * recoverable (unlike a plain hash of a 10k-space PIN). The dev fallback below
 * only exists so the demo runs without env setup; production must set it.
 * Uses `||` (not `??`) so an empty string — which is what Next.js loads from
 * a `.env` copied verbatim from `.env.example`'s declared-but-empty
 * `AUTH_PIN_PEPPER=` line — falls back too, matching db/seed.mjs (issue #272). */
const PIN_PEPPER_DEV_FALLBACK = 'ifms-dev-pepper'
export function pinPrefilter(pin: string): string {
  return createHmac('sha256', process.env.AUTH_PIN_PEPPER || PIN_PEPPER_DEV_FALLBACK).update(pin).digest('hex')
}

/* ── Login throttling / lockout (issue #221 review) ──
 * DB-backed counters with escalating lockout (5 → 15 min, 10 → 30 min,
 * 15 → 60 min). Checked before any credential work, so a locked identifier
 * costs nothing; cleared on success.
 *
 * Identifiers:
 *  - `email:<addr>` — per-account lockout for password attempts
 *  - `pin:<pin>`    — per-PIN lockout (guesses against a specific worker PIN)
 *  - `pin:global`   — ONE shared counter across ALL PIN attempts. A 4-digit PIN
 *    space (10k) can't be meaningfully protected by per-PIN locks alone (an
 *    attacker would just move to the next PIN), so this bounds the whole PIN
 *    space to MAX_PIN_GLOBAL_ATTEMPTS per lock window before every PIN login is
 *    rejected. When a lock window expires the counter is reset (decay), so a
 *    window that has passed starts fresh. */
export const MAX_LOGIN_ATTEMPTS = 5
export const MAX_PIN_GLOBAL_ATTEMPTS = 20

function lockoutSecondsFor(failures: number, base: number): number {
  const tiers = [15 * 60, 30 * 60, 60 * 60]
  const idx = Math.min(Math.floor(Math.max(failures - base, 0) / base), tiers.length - 1)
  return tiers[idx]
}

export async function checkLoginThrottle(identifier: string): Promise<{ locked: boolean; retryAfterSeconds: number }> {
  const rows = await db.select().from(loginThrottle).where(eq(loginThrottle.identifier, identifier)).limit(1)
  const row = rows[0]
  if (!row?.lockedUntil) return { locked: false, retryAfterSeconds: 0 }
  const remainMs = row.lockedUntil.getTime() - Date.now()
  if (remainMs <= 0) {
    // Lock window over — reset so the next window starts fresh.
    await db.delete(loginThrottle).where(eq(loginThrottle.identifier, identifier))
    return { locked: false, retryAfterSeconds: 0 }
  }
  return { locked: true, retryAfterSeconds: Math.ceil(remainMs / 1000) }
}

export async function recordLoginFailure(identifier: string, base: number = MAX_LOGIN_ATTEMPTS): Promise<void> {
  const rows = await db.select({ failedCount: loginThrottle.failedCount }).from(loginThrottle).where(eq(loginThrottle.identifier, identifier)).limit(1)
  const next = (rows[0]?.failedCount ?? 0) + 1
  const lockSeconds = next >= base ? lockoutSecondsFor(next, base) : 0
  await db
    .insert(loginThrottle)
    .values({ identifier, failedCount: next, lockedUntil: lockSeconds ? new Date(Date.now() + lockSeconds * 1000) : null, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: loginThrottle.identifier,
      set: { failedCount: next, lockedUntil: lockSeconds ? new Date(Date.now() + lockSeconds * 1000) : null, updatedAt: new Date() },
    })
}

export async function clearLoginThrottle(identifier: string): Promise<void> {
  await db.delete(loginThrottle).where(eq(loginThrottle.identifier, identifier))
}

/* ── Tenant gating (issue #223) ──
 * Tenant-scoped accounts (owner/manager/worker/vet/auditor) may only receive a
 * session while their tenant is active. Platform roles (super_admin) have no
 * tenant and are unaffected. The login route calls this before issuing a
 * session — a worker at a suspended farm must not be able to log in. */
export async function isTenantActive(tenantId: string): Promise<boolean> {
  const rows = await db.select({ active: tenants.active }).from(tenants).where(eq(tenants.id, tenantId)).limit(1)
  return rows[0]?.active === true
}

/* ── Sessions ── */
export function newSessionToken(): string {
  return randomBytes(32).toString('base64url')
}

// `ttlMs` defaults to the platform's normal 30-day session — pass a shorter
// value for a tenant that has configured its own sessionTimeoutMinutes
// (settings-reorg; see app/api/auth/login/route.ts) so shared farm-office
// devices sign out sooner, the same knob createImpersonationSession already
// used for a different reason (a bounded admin window rather than a
// tenant-wide default).
export async function createSession(userId: string, ttlMs: number = SESSION_TTL_MS): Promise<string> {
  const token = newSessionToken()
  const now = new Date()
  await db.insert(sessions).values({
    token,
    userId,
    createdAt: now,
    expiresAt: new Date(now.getTime() + ttlMs),
  })
  return token
}

/* ── Time-boxed impersonation session (admin user-management feature) ──
 * Creates a session row for the TARGET user, but stamped with the ADMIN's id
 * in `impersonatedBy` and an `expiresAt` set to now + minutes — not the usual
 * 30-day SESSION_TTL_MS. Expiry is enforced by the exact same
 * `gt(sessions.expiresAt, new Date())` check every other session already goes
 * through (getSessionDetails/getSessionUser below), so there is no separate
 * "impersonation expiry" code path to keep in sync or get wrong. */
export async function createImpersonationSession(targetUserId: string, adminUserId: string, minutes: number): Promise<{ token: string; expiresAt: Date }> {
  const token = newSessionToken()
  const now = new Date()
  const expiresAt = new Date(now.getTime() + minutes * 60 * 1000)
  await db.insert(sessions).values({
    token,
    userId: targetUserId,
    createdAt: now,
    expiresAt,
    impersonatedBy: adminUserId,
  })
  return { token, expiresAt }
}

export async function destroySession(token: string | undefined): Promise<void> {
  if (token) await db.delete(sessions).where(eq(sessions.token, token))
}

export interface SessionDetails {
  user: SessionUser
  // Null for a normal login; the admin's user id while this session is a
  // time-boxed impersonation (sessions.impersonatedBy).
  impersonatedBy: string | null
  expiresAt: Date
}

// Same lookup getSessionUser() has always done, but also surfaces
// impersonatedBy/expiresAt for callers that need them (GET /api/auth/session,
// the impersonation-stop route) without changing getSessionUser()'s own
// return shape or its callers anywhere else in the codebase.
export async function getSessionDetails(): Promise<SessionDetails | null> {
  const store = await cookies()
  const token = store.get(SESSION_COOKIE)?.value
  if (!token) return null
  const rows = await db
    .select({ user: users, impersonatedBy: sessions.impersonatedBy, expiresAt: sessions.expiresAt })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(and(eq(sessions.token, token), gt(sessions.expiresAt, new Date())))
    .limit(1)
  const row = rows[0]
  if (!row) return null
  const u = row.user
  if (u.status !== 'ACTIVE') return null
  if (u.tenantId && !(await isTenantActive(u.tenantId))) return null
  return {
    user: { id: u.id, name: u.name, email: u.email, role: u.role, tenantId: u.tenantId },
    impersonatedBy: row.impersonatedBy,
    expiresAt: row.expiresAt,
  }
}

// Resolve the cookie's session row to a user, or null when absent/expired.
// Session-time enforcement (issue #223): the login route gates on account and
// tenant status when issuing a session; this lookup enforces the same at
// refresh time, so a user whose account or tenant is suspended loses the
// session on the next bootstrap (401 -> login) instead of keeping it until
// cookie expiry.
export async function getSessionUser(): Promise<SessionUser | null> {
  const details = await getSessionDetails()
  return details?.user ?? null
}

/* ── Cookie attach/clear on the outgoing response ── */

/* Whether the session cookie should carry `Secure`.
 *
 * Deliberately NOT `NODE_ENV === 'production'`. The Docker runner stage sets
 * NODE_ENV=production, so running that image locally over plain HTTP (via
 * `make up`, or reaching it on a LAN IP from a phone) stamped `Secure` on the
 * cookie — and browsers REFUSE to store a Secure cookie delivered over http://.
 * Login returned 200 with a valid session, the browser silently dropped the
 * cookie, and every following request was anonymous: the admin queue answered
 * "Unauthorized" to a super_admin who had just signed in successfully.
 *
 * Deriving it from how the request actually arrived is correct in every case:
 * a real HTTPS deployment still gets Secure, one behind a TLS-terminating
 * proxy is covered by x-forwarded-proto, and a plain-HTTP local run does not
 * lock itself out. Flipping NODE_ENV instead would have been wrong — it also
 * gates the dev-only RoleSelector, which must never ship. */
export function isSecureRequest(req?: Request): boolean {
  if (!req) return process.env.NODE_ENV === 'production'
  // A TLS-terminating proxy reports the ORIGINAL scheme here; may be a list.
  const forwarded = req.headers.get('x-forwarded-proto')
  if (forwarded) return forwarded.split(',')[0].trim().toLowerCase() === 'https'
  try {
    return new URL(req.url).protocol === 'https:'
  } catch {
    return process.env.NODE_ENV === 'production'
  }
}

// `req` derives the Secure flag from how the request actually arrived (see
// isSecureRequest). `maxAgeMs` defaults to the normal 30-day session TTL, so
// every ordinary call site is unaffected; impersonation passes the granted
// window (5/10/15/30 minutes) so the cookie's own lifetime matches the session
// row's real `expiresAt` instead of outliving it by weeks. The server-side
// `gt(expiresAt, now())` check remains the actual enforcement either way —
// this only keeps the cookie honest.
export function attachSessionCookie(
  res: NextResponse,
  token: string,
  req?: Request,
  maxAgeMs: number = SESSION_TTL_MS,
): NextResponse {
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isSecureRequest(req),
    path: '/',
    maxAge: Math.floor(maxAgeMs / 1000),
  })
  return res
}

export function clearSessionCookie(res: NextResponse): NextResponse {
  res.cookies.set(SESSION_COOKIE, '', { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 0 })
  return res
}

/* ── Admin "parked" session cookie (impersonation) ──
 * While a super_admin impersonates another user, `ifms_session` is replaced
 * by the TARGET's session so every route that reads it (getSessionUser, etc.)
 * genuinely acts as that user for the time box — that's the whole point. The
 * admin's own session token is preserved in a second, separate httpOnly
 * cookie so "Return to admin" (or the time box simply expiring) can restore
 * it without a second login. Uses the same request-derived Secure flag as
 * attachSessionCookie: hardcoding `NODE_ENV === 'production'` here would
 * reintroduce the bug that made a production build over plain HTTP drop the
 * cookie outright — which would strand an admin inside an impersonation with
 * no way back. */
export const ADMIN_SESSION_COOKIE = 'ifms_admin_session'

export function attachAdminSessionCookie(res: NextResponse, token: string, req?: Request): NextResponse {
  res.cookies.set(ADMIN_SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isSecureRequest(req),
    path: '/',
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  })
  return res
}

export function clearAdminSessionCookie(res: NextResponse): NextResponse {
  res.cookies.set(ADMIN_SESSION_COOKIE, '', { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 0 })
  return res
}
