import { NextResponse } from 'next/server'
import { randomBytes } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { users } from '@/db/schemas'
import { getSessionUser, hashSecret, verifySecret } from '@/lib/auth'

// ── POST /api/auth/change-password (issue #255) ─────────────────────────────
// Self-service password change for the logged-in owner/manager. Reuses the
// real scrypt hashing from lib/auth.ts (hashSecret/verifySecret) — no second
// hashing scheme. Body: { currentPassword, newPassword }.
//
// Gated to owner/manager (per this issue's task text) — workers authenticate
// via PIN, not password, and vet/auditor/super_admin password changes are out
// of this issue's scope.
//
// A fresh per-change salt is generated (same convention as db/seed.mjs's
// saltFor()). `passwordSalt` also backs a user's PIN hash (see auth.test.ts's
// note on lib/auth.ts's verifySecret), but owner/manager rows never carry a
// pinHash (db/seed.mjs), so rotating the salt here cannot desync a PIN.

const bad = (msg: string, status = 400) =>
  NextResponse.json({ success: false, error: msg }, { status })

const MIN_PASSWORD_LENGTH = 8

export async function POST(req: Request) {
  const session = await getSessionUser()
  if (!session) return bad('Unauthorized', 401)
  if (session.role !== 'owner' && session.role !== 'manager') {
    return bad('Forbidden', 403)
  }

  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return bad('Invalid JSON body')
  }
  const b = (raw ?? {}) as Record<string, unknown>
  const currentPassword = typeof b.currentPassword === 'string' ? b.currentPassword : ''
  const newPassword = typeof b.newPassword === 'string' ? b.newPassword : ''

  if (!currentPassword) return bad('currentPassword is required')
  if (!newPassword || newPassword.length < MIN_PASSWORD_LENGTH) {
    return bad(`newPassword must be at least ${MIN_PASSWORD_LENGTH} characters`)
  }

  const rows = await db.select().from(users).where(eq(users.id, session.id)).limit(1)
  const user = rows[0]
  if (!user) return bad('Unauthorized', 401)

  if (!verifySecret(currentPassword, user.passwordSalt, user.passwordHash)) {
    return bad('Current password is incorrect', 401)
  }
  if (currentPassword === newPassword) {
    return bad('New password must be different from the current password')
  }

  const newSalt = randomBytes(16).toString('hex')
  await db
    .update(users)
    .set({ passwordHash: hashSecret(newPassword, newSalt), passwordSalt: newSalt })
    .where(eq(users.id, user.id))

  return NextResponse.json({ success: true, data: { id: user.id } }, { status: 200 })
}
