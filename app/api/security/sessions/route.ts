import { NextResponse } from 'next/server'
import { and, asc, eq, gt, ne } from 'drizzle-orm'
import { cookies } from 'next/headers'
import { db } from '@/db'
import { sessions } from '@/db/schemas'
import { getSessionUser, SESSION_COOKIE } from '@/lib/auth'

const json = (body: object, status = 200) => NextResponse.json(body, { status })

// GET /api/security/sessions — own sessions only. Raw session tokens are never
// returned, so this endpoint cannot be used to take over a session.
export async function GET() {
  const user = await getSessionUser()
  if (!user) return json({ success: false, error: 'Unauthorized' }, 401)
  const store = await cookies()
  const currentToken = store.get(SESSION_COOKIE)?.value
  const rows = await db.select({ token: sessions.token, createdAt: sessions.createdAt, expiresAt: sessions.expiresAt })
    .from(sessions)
    .where(and(eq(sessions.userId, user.id), gt(sessions.expiresAt, new Date())))
    .orderBy(asc(sessions.createdAt))
  return json({ success: true, data: rows.map(({ token, ...row }) => ({ ...row, current: token === currentToken })) })
}

// DELETE /api/security/sessions — revoke every other live session belonging to
// the signed-in user. Keeping the current token avoids surprising self-logout.
export async function DELETE() {
  const user = await getSessionUser()
  if (!user) return json({ success: false, error: 'Unauthorized' }, 401)
  const store = await cookies()
  const currentToken = store.get(SESSION_COOKIE)?.value
  if (!currentToken) return json({ success: false, error: 'Current session not found' }, 401)
  await db.delete(sessions).where(and(eq(sessions.userId, user.id), ne(sessions.token, currentToken)))
  return json({ success: true, data: { revokedOtherSessions: true } })
}
