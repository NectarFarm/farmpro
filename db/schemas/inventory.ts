// IFMS Inventory backend (issue #235). Fresh build: no `inventory_items`,
// `inventory_lots`, `purchases`, or `physical-counts` table existed anywhere
// on this branch before this issue (the issue's own branch-correction note
// confirms it — checked `db/schemas/*.ts` and grepped the repo). Field lists
// are not invented: they mirror the issue's exact spec, cross-checked against
// the UI's mock contract in components/farm/inventory.tsx (`STOCK_ITEMS`,
// `PURCHASES`) and components/farm/data.ts.
//
// Reuses the real `audit_log` table from db/schemas/governance.ts (issue
// #243, merged) for quantity-adjust history — no second audit mechanism is
// built here (see app/api/inventory/lots/[id]/route.ts).
//
// ── Why items and lots are separate tables ──────────────────────────────────
// The UI's flat `STOCK_ITEMS` mock rows conflate "item" (name/category/unit/
// reorder point) with "lot" (a specific batch of stock: quantity on hand,
// unit cost, expiry, lot number, when received) into one row per lot. A real
// backend needs the split — the same item (e.g. "Broiler Starter Mash") can
// have multiple lots in stock at once with different costs/expiries/receipt
// dates, and a purchase should add a lot without duplicating the item. The
// merged stock-list endpoint (GET /api/inventory/items) re-flattens
// items+lots server-side for the UI's table shape — see that route for the
// join and the `status` computation.
import { pgTable, text, timestamp, integer, bigint, index } from 'drizzle-orm/pg-core'

// A tenant's catalog of inventory items (feed, vaccines, medicine, seed,
// etc — `category` is free text, matching the UI's cat filter chips, not an
// enum, since the reference system doesn't fix a closed list either).
// `lowStockThreshold` is the reorder point the merged stock-list endpoint
// compares summed lot quantity against to compute `status: 'low'`.
//
// No DB-level unique index on (tenantId, name): POST /api/purchases does a
// case-insensitive lookup-then-create (see lib/inventory.ts's
// findOrCreateItem) inside a transaction, same "SELECT generates the common
// case, the real concurrent-insert race is accepted as a rare duplicate
// rather than guarded by a unique index" tradeoff other tenant-scoped catalog
// tables on this branch make when the field being deduped (a free-text name)
// isn't a hard identifier like a farm/batch code.
export const inventoryItems = pgTable('inventory_items', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  name: text('name').notNull(),
  category: text('category').notNull().default(''),
  unit: text('unit').notNull(),
  lowStockThreshold: integer('low_stock_threshold').notNull().default(0),
  createdAt: timestamp('created_at').defaultNow(),
}, (t) => [
  index('idx_inventory_items_tenant').on(t.tenantId),
])

// A physical lot of an item: a specific quantity received on a specific date
// at a specific cost, optionally with an expiry. `itemId` is a real FK into
// `inventory_items`. `qtyOnHand` is the mutable field — POST /api/purchases
// sets it at receipt, PATCH /api/inventory/lots/[id] is the only other way it
// changes (reason-required, audited — see that route).
export const inventoryLots = pgTable('inventory_lots', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  itemId: text('item_id').notNull().references(() => inventoryItems.id),
  lotNo: text('lot_no').notNull(),
  qtyOnHand: integer('qty_on_hand').notNull().default(0),
  // Widened to bigint (issue: money-unit-enforcement) — see the comment on
  // batches.acquisitionCostCents in db/schemas/index.ts for why.
  unitCostCents: bigint('unit_cost_cents', { mode: 'number' }).notNull().default(0),
  expiryDate: timestamp('expiry_date'),
  receivedDate: timestamp('received_date').defaultNow().notNull(),
  // Multi-farm filtering (farm-scoped-data task): the farm belongs on the
  // physical LOT, not the catalog item — `inventoryItems` is a tenant-wide
  // catalogue (the same "Broiler Starter Mash" item can have lots sitting at
  // different farms), while a lot is a specific quantity received at a
  // specific place. Plain logical reference to farms.id, no DB FK — same
  // "no import cycle with db/schemas/index.ts" convention this file already
  // avoids by not importing productionUnits/batches either; validated
  // against the caller's tenant in the route. Nullable: pre-existing lots
  // predate farm scoping — the migration backfills them to the tenant's
  // earliest-created farm rather than leaving them permanently unfilterable.
  farmId: text('farm_id'),
}, (t) => [
  index('idx_inventory_lots_tenant').on(t.tenantId),
  index('idx_inventory_lots_tenant_item').on(t.tenantId, t.itemId),
  index('idx_inventory_lots_farm').on(t.farmId),
])

