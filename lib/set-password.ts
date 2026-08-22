// ── Set-password token helpers (feat/email-notifications) ──────────────────
// Shared by PATCH /api/onboard-requests/[id] (mints, on approval) and
// POST/GET /api/set-password/[token] (resolve + consume) — same
// "logic lives in lib/, routes stay thin" convention as lib/auditor.ts.
//
// Why this exists: approving an onboarding request used to generate a temp
// password and hand it to the ADMIN once (still true — that one-time reveal
// stays as a fallback for when mail isn't configured or bounces). Emailing
// that same working password to the applicant would leave a reusable
// credential sitting in a mailbox forever. This token buys the same
// outcome — the applicant ends up with a password only they know — without
// ever putting a real password in an email: the link lets them SET one,
// once, before it expires.
import 'server-only'
import { randomBytes, randomUUID } from 'node:crypto'
import { and, eq, gt, isNull } from 'drizzle-orm'
import { db } from '@/db'
import { setPasswordTokens, users } from '@/db/schemas'
import { hashSecret } from '@/lib/auth'

// 48h — long enough for an applicant to notice the email without being a
// permanently-live credential.
export const SET_PASSWORD_TOKEN_TTL_MS = 48 * 60 * 60 * 1000

export const MIN_SET_PASSWORD_LENGTH = 8

function newToken(): string {
  // Same shape as lib/auditor.ts's newAuditorToken — 32 random bytes,
  // base64url, a session-grade random token for a different credential type.
  return randomBytes(32).toString('base64url')
}

// Mints a fresh token for `userId`, superseding (marking used) any prior
// unused token for that same user — mirrors auditor-link's "one live link"
// discipline: at most one usable set-password link per user at a time.
export async function issueSetPasswordToken(userId: string): Promise<{ token: string; expiresAt: Date }> {
  const now = new Date()

  await db
    .update(setPasswordTokens)
    .set({ usedAt: now })
    .where(and(eq(setPasswordTokens.userId, userId), isNull(setPasswordTokens.usedAt)))

  const token = newToken()
  const expiresAt = new Date(now.getTime() + SET_PASSWORD_TOKEN_TTL_MS)
  await db.insert(setPasswordTokens).values({
    id: randomUUID(),
    userId,
    token,
    expiresAt,
    createdAt: now,
  })

  return { token, expiresAt }
}

export interface SetPasswordTokenInfo {
  userId: string
  email: string
  name: string
}

// Resolves a live (unexpired, unused) token to the user it grants a
// one-time password-set to, or null if the token doesn't exist, has
// expired, or was already used/superseded. Does NOT consume it — used by
// GET /api/set-password/[token] to show the applicant who they're setting a
// password for before they submit one.
export async function resolveSetPasswordToken(token: string): Promise<SetPasswordTokenInfo | null> {
  if (!token) return null
  const rows = await db
    .select({ userId: setPasswordTokens.userId, email: users.email, name: users.name })
    .from(setPasswordTokens)
    .innerJoin(users, eq(setPasswordTokens.userId, users.id))
    .where(
      and(
        eq(setPasswordTokens.token, token),
        isNull(setPasswordTokens.usedAt),
        gt(setPasswordTokens.expiresAt, new Date())
      )
    )
    .limit(1)
  return rows[0] ?? null
}

export type ConsumeSetPasswordResult =
  | { ok: true }
  | { ok: false; error: 'invalid-or-expired' }

// Consumes a live token: re-validates it (a token can't be spent twice even
// under a race — the UPDATE below is scoped to `usedAt IS NULL`, so only one
// concurrent caller ever succeeds), sets the user's password, and marks the
// token used. Never re-throws a DB error to the caller as an exception —
// callers treat any non-ok result as "refuse the request".
export async function consumeSetPasswordToken(token: string, newPassword: string): Promise<ConsumeSetPasswordResult> {
  const info = await resolveSetPasswordToken(token)
  if (!info) return { ok: false, error: 'invalid-or-expired' }

  const salt = randomBytes(16).toString('hex')
  const passwordHash = hashSecret(newPassword, salt)

  return db.transaction(async (tx) => {
    // Atomically claim the token — only succeeds if it's still unused. This
    // is what makes "works once, then refused" true even if two requests
    // race with the same token.
    const claimed = await tx
      .update(setPasswordTokens)
      .set({ usedAt: new Date() })
      .where(
        and(
          eq(setPasswordTokens.token, token),
          isNull(setPasswordTokens.usedAt),
          gt(setPasswordTokens.expiresAt, new Date())
        )
      )
      .returning({ id: setPasswordTokens.id })

    if (claimed.length === 0) return { ok: false, error: 'invalid-or-expired' }

    await tx.update(users).set({ passwordHash, passwordSalt: salt }).where(eq(users.id, info.userId))
    return { ok: true }
  })
}
