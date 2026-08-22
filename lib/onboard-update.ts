// ── Onboard-request update-link token helpers (feat/email-notifications) ───
// Shared by PATCH /api/onboard-requests/[id] (mints, on info-needed) and
// GET/POST /api/onboard-requests/update/[token] (resolve + resubmit) — same
// "logic lives in lib/, routes stay thin" convention as lib/auditor.ts /
// lib/set-password.ts.
//
// An applicant marked 'info-needed' has no account at all, so the only way
// to let them fix their own request is a tokenised public link — the exact
// shape lib/auditor.ts already proves out (stored, expiring, single-purpose
// token, no session involved).
import 'server-only'
import { randomBytes, randomUUID } from 'node:crypto'
import { and, eq, gt, isNull } from 'drizzle-orm'
import { db } from '@/db'
import { onboardUpdateTokens, onboardRequests } from '@/db/schemas'

// 7 days — an applicant may not check email daily; this is a correction
// window, not a live session.
export const ONBOARD_UPDATE_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000

function newToken(): string {
  return randomBytes(32).toString('base64url')
}

// Mints a fresh token for `onboardRequestId`, superseding (closing out) any
// prior unused token for that same request — at most one usable update
// link per request at a time, same discipline as set-password tokens.
export async function issueOnboardUpdateToken(onboardRequestId: string): Promise<{ token: string; expiresAt: Date }> {
  const now = new Date()

  await db
    .update(onboardUpdateTokens)
    .set({ usedAt: now })
    .where(and(eq(onboardUpdateTokens.onboardRequestId, onboardRequestId), isNull(onboardUpdateTokens.usedAt)))

  const token = newToken()
  const expiresAt = new Date(now.getTime() + ONBOARD_UPDATE_TOKEN_TTL_MS)
  await db.insert(onboardUpdateTokens).values({
    id: randomUUID(),
    onboardRequestId,
    token,
    expiresAt,
    createdAt: now,
  })

  return { token, expiresAt }
}

// Resolves a live (unexpired, not-closed-out) token to the request it
// grants edit access to, or null. Deliberately has no fallback of any
// kind — an update-request route has exactly one legitimate way in.
export async function resolveOnboardUpdateToken(token: string): Promise<{ onboardRequestId: string } | null> {
  if (!token) return null
  const rows = await db
    .select({ onboardRequestId: onboardUpdateTokens.onboardRequestId })
    .from(onboardUpdateTokens)
    .where(
      and(
        eq(onboardUpdateTokens.token, token),
        isNull(onboardUpdateTokens.usedAt),
        gt(onboardUpdateTokens.expiresAt, new Date())
      )
    )
    .limit(1)
  return rows[0] ?? null
}

// Closes out a token once its request has been successfully resubmitted —
// NOT single-use in the sense of "one edit only" (the applicant may save
// several times while iterating — see the route, which re-resolves the
// token on every call rather than consuming it on read), but once the
// request is back to 'pending' for re-review, this specific link's job is
// done; a further correction needs a fresh info-needed cycle.
export async function closeOnboardUpdateToken(token: string): Promise<void> {
  await db
    .update(onboardUpdateTokens)
    .set({ usedAt: new Date() })
    .where(eq(onboardUpdateTokens.token, token))
}

// The onboard_requests row shape needed to prefill the applicant's edit
// form. Kept to the fields the update route (and its validateBody reuse)
// actually needs.
export async function loadOnboardRequestForUpdate(onboardRequestId: string) {
  const rows = await db.select().from(onboardRequests).where(eq(onboardRequests.id, onboardRequestId)).limit(1)
  return rows[0] ?? null
}
