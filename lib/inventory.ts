// ── Shared inventory logic (issue #235) ──────────────────────────────────────
// Status computation, the purchase -> item/lot upsert transaction, and the
// variance definition all live here so the routes that use them (and the
// tests that verify them) share one implementation instead of drifting.
import 'server-only'
import { randomUUID } from 'node:crypto'
import { and, eq, sql } from 'drizzle-orm'
import { db } from '@/db'
import type { PgTransaction } from 'drizzle-orm/pg-core'
import { inventoryItems, inventoryLots, purchases, purchaseCharges, auditLog } from '@/db/schemas'
import { postPurchaseJournal } from '@/lib/finance'
import { insertMoneyApproval } from '@/lib/raise-money-approval'

type Tx = PgTransaction<any, any, any>

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
      // Null while the purchase waits for approval: no stock exists until then.
      lot: typeof inventoryLots.$inferSelect | null
      // One per requested lot; more when a value that does not divide by the
      // quantity has to be carried at two unit costs (see splitLotCost).
      lots: (typeof inventoryLots.$inferSelect)[]
      purchase: typeof purchases.$inferSelect
    }

/**
 * Split a stock value across whole-cent unit costs so it is carried exactly.
 * A lot has one integer unit cost and every consumer (FIFO consumption, lot
 * adjustments, the cost breakdown) prices a draw as qty x lot.unitCostCents,
 * so a single rounded unit cost makes qty x unit drift from the value that was
 * debited. When the value divides evenly it is one lot. Otherwise it is two
 * lots of the same stock: `remainder` units one cent dearer, the rest at the
 * floor. The sum of qty x unit over the pieces is exactly valueCents.
 */
export function splitLotCost(valueCents: number, quantity: number): { qty: number; unitCostCents: number }[] {
  const base = Math.floor(valueCents / quantity)
  const remainder = valueCents - base * quantity
  if (remainder === 0) return [{ qty: quantity, unitCostCents: base }]
  return [
    { qty: quantity - remainder, unitCostCents: base },
    { qty: remainder, unitCostCents: base + 1 },
  ]
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
  // The value stock is carried at when it differs from quantity x typed unit
  // cost (an inclusive VATable bill values stock net of VAT). Defaults to
  // quantity x unitCostCents. See splitLotCost for how an amount that does not
  // divide evenly is carried without drifting.
  lotValueCents?: number
  totalCostCents?: number
  paymentMethod?: string
  amountPaidCents?: number
  lotNo?: string
  expiryDate?: Date | null
  receivedDate?: Date
  // Forms-audit slice: all optional pass-throughs onto the columns
  // db/schemas/inventory.ts added — see that file for why `receivedDate`
  // above ALSO still gets written to `purchases.createdAt` (unchanged, for
  // P&L continuity) as well as the new dedicated column.
  paymentReference?: string | null
  dueDate?: Date | null
  invoiceNumber?: string | null
  notes?: string | null
  photoUrl?: string | null
  // Three-date model (item 18). `receivedDate` above is already the
  // effective date. `transactionDate` defaults to it when the caller sends
  // nothing better (there is rarely a separate "when I placed the order"
  // fact worth asking for on a small farm purchase); `postingDate` defaults
  // to `receivedDate` too — the chain the sheet's own copy states. Never
  // left null, for the same reason recordSale never leaves its dates null:
  // `lib/reports.ts`'s posting_date filter has to stay equivalent to its old
  // created_at filter for every row this function writes.
  transactionDate?: Date | null
  postingDate?: Date | null
  // Item 20: optional link to the supplier master — validated against the
  // caller's tenant by the route.
  supplierId?: string | null
  // Item 23: the recording actor's user id — see db/schemas/inventory.ts's
  // purchases.recordedBy for what this unlocks (edit/reverse ownership).
  recordedBy?: string | null
  // Farm-scoped-data task: the farm this stock physically lands at. Set on
  // BOTH the lot and the purchase row in the same transaction — see
  // db/schemas/inventory.ts's inventoryLots.farmId/purchases.farmId comments
  // for why they're never independent facts. `null`/omitted keeps both
  // unscoped (tenant-wide), same as before this task existed.
  farmId?: string | null
  // Explicit dimension overrides (dimensions-on-gl task) — see
  // lib/finance.ts's postPurchaseJournal / lib/dimensions.ts's
  // resolveMasterDimensions for the resolution order this participates in.
  dimensions?: Record<string, string>
  // Issue #419. Omitted leaves the tax columns null. totalCostCents stays
  // the settled amount; the lot keeps the typed unit cost.
  taxCode?: string | null
  taxInclusive?: boolean | null
  grossCents?: number | null
  taxCents?: number | null
  netCents?: number | null
  // Issue #423. Omitted on the old single-item body: raw stays null (the
  // raw cost is unitCostCents) and the purchase is not part of a receipt.
  rawUnitCostCents?: number | null
  receiptGroupId?: string | null
  // Omitted means one lot for the whole quantity, as before. When present,
  // the quantities must add up to `quantity`. Value is carried as for one lot.
  lots?: { quantity: number; expiryDate?: Date | null; lotNo?: string | null }[]
  // Issue #424. A hold stores the purchase and does not create lots or a
  // journal. Stock quantity stays where it was until the approval is decided.
  hold?: boolean
}): Promise<RecordPurchaseResult> {
  return db.transaction((tx) => writePurchase(tx, input))
}

