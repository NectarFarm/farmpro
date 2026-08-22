import { NextResponse } from 'next/server'
import { db } from '@/db'
import { purchases } from '@/db/schemas'
import { recordPurchase } from '@/lib/inventory'
import { and, desc, eq } from 'drizzle-orm'
import { farmNotFoundResponse, resolveFarmFilter } from '@/lib/farm-scope'
import { requireTenantSession } from '@/lib/api-auth'

// ── GET/POST /api/purchases (issue #235 task 2) ─────────────────────────────
// Fresh build: no `purchases` table existed on this branch before this issue.
// POST is the only way stock enters the system in v1 — it upserts the item
// (by tenant+name) and always creates a new lot; see lib/inventory.ts's
// recordPurchase for the transaction. Same tenant-resolution + envelope
// conventions as GET/POST /api/batches.

const ok = <T>(data: T) => NextResponse.json({ success: true, data }, { status: 200 })
const created = <T>(data: T) => NextResponse.json({ success: true, data }, { status: 201 })
const badRequest = (msg: string) => NextResponse.json({ success: false, error: msg }, { status: 400 })

// GET /api/purchases?tenantId=...&itemId=... — list a tenant's purchases
// (newest first), optionally filtered to one item.
export async function GET(req: Request) {
  const url = new URL(req.url)
  const auth = await requireTenantSession()
  if ('error' in auth) return auth.error
  const { tenantId } = auth

  const itemId = url.searchParams.get('itemId')?.trim()

  // farmId (direct filter — purchases.farmId, farm-scoped-data task).
  const farmFilter = await resolveFarmFilter(tenantId, url.searchParams.get('farmId'))
  if (farmFilter === null) return NextResponse.json(farmNotFoundResponse(), { status: 404 })

  const conditions = [eq(purchases.tenantId, tenantId)]
  if (itemId) conditions.push(eq(purchases.itemId, itemId))
  if (farmFilter) conditions.push(eq(purchases.farmId, farmFilter))

  const rows = await db
    .select()
    .from(purchases)
    .where(and(...conditions))
    .orderBy(desc(purchases.createdAt), desc(purchases.id))

  return ok(rows)
}

// POST /api/purchases — record a purchase; upserts the item by tenant+name
// (case-insensitive) and always creates a new lot for the received quantity.
// Body: { tenantId?, supplier, itemName, category?, unit, lowStockThreshold?,
//         quantity, unitCostCents, totalCostCents?, paymentMethod?,
//         amountPaidCents?, lotNo?, expiryDate?, receivedDate? }
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
  const { tenantId } = auth
  const supplier = typeof b.supplier === 'string' ? b.supplier.trim() : ''
  const itemName = typeof b.itemName === 'string' ? b.itemName.trim() : ''
  const unit = typeof b.unit === 'string' ? b.unit.trim() : ''
  const quantity = Number(b.quantity)
  const unitCostCents = Number(b.unitCostCents)

  if (!supplier) return badRequest('supplier is required')
  if (!itemName) return badRequest('itemName is required')
  if (!unit) return badRequest('unit is required')
  if (!Number.isFinite(quantity) || quantity <= 0) return badRequest('quantity must be a positive number')
  if (!Number.isFinite(unitCostCents) || unitCostCents < 0) return badRequest('unitCostCents must be a non-negative number')

  // farmId (farm-scoped-data task) — optional. When supplied, both the new
  // lot AND this purchase row get it (see lib/inventory.ts's recordPurchase):
  // a purchase and the physical lot it creates always describe stock landing
  // at the same farm, so there is exactly one farmId to resolve/validate here.
  const farmFilter = await resolveFarmFilter(tenantId, typeof b.farmId === 'string' ? b.farmId : undefined)
  if (farmFilter === null) return NextResponse.json(farmNotFoundResponse(), { status: 404 })

  const category = typeof b.category === 'string' ? b.category.trim() : undefined
  const lowStockThreshold = b.lowStockThreshold !== undefined && Number.isFinite(Number(b.lowStockThreshold))
    ? Math.max(0, Math.trunc(Number(b.lowStockThreshold)))
    : undefined
  const totalCostCents = b.totalCostCents !== undefined && Number.isFinite(Number(b.totalCostCents))
    ? Math.max(0, Math.trunc(Number(b.totalCostCents)))
    : undefined
  const paymentMethod = typeof b.paymentMethod === 'string' ? b.paymentMethod.trim() : undefined
  const amountPaidCents = b.amountPaidCents !== undefined && Number.isFinite(Number(b.amountPaidCents))
    ? Math.max(0, Math.trunc(Number(b.amountPaidCents)))
    : undefined
  const lotNo = typeof b.lotNo === 'string' ? b.lotNo.trim() : undefined
  const expiryDate = typeof b.expiryDate === 'string' && b.expiryDate ? new Date(b.expiryDate) : null
  const receivedDate = typeof b.receivedDate === 'string' && b.receivedDate ? new Date(b.receivedDate) : undefined

  const result = await recordPurchase({
    tenantId,
    supplier,
    itemName,
    category,
    unit,
    lowStockThreshold,
    quantity: Math.trunc(quantity),
    unitCostCents: Math.trunc(unitCostCents),
    totalCostCents,
    paymentMethod,
    amountPaidCents,
    lotNo,
    expiryDate,
    receivedDate,
    farmId: farmFilter ?? null,
  })

  return created(result)
}
