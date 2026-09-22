import { NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import { db } from '@/db'
import { inventoryItems, inventoryLots } from '@/db/schemas'
import { computeItemStatus } from '@/lib/inventory'
import { and, asc, eq, sql } from 'drizzle-orm'
import { farmNotFoundResponse, resolveFarmFilter } from '@/lib/farm-scope'
import { requireTenantSession, forbidden } from '@/lib/api-auth'
import { canEdit, MODULES } from '@/lib/permissions'
import { isInvalid, requireNonNegativeCount } from '@/lib/validate-input'

// ── GET /api/inventory/items (issue #235 task 3) ────────────────────────────
// The merged stock-list endpoint: joins inventory_items with their
// inventory_lots and computes `status` ('ok' | 'low' | 'expiring') server
// side, per lib/inventory.ts's computeItemStatus. This is the real backend
// for components/farm/inventory.tsx's STOCK_ITEMS table (each returned row
// carries the item's fields plus its lots and the merged status).
//
// `farmId` (farm-scoped-data task) filters the LOTS, not the items:
// inventoryItems is a tenant-wide catalogue (db/schemas/inventory.ts), so the
// item list itself never changes with the farm filter — a farm can only
// scope which physical stock (lots) counts toward `qtyOnHand`/`status`.
// Every item still appears (qtyOnHand: 0, lots: [], status: 'ok') even with
// zero lots at the selected farm, same as an item with zero lots today —
// this is a stock LEVEL filter, not a catalogue filter.

const ok = <T>(data: T) => NextResponse.json({ success: true, data }, { status: 200 })
const created = <T>(data: T) => NextResponse.json({ success: true, data }, { status: 201 })
const badRequest = (msg: string) => NextResponse.json({ success: false, error: msg }, { status: 400 })

export async function GET(req: Request) {
  const url = new URL(req.url)
  const auth = await requireTenantSession()
  if ('error' in auth) return auth.error
  const { tenantId } = auth

  const farmFilter = await resolveFarmFilter(tenantId, url.searchParams.get('farmId'))
  if (farmFilter === null) return NextResponse.json(farmNotFoundResponse(), { status: 404 })

  const items = await db
    .select()
    .from(inventoryItems)
    .where(eq(inventoryItems.tenantId, tenantId))
    .orderBy(asc(inventoryItems.createdAt), asc(inventoryItems.id))

  const lotConditions = [eq(inventoryLots.tenantId, tenantId)]
  if (farmFilter) lotConditions.push(eq(inventoryLots.farmId, farmFilter))
  const lots = await db
    .select()
    .from(inventoryLots)
    .where(and(...lotConditions))
    .orderBy(asc(inventoryLots.receivedDate))

  const lotsByItem = new Map<string, typeof lots>()
  for (const lot of lots) {
    const list = lotsByItem.get(lot.itemId) ?? []
    list.push(lot)
    lotsByItem.set(lot.itemId, list)
  }

  const merged = items.map((item) => {
    const itemLots = lotsByItem.get(item.id) ?? []
    const totalQtyOnHand = itemLots.reduce((sum, l) => sum + l.qtyOnHand, 0)
    const status = computeItemStatus({
      totalQtyOnHand,
      lowStockThreshold: item.lowStockThreshold,
      lots: itemLots.map((l) => ({ expiryDate: l.expiryDate })),
    })
    return {
      ...item,
      qtyOnHand: totalQtyOnHand,
      lots: itemLots,
      status,
    }
  })

  return ok(merged)
}

// ── POST /api/inventory/items (forms-audit slice, item 6) ───────────────────
// "Add a stock item without inventing a purchase" — the audit's finding #5:
// a new item could only ever be created as a side effect of POST
// /api/purchases (see lib/inventory.ts's recordPurchase), which meant
// setting up a catalogue before the first delivery required faking a
// purchase of stock that hadn't arrived yet. This creates the item master
// alone, at zero quantity (no lot, nothing to receive) — a real "set up
// before you buy" path, without touching the purchase flow at all.
//
// Body: { tenantId?, name, category?, unit, lowStockThreshold?, sku? }
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

  if (!(await canEdit(tenantId, session.role, MODULES.inventory))) {
    return forbidden('Your role does not have edit access to inventory')
  }

  const name = typeof b.name === 'string' ? b.name.trim() : ''
  const unit = typeof b.unit === 'string' ? b.unit.trim() : ''
  if (!name) return badRequest('name is required')
  if (!unit) return badRequest('unit is required')

  const category = typeof b.category === 'string' ? b.category.trim() : ''
  const sku = typeof b.sku === 'string' && b.sku.trim() ? b.sku.trim() : null

  let lowStockThreshold = 0
  if (b.lowStockThreshold !== undefined) {
    const parsed = requireNonNegativeCount(b.lowStockThreshold, 'lowStockThreshold')
    if (isInvalid(parsed)) return badRequest(parsed.problem)
    lowStockThreshold = parsed
  }

  // Same case-insensitive dedupe POST /api/purchases' findOrCreateItem
  // applies (lib/inventory.ts's recordPurchase) — two entry points into the
  // same catalogue must refuse the same duplicate, not just one of them.
  const existing = await db
    .select({ id: inventoryItems.id })
    .from(inventoryItems)
    .where(and(eq(inventoryItems.tenantId, tenantId), sql`lower(${inventoryItems.name}) = lower(${name})`))
  if (existing.length > 0) return badRequest(`${name} is already in the catalogue`)

  const [item] = await db
    .insert(inventoryItems)
    .values({ id: randomUUID(), tenantId, name, category, unit, lowStockThreshold, sku })
    .returning()

  // Same merged shape GET returns (qtyOnHand/lots/status) — a freshly
  // created item has none of either, and 'ok' is the honest status for zero
  // stock against whatever reorder level was just set (0 is never "low").
  return created({ ...item, qtyOnHand: 0, lots: [], status: 'ok' as const })
}
