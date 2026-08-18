import { NextResponse } from 'next/server'
import { db } from '@/db'
import { tasks, users } from '@/db/schemas'
import { getSessionUser } from '@/lib/auth'
import { and, asc, eq, gte, lt } from 'drizzle-orm'

// ── Task approval governance (issue: task approver selection) ───────────────
// A task's creator can designate WHO approves its completion (`approverId`, a
// user id). Only users who can actually decide — owner/manager roles (the
// same ALLOWED_ROLES the approve/reject routes gate on) — are valid
// approvers; anything else is rejected here rather than stored. NULL leaves
// the task in the general queue (pre-existing behavior).

// ── GET/POST /api/tasks (issue #227 task 2, extended by issue #243) ────────
// Small dedicated endpoint rather than a generic /api/data/[resource] route —
// no such generic route exists on this branch yet.
//
// `tasks` didn't exist on this branch before issue #227 — built minimal there
// (tenantId/title/dueAt/status only). Issue #243 (Epic: Tasks & Governance)
// extends the same table in place — priority/requiresApproval/notes — rather
// than forking a second one; see db/schemas/dashboard.ts and
// app/api/tasks/[id]/route.ts for the completion->approval transition those
// new fields power.
//
// Query params (GET):
//   tenantId  — standalone-mock-mode fallback when there's no session (same
//               convention as GET /api/farms).
//   due=today — restrict to tasks whose dueAt falls within [today 00:00,
//               tomorrow 00:00) in server UTC. No timezone-per-tenant concept
//               exists yet, so "today" is a UTC calendar day; revisit once
//               farm-location/timezone lands (Epic: Platform Shell).

const ok = <T>(data: T) => NextResponse.json({ success: true, data }, { status: 200 })
const created = <T>(data: T) => NextResponse.json({ success: true, data }, { status: 201 })
const badRequest = (msg: string) => NextResponse.json({ success: false, error: msg }, { status: 400 })

const VALID_PRIORITIES = new Set(['low', 'medium', 'high'])

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

// POST /api/tasks — create a task. Body: { tenantId?, title, dueAt?, status?,
// priority?, requiresApproval?, notes? }. `assignee`/`batch`/photo-evidence
// fields the mock UI carries (components/farm/data.ts's `Task`) are not
// stored — no `productionUnits`/`batches` assignment column exists on this
// table and photo evidence is explicitly out of scope for this issue.
export async function POST(req: Request) {
  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return badRequest('Invalid JSON body')
  }
  const b = (raw ?? {}) as Record<string, unknown>
  const session = await getSessionUser()
  const tenantId = session?.tenantId ?? (typeof b.tenantId === 'string' ? b.tenantId.trim() : '')
  const title = typeof b.title === 'string' ? b.title.trim() : ''

  if (!tenantId) return badRequest('tenantId is required')
  if (!title) return badRequest('title is required')
  const dueAt = typeof b.dueAt === 'string' && b.dueAt ? new Date(b.dueAt) : null
  const status = typeof b.status === 'string' && b.status.trim() ? b.status.trim() : 'PENDING'
  const priority = typeof b.priority === 'string' && VALID_PRIORITIES.has(b.priority.trim()) ? b.priority.trim() : 'medium'
  const requiresApproval = b.requiresApproval === true
  const notes = typeof b.notes === 'string' ? b.notes.trim() : null

  // Designated approver: an owner/manager user of THIS tenant. Rejected with
  // 400 if it doesn't exist or can't approve — a bad/foreign id must not be
  // stored (same "validate before insert" convention POST /api/batches uses
  // for `unitId`).
  let approverId: string | null = null
  const requestedApprover = typeof b.approverId === 'string' && b.approverId.trim() ? b.approverId.trim() : null
  if (requestedApprover) {
    const approverRows = await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.id, requestedApprover), eq(users.tenantId, tenantId), eq(users.status, 'ACTIVE')))
    const approver = approverRows[0]
    if (!approver) return badRequest('approverId must be an active user of this tenant')
    const approverUser = await db.select({ role: users.role }).from(users).where(eq(users.id, requestedApprover)).limit(1)
    if (!approverUser[0] || !['owner', 'manager'].includes(approverUser[0].role)) {
      return badRequest('approverId must be an owner or manager')
    }
    approverId = requestedApprover
  }

  const rows = await db
    .insert(tasks)
    .values({
      id: crypto.randomUUID(),
      tenantId,
      title,
      dueAt,
      status,
      priority,
      requiresApproval,
      notes,
      approverId,
    })
    .returning()

  return created(rows[0])
}
