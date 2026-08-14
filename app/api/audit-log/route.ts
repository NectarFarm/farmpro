import { NextResponse } from 'next/server'
import { db } from '@/db'
import { auditLog, users } from '@/db/schemas'
import { getSessionUser } from '@/lib/auth'
import { desc, eq } from 'drizzle-orm'

// ── GET /api/audit-log (issue #244) ─────────────────────────────────────────
// The missing read side of `audit_log` (issue #243 built the table + the two
// writers — approve/reject, see lib/governance.ts — but no GET route). Powers
// GovernanceScreen's Activity Log tab, replacing the mock `ACTIVITY_LOG`.
//
// Same tenant-resolution convention as GET /api/approvals: session tenant
// wins, `tenantId` query param is the standalone-mock-mode fallback.
//
// `audit_log.actor` stores a raw user id (see lib/governance.ts's
// `decideApproval` — `actor: session.id`), not a display name. A left join
// against `users` resolves it to a name/email so the UI can show "the correct
// user attributed" (this issue's acceptance criterion) instead of a bare
// uuid; `actorName`/`actorEmail` are null if the user row is gone (e.g.
// deleted account) — the log entry itself is append-only and still shown.
//
// Pagination: `limit` (default 50, capped at 200) + `offset` (default 0),
// same minimal offset-pagination shape as this branch uses elsewhere (no
// cursor infra exists yet). Always ordered newest-first (`at desc`).

const ok = <T>(data: T) => NextResponse.json({ success: true, data }, { status: 200 })
const badRequest = (msg: string) => NextResponse.json({ success: false, error: msg }, { status: 400 })

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200

function parseLimit(raw: string | null): number {
  if (!raw) return DEFAULT_LIMIT
  const n = Number.parseInt(raw, 10)
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIMIT
  return Math.min(n, MAX_LIMIT)
}

function parseOffset(raw: string | null): number {
  if (!raw) return 0
  const n = Number.parseInt(raw, 10)
  if (!Number.isFinite(n) || n < 0) return 0
  return n
}

export async function GET(req: Request) {
  const session = await getSessionUser()
  const url = new URL(req.url)
  const tenantId = session?.tenantId ?? url.searchParams.get('tenantId')?.trim()
  if (!tenantId) return badRequest('tenantId is required')

  const limit = parseLimit(url.searchParams.get('limit'))
  const offset = parseOffset(url.searchParams.get('offset'))

  const rows = await db
    .select({
      id: auditLog.id,
      tenantId: auditLog.tenantId,
      actor: auditLog.actor,
      actorName: users.name,
      actorEmail: users.email,
      action: auditLog.action,
      entity: auditLog.entity,
      entityId: auditLog.entityId,
      meta: auditLog.meta,
      at: auditLog.at,
    })
    .from(auditLog)
    .leftJoin(users, eq(users.id, auditLog.actor))
    .where(eq(auditLog.tenantId, tenantId))
    .orderBy(desc(auditLog.at), desc(auditLog.id))
    .limit(limit)
    .offset(offset)

  return ok(rows)
}
