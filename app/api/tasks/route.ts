import { NextResponse } from 'next/server'
import { db } from '@/db'
import { tasks, employees } from '@/db/schemas'
import { and, asc, eq, gte, lt } from 'drizzle-orm'
import { farmNotFoundResponse, resolveFarmFilter } from '@/lib/farm-scope'
import { requireTenantSession, forbidden } from '@/lib/api-auth'
import { canEdit, MODULES } from '@/lib/permissions'
import { isRecurrence } from '@/lib/tasks'
import { resolveAssignee, resolveApprover } from '@/lib/task-people'

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
  const url = new URL(req.url)
  const auth = await requireTenantSession()
  if ('error' in auth) return auth.error
  const { tenantId } = auth

  const due = url.searchParams.get('due')?.trim().toLowerCase()

  // farmId (direct filter — tasks.farmId, farm-scoped-data task). Absent or
  // 'ALL' means no filter (unchanged behaviour); an unknown/foreign id 404s
  // instead of silently returning the tenant's unfiltered tasks.
  const farmFilter = await resolveFarmFilter(tenantId, url.searchParams.get('farmId'))
  if (farmFilter === null) return NextResponse.json(farmNotFoundResponse(), { status: 404 })

  const conditions = [eq(tasks.tenantId, tenantId)]

  // A calendar asks for a window, not "today" — `from`/`to` are ISO
  // instants, `to` exclusive, so a month view is one request instead of
  // thirty-one.
  const fromParam = url.searchParams.get('from')
  const toParam = url.searchParams.get('to')
  if (fromParam) {
    const from = new Date(fromParam)
    if (Number.isNaN(from.getTime())) return badRequest('from must be a valid date')
    conditions.push(gte(tasks.dueAt, from))
  }
  if (toParam) {
    const to = new Date(toParam)
    if (Number.isNaN(to.getTime())) return badRequest('to must be a valid date')
    conditions.push(lt(tasks.dueAt, to))
  }

  // Who the work is on. `me` resolves through the caller's own employee row
  // so the worker app doesn't have to know its employees.id.
  const assignee = url.searchParams.get('assigneeId')?.trim()
  if (assignee) {
    if (assignee === 'me') {
      const [own] = await db
        .select({ id: employees.id })
        .from(employees)
        .where(and(eq(employees.tenantId, tenantId), eq(employees.userId, auth.session.id)))
        .limit(1)
      // No employee row means no assigned work — an empty list is the honest
      // answer, not every task on the farm.
      conditions.push(own ? eq(tasks.assigneeId, own.id) : eq(tasks.assigneeId, '\u0000no-such-employee'))
    } else {
      conditions.push(eq(tasks.assigneeId, assignee))
    }
  }

  const statusFilter = url.searchParams.get('status')?.trim()
  if (statusFilter) conditions.push(eq(tasks.status, statusFilter.toUpperCase()))
  if (due === 'today') {
    const start = startOfUtcDay(new Date())
    const end = new Date(start.getTime() + 24 * 60 * 60 * 1000)
    conditions.push(gte(tasks.dueAt, start), lt(tasks.dueAt, end))
  }
  if (farmFilter) conditions.push(eq(tasks.farmId, farmFilter))

  const rows = await db
    .select()
    .from(tasks)
    .where(and(...conditions))
    .orderBy(asc(tasks.dueAt), asc(tasks.id))

  return ok(rows)
}

// POST /api/tasks — create a task. Body: { tenantId?, title, dueAt?, status?,
// priority?, requiresApproval?, notes?, farmId? }. `assignee`/`batch`/photo-evidence
// fields the mock UI carries (components/farm/data.ts's `Task`) are not
// stored — no `productionUnits`/`batches` assignment column exists on this
// table and photo evidence is explicitly out of scope for this issue.
//
// `farmId` (farm-scoped-data task) is optional and nullable — a task with no
// farmId is tenant-level (e.g. "renew business license") and stays visible
// in every farm's filtered view exactly the way records.batchId === null
// already documents for approval_requests. When supplied it must belong to
// this tenant — same 404-not-silently-unfiltered contract every other
// farmId-accepting route uses.
export async function POST(req: Request) {
  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return badRequest('Invalid JSON body')
  }
  const b = (raw ?? {}) as Record<string, unknown>
  const auth = await requireTenantSession({ explicitTenantId: typeof b.tenantId === 'string' ? b.tenantId : undefined })
  if ('error' in auth) return auth.error
  const { session, tenantId } = auth

  if (!(await canEdit(tenantId, session.role, MODULES.tasks))) {
    return forbidden('Your role does not have edit access to tasks')
  }

  const title = typeof b.title === 'string' ? b.title.trim() : ''

  if (!title) return badRequest('title is required')

  const farmFilter = await resolveFarmFilter(tenantId, typeof b.farmId === 'string' ? b.farmId : undefined)
  if (farmFilter === null) return NextResponse.json(farmNotFoundResponse(), { status: 404 })

  const dueAt = typeof b.dueAt === 'string' && b.dueAt ? new Date(b.dueAt) : null
  const status = typeof b.status === 'string' && b.status.trim() ? b.status.trim() : 'PENDING'
  const priority = typeof b.priority === 'string' && VALID_PRIORITIES.has(b.priority.trim()) ? b.priority.trim() : 'medium'
  const requiresApproval = b.requiresApproval === true
  const notes = typeof b.notes === 'string' ? b.notes.trim() : null

  // Who does the work (an employee) and who signs it off (a signed-in user).
  let assigneeId: string | null = null
  if (typeof b.assigneeId === 'string' && b.assigneeId.trim()) {
    assigneeId = await resolveAssignee(tenantId, b.assigneeId.trim())
    if (!assigneeId) return badRequest('That employee is not on this farm')
  }

  let approverId: string | null = null
  if (typeof b.approverId === 'string' && b.approverId.trim()) {
    const approver = await resolveApprover(tenantId, b.approverId.trim())
    if ('problem' in approver) {
      return badRequest(approver.problem === 'not-found'
        ? 'That approver is not a user on this farm'
        : `${approver.name} cannot approve tasks — give their role governance access first, or pick someone else`)
    }
    approverId = approver.id
  }

  const recurrence = isRecurrence(b.recurrence) ? b.recurrence : 'none'
  // A recurring task with no due date has nothing to advance, so the
  // repetition would silently never happen — refuse it at write time rather
  // than storing a schedule that does nothing.
  if (recurrence !== 'none' && !dueAt) {
    return badRequest('A repeating task needs a due date — that is what each repeat is counted from')
  }
  const recurrenceUntil = typeof b.recurrenceUntil === 'string' && b.recurrenceUntil
    ? new Date(b.recurrenceUntil)
    : null
  if (recurrenceUntil && dueAt && recurrenceUntil < dueAt) {
    return badRequest('The repeat end date is before the first due date')
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
      farmId: farmFilter ?? null,
      assigneeId,
      approverId,
      recurrence,
      recurrenceUntil,
    })
    .returning()

  return created(rows[0])
}
