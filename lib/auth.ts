import 'server-only'
import { createHash, randomUUID } from 'crypto'
import { cookies } from 'next/headers'
import { db } from '@/db'
import { sessions, settings } from '@/db/schema'
import { eq } from 'drizzle-orm'
import { UnauthorizedError } from '@/lib/errors'

const SESSION_COOKIE = 'farm_session'
const SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1000 // 7 days

export function hashPin(pin: string): string {
  return createHash('sha256').update(pin).digest('hex')
}

export async function createSession(
  userType: 'owner' | 'employee' | 'customer',
  userId?: string,
  userName?: string,
) {
  const id = randomUUID()
  const expiresAt = new Date(Date.now() + SESSION_DURATION_MS)

  await db.insert(sessions).values({ id, userType, userId, userName, expiresAt })

  const jar = await cookies()
  jar.set(SESSION_COOKIE, id, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    expires: expiresAt,
    path: '/',
  })

  return { id, userType, userId, userName }
}

export async function getSession() {
  const jar = await cookies()
  const sessionId = jar.get(SESSION_COOKIE)?.value
  if (!sessionId) return null

  const [session] = await db
    .select()
    .from(sessions)
    .where(eq(sessions.id, sessionId))
    .limit(1)

  if (!session || session.expiresAt < new Date()) {
    if (session) await db.delete(sessions).where(eq(sessions.id, sessionId))
    return null
  }

  return session
}

export async function deleteSession() {
  const jar = await cookies()
  const sessionId = jar.get(SESSION_COOKIE)?.value
  if (sessionId) {
    await db.delete(sessions).where(eq(sessions.id, sessionId))
    jar.delete(SESSION_COOKIE)
  }
}

export async function requireSession() {
  const session = await getSession()
  if (!session) throw new UnauthorizedError()
  return session
}

export async function requireOwner() {
  const session = await requireSession()
  if (session.userType !== 'owner') throw new UnauthorizedError('Owner access required')
  return session
}

/** Ensure the settings row exists; seed it with default owner PIN '1234' if not. */
export async function ensureSettings() {
  const [row] = await db.select().from(settings).where(eq(settings.id, 'default')).limit(1)
  if (!row) {
    await db.insert(settings).values({ id: 'default', ownerPinHash: hashPin('1234') })
  }
  return row ?? (await db.select().from(settings).where(eq(settings.id, 'default')).limit(1))[0]
}