// A purchase: the record of stock coming in. Creating one upserts the item
// (by tenant+name) and always inserts a new lot (see POST /api/purchases) —
// this table is also the sole source for GET
// /api/inventory/items/[id]/usage-history (issue task 6: "derive from
// purchases ... a real query, not a new table").
//
// `amountPaidCents` is tracked separately from `totalCostCents` because the
// UI's PURCHASES mock already distinguishes "delivered" from "pending"
// purchases — a purchase can be recorded before it's fully paid for.
export const purchases = pgTable('purchases', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  supplier: text('supplier').notNull(),
  itemId: text('item_id').notNull().references(() => inventoryItems.id),
  quantity: integer('quantity').notNull(),
  // Widened to bigint (issue: money-unit-enforcement) — see the comment on
  // batches.acquisitionCostCents in db/schemas/index.ts for why.
  unitCostCents: bigint('unit_cost_cents', { mode: 'number' }).notNull().default(0),
  totalCostCents: bigint('total_cost_cents', { mode: 'number' }).notNull().default(0),
  paymentMethod: text('payment_method').notNull().default(''),
  amountPaidCents: bigint('amount_paid_cents', { mode: 'number' }).notNull().default(0),
  // Multi-farm filtering (farm-scoped-data task) — a purchase is a receiving
  // event for a specific farm's stock, same rationale as inventoryLots.farmId
  // above (and recordPurchase sets both to the same value: a purchase and
  // the lot it creates always belong to the same farm). Plain logical
  // reference, no DB FK, same convention as the rest of this file. Nullable:
  // pre-existing purchases predate farm scoping — backfilled to the tenant's
  // earliest-created farm by the migration.
  farmId: text('farm_id'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('idx_purchases_tenant').on(t.tenantId),
  index('idx_purchases_tenant_item').on(t.tenantId, t.itemId),
  index('idx_purchases_farm').on(t.farmId),
])

// ── Stock actually used (feed-from-stock task) ─────────────────────────────
// The missing side of the ledger. `inventoryLots` recorded stock coming IN
// (a purchase sets qtyOnHand) and could be corrected by hand, but nothing
// recorded stock going OUT: a worker typed the feed's name as free text into
// a record's `data` blob, and the quantity on hand never moved. Two things
// followed from that, and both were visible in the app:
//   - "remaining quantity" was fiction. Stock only ever fell when someone
//     remembered to adjust a lot manually.
//   - GET /api/batches/[id]/cost-breakdown returned feed = 0, tracked:false,
//     because there genuinely was no consumption data to cost.
//
// One row per (lot, batch) allocation, not per feeding event: a single
// issue of 80kg can span two lots, and the cost differs per lot, so
// collapsing them would lose the only figure that makes per-batch feed cost
// real. `unitCostCents` is copied from the lot at the time it was taken —
// the same snapshot reasoning payslips use, so re-pricing a later purchase
// can't retroactively change what a past feeding cost.
export const inventoryConsumption = pgTable('inventory_consumption', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  itemId: text('item_id').notNull().references(() => inventoryItems.id),
  lotId: text('lot_id').notNull().references(() => inventoryLots.id),
  // Which batch ate it. Plain logical reference, no DB FK — same convention
  // as records.batchId in db/schemas/people.ts.
  batchId: text('batch_id').notNull(),
  // The submission this came from, so a record and the stock it moved can be
  // traced to each other in both directions.
  recordId: text('record_id'),
  employeeId: text('employee_id'),
  qty: integer('qty').notNull(),
  unitCostCents: bigint('unit_cost_cents', { mode: 'number' }).notNull().default(0),
  totalCostCents: bigint('total_cost_cents', { mode: 'number' }).notNull().default(0),
  // Denormalised from the lot it was taken from: consumption is reported per
  // farm and the lot's own farm is the only correct answer, but joining back
  // through the lot on every report is a needless hop for a value that can
  // never change after the fact.
  farmId: text('farm_id'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('idx_inventory_consumption_tenant').on(t.tenantId),
  index('idx_inventory_consumption_batch').on(t.tenantId, t.batchId),
  index('idx_inventory_consumption_item').on(t.tenantId, t.itemId),
  index('idx_inventory_consumption_record').on(t.recordId),
])
