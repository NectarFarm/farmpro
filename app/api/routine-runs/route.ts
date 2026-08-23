import { NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import { and, desc, eq, gte } from 'drizzle-orm'
import { db } from '@/db'
import { batches, employees, routineRuns, routines } from '@/db/schemas'
import { requireTenantSession } from '@/lib/api-auth'

// ── GET/POST /api/routine-runs (worker-routines task) ───────────────────────
// "Was the morning round done today?" cannot be answered from the records the
// round produced: a round where nothing died, nothing was collected and
// everything looked fine produces no records at all, and its absence is
// indistinguishable from nobody turning up. So finishing a round is itself
// recorded.
//
// `since` (an ISO instant) is what the worker's portal uses to grey out the
// rounds already done today, and what an owner's view would use to see which
// ones weren't.

const ok = <T>(data: T, status = 200) => NextResponse.json({ success: true, data }, { status })
const badRequest = (error: string) => NextResponse.json({ success: false, error }, { status: 400 })

export async function GET(req: Request) {
  const url = new URL(req.url)
  const auth = await requireTenantSession({ explicitTenantId: url.searchParams.get('tenantId') })
  if ('error' in auth) return auth.error
  const { tenantId } = auth

  const conditions = [eq(routineRuns.tenantId, tenantId)]
  const batchId = url.searchParams.get('batchId')?.trim()
  if (batchId) conditions.push(eq(routineRuns.batchId, batchId))
  const since = url.searchParams.get('since')?.trim()
  if (since) {
    const at = new Date(since)
    if (Number.isNaN(at.getTime())) return badRequest('since must be a valid date')
    conditions.push(gte(routineRuns.completedAt, at))
  }

  const rows = await db
    .select()
    .from(routineRuns)
    .where(and(...conditions))
    .orderBy(desc(routineRuns.completedAt))
    .limit(200)

  return ok(rows)
}

// POST — the worker finished a round. The steps themselves have already filed
// their own records by the time this is called; this is the round's own
// completion, not a second copy of the data.
export async function POST(req: Request) {
  let raw: unknown
  try { raw = await req.json() } catch { return badRequest('Invalid JSON body') }
  const b = (raw ?? {}) as Record<string, unknown>

  const auth = await requireTenantSession({ explicitTenantId: typeof b.tenantId === 'string' ? b.tenantId : undefined })
  if ('error' in auth) return auth.error
  const { tenantId } = auth

  const routineId = typeof b.routineId === 'string' ? b.routineId.trim() : ''
  const batchId = typeof b.batchId === 'string' ? b.batchId.trim() : ''
  const employeeId = typeof b.employeeId === 'string' ? b.employeeId.trim() : ''
  if (!routineId || !batchId || !employeeId) return badRequest('routineId, batchId and employeeId are required')

  // All three checked against the tenant rather than trusted: a run pointing
  // at another farm's batch would quietly corrupt the "was it done" answer
  // for both.
  const [routine] = await db.select({ id: routines.id }).from(routines)
    .where(and(eq(routines.id, routineId), eq(routines.tenantId, tenantId))).limit(1)
  if (!routine) return NextResponse.json({ success: false, error: 'Routine not found' }, { status: 404 })

  const [batch] = await db.select({ id: batches.id }).from(batches)
    .where(and(eq(batches.id, batchId), eq(batches.tenantId, tenantId))).limit(1)
  if (!batch) return NextResponse.json({ success: false, error: 'Batch not found' }, { status: 404 })

  const [employee] = await db.select({ id: employees.id }).from(employees)
    .where(and(eq(employees.id, employeeId), eq(employees.tenantId, tenantId))).limit(1)
  if (!employee) return NextResponse.json({ success: false, error: 'Employee not found' }, { status: 404 })

  const completedSteps = b.completedSteps && typeof b.completedSteps === 'object' && !Array.isArray(b.completedSteps)
    ? (b.completedSteps as Record<string, unknown>)
    : {}
  const skippedCount = Number.isFinite(Number(b.skippedCount)) ? Math.max(0, Math.trunc(Number(b.skippedCount))) : 0

  const [row] = await db.insert(routineRuns).values({
    id: randomUUID(), tenantId, routineId, batchId, employeeId, completedSteps, skippedCount,
  }).returning()

  return ok(row, 201)
}
