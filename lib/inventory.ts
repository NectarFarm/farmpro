// ── Shared inventory logic (issue #235) ──────────────────────────────────────
// Status computation, the purchase -> item/lot upsert transaction, and the
// variance definition all live here so the routes that use them (and the
// tests that verify them) share one implementation instead of drifting.
import 'server-only'
import { randomUUID } from 'node:crypto'
import { and, eq, sql } from 'drizzle-orm'
import { db } from '@/db'
import { inventoryItems, inventoryLots, purchases, auditLog } from '@/db/schemas'
import { postPurchaseJournal } from '@/lib/finance'

// A lot is "expiring" once its expiry date is within this many days (this
// includes lots that have already expired — a negative "days until expiry"
// is still <= the window). 30 days matches the UI's mock data intent (Oxymav
// B expires 2026-09-15 and is flagged "expiring" against a mocked "now" a few
// weeks earlier) and gives a worker enough lead time to use or discard stock
// before it's wasted.
export const EXPIRY_WARNING_DAYS = 30

// Status priority when an item has both a low-stock lot and an expiring lot:
// expiring wins. Rationale: a low-stock item is a planning problem (reorder
// it), an expiring item is a waste/loss-prevention problem that's often more
// time-sensitive and can't be fixed by reordering — so it's the more urgent
// signal to surface as the single status chip the UI renders.
export type StockStatus = 'ok' | 'low' | 'expiring'

export function computeItemStatus(params: {
  totalQtyOnHand: number
  lowStockThreshold: number
  lots: { expiryDate: Date | null }[]
  now?: Date
}): StockStatus {
  const now = params.now ?? new Date()
  const warningCutoff = new Date(now.getTime() + EXPIRY_WARNING_DAYS * 24 * 60 * 60 * 1000)
  const hasExpiringLot = params.lots.some((l) => l.expiryDate !== null && l.expiryDate <= warningCutoff)
  if (hasExpiringLot) return 'expiring'
  if (params.totalQtyOnHand < params.lowStockThreshold) return 'low'
  return 'ok'
}

// ── Variance definition (issue #235 task 4) ─────────────────────────────────
// There is no `physical-counts` table on this branch and building one (a full
// worker-facing closing-stock-count flow) is bigger scope than this issue —
// so a numeric "expected vs actual" gap like the UI's mocked VARIANCES table
// would be fabricated: there is no independent count to compare `qtyOnHand`
// against, and computing "expected" from purchases-received-minus-adjustments
// would just reproduce `qtyOnHand` itself (that IS how qtyOnHand is
// maintained), always yielding a gap of zero — a fake precision that hides
// the real problem instead of surfacing it.
//
// The honest, real thing this data CAN say: how long has it been since a
// lot's on-hand figure was last reconciled against reality? A lot's
// `qtyOnHand` is only known-good as of two events: when it was received
// (`receivedDate`, from a purchase) or when someone last recounted/corrected
// it (a `PATCH /api/inventory/lots/[id]` quantity-adjust, which writes to
// `audit_log`). A lot with neither event inside the staleness window has an
// on-hand figure that's just an assumption — flag it for a physical count
// instead of asserting a variance number with no basis.
export const VARIANCE_STALENESS_DAYS = 30

export type VarianceRow = {
  lotId: string
  itemId: string
  itemName: string
  lotNo: string
  qtyOnHand: number
  lastReconciledAt: Date
  daysSinceReconciliation: number
  flagged: boolean
}

export async function computeVariance(tenantId: string, now: Date = new Date()): Promise<VarianceRow[]> {
  const rows = await db
    .select({
      lotId: inventoryLots.id,
      itemId: inventoryLots.itemId,
      itemName: inventoryItems.name,
      lotNo: inventoryLots.lotNo,
      qtyOnHand: inventoryLots.qtyOnHand,
      receivedDate: inventoryLots.receivedDate,
    })
    .from(inventoryLots)
    .innerJoin(inventoryItems, eq(inventoryLots.itemId, inventoryItems.id))
    .where(eq(inventoryLots.tenantId, tenantId))

  const adjustLogs = await db
    .select({ entityId: auditLog.entityId, at: auditLog.at })
    .from(auditLog)
    .where(and(eq(auditLog.tenantId, tenantId), eq(auditLog.action, 'inventory.adjust')))

  const lastAdjustByLot = new Map<string, Date>()
  for (const log of adjustLogs) {
    const prev = lastAdjustByLot.get(log.entityId)
    if (!prev || log.at > prev) lastAdjustByLot.set(log.entityId, log.at)
  }

  return rows.map((r) => {
    const lastAdjust = lastAdjustByLot.get(r.lotId)
    const lastReconciledAt = lastAdjust && lastAdjust > r.receivedDate ? lastAdjust : r.receivedDate
    const daysSinceReconciliation = Math.floor((now.getTime() - lastReconciledAt.getTime()) / (24 * 60 * 60 * 1000))
    return {
      lotId: r.lotId,
      itemId: r.itemId,
      itemName: r.itemName,
      lotNo: r.lotNo,
      qtyOnHand: r.qtyOnHand,
      lastReconciledAt,
      daysSinceReconciliation,
      flagged: daysSinceReconciliation > VARIANCE_STALENESS_DAYS,
    }
  })
}

