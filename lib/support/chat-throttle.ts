// ── Support chat rate limit (SaaS back-office backend) ──────────────────────
// A fixed-window counter per user, DB-backed (chat_throttle table) so it
// works across instances and survives restarts — same reasoning as
// db/schemas/auth.ts's loginThrottle, generic rather than login's
// escalating-lockout shape (a chat limit just needs "at most N per window").
import 'server-only'
import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { chatThrottle } from '@/db/schemas'

const WINDOW_MS = 60 * 60 * 1000 // 1 hour
const MAX_PER_WINDOW = 30

export interface ThrottleCheck {
  allowed: boolean
  retryAfterSeconds?: number
}

/** Checks AND increments in one call — a caller that gets `allowed: true`
 * has already consumed one of its messages for this window. */
export async function checkAndConsumeChatThrottle(identifier: string, now = new Date()): Promise<ThrottleCheck> {
  const rows = await db.select().from(chatThrottle).where(eq(chatThrottle.identifier, identifier)).limit(1)
  const row = rows[0]

  if (!row || now.getTime() - row.windowStart.getTime() >= WINDOW_MS) {
    // New window (first message ever, or the previous window expired).
    await db
      .insert(chatThrottle)
      .values({ identifier, windowStart: now, count: 1 })
      .onConflictDoUpdate({ target: chatThrottle.identifier, set: { windowStart: now, count: 1 } })
    return { allowed: true }
  }

  if (row.count >= MAX_PER_WINDOW) {
    const retryAfterSeconds = Math.max(1, Math.ceil((row.windowStart.getTime() + WINDOW_MS - now.getTime()) / 1000))
    return { allowed: false, retryAfterSeconds }
  }

  await db.update(chatThrottle).set({ count: row.count + 1 }).where(eq(chatThrottle.identifier, identifier))
  return { allowed: true }
}
