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
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000 // 30 days

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

export async function createSession(userId: string): Promise<string> {
  const token = newSessionToken()
  const now = new Date()
  await db.insert(sessions).values({
    token,
    userId,
    createdAt: now,
    expiresAt: new Date(now.getTime() + SESSION_TTL_MS),
  })
  return token
}

export async function destroySession(token: string | undefined): Promise<void> {
  if (token) await db.delete(sessions).where(eq(sessions.token, token))
}

// Resolve the cookie's session row to a user, or null when absent/expired.
// Session-time enforcement (issue #223): the login route gates on account and
// tenant status when issuing a session; this lookup enforces the same at
// refresh time, so a user whose account or tenant is suspended loses the
// session on the next bootstrap (401 -> login) instead of keeping it until
// cookie expiry.
export async function getSessionUser(): Promise<SessionUser | null> {
  const store = await cookies()
  const token = store.get(SESSION_COOKIE)?.value
  if (!token) return null
  const rows = await db
    .select({ user: users })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(and(eq(sessions.token, token), gt(sessions.expiresAt, new Date())))
    .limit(1)
  const u = rows[0]?.user
  if (!u) return null
  if (u.status !== 'ACTIVE') return null
  if (u.tenantId && !(await isTenantActive(u.tenantId))) return null
  return { id: u.id, name: u.name, email: u.email, role: u.role, tenantId: u.tenantId }
}

/* ── Cookie attach/clear on the outgoing response ── */
export function attachSessionCookie(res: NextResponse, token: string): NextResponse {
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  })
  return res
}

export function clearSessionCookie(res: NextResponse): NextResponse {
  res.cookies.set(SESSION_COOKIE, '', { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 0 })
  return res
}
