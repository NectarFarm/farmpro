import { NextResponse } from 'next/server'
import { db } from '@/db'
import { batches, products } from '@/db/schemas'
import { listSales, recordSale } from '@/lib/finance'
import { and, eq } from 'drizzle-orm'
import { batchIdsForFarm, farmNotFoundResponse, resolveFarmFilter } from '@/lib/farm-scope'
import { requireTenantSession, forbidden } from '@/lib/api-auth'
import { canEdit, MODULES } from '@/lib/permissions'
import { BatchLedgerError } from '@/lib/batch-ledger'

// ── GET/POST /api/data/sales (issue #239 task 1) ────────────────────────────
// Fresh build: no `sales` table or route existed anywhere on this branch
// before this issue (the issue's own branch-correction note confirms it).
// Field set matches the issue's exact spec and components/farm/finance.tsx's
// `SALES` mock 1:1 (id, batchId, item, amountCents, method, status, soldAt).
//
// POST also posts the sale's journal entry in the same DB transaction — see
// lib/finance.ts's recordSale / postSaleJournal for the posting rule and the
// posting-engine-vs-computed-on-read decision.
//
// Same tenant-resolution + envelope conventions as GET/POST /api/batches:
// session tenant wins, `tenantId` query param / body field is the
// standalone-mock-mode fallback.

const ok = <T>(data: T) => NextResponse.json({ success: true, data }, { status: 200 })
const created = <T>(data: T) => NextResponse.json({ success: true, data }, { status: 201 })
const badRequest = (msg: string) => NextResponse.json({ success: false, error: msg }, { status: 400 })
const notFound = (msg: string) => NextResponse.json({ success: false, error: msg }, { status: 404 })

const VALID_STATUSES = new Set(['paid', 'pending'])

// GET /api/data/sales?tenantId=...&farmId= — list a tenant's sales, newest
// first. `farmId` is a two-hop JOIN filter (farm-scoped-data task):
// sales.batchId -> batches.unitId -> production_units.farmId — sales has no
// farm_id of its own, same reasoning as GET /api/records's farmId.
export async function GET(req: Request) {
  const url = new URL(req.url)
  const auth = await requireTenantSession()
  if ('error' in auth) return auth.error
  const { tenantId } = auth

  const farmFilter = await resolveFarmFilter(tenantId, url.searchParams.get('farmId'))
  if (farmFilter === null) return NextResponse.json(farmNotFoundResponse(), { status: 404 })

  if (farmFilter) {
    const batchIds = await batchIdsForFarm(tenantId, farmFilter)
    if (batchIds.length === 0) return ok([])
    const rows = await listSales(tenantId, batchIds)
    return ok(rows)
  }

  const rows = await listSales(tenantId)
  return ok(rows)
}

// POST /api/data/sales — record a sale (and post its journal entry).
// Body: { tenantId?, batchId?, productId?, item?, amountCents, method?,
//         status?, soldAt? }
//
// `amountCents` (issue: money-unit-enforcement): renamed from `amount` and
// now in cents, matching `purchases`' `unitCostCents`/`totalCostCents`/
// `amountPaidCents` convention (every money field, in every route body, is
// cents) — see db/schemas/finance.ts's `sales.amountCents` and lib/money.ts.
//
// `productId` (product-unit-inheritance task, optional): when present and
// `item` is not explicitly supplied, `item` is filled in from the product's
// own name — so a catalogue-driven sale doesn't force the caller to retype
// the label the catalogue already knows, while an ad-hoc sale with no
// productId still requires `item` exactly as before. `productId` must
// belong to the caller's tenant (tenant isolation, same 404-not-500 shape as
// `batchId` below).
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

  if (!(await canEdit(tenantId, session.role, MODULES.finance))) {
    return forbidden('Your role does not have edit access to finance')
  }

  let item = typeof b.item === 'string' ? b.item.trim() : ''
  const amountCents = Number(b.amountCents)
  const status = typeof b.status === 'string' && b.status.trim() ? b.status.trim() : 'paid'
  const batchId = typeof b.batchId === 'string' && b.batchId.trim() ? b.batchId.trim() : null
  const productId = typeof b.productId === 'string' && b.productId.trim() ? b.productId.trim() : null

  let product: { id: string; name: string; stockEffect: string } | undefined
  if (productId) {
    const rows = await db.select({ id: products.id, name: products.name, stockEffect: products.stockEffect }).from(products).where(and(eq(products.id, productId), eq(products.tenantId, tenantId)))
    product = rows[0]
    if (!product) return notFound('Product not found for this tenant')
    if (!item) item = product.name
  }

  if (!item) return badRequest('item is required')
  if (!Number.isFinite(amountCents) || amountCents <= 0) return badRequest('amountCents must be a positive number')
  if (!VALID_STATUSES.has(status)) return badRequest("status must be 'paid' or 'pending'")

  if (batchId) {
    const rows = await db.select({ id: batches.id }).from(batches).where(and(eq(batches.id, batchId), eq(batches.tenantId, tenantId)))
    if (rows.length === 0) return notFound('Batch not found for this tenant')
  }

  const method = typeof b.method === 'string' ? b.method.trim() : ''
  const soldAt = typeof b.soldAt === 'string' && b.soldAt ? new Date(b.soldAt) : undefined

  // How many were sold. Optional, because a sale can legitimately be an
  // amount with no unit count behind it (a bulk lot, a service) — but a sale
  // that is going to reduce a batch's headcount cannot be, so that case is
  // refused rather than silently recorded as a sale of zero birds.
  const qty = b.qty !== undefined && b.qty !== null && b.qty !== '' ? Math.trunc(Number(b.qty)) : null
  if (qty !== null && (!Number.isFinite(qty) || qty <= 0)) return badRequest('qty must be a positive whole number')
  if (product?.stockEffect === 'batch_quantity' && batchId && qty === null) {
    return badRequest(`${product.name} comes out of the batch when sold — enter how many were sold`)
  }

  try {
    const sale = await recordSale({
      tenantId,
      batchId,
      productId,
      item,
      qty,
      stockEffect: product?.stockEffect ?? null,
      actor: session.email,
      amountCents: Math.trunc(amountCents),
      method,
      status,
      soldAt,
    })
    return created(sale)
  } catch (err) {
    // Selling more birds than the batch has is a data-entry mistake worth
    // stopping at the door: the money would be recorded against a headcount
    // that cannot be right.
    if (err instanceof BatchLedgerError) {
      return NextResponse.json({ success: false, error: err.message }, { status: err.status })
    }
    throw err
  }
}
