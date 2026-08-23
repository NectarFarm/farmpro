// ── Taking stock out (feed-from-stock task) ─────────────────────────────────
// Every deduction goes through here so the four rules that make "remaining
// quantity" mean something can't be re-decided per caller:
//
//   1. Oldest usable stock goes first — earliest expiry, then earliest
//      received. Feed spoils; issuing the newest bag while an older one
//      expires on the shelf is how stock gets written off.
//   2. A shortfall fails the whole issue rather than partially deducting.
//      A worker told "you only have 40kg" can go and check; a silent partial
//      deduction leaves both the stock figure and the feeding record wrong,
//      and nobody finds out until a count doesn't add up.
//   3. Cost is snapshotted from the lot at the moment it's taken, so
//      re-pricing a later purchase can't change what a past feeding cost.
//   4. It runs inside the caller's transaction. The record and the stock it
//      moved commit together or not at all — a feeding saved without its
//      deduction is exactly the fiction this table exists to end.
import 'server-only'
import { randomUUID } from 'node:crypto'
import { and, asc, eq, gt } from 'drizzle-orm'
import { db } from '@/db'
import { inventoryConsumption, inventoryItems, inventoryLots } from '@/db/schemas'

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

export class InsufficientStockError extends Error {
  constructor(
    public itemName: string,
    public requested: number,
    public available: number,
    public unit: string
  ) {
    super(
      available === 0
        ? `${itemName} is out of stock`
        : `Only ${available}${unit ? ` ${unit}` : ''} of ${itemName} left — you asked for ${requested}`
    )
  }
}

export class UnknownItemError extends Error {
  constructor() {
    super('That stock item does not exist on this farm')
  }
}

export interface ConsumeRequest {
  tenantId: string
  itemId: string
  qty: number
  batchId: string
  /** Restricts which lots may be drawn from; null means any lot in the tenant. */
  farmId?: string | null
  recordId?: string | null
  employeeId?: string | null
}

export interface ConsumeResult {
  itemId: string
  itemName: string
  unit: string
  qty: number
  totalCostCents: number
  /** One entry per lot the quantity was drawn from. */
  allocations: { lotId: string; lotNo: string; qty: number; unitCostCents: number }[]
}

// How much of an item can actually be issued right now. Same lot filter the
// deduction uses, so the number a worker is shown and the number enforced on
// submit can't disagree.
export async function availableQty(
  tenantId: string,
  itemId: string,
  farmId?: string | null,
  tx?: Tx
): Promise<number> {
  const conn = tx ?? db
  const conditions = [eq(inventoryLots.tenantId, tenantId), eq(inventoryLots.itemId, itemId)]
  if (farmId) conditions.push(eq(inventoryLots.farmId, farmId))
  const lots = await conn.select({ qty: inventoryLots.qtyOnHand }).from(inventoryLots).where(and(...conditions))
  return lots.reduce((sum, l) => sum + l.qty, 0)
}

export async function consumeStock(tx: Tx, req: ConsumeRequest): Promise<ConsumeResult> {
  const [item] = await tx
    .select({ id: inventoryItems.id, name: inventoryItems.name, unit: inventoryItems.unit })
    .from(inventoryItems)
    .where(and(eq(inventoryItems.id, req.itemId), eq(inventoryItems.tenantId, req.tenantId)))
    .limit(1)
  if (!item) throw new UnknownItemError()

  const conditions = [
    // Tenant-scoped as well as item-scoped: an item id from another tenant
    // must find nothing, not quietly draw down someone else's stock.
    eq(inventoryLots.tenantId, req.tenantId),
    eq(inventoryLots.itemId, req.itemId),
    // Empty lots are excluded up front rather than skipped in the loop: a
    // farm with fifty spent lots shouldn't have them all read to find the
    // one with stock in it.
    gt(inventoryLots.qtyOnHand, 0),
  ]
  if (req.farmId) conditions.push(eq(inventoryLots.farmId, req.farmId))

  const lots = await tx
    .select()
    .from(inventoryLots)
    .where(and(...conditions))
    // NULLS LAST: a lot with no expiry is not urgent, so it waits behind
    // every lot that will actually go off.
    .orderBy(asc(inventoryLots.expiryDate), asc(inventoryLots.receivedDate), asc(inventoryLots.id))

  const total = lots.reduce((sum, l) => sum + l.qtyOnHand, 0)
  if (total < req.qty) {
    throw new InsufficientStockError(item.name, req.qty, total, item.unit)
  }

  let remaining = req.qty
  const allocations: ConsumeResult['allocations'] = []
  let totalCostCents = 0

  for (const lot of lots) {
    if (remaining <= 0) break
    const take = Math.min(remaining, lot.qtyOnHand)
    remaining -= take

    await tx
      .update(inventoryLots)
      .set({ qtyOnHand: lot.qtyOnHand - take })
      .where(eq(inventoryLots.id, lot.id))

    const lineCost = take * lot.unitCostCents
    totalCostCents += lineCost

    await tx.insert(inventoryConsumption).values({
      id: randomUUID(),
      tenantId: lot.tenantId,
      itemId: req.itemId,
      lotId: lot.id,
      batchId: req.batchId,
      recordId: req.recordId ?? null,
      employeeId: req.employeeId ?? null,
      qty: take,
      unitCostCents: lot.unitCostCents,
      totalCostCents: lineCost,
      farmId: lot.farmId,
    })

    allocations.push({ lotId: lot.id, lotNo: lot.lotNo, qty: take, unitCostCents: lot.unitCostCents })
  }

  return { itemId: req.itemId, itemName: item.name, unit: item.unit, qty: req.qty, totalCostCents, allocations }
}