export class PurchaseReceiptError extends Error {}

export async function recordPurchaseReceipt(input: {
  tenantId: string
  receiptGroupId: string
  charges: { kind: string; amountCents: number }[]
  lines: Parameters<typeof recordPurchase>[0][]
}) {
  return db.transaction(async (tx) => {
    const charges = []
    for (const charge of input.charges) {
      const [row] = await tx.insert(purchaseCharges).values({
        id: randomUUID(),
        tenantId: input.tenantId,
        receiptGroupId: input.receiptGroupId,
        kind: charge.kind,
        amountCents: charge.amountCents,
      }).returning()
      charges.push(row)
    }
    const purchasesRecorded = []
    for (const line of input.lines) {
      const result = await writePurchase(tx, {
        ...line,
        tenantId: input.tenantId,
        receiptGroupId: input.receiptGroupId,
      }, { deferApproval: true })
      if ('problem' in result) throw new PurchaseReceiptError(result.problem)
      purchasesRecorded.push(result)
    }
    // One approval for the whole receipt: the policy judged the receipt by its
    // total, so approving books every line (and keeps the charges) together and
    // rejecting books none. The approval hangs off the first line's id.
    const held = purchasesRecorded.filter((row) => row.purchase.approvalStatus === 'pending')
    if (held.length > 0) {
      const first = input.lines[0]
      if (!first.recordedBy) throw new PurchaseReceiptError('A document waiting for approval needs the person who recorded it.')
      await insertMoneyApproval(tx, {
        tenantId: input.tenantId,
        requestedBy: first.recordedBy,
        title: `Purchase receipt of ${held.length} line${held.length === 1 ? '' : 's'} waiting for approval`,
        details: {
          docType: 'purchase',
          documentId: held[0].purchase.id,
          receiptGroupId: input.receiptGroupId,
          amountCents: held.reduce((sum, row) => sum + row.purchase.totalCostCents, 0),
          dimensions: first.dimensions ?? null,
          lines: held.map((row, i) => ({
            documentId: row.purchase.id,
            lots: (input.lines[i].lots && input.lines[i].lots!.length > 0
              ? input.lines[i].lots!
              : [{ quantity: input.lines[i].quantity, expiryDate: input.lines[i].expiryDate ?? null, lotNo: input.lines[i].lotNo }]
            ).map((spec) => ({
              quantity: spec.quantity,
              expiryDate: spec.expiryDate ? spec.expiryDate.toISOString() : null,
              lotNo: spec.lotNo ?? null,
            })),
          })),
        },
      })
    }
    return { receiptGroupId: input.receiptGroupId, charges, purchases: purchasesRecorded }
  })
}

/**
 * Write the lots of a purchase so that qty x unit cost over every row is
 * exactly `valueCents` (see splitLotCost). The units are dealt to the
 * requested lots in order; a lot that straddles the one-cent step becomes two
 * rows. Shared by a purchase posted now and one posted on approval, so a held
 * purchase carries stock at the same value an immediate one would.
 */
export async function insertPurchaseLots(tx: Tx, input: {
  tenantId: string
  itemId: string
  farmId: string | null
  receivedDate: Date
  specs: { quantity: number; expiryDate?: Date | null; lotNo?: string | null }[]
  valueCents: number
}) {
  const quantity = input.specs.reduce((sum, spec) => sum + spec.quantity, 0)
  const tiers = splitLotCost(input.valueCents, quantity).map((tier) => ({ ...tier }))
  const lots: (typeof inventoryLots.$inferSelect)[] = []
  let tierIdx = 0
  for (const spec of input.specs) {
    const baseLotNo = spec.lotNo || `LOT-${input.receivedDate.toISOString().slice(0, 10)}-${randomUUID().slice(0, 8).toUpperCase()}`
    let need = spec.quantity
    let part = 0
    while (need > 0) {
      const tier = tiers[tierIdx]
      const take = Math.min(need, tier.qty)
      if (take > 0) {
        const [row] = await tx
          .insert(inventoryLots)
          .values({
            id: randomUUID(),
            tenantId: input.tenantId,
            itemId: input.itemId,
            lotNo: part === 0 ? baseLotNo : `${baseLotNo}-${String.fromCharCode(65 + part)}`,
            qtyOnHand: take,
            unitCostCents: tier.unitCostCents,
            expiryDate: spec.expiryDate ?? null,
            receivedDate: input.receivedDate,
            farmId: input.farmId,
          })
          .returning()
        lots.push(row)
        part++
      }
      tier.qty -= take
      need -= take
      if (tier.qty === 0) tierIdx++
    }
  }
  return lots
}

