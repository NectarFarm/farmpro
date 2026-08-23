import { NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import { and, asc, eq } from 'drizzle-orm'
import { db } from '@/db'
import { routines, routineSteps } from '@/db/schemas'
import { requireTenantSession, forbidden } from '@/lib/api-auth'
import { canEdit, MODULES } from '@/lib/permissions'
import { parseSteps, TIMES_OF_DAY } from '@/app/api/routines/route'

// ── PATCH/DELETE /api/routines/[id] (worker-routines task) ──────────────────
// PATCH replaces the whole step list when `steps` is present, rather than
// patching individual steps. A round is an ORDERED checklist edited as a
// whole — "remove water check, add egg collection, move feeding first" is one
// intent, and expressing it as three separate calls invites a half-applied
// list that a worker then walks through.
//
// DELETE is a real delete: a routine is configuration, not a record of
// anything that happened. The runs it produced (routine_runs) and the records
// each step filed both survive it, so deleting "Morning round" does not erase
// the mornings it was used for.

const ok = <T>(data: T) => NextResponse.json({ success: true, data }, { status: 200 })
const badRequest = (error: string) => NextResponse.json({ success: false, error }, { status: 400 })
const notFound = () => NextResponse.json({ success: false, error: 'Routine not found' }, { status: 404 })

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  let raw: unknown
  try { raw = await req.json() } catch { return badRequest('Invalid JSON body') }
  const b = (raw ?? {}) as Record<string, unknown>

  const auth = await requireTenantSession({ explicitTenantId: typeof b.tenantId === 'string' ? b.tenantId : undefined })
  if ('error' in auth) return auth.error
  const { session, tenantId } = auth
  if (!(await canEdit(tenantId, session.role, MODULES.batches))) {
    return forbidden('Your role cannot change how this farm records work')
  }

  const [existing] = await db
    .select()
    .from(routines)
    .where(and(eq(routines.id, id), eq(routines.tenantId, tenantId)))
    .limit(1)
  if (!existing) return notFound()

  const patch: Partial<typeof routines.$inferInsert> = {}
  if (typeof b.name === 'string' && b.name.trim()) patch.name = b.name.trim()
  if (typeof b.timeOfDay === 'string' && TIMES_OF_DAY.has(b.timeOfDay)) patch.timeOfDay = b.timeOfDay
  if (b.active !== undefined) patch.active = b.active === true
  if (b.sortOrder !== undefined && Number.isFinite(Number(b.sortOrder))) patch.sortOrder = Math.trunc(Number(b.sortOrder))

  const steps = b.steps !== undefined ? parseSteps(Array.isArray(b.steps) ? b.steps : []) : undefined
  if (steps === null) return badRequest('Each step needs a label and a valid kind')

  if (Object.keys(patch).length === 0 && steps === undefined) {
    return badRequest('No updatable fields provided')
  }

  const updated = await db.transaction(async (tx) => {
    if (Object.keys(patch).length > 0) {
      await tx.update(routines).set(patch).where(and(eq(routines.id, id), eq(routines.tenantId, tenantId)))
    }
    if (steps !== undefined) {
      await tx.delete(routineSteps).where(eq(routineSteps.routineId, id))
      if (steps.length > 0) {
        await tx.insert(routineSteps).values(steps.map((step, i) => ({
          id: randomUUID(), tenantId, routineId: id, kind: step.kind, label: step.label,
          required: step.required, sortOrder: i,
        })))
      }
    }
    const [row] = await tx.select().from(routines).where(eq(routines.id, id))
    const rows = await tx.select().from(routineSteps).where(eq(routineSteps.routineId, id)).orderBy(asc(routineSteps.sortOrder))
    return { ...row, steps: rows }
  })

  return ok(updated)
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const auth = await requireTenantSession({ explicitTenantId: new URL(req.url).searchParams.get('tenantId') })
  if ('error' in auth) return auth.error
  const { session, tenantId } = auth
  if (!(await canEdit(tenantId, session.role, MODULES.batches))) {
    return forbidden('Your role cannot change how this farm records work')
  }

  const rows = await db
    .delete(routines)
    .where(and(eq(routines.id, id), eq(routines.tenantId, tenantId)))
    .returning()
  if (rows.length === 0) return notFound()
  return ok(rows[0])
}
