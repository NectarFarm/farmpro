import { NextResponse } from 'next/server'
import { and, asc, eq, inArray } from 'drizzle-orm'
import { db } from '@/db'
import { batches, inventoryItems, inventoryLots, productionUnits } from '@/db/schemas'
import { requireTenantSession } from '@/lib/api-auth'

// ── GET /api/inventory/available?batchId=… (feed-from-stock task) ───────────
// Answers the one question the worker's feeding form actually has: what can I
// give this batch, and how much of it is left?
//
// It exists separately from GET /api/inventory/items because that endpoint
// takes a `farmId` and returns the whole catalogue including items with no
// stock anywhere. A worker doesn't know their batch's farm id — they know
// which batch they are standing in front of — so the farm is resolved HERE,
// one hop through batches.unitId -> production_units.farmId, using the same
// join every other farm-scoped read uses. Getting that wrong in the client
// would mean showing a worker feed that is physically at another farm.
//
// Items with zero left are returned, not filtered out. A worker looking for
// "Layer Mash" and not finding it in the list assumes the app is broken or
// the name is different; seeing it listed with "0 kg left" tells them the
// truth, which is that somebody needs to buy feed.
//
// No category filter. `inventory_items.category` is free text ('Feed', 'Vet',
// 'Agro' in the demo data, whatever a tenant types in practice), so
// hard-coding a match on it would quietly hide a supplement somebody
// categorised differently. The form gives them a search box instead.

const ok = <T>(data: T) => NextResponse.json({ success: true, data }, { status: 200 })
const bad = (error: string, status: number) => NextResponse.json({ success: false, error }, { status })

export async function GET(req: Request) {
  const url = new URL(req.url)
  const auth = await requireTenantSession({ explicitTenantId: url.searchParams.get('tenantId') })
  if ('error' in auth) return auth.error
  const { tenantId } = auth

  const batchId = url.searchParams.get('batchId')?.trim()

  // Resolve the farm from the batch, when one was named.
  let farmId: string | null = null
  if (batchId) {
    const [row] = await db
      .select({ farmId: productionUnits.farmId })
      .from(batches)
      .innerJoin(productionUnits, eq(productionUnits.id, batches.unitId))
      .where(and(eq(batches.id, batchId), eq(batches.tenantId, tenantId)))
      .limit(1)
    if (!row) return bad('Batch not found for this tenant', 404)
    farmId = row.farmId
  }

  const items = await db
    .select()
    .from(inventoryItems)
    .where(eq(inventoryItems.tenantId, tenantId))
    .orderBy(asc(inventoryItems.name))

  if (items.length === 0) return ok([])

  const lotConditions = [
    eq(inventoryLots.tenantId, tenantId),
    inArray(inventoryLots.itemId, items.map((i) => i.id)),
  ]
  // A lot with no farm predates farm scoping and belongs to the tenant at
  // large, so it stays usable from anywhere rather than becoming stock
  // nobody can reach.
  if (farmId) lotConditions.push(eq(inventoryLots.farmId, farmId))

  const lots = await db.select().from(inventoryLots).where(and(...lotConditions))

  const totals = new Map<string, number>()
  const earliestExpiry = new Map<string, Date>()
  for (const lot of lots) {
    totals.set(lot.itemId, (totals.get(lot.itemId) ?? 0) + lot.qtyOnHand)
    if (lot.expiryDate && lot.qtyOnHand > 0) {
      const current = earliestExpiry.get(lot.itemId)
      if (!current || lot.expiryDate < current) earliestExpiry.set(lot.itemId, lot.expiryDate)
    }
  }

  return ok(items.map((item) => ({
    id: item.id,
    name: item.name,
    category: item.category,
    unit: item.unit,
    qtyOnHand: totals.get(item.id) ?? 0,
    lowStockThreshold: item.lowStockThreshold,
    // Shown next to the quantity so the oldest stock gets used first without
    // the worker having to know which lot they are drawing from — the
    // deduction picks that for them (lib/inventory-consume.ts).
    nextExpiry: earliestExpiry.get(item.id)?.toISOString() ?? null,
  })))
}
