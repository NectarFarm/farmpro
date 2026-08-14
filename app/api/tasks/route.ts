import { NextResponse } from 'next/server'
import { db } from '@/db'
import { tasks } from '@/db/schemas'
import { getSessionUser } from '@/lib/auth'
import { and, asc, eq, gte, lt } from 'drizzle-orm'

// ── GET /api/tasks (issue #227 task 2) ─────────────────────────────────────
// Small dedicated endpoint rather than a generic /api/data/[resource] route —
// no such generic route exists on this branch yet, and this issue only needs
// the read path with a "due today" filter (backs the dashboard's
// today's-tasks strip).
//
// `tasks` didn't exist on this branch before this issue — built minimal here
// (tenantId/title/dueAt/status only). The fuller lifecycle (assignment,
// recurrence, approvals) is Epic: Tasks & Governance's job (#242/#243);
// extend this table in place when that lands rather than forking it.
//
// Query params:
//   tenantId  — standalone-mock-mode fallback when there's no session (same
//               convention as GET /api/farms).
//   due=today — restrict to tasks whose dueAt falls within [today 00:00,
//               tomorrow 00:00) in server UTC. No timezone-per-tenant concept
//               exists yet, so "today" is a UTC calendar day; revisit once
//               farm-location/timezone lands (Epic: Platform Shell).

const ok = <T>(data: T) => NextResponse.json({ success: true, data }, { status: 200 })
const badRequest = (msg: string) => NextResponse.json({ success: false, error: msg }, { status: 400 })

export function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
}

export async function GET(req: Request) {
  const session = await getSessionUser()
  const url = new URL(req.url)
  const tenantId = session?.tenantId ?? url.searchParams.get('tenantId')?.trim()
  if (!tenantId) return badRequest('tenantId is required')

  const due = url.searchParams.get('due')?.trim().toLowerCase()

  const conditions = [eq(tasks.tenantId, tenantId)]
  if (due === 'today') {
    const start = startOfUtcDay(new Date())
    const end = new Date(start.getTime() + 24 * 60 * 60 * 1000)
    conditions.push(gte(tasks.dueAt, start), lt(tasks.dueAt, end))
  }

  const rows = await db
    .select()
    .from(tasks)
    .where(and(...conditions))
    .orderBy(asc(tasks.dueAt), asc(tasks.id))

  return ok(rows)
}
