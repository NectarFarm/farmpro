import { NextResponse } from 'next/server'
import { and, asc, eq, inArray } from 'drizzle-orm'
import { db } from '@/db'
import { products, productUnits } from '@/db/schemas'
import { getSessionUser } from '@/lib/auth'
import { unitIdsForFarm, farmNotFoundResponse, resolveFarmFilter } from '@/lib/farm-scope'

// ── GET/POST /api/products (product-unit-inheritance task) ─────────────────
// The tenant-level product catalogue itself — create once, reuse everywhere
// (see db/schemas/dashboard.ts for the full model writeup: products stay
// tenant-scoped on purpose, since that's what makes "the same product shared
// across units/batches" possible at all).
//
// Unlike the older GET/POST /api/units, /api/farms etc, tenant scope here is
// derived from the SESSION ONLY — no `tenantId` query param fallback. That
// fallback is a known auth hole on the older routes (any caller who knows/
// guesses a tenantId can read or write that tenant's data); this is a fresh
// route, so it's built without the hole rather than copying it in. A
// super_admin (session.tenantId === null) has no tenant of its own, so POST
// requires one explicitly in the BODY (never the query string) — same
// carve-out PATCH /api/farms/[id] already makes.

const ok = <T>(data: T) => NextResponse.json({ success: true, data }, { status: 200 })
const created = <T>(data: T) => NextResponse.json({ success: true, data }, { status: 201 })
const unauthorized = () => NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
const badRequest = (msg: string) => NextResponse.json({ success: false, error: msg }, { status: 400 })
const badFields = (fields: Record<string, string>, status = 400) => {
  const firstKey = Object.keys(fields)[0]
  return NextResponse.json({ success: false, error: fields[firstKey], fields }, { status })
}

function resolveTenantId(session: { role: string; tenantId: string | null } | null, bodyTenantId?: string): string {
  if (!session) return ''
  if (session.role === 'super_admin') return bodyTenantId?.trim() ?? ''
  return session.tenantId ?? ''
}

// GET /api/products?farmId=&includeArchived= — list the tenant's catalogue.
// `products` is tenant-level, not farm-level (there is no products.farm_id —
// see db/schemas/dashboard.ts), but a `farmId` still narrows the list
// meaningfully: it returns only products attached (via product_units) to a
// unit that belongs to that farm. This mirrors how GET /api/units already
// treats farmId (a direct filter) and lets a multi-farm tenant's product
// picker show "what this farm actually sells" instead of the whole tenant
// catalogue on every farm's screen.
export async function GET(req: Request) {
  const session = await getSessionUser()
  if (!session) return unauthorized()
  const url = new URL(req.url)
  // Session-derived tenant, full stop — no `tenantId` query-param fallback
  // (that's the known auth hole other routes carry; this route doesn't). A
  // super_admin session has no tenant of its own and GET has no body to
  // name one in, so it gets the same 400 any tenant-less session would.
  const tenantId = session.tenantId ?? ''
  if (!tenantId) return badRequest('tenantId is required')

  const includeArchived = url.searchParams.get('includeArchived') === 'true'
  const conditions = [eq(products.tenantId, tenantId)]
  if (!includeArchived) conditions.push(eq(products.status, 'ACTIVE'))

  const farmIdParam = url.searchParams.get('farmId')
  if (farmIdParam) {
    const farmFilter = await resolveFarmFilter(tenantId, farmIdParam)
    if (farmFilter === null) return NextResponse.json(farmNotFoundResponse(), { status: 404 })
    if (farmFilter) {
      const unitIds = await unitIdsForFarm(tenantId, farmFilter)
      if (unitIds.length === 0) return ok([])
      const rows = await db
        .select({
          id: products.id,
          tenantId: products.tenantId,
          type: products.type,
          name: products.name,
          saleUnits: products.saleUnits,
          status: products.status,
          createdAt: products.createdAt,
        })
        .from(productUnits)
        .innerJoin(products, and(eq(products.id, productUnits.productId), ...conditions))
        .where(inArray(productUnits.unitId, unitIds))
        .orderBy(asc(products.name))
      // de-dupe: a product attached to two units in the same farm would
      // otherwise appear twice.
      const seen = new Set<string>()
      const deduped = rows.filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)))
      return ok(deduped)
    }
  }

  const rows = await db
    .select()
    .from(products)
    .where(and(...conditions))
    .orderBy(asc(products.name))
  return ok(rows)
}

// POST /api/products — create a catalogue product.
// Body: { tenantId? (super_admin only), name, type, saleUnits? }
export async function POST(req: Request) {
  const session = await getSessionUser()
  if (!session) return unauthorized()

  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return badRequest('Invalid JSON body')
  }
  const b = (raw ?? {}) as Record<string, unknown>
  const tenantId = resolveTenantId(session, typeof b.tenantId === 'string' ? b.tenantId : undefined)

  const fields: Record<string, string> = {}
  if (!tenantId) fields.tenantId = 'tenantId is required'

  const name = typeof b.name === 'string' ? b.name.trim() : ''
  if (!name) fields.name = 'name is required'
  else if (name.length > 200) fields.name = 'name must be at most 200 characters'

  const type = typeof b.type === 'string' ? b.type.trim() : ''
  if (!type) fields.type = 'type is required'

  let saleUnits = '0'
  if (b.saleUnits !== undefined && b.saleUnits !== null && b.saleUnits !== '') {
    const n = Number(b.saleUnits)
    if (!Number.isFinite(n) || n < 0) fields.saleUnits = 'saleUnits must be a non-negative number'
    else saleUnits = String(n)
  }

  if (Object.keys(fields).length > 0) return badFields(fields)

  // No unique index on (tenantId, name) — same "free-text name, a rare
  // concurrent duplicate is accepted rather than DB-guarded" tradeoff
  // db/schemas/inventory.ts's inventoryItems already makes, for the same
  // reason (a product name isn't a hard identifier like a farm/batch code).
  const id = crypto.randomUUID()
  const rows = await db
    .insert(products)
    .values({ id, tenantId, name, type, saleUnits, status: 'ACTIVE' })
    .returning()
  return created(rows[0])
}
