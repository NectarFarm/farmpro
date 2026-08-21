import { NextResponse } from 'next/server'
import { db } from '@/db'
import { inventoryItems, inventoryLots } from '@/db/schemas'
import { getSessionUser } from '@/lib/auth'
import { computeItemStatus } from '@/lib/inventory'
import { asc, eq } from 'drizzle-orm'

// ── GET /api/inventory/items (issue #235 task 3) ────────────────────────────
// The merged stock-list endpoint: joins inventory_items with their
// inventory_lots and computes `status` ('ok' | 'low' | 'expiring') server
// side, per lib/inventory.ts's computeItemStatus. This is the real backend
// for components/farm/inventory.tsx's STOCK_ITEMS table (each returned row
// carries the item's fields plus its lots and the merged status).

const ok = <T>(data: T) => NextResponse.json({ success: true, data }, { status: 200 })
const badRequest = (msg: string) => NextResponse.json({ success: false, error: msg }, { status: 400 })

export async function GET(req: Request) {
  const session = await getSessionUser()
  const url = new URL(req.url)
  const tenantId = session?.tenantId ?? url.searchParams.get('tenantId')?.trim()
  if (!tenantId) return badRequest('tenantId is required')

  const items = await db
    .select()
    .from(inventoryItems)
    .where(eq(inventoryItems.tenantId, tenantId))
    .orderBy(asc(inventoryItems.createdAt), asc(inventoryItems.id))

  const lots = await db
    .select()
    .from(inventoryLots)
    .where(eq(inventoryLots.tenantId, tenantId))
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
