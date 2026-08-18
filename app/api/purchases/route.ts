import { NextResponse } from 'next/server'
import { db } from '@/db'
import { purchases } from '@/db/schemas'
import { getSessionUser } from '@/lib/auth'
import { recordPurchase } from '@/lib/inventory'
import { and, desc, eq } from 'drizzle-orm'
import { canEdit, MODULES } from '@/lib/permissions'

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
  const session = await getSessionUser()
  const url = new URL(req.url)
  const tenantId = session?.tenantId ?? url.searchParams.get('tenantId')?.trim()
  if (!tenantId) return badRequest('tenantId is required')

  const itemId = url.searchParams.get('itemId')?.trim()
  const conditions = [eq(purchases.tenantId, tenantId)]
  if (itemId) conditions.push(eq(purchases.itemId, itemId))

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
  const session = await getSessionUser()
  const tenantId = session?.tenantId ?? (typeof b.tenantId === 'string' ? b.tenantId.trim() : '')
  const supplier = typeof b.supplier === 'string' ? b.supplier.trim() : ''
  const itemName = typeof b.itemName === 'string' ? b.itemName.trim() : ''
  const unit = typeof b.unit === 'string' ? b.unit.trim() : ''
  const quantity = Number(b.quantity)
  const unitCostCents = Number(b.unitCostCents)

  if (!tenantId) return badRequest('tenantId is required')
  if (!supplier) return badRequest('supplier is required')
  if (!itemName) return badRequest('itemName is required')
  if (!unit) return badRequest('unit is required')
  if (!Number.isFinite(quantity) || quantity <= 0) return badRequest('quantity must be a positive number')
  if (!Number.isFinite(unitCostCents) || unitCostCents < 0) return badRequest('unitCostCents must be a non-negative number')

  // Role-matrix enforcement (lib/permissions.ts): recording a purchase is a
  // write on both the 'inventory' and 'finance' modules — either restriction
  // blocks it.
  if (session && !(await canEdit(tenantId, session.role, MODULES.inventory)) && !(await canEdit(tenantId, session.role, MODULES.finance))) {
    return NextResponse.json({ success: false, error: 'You do not have permission to record purchases' }, { status: 403 })
  }

  // Role-matrix enforcement (lib/permissions.ts): recording a purchase is a
  // write on both the 'inventory' and 'finance' modules — either restriction
  // blocks it.
  if (session && !(await canEdit(tenantId, session.role, MODULES.inventory)) && !(await canEdit(tenantId, session.role, MODULES.finance))) {
    return NextResponse.json({ success: false, error: 'You do not have permission to record purchases' }, { status: 403 })
  }

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
  })

  return created(result)
}