// ── Purchase -> item/lot upsert (issue #235 task 2) ─────────────────────────
// "a purchase creates/updates an item+lot (upsert-by-name-and-tenant for the
// item, new row for the lot)". Item lookup is case-insensitive on name so
// "broiler starter mash" and "Broiler Starter Mash" resolve to the same
// catalog row; a genuinely new item is created only when no case-insensitive
// match exists for this tenant. Wrapped in a transaction so a purchase can
// never produce a lot/purchase row without its item, or vice versa.
//
// Returns `{ problem }` for a refusal the CALLER has to turn into a 400 — a
// unit that contradicts the item it is going into. Thrown exceptions stay for
// genuine faults; a mismatched unit is ordinary bad input, and modelling it as
// a return value keeps the route's error envelope in the route.
export type RecordPurchaseResult =
  | { problem: string }
  | {
      item: typeof inventoryItems.$inferSelect
      lot: typeof inventoryLots.$inferSelect
      purchase: typeof purchases.$inferSelect
    }

export async function recordPurchase(input: {
  tenantId: string
  supplier: string
  itemName: string
  category?: string
  unit: string
  lowStockThreshold?: number
  quantity: number
  unitCostCents: number
  totalCostCents?: number
  paymentMethod?: string
  amountPaidCents?: number
  lotNo?: string
  expiryDate?: Date | null
  receivedDate?: Date
  // Farm-scoped-data task: the farm this stock physically lands at. Set on
  // BOTH the lot and the purchase row in the same transaction — see
  // db/schemas/inventory.ts's inventoryLots.farmId/purchases.farmId comments
  // for why they're never independent facts. `null`/omitted keeps both
  // unscoped (tenant-wide), same as before this task existed.
  farmId?: string | null
}): Promise<RecordPurchaseResult> {
  return db.transaction(async (tx): Promise<RecordPurchaseResult> => {
    const existing = await tx
      .select()
      .from(inventoryItems)
      .where(and(eq(inventoryItems.tenantId, input.tenantId), sql`lower(${inventoryItems.name}) = lower(${input.itemName})`))
    let item = existing[0]
    // ── The unit has to match the item it is going into ────────────────────
    // `unit` is a hard requirement in both purchase sheets and on the route,
    // and it was then thrown away whenever the item already existed: only the
    // `if (!item)` insert below ever read it. So a purchase of 20 typed as
    // "bag" against an item recorded in "kg" stored qtyOnHand 20 and the UI
    // rendered "20kg". Twenty bags silently became twenty kilos, and nothing
    // in the system could tell afterwards which one was meant.
    //
    // Refused rather than silently converted — there is no conversion table
    // here, and inventing one would be worse than asking.
    if (item && item.unit && input.unit && item.unit.toLowerCase() !== input.unit.toLowerCase()) {
      return {
        problem: `${item.name} is recorded in ${item.unit}, not ${input.unit}.`
          + ` Record this purchase in ${item.unit}, or use a different item name.`,
      }
    }
    if (!item) {
      const [inserted] = await tx
        .insert(inventoryItems)
        .values({
          id: randomUUID(),
          tenantId: input.tenantId,
          name: input.itemName,
          category: input.category ?? '',
          unit: input.unit,
          lowStockThreshold: input.lowStockThreshold ?? 0,
        })
        .returning()
      item = inserted
    }

    const receivedDate = input.receivedDate ?? new Date()
    const lotNo = input.lotNo || `LOT-${receivedDate.toISOString().slice(0, 10)}-${randomUUID().slice(0, 8).toUpperCase()}`
    // The caller no longer gets to override this — POST /api/purchases now
    // computes it as quantity x unitCostCents and passes that in. Kept as a
    // parameter (rather than recomputed here) so the route stays the one place
    // that decides, and any future caller has to make the same decision
    // explicitly instead of inheriting a silent default.
    const totalCostCents = input.totalCostCents ?? input.quantity * input.unitCostCents

    const [lot] = await tx
      .insert(inventoryLots)
      .values({
        id: randomUUID(),
        tenantId: input.tenantId,
        itemId: item.id,
        lotNo,
        qtyOnHand: input.quantity,
        unitCostCents: input.unitCostCents,
        expiryDate: input.expiryDate ?? null,
        receivedDate,
        farmId: input.farmId ?? null,
      })
      .returning()

    const [purchase] = await tx
      .insert(purchases)
      .values({
        id: randomUUID(),
        tenantId: input.tenantId,
        supplier: input.supplier,
        itemId: item.id,
        quantity: input.quantity,
        unitCostCents: input.unitCostCents,
        totalCostCents,
        paymentMethod: input.paymentMethod ?? '',
        amountPaidCents: input.amountPaidCents ?? 0,
        createdAt: receivedDate,
        farmId: input.farmId ?? null,
      })
      .returning()

    // Issue #239 task 3: a purchase posts Dr Purchases Expense, Cr Cash
    // (amount paid) / Cr Accounts Payable (amount owed) — posted in the same
    // transaction as the purchase itself so a purchase can never exist
    // without its journal entry. See lib/finance.ts's postPurchaseJournal.
    await postPurchaseJournal(tx, purchase)

    return { item, lot, purchase }
  })
}
