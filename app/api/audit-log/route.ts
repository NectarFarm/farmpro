import { NextResponse } from 'next/server'
import { db } from '@/db'
import { auditLog, users } from '@/db/schemas'
import { and, desc, eq } from 'drizzle-orm'
import { requireTenantSession } from '@/lib/api-auth'

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
// `actorRole` (issue #302) rides the same left join — it's what powers the
// Activity Log's role-filter chips (GovernanceScreen), so the actor's role at
// query time is resolved here rather than re-fetched client-side. Null for
// the same reason actorName/actorEmail can be null (deleted account).
//
// Pagination: `limit` (default 50, capped at 200) + `offset` (default 0),
// same minimal offset-pagination shape as this branch uses elsewhere (no
// cursor infra exists yet). Always ordered newest-first (`at desc`).
//
// `entity`/`entityId` (item 23 bug fix): StatusTimeline (components/farm/
// status-timeline.tsx) has sent these two query params since it was built for
// tasks/employees/batches — but this route never read them, so every screen
// using StatusTimeline was actually rendering the WHOLE tenant's audit log,
// unfiltered, as if it were that one record's history. Harmless-looking
// (still real rows, still tenant-scoped) but wrong: a task's "Status History"
// showed every batch/employee/approval event too. Both optional and only
// applied together (an entityId with no entity, or vice versa, is treated as
// absent) — no existing caller that omits both changes behaviour.

const ok = <T>(data: T) => NextResponse.json({ success: true, data }, { status: 200 })

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
  const url = new URL(req.url)
  const auth = await requireTenantSession()
  if ('error' in auth) return auth.error
  const { tenantId } = auth

  const limit = parseLimit(url.searchParams.get('limit'))
  const offset = parseOffset(url.searchParams.get('offset'))
  const entity = url.searchParams.get('entity')?.trim()
  const entityId = url.searchParams.get('entityId')?.trim()

  const conditions = [eq(auditLog.tenantId, tenantId)]
  if (entity && entityId) {
    conditions.push(eq(auditLog.entity, entity))
    conditions.push(eq(auditLog.entityId, entityId))
  }

  const rows = await db
    .select({
      id: auditLog.id,
      tenantId: auditLog.tenantId,
      actor: auditLog.actor,
      actorName: users.name,
      actorEmail: users.email,
      actorRole: users.role,
      action: auditLog.action,
      entity: auditLog.entity,
      entityId: auditLog.entityId,
      meta: auditLog.meta,
      at: auditLog.at,
    })
    .from(auditLog)
    .leftJoin(users, eq(users.id, auditLog.actor))
    .where(and(...conditions))
    .orderBy(desc(auditLog.at), desc(auditLog.id))
    .limit(limit)
    .offset(offset)

  return ok(rows)
}
