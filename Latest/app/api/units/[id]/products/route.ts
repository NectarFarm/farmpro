import { NextResponse } from 'next/server'
import { and, eq } from 'drizzle-orm'
import { db } from '@/db'
import { productionUnits } from '@/db/schemas'
import { getSessionUser } from '@/lib/auth'
import { getUnitProducts, setUnitProducts, validateProductIds } from '@/lib/products'

// ── GET/PUT /api/units/[id]/products (product-unit-inheritance task) ──────
// Which products a production unit offers — the "define once, share across
// units" side of the model (see db/schemas/dashboard.ts). Every batch under
// this unit inherits this exact list unless it has its own override (see
// GET/PUT /api/batches/[id]/products).
//
// Session-derived tenant only — no `tenantId` query-param/body fallback;
// this is a fresh route built without the older routes' known auth hole.

const ok = <T>(data: T) => NextResponse.json({ success: true, data }, { status: 200 })
const unauthorized = () => NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
const badRequest = (msg: string) => NextResponse.json({ success: false, error: msg }, { status: 400 })
const notFound = (msg: string) => NextResponse.json({ success: false, error: msg }, { status: 404 })
const badFields = (fields: Record<string, string>, status = 400) => {
  const firstKey = Object.keys(fields)[0]
  return NextResponse.json({ success: false, error: fields[firstKey], fields }, { status })
}

function tenantIdOf(session: { role: string; tenantId: string | null } | null, bodyTenantId?: string): string {
  if (!session) return ''
  if (session.role === 'super_admin') return bodyTenantId?.trim() ?? ''
  return session.tenantId ?? ''
}

async function findUnit(tenantId: string, unitId: string) {
  const rows = await db
    .select()
    .from(productionUnits)
    .where(and(eq(productionUnits.id, unitId), eq(productionUnits.tenantId, tenantId)))
  return rows[0]
}

// GET /api/units/[id]/products — the unit's own product list (not resolved
// through anything; a unit has no inheritance of its own to resolve).
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = await getSessionUser()
  if (!session) return unauthorized()
  const tenantId = session.tenantId ?? ''
  if (!tenantId) return badRequest('tenantId is required')

  const unit = await findUnit(tenantId, id)
  if (!unit) return notFound('Unit not found for this tenant')

  const rows = await getUnitProducts(tenantId, id)
  return ok(rows)
}

// PUT /api/units/[id]/products — set the FULL list of products this unit
// offers. Body: { tenantId? (super_admin only), productIds: string[] }
// Every id must belong to the caller's tenant (tenant isolation: a unit can
// never be given another tenant's product) — validateProductIds enforces
// this the same way validateBatchIds already does for
// employees.assignedBatchIds.
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = await getSessionUser()
  if (!session) return unauthorized()

  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return badRequest('Invalid JSON body')
  }
  const b = (raw ?? {}) as Record<string, unknown>
  const tenantId = tenantIdOf(session, typeof b.tenantId === 'string' ? b.tenantId : undefined)
  if (!tenantId) return badRequest('tenantId is required')

  const unit = await findUnit(tenantId, id)
  if (!unit) return notFound('Unit not found for this tenant')

  if (!Array.isArray(b.productIds)) return badFields({ productIds: 'productIds must be an array of product ids' })
  const rawIds = b.productIds.filter((v): v is string => typeof v === 'string')

  const validated = await validateProductIds(tenantId, rawIds)
  if (validated === null) {
    return badFields({ productIds: 'One or more products do not belong to this tenant' })
  }

  await setUnitProducts(tenantId, id, validated)
  const rows = await getUnitProducts(tenantId, id)
  return ok(rows)
}
