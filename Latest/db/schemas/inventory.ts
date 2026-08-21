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
import { pgTable, text, timestamp, integer, index } from 'drizzle-orm/pg-core'

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
  unitCostCents: integer('unit_cost_cents').notNull().default(0),
  expiryDate: timestamp('expiry_date'),
  receivedDate: timestamp('received_date').defaultNow().notNull(),
}, (t) => [
  index('idx_inventory_lots_tenant').on(t.tenantId),
  index('idx_inventory_lots_tenant_item').on(t.tenantId, t.itemId),
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
  unitCostCents: integer('unit_cost_cents').notNull().default(0),
  totalCostCents: integer('total_cost_cents').notNull().default(0),
  paymentMethod: text('payment_method').notNull().default(''),
  amountPaidCents: integer('amount_paid_cents').notNull().default(0),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('idx_purchases_tenant').on(t.tenantId),
  index('idx_purchases_tenant_item').on(t.tenantId, t.itemId),
])
