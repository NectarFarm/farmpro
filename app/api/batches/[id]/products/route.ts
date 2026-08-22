import { NextResponse } from 'next/server'
import { and, eq } from 'drizzle-orm'
import { db } from '@/db'
import { batches } from '@/db/schemas'
import { getSessionUser } from '@/lib/auth'
import { resolveBatchProducts, setBatchOverrides, validateProductIds } from '@/lib/products'

// ── GET/PUT /api/batches/[id]/products (product-unit-inheritance task) ────
// GET returns the batch's fully RESOLVED product list — everything it
// inherits from its unit, minus any EXCLUDE override, plus any ADD override
// — each row flagged `inherited: true|false` and, when inherited, naming the
// unit it came from. This is the endpoint the batch-detail UI and the
// sell-from-a-batch product picker both read; see lib/products.ts's
// resolveBatchProducts for the single-query resolution and
// db/schemas/dashboard.ts for why the override table (`batch_products`) is
// normally empty for any given batch.
//
// PUT sets the OVERRIDES, not the resolved list — the body names which
// products to ADD (offered despite not being on the unit) and which to
// EXCLUDE (on the unit, but not offered by this specific batch). Anything
// not named in either list simply keeps inheriting from the unit — a batch
// that never calls this route, or calls it with both lists empty, has zero
// rows in `batch_products` and 100% inherits, which is the intended default.
//
// Session-derived tenant only — no `tenantId` query-param/body fallback.

const ok = <T>(data: T) => NextResponse.json({ success: true, data }, { status: 200 })
const unauthorized = () => NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
const badRequest = (msg: string) => NextResponse.json({ success: false, error: msg }, { status: 400 })
const notFound = () => NextResponse.json({ success: false, error: 'Batch not found' }, { status: 404 })
const badFields = (fields: Record<string, string>, status = 400) => {
  const firstKey = Object.keys(fields)[0]
  return NextResponse.json({ success: false, error: fields[firstKey], fields }, { status })
}

function tenantIdOf(session: { role: string; tenantId: string | null } | null, bodyTenantId?: string): string {
  if (!session) return ''
  if (session.role === 'super_admin') return bodyTenantId?.trim() ?? ''
  return session.tenantId ?? ''
}

async function batchExists(tenantId: string, batchId: string): Promise<boolean> {
  const rows = await db.select({ id: batches.id }).from(batches).where(and(eq(batches.id, batchId), eq(batches.tenantId, tenantId)))
  return rows.length > 0
}

// GET /api/batches/[id]/products — the resolved list.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = await getSessionUser()
  if (!session) return unauthorized()
  const tenantId = session.tenantId ?? ''
  if (!tenantId) return badRequest('tenantId is required')

  const resolved = await resolveBatchProducts(tenantId, id)
  if (resolved === null) return notFound()
  return ok(resolved)
}

// PUT /api/batches/[id]/products — set overrides.
// Body: { tenantId? (super_admin only), adds: string[], excludes: string[] }
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

  if (!(await batchExists(tenantId, id))) return notFound()

  const fields: Record<string, string> = {}
  const addsRaw = Array.isArray(b.adds) ? b.adds.filter((v): v is string => typeof v === 'string') : []
  const excludesRaw = Array.isArray(b.excludes) ? b.excludes.filter((v): v is string => typeof v === 'string') : []
  if (b.adds !== undefined && !Array.isArray(b.adds)) fields.adds = 'adds must be an array of product ids'
  if (b.excludes !== undefined && !Array.isArray(b.excludes)) fields.excludes = 'excludes must be an array of product ids'

  const adds = Array.from(new Set(addsRaw.map((v) => v.trim()).filter(Boolean)))
  const excludes = Array.from(new Set(excludesRaw.map((v) => v.trim()).filter(Boolean)))

  const overlap = adds.filter((pid) => excludes.includes(pid))
  if (overlap.length > 0) fields.adds = 'a product cannot be both added and excluded on the same batch'

  if (Object.keys(fields).length > 0) return badFields(fields)

  const allIds = Array.from(new Set([...adds, ...excludes]))
  if (allIds.length > 0) {
    const validated = await validateProductIds(tenantId, allIds)
    if (validated === null) {
      return badFields({ adds: 'One or more products do not belong to this tenant' })
    }
  }

  await setBatchOverrides(tenantId, id, adds, excludes)
  const resolved = await resolveBatchProducts(tenantId, id)
  return ok(resolved)
}
