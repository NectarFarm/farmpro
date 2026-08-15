import { NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import { and, eq, gt, isNull } from 'drizzle-orm'
import { db } from '@/db'
import { auditorLinks } from '@/db/schemas'
import { getSessionUser } from '@/lib/auth'
import { AUDITOR_LINK_TTL_MS, newAuditorToken } from '@/lib/auditor'

// ── GET/POST/DELETE /api/auditor-link (issue #313) ──────────────────────────
// Real backend for components/farm/reports.tsx's 'Generate Auditor Link' /
// 'Revoke Link' button — previously a pure local UI toggle (`showAuditor`
// state) with no `/api/auditor-link` or equivalent route anywhere in the app.
//
// Owner-only, real session required for every method here — no
// tenantId-query-param standalone-mock-mode fallback the read-side report
// routes use: minting or revoking a credential that lets a stranger read the
// whole tenant's financials for ~8h isn't something a caller should be able
// to do just by naming a tenant id in a query string (same reasoning
// PUT /api/role-permissions already applies to its owner-only write).
//
// One live link per tenant, kept simple: POST first revokes any existing
// live link for the caller's tenant, then inserts one fresh row — so the
// UI's single-link toggle always matches DB reality (at most one usable
// auditor URL per tenant at a time). GET lets the screen restore that state
// across a reload instead of resetting to "no link" until the next click.

const ok = <T>(data: T) => NextResponse.json({ success: true, data }, { status: 200 })
const bad = (msg: string, status = 400) => NextResponse.json({ success: false, error: msg }, { status })

type OwnerAuthResult = { ok: true; tenantId: string } | { ok: false; response: NextResponse }

async function requireOwnerSession(): Promise<OwnerAuthResult> {
  const session = await getSessionUser()
  if (!session) return { ok: false, response: bad('Unauthorized', 401) }
  if (!session.tenantId) return { ok: false, response: bad('Forbidden', 403) }
  if (session.role !== 'owner') return { ok: false, response: bad('Forbidden — owner only', 403) }
  return { ok: true, tenantId: session.tenantId }
}

async function liveLink(tenantId: string) {
  const rows = await db
    .select()
    .from(auditorLinks)
    .where(and(eq(auditorLinks.tenantId, tenantId), isNull(auditorLinks.revokedAt), gt(auditorLinks.expiresAt, new Date())))
    .limit(1)
  return rows[0] ?? null
}

// GET — the caller's tenant's currently-live link (if any), so the Reports
// screen can reflect real DB state on mount rather than assuming "none".
export async function GET() {
  const auth = await requireOwnerSession()
  if (!auth.ok) return auth.response

  const link = await liveLink(auth.tenantId)
  if (!link) return ok({ link: null })
  return ok({ link: { token: link.token, expiresAt: link.expiresAt.toISOString(), createdAt: link.createdAt.toISOString() } })
}

// POST — mint a fresh link for the caller's tenant, revoking any prior live
// one first.
export async function POST() {
  const auth = await requireOwnerSession()
  if (!auth.ok) return auth.response

  const now = new Date()
  await db
    .update(auditorLinks)
    .set({ revokedAt: now })
    .where(and(eq(auditorLinks.tenantId, auth.tenantId), isNull(auditorLinks.revokedAt)))

  const token = newAuditorToken()
  const expiresAt = new Date(now.getTime() + AUDITOR_LINK_TTL_MS)
  await db.insert(auditorLinks).values({
    id: randomUUID(),
    tenantId: auth.tenantId,
    token,
    expiresAt,
    createdAt: now,
  })

  return ok({ token, expiresAt: expiresAt.toISOString() })
}

// DELETE — revoke the caller's tenant's currently-live link, if any.
export async function DELETE() {
  const auth = await requireOwnerSession()
  if (!auth.ok) return auth.response

  await db
    .update(auditorLinks)
    .set({ revokedAt: new Date() })
    .where(and(eq(auditorLinks.tenantId, auth.tenantId), isNull(auditorLinks.revokedAt)))

  return ok({ revoked: true })
}
