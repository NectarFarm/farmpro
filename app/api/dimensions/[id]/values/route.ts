import { NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import { and, asc, eq } from 'drizzle-orm'
import { db } from '@/db'
import { dimensions, dimensionValues } from '@/db/schemas'
import { requireTenantSession, forbidden } from '@/lib/api-auth'
import { canEdit, MODULES } from '@/lib/permissions'

// ── GET/POST /api/dimensions/[id]/values (dimensions-on-gl task) ───────────
// The coded tree an accountant actually posts against. System-projected
// values (sourceType 'farm'/'unit'/'batch') are created ONLY by
// lib/dimensions.ts's project*() functions (write-through from the real
// farm/unit/batch routes) — this route refuses to create a value under a
// system dimension directly, since a hand-created "FARM" value with no real
// farm behind it would be indistinguishable from a real one at posting time
// but would never be kept in sync. User-defined dimensions have no such
// restriction: every value on one is created here.

const ok = <T>(data: T) => NextResponse.json({ success: true, data }, { status: 200 })
const created = <T>(data: T) => NextResponse.json({ success: true, data }, { status: 201 })
const badRequest = (msg: string, fields?: Record<string, string>) =>
  NextResponse.json({ success: false, error: msg, ...(fields ? { fields } : {}) }, { status: 400 })
const notFound = (msg: string) => NextResponse.json({ success: false, error: msg }, { status: 404 })

function isUniqueViolation(err: unknown): boolean {
  return !!err && typeof err === 'object' && (err as { code?: string }).code === '23505'
}

async function loadDimension(tenantId: string, id: string) {
  const rows = await db.select().from(dimensions).where(and(eq(dimensions.id, id), eq(dimensions.tenantId, tenantId))).limit(1)
  return rows[0]
}

// GET /api/dimensions/[id]/values?tenantId= — list one dimension's values,
// including archived ones (a config screen needs to show why a value can no
// longer be posted to, not just hide it).
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const auth = await requireTenantSession({ explicitTenantId: new URL(req.url).searchParams.get('tenantId') ?? undefined })
  if ('error' in auth) return auth.error
  const { tenantId } = auth

  const dimension = await loadDimension(tenantId, id)
  if (!dimension) return notFound('Dimension not found for this tenant')

  const rows = await db.select().from(dimensionValues).where(eq(dimensionValues.dimensionId, id)).orderBy(asc(dimensionValues.code))
  return ok(rows)
}

// POST /api/dimensions/[id]/values — create a value on a USER-DEFINED
// dimension. Body: { tenantId?, code, name, levelOrdinal?, parentValueId? }
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
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

  const dimension = await loadDimension(tenantId, id)
  if (!dimension) return notFound('Dimension not found for this tenant')
  if (dimension.isSystem) {
    return badRequest(`${dimension.name} is a system dimension — its values are kept in step with the real farms/units/batches, not created by hand here`)
  }

  const code = typeof b.code === 'string' ? b.code.trim() : ''
  const name = typeof b.name === 'string' ? b.name.trim() : ''
  const levelOrdinal = Number.isFinite(Number(b.levelOrdinal)) && Number(b.levelOrdinal) > 0 ? Math.trunc(Number(b.levelOrdinal)) : 1
  const parentValueId = typeof b.parentValueId === 'string' && b.parentValueId.trim() ? b.parentValueId.trim() : null

  const fields: Record<string, string> = {}
  if (!code) fields.code = 'code is required'
  if (!name) fields.name = 'name is required'
  if (levelOrdinal > dimension.levelCount) fields.levelOrdinal = `${dimension.name} only has ${dimension.levelCount} level(s)`
  if (Object.keys(fields).length > 0) return badRequest('Invalid dimension value', fields)

  if (parentValueId) {
    const parentRows = await db.select().from(dimensionValues).where(and(eq(dimensionValues.id, parentValueId), eq(dimensionValues.dimensionId, id), eq(dimensionValues.tenantId, tenantId))).limit(1)
    if (!parentRows[0]) return badRequest('parentValueId does not belong to this dimension', { parentValueId: 'Not found in this dimension' })
  }

  try {
    const rows = await db
      .insert(dimensionValues)
      .values({ id: randomUUID(), dimensionId: id, tenantId, code, name, levelOrdinal, parentValueId, sourceType: null, sourceId: null, archived: false })
      .returning()
    return created(rows[0])
  } catch (err) {
    if (isUniqueViolation(err)) return badRequest('A value with this code already exists on this dimension', { code: 'Already exists' })
    throw err
  }
}
