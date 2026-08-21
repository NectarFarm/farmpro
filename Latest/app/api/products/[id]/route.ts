import { NextResponse } from 'next/server'
import { and, eq } from 'drizzle-orm'
import { db } from '@/db'
import { products, productUnits, batchProducts, sales } from '@/db/schemas'
import { getSessionUser } from '@/lib/auth'

// ── PATCH/DELETE /api/products/[id] (product-unit-inheritance task) ───────
// Session-derived tenant only, same as GET/POST /api/products — see that
// route's header for why there's no `tenantId` query-param fallback here.
//
// ── Delete-vs-archive decision ──────────────────────────────────────────────
// A product can be referenced by: `sales.productId` (a real historical
// sale), `product_units` (a unit currently offers it), or `batch_products`
// (a batch override names it). DELETE checks all three:
//   - ANY reference exists  -> archive (status = 'ARCHIVED'), 200. Hard
//     deleting would either orphan a real sale's productId (silently
//     breaking "attribute revenue back to a product") or silently stop a
//     unit/batch from offering something it still thinks it offers. Same
//     precedent as farms.status (a farm with units can't be hard-deleted)
//     and employees' ACTIVE/INACTIVE toggle.
//   - NO reference exists   -> genuinely DELETE the row. A product that was
//     created and never attached to anything and never sold is not
//     "historical" yet — there's nothing an archive would be protecting.
// Archiving does NOT remove the product's product_units/batch_products rows
// — an archived product silently drops out of GET /api/products' default
// list and out of resolveBatchProducts (which filters status = 'ACTIVE'),
// but the underlying associations aren't destroyed, so restoring it
// (PATCH { status: 'ACTIVE' }) brings everything back exactly as it was.

const ok = <T>(data: T) => NextResponse.json({ success: true, data }, { status: 200 })
const unauthorized = () => NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
const badRequest = (msg: string) => NextResponse.json({ success: false, error: msg }, { status: 400 })
const notFound = () => NextResponse.json({ success: false, error: 'Product not found' }, { status: 404 })
const badFields = (fields: Record<string, string>, status = 400) => {
  const firstKey = Object.keys(fields)[0]
  return NextResponse.json({ success: false, error: fields[firstKey], fields }, { status })
}

const VALID_PRODUCT_STATUSES = new Set(['ACTIVE', 'ARCHIVED'])

function tenantIdOf(session: { role: string; tenantId: string | null } | null, bodyTenantId?: string): string {
  if (!session) return ''
  if (session.role === 'super_admin') return bodyTenantId?.trim() ?? ''
  return session.tenantId ?? ''
}

// PATCH /api/products/[id] — edit name/type/saleUnits, or archive/restore
// via `status`. Body: { tenantId? (super_admin only), name?, type?,
// saleUnits?, status? }
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
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

  const fields: Record<string, string> = {}
  const patch: Partial<typeof products.$inferInsert> = {}

  if (b.name !== undefined) {
    const name = typeof b.name === 'string' ? b.name.trim() : ''
    if (!name) fields.name = 'name must be a non-empty string'
    else patch.name = name
  }
  if (b.type !== undefined) {
    const type = typeof b.type === 'string' ? b.type.trim() : ''
    if (!type) fields.type = 'type must be a non-empty string'
    else patch.type = type
  }
  if (b.saleUnits !== undefined) {
    const n = Number(b.saleUnits)
    if (!Number.isFinite(n) || n < 0) fields.saleUnits = 'saleUnits must be a non-negative number'
    else patch.saleUnits = String(n)
  }
  if (b.status !== undefined) {
    const status = typeof b.status === 'string' ? b.status.trim() : ''
    if (!VALID_PRODUCT_STATUSES.has(status)) fields.status = "status must be 'ACTIVE' or 'ARCHIVED'"
    else patch.status = status
  }

  if (Object.keys(fields).length > 0) return badFields(fields)
  if (Object.keys(patch).length === 0) return badRequest('No updatable fields provided')

  const rows = await db
    .update(products)
    .set(patch)
    .where(and(eq(products.id, id), eq(products.tenantId, tenantId)))
    .returning()
  if (rows.length === 0) return notFound()
  return ok(rows[0])
}

// DELETE /api/products/[id]?tenantId= (super_admin only) — see the
// delete-vs-archive decision above.
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = await getSessionUser()
  if (!session) return unauthorized()

  const url = new URL(req.url)
  const tenantId = session.role === 'super_admin'
    ? (url.searchParams.get('tenantId')?.trim() ?? '')
    : (session.tenantId ?? '')
  if (!tenantId) return badRequest('tenantId is required')

  const existing = await db
    .select({ id: products.id })
    .from(products)
    .where(and(eq(products.id, id), eq(products.tenantId, tenantId)))
  if (existing.length === 0) return notFound()

  const [saleRefs, unitRefs, batchRefs] = await Promise.all([
    db.select({ id: sales.id }).from(sales).where(eq(sales.productId, id)).limit(1),
    db.select({ id: productUnits.id }).from(productUnits).where(eq(productUnits.productId, id)).limit(1),
    db.select({ id: batchProducts.id }).from(batchProducts).where(eq(batchProducts.productId, id)).limit(1),
  ])
  const referenced = saleRefs.length > 0 || unitRefs.length > 0 || batchRefs.length > 0

  if (referenced) {
    const rows = await db
      .update(products)
      .set({ status: 'ARCHIVED' })
      .where(and(eq(products.id, id), eq(products.tenantId, tenantId)))
      .returning()
    return ok({ archived: true, product: rows[0] })
  }

  await db.delete(products).where(and(eq(products.id, id), eq(products.tenantId, tenantId)))
  return ok({ archived: false, deleted: true })
}
