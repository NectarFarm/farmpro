import { NextResponse } from 'next/server'
import { desc, inArray } from 'drizzle-orm'
import { db } from '@/db'
import { auditLog, users } from '@/db/schemas'
import { getSessionUser } from '@/lib/auth'

// ── GET /api/admin/impersonation-log (admin user-management feature) ───────
// super_admin only. History of who impersonated whom, when it started, and
// when/how it ended — read straight from audit_log's 'impersonation.start' /
// 'impersonation.end' rows (written by the impersonate/stop routes; expiry
// with no explicit "stop" call has no separate end row today — see the
// route-level note on impersonate/stop about why the client calls stop right
// as its own countdown hits zero rather than relying on a server-side timer
// to write one). Newest first. Actor/target ids are resolved to name/email in
// one extra query (not per-row) so this stays O(1) queries regardless of log size.

const bad = (msg: string, status = 400) =>
  NextResponse.json({ success: false, error: msg }, { status })

const ACTIONS = ['impersonation.start', 'impersonation.end'] as const

export async function GET() {
  const session = await getSessionUser()
  if (!session) return bad('Unauthorized', 401)
  if (session.role !== 'super_admin') return bad('Forbidden', 403)

  const rows = await db
    .select()
    .from(auditLog)
    .where(inArray(auditLog.action, [...ACTIONS]))
    .orderBy(desc(auditLog.at))

  const userIds = Array.from(new Set(rows.flatMap((r) => [r.actor, r.entityId])))
  const userRows = userIds.length
    ? await db.select({ id: users.id, name: users.name, email: users.email }).from(users).where(inArray(users.id, userIds))
    : []
  const userById = new Map(userRows.map((u) => [u.id, u]))

  const data = rows.map((r) => ({
    id: r.id,
    action: r.action,
    at: r.at,
    admin: userById.get(r.actor) ?? { id: r.actor, name: 'Unknown', email: '' },
    target: userById.get(r.entityId) ?? { id: r.entityId, name: 'Unknown', email: '' },
    meta: r.meta,
  }))

  return NextResponse.json({ success: true, data }, { status: 200 })
}
