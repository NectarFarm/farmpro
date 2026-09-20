import { NextResponse } from 'next/server'
import { and, asc, eq } from 'drizzle-orm'
import { requireTenantSession, forbidden } from '@/lib/api-auth'
import { canEdit, MODULES } from '@/lib/permissions'
import { updateDimension, archiveDimension, SystemDimensionEditError, DimensionNotFoundError } from '@/lib/dimensions'
import { db } from '@/db'
import { dimensions, dimensionLevels } from '@/db/schemas'

// ── PATCH /api/dimensions/[id] (dimensions-operable task) ──────────────────
// Editing and archiving a USER-DEFINED dimension (item 4 of the brief: "user-
// defined dimensions and their values need editing and archiving, not just
// creation"). A system dimension (UNIT/FARM/BATCH/ENTERPRISE) refuses both —
// see lib/dimensions.ts's updateDimension/archiveDimension for why.
//
// Body: { tenantId?, name?, shortName?, separator?, budgetCheck?, budgetControl?, archived? }
// `archived` is handled as its own operation (archiveDimension) so an
// archive/restore never accidentally also rewrites the name in the same
// call — the route applies field edits first, then the archive flag, both
// inside one response either way.

const ok = <T>(data: T) => NextResponse.json({ success: true, data }, { status: 200 })
const badRequest = (msg: string, fields?: Record<string, string>) =>
  NextResponse.json({ success: false, error: msg, ...(fields ? { fields } : {}) }, { status: 400 })
const notFound = (msg: string) => NextResponse.json({ success: false, error: msg }, { status: 404 })

function isUniqueViolation(err: unknown): boolean {
  return !!err && typeof err === 'object' && (err as { code?: string }).code === '23505'
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
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

  if (!(await canEdit(tenantId, session.role, MODULES.finance))) {
    return forbidden('Your role does not have edit access to finance configuration')
  }

  const patch: { name?: string; shortName?: string; separator?: string; budgetCheck?: boolean; budgetControl?: boolean } = {}
  if (typeof b.name === 'string' && b.name.trim()) patch.name = b.name.trim()
  if (typeof b.shortName === 'string') patch.shortName = b.shortName.trim()
  if (typeof b.separator === 'string' && b.separator.trim()) patch.separator = b.separator.trim()
  if (typeof b.budgetCheck === 'boolean') patch.budgetCheck = b.budgetCheck
  if (typeof b.budgetControl === 'boolean') patch.budgetControl = b.budgetControl

  try {
    if (Object.keys(patch).length > 0) {
      await updateDimension(db, tenantId, id, patch)
    }
    if (typeof b.archived === 'boolean') {
      await archiveDimension(db, tenantId, id, b.archived)
    }
  } catch (err) {
    if (err instanceof DimensionNotFoundError) return notFound(err.message)
    if (err instanceof SystemDimensionEditError) return badRequest(err.message)
    if (isUniqueViolation(err)) return badRequest('A dimension with this code already exists for this tenant')
    throw err
  }

  const rows = await db.select().from(dimensions).where(and(eq(dimensions.id, id), eq(dimensions.tenantId, tenantId))).limit(1)
  const row = rows[0]
  if (!row) return notFound('Dimension not found for this tenant')
  const levels = await db.select().from(dimensionLevels).where(eq(dimensionLevels.dimensionId, id)).orderBy(asc(dimensionLevels.ordinal))
  return ok({ ...row, levels })
}
