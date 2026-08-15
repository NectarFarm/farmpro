// ── Auditor / Investor read-only link helpers (issue #313) ─────────────────
// Shared by POST/DELETE /api/auditor-link (mint/revoke) and the token-gated
// GET /api/auditor/[token]/reports/[type] read route — same "logic lives in
// lib/, routes stay thin" convention as lib/reports.ts / lib/finance.ts.
import 'server-only'
import { randomBytes } from 'node:crypto'
import { and, eq, gt, isNull } from 'drizzle-orm'
import { db } from '@/db'
import { auditorLinks } from '@/db/schemas'

// ~8h — matches components/farm/reports.tsx's own "~8h link" chip / "Expires
// in ~8 hours" copy on the Auditor / Investor Access card. Keep these two in
// sync if that copy ever changes.
export const AUDITOR_LINK_TTL_MS = 8 * 60 * 60 * 1000

export function newAuditorToken(): string {
  // Same shape as lib/auth.ts's newSessionToken (32 random bytes,
  // base64url) — a session-grade random token, just for a different
  // credential type.
  return randomBytes(32).toString('base64url')
}

// Resolves a live (unexpired, unrevoked) auditor token to the tenant it
// grants read access to, or null if the token doesn't exist, has expired, or
// was revoked. Deliberately has NO tenantId-query-param fallback of the kind
// GET /api/reports/* use for standalone-mock-mode — an auditor route has
// exactly one legitimate way in: a valid token.
export async function resolveAuditorTenantId(token: string): Promise<string | null> {
  if (!token) return null
  const rows = await db
    .select({ tenantId: auditorLinks.tenantId })
    .from(auditorLinks)
    .where(and(eq(auditorLinks.token, token), isNull(auditorLinks.revokedAt), gt(auditorLinks.expiresAt, new Date())))
    .limit(1)
  return rows[0]?.tenantId ?? null
}
