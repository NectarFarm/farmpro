// ── Server-only auth helpers (issue #221) ──────────────────────────────────
// Session token stored in an httpOnly cookie (`ifms_session`), row in `sessions`.
// Password/PIN hashing uses scrypt (node:crypto — no extra deps). This module is
// imported only by route handlers (server side), never by client components.
import 'server-only'
import { cookies } from 'next/headers'
import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto'
import { and, eq, gt } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import { db } from '@/db'
import { sessions, users } from '@/db/schemas'

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
  return { id: u.id, name: u.name, email: u.email, role: u.role, tenantId: u.tenantId }
}

export function userId(): string {
  return randomUUID()
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