// `deferApproval`: a held line of a receipt does not raise its own approval;
// recordPurchaseReceipt raises one for the whole receipt group.
async function writePurchase(tx: Tx, input: Parameters<typeof recordPurchase>[0], opts: { deferApproval?: boolean } = {}): Promise<RecordPurchaseResult> {
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
    const transactionDate = input.transactionDate ?? receivedDate
    const postingDate = input.postingDate ?? receivedDate
    // The caller no longer gets to override this — POST /api/purchases now
    // computes it as quantity x unitCostCents and passes that in. Kept as a
    // parameter (rather than recomputed here) so the route stays the one place
    // that decides, and any future caller has to make the same decision
    // explicitly instead of inheriting a silent default.
    const totalCostCents = input.totalCostCents ?? input.quantity * input.unitCostCents

    const lotSpecs = input.lots && input.lots.length > 0
      ? input.lots
      : [{ quantity: input.quantity, expiryDate: input.expiryDate ?? null, lotNo: input.lotNo }]
    const lotQty = lotSpecs.reduce((sum, lot) => sum + lot.quantity, 0)
    if (lotQty !== input.quantity) {
      return { problem: 'Lot quantities must add up to the line quantity.' }
    }

    if (input.hold) {
      if (!input.recordedBy) return { problem: 'A document waiting for approval needs the person who recorded it.' }
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
          paymentReference: input.paymentReference ?? null,
          dueDate: input.dueDate ?? null,
          invoiceNumber: input.invoiceNumber ?? null,
          receivedDate,
          notes: input.notes ?? null,
          photoUrl: input.photoUrl ?? null,
          transactionDate,
          postingDate,
          supplierId: input.supplierId ?? null,
          recordedBy: input.recordedBy,
          taxCode: input.taxCode ?? null,
          taxInclusive: input.taxInclusive ?? null,
          grossCents: input.grossCents ?? null,
          taxCents: input.taxCents ?? null,
          netCents: input.netCents ?? null,
          receiptGroupId: input.receiptGroupId ?? null,
          rawUnitCostCents: input.rawUnitCostCents ?? null,
          approvalStatus: 'pending',
        })
        .returning()
      if (!opts.deferApproval) {
        await insertMoneyApproval(tx, {
          tenantId: input.tenantId,
          requestedBy: input.recordedBy,
          title: `Purchase ${input.itemName} waiting for approval`,
          details: {
            docType: 'purchase',
            documentId: purchase.id,
            amountCents: totalCostCents,
            dimensions: input.dimensions ?? null,
            lots: lotSpecs.map((spec) => ({
              quantity: spec.quantity,
              expiryDate: spec.expiryDate ? spec.expiryDate.toISOString() : null,
              lotNo: spec.lotNo ?? null,
            })),
          },
        })
      }
      return { item, lot: null, lots: [], purchase }
    }

    const lots = await insertPurchaseLots(tx, {
      tenantId: input.tenantId,
      itemId: item.id,
      farmId: input.farmId ?? null,
      receivedDate,
      specs: lotSpecs,
      valueCents: input.lotValueCents ?? input.quantity * input.unitCostCents,
    })
    const lot = lots[0]

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
        paymentReference: input.paymentReference ?? null,
        dueDate: input.dueDate ?? null,
        invoiceNumber: input.invoiceNumber ?? null,
        // Dual-write: `createdAt` above keeps doing the P&L-period job it
        // always has (same `receivedDate` value); this is the new, honestly
        // labelled column the list/detail actually show as "Received".
        receivedDate,
        notes: input.notes ?? null,
        photoUrl: input.photoUrl ?? null,
        transactionDate,
        postingDate,
        supplierId: input.supplierId ?? null,
        recordedBy: input.recordedBy ?? null,
        taxCode: input.taxCode ?? null,
        taxInclusive: input.taxInclusive ?? null,
        grossCents: input.grossCents ?? null,
        taxCents: input.taxCents ?? null,
        netCents: input.netCents ?? null,
        receiptGroupId: input.receiptGroupId ?? null,
        rawUnitCostCents: input.rawUnitCostCents ?? null,
      })
      .returning()

    // Issue #239 task 3: a purchase posts Dr Purchases Expense, Cr Cash
    // (amount paid) / Cr Accounts Payable (amount owed) — posted in the same
    // transaction as the purchase itself so a purchase can never exist
    // without its journal entry. See lib/finance.ts's postPurchaseJournal.
    await postPurchaseJournal(tx, purchase, { dimensions: input.dimensions })

    return { item, lot, lots, purchase }
  }
