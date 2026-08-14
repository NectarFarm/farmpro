// IFMS dashboard-backend schema (issue #227). Minimal tables this issue's
// endpoints need to exist against: `products` (price strip), `tasks`
// (due-today strip), `notifications` (bell/feed). None of these tables existed
// yet on this branch — checked `db/schemas/*.ts`, issue #243 (Tasks &
// Governance: build /api/tasks) and issue #231/#232 (Crops: batches/products)
// are both still open, so this is not a duplicate of in-flight work.
//
// These are intentionally minimal, scoped to exactly what #227's endpoints
// read/write. Fuller shapes are expected to land from their owning epics:
//   - `products` gets real catalogue fields (SKUs, units-of-measure,
//     isMainProduct/isCostDriver — see issue #21) from Epic: Crops & Batches
//     (#230 / #231 / #232).
//   - `tasks` gets assignment/recurrence/approvals fields from Epic:
//     Tasks & Governance (#242 / #243).
// Extend these tables in place when that work lands rather than forking a
// second table.
import { pgTable, text, timestamp, numeric, boolean, index, uniqueIndex } from 'drizzle-orm/pg-core'

// A tenant's sellable product types. `saleUnits` is the reference system's
// field name for "current sale price per unit" (issue #227 task 1: "returning
// current sale price per product type, reading products.saleUnits") — kept
// under that name here so the contract this endpoint exposes matches what the
// dashboard's price strip already expects, even though the column is a flat
// price rather than a computed sale-units breakdown.
export const products = pgTable('products', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  type: text('type').notNull(),
  name: text('name').notNull(),
  saleUnits: numeric('sale_units', { precision: 12, scale: 2 }).notNull().default('0'),
  createdAt: timestamp('created_at').defaultNow(),
}, (t) => [
  index('idx_products_tenant').on(t.tenantId),
])

// A tenant's work items. `dueAt` null means "no due date" — excluded from any
// due-today query. `status` is a free-form string for now (PENDING / DONE /
// CANCELLED at minimum); the fuller lifecycle/approvals state machine belongs
// to Epic: Tasks & Governance (#243).
export const tasks = pgTable('tasks', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  title: text('title').notNull(),
  dueAt: timestamp('due_at'),
  status: text('status').notNull().default('PENDING'),
  createdAt: timestamp('created_at').defaultNow(),
}, (t) => [
  index('idx_tasks_tenant').on(t.tenantId),
  index('idx_tasks_tenant_due').on(t.tenantId, t.dueAt),
])

// Dashboard notification feed (issue #227 task 3). This table is the source
// of truth for GET /api/notifications + PATCH .../[id] (mark read). Rows are
// aggregated from other tables rather than hand-authored:
//   - `sourceType: 'task'` — synced lazily on GET from `tasks` that are
//     overdue or due today for the tenant (see app/api/notifications/route.ts).
//   - `sourceType: 'alert'` — TODO: no `alerts` table exists anywhere on this
//     branch yet (checked db/schemas/*.ts and grepped the whole repo). Building
//     a full alerts subsystem is out of scope for this issue; wire this source
//     in once an `alerts` table lands (tracked nowhere yet — flagged in the PR).
//   - `sourceType: 'approval'` — TODO: blocked on Epic: Tasks & Governance's
//     approvals table (issue #243), per the issue's own instruction not to
//     block this work on it.
export const notifications = pgTable('notifications', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  sourceType: text('source_type').notNull(), // 'task' | 'alert' | 'approval'
  sourceId: text('source_id'),
  title: text('title').notNull(),
  message: text('message').notNull().default(''),
  read: boolean('read').notNull().default(false),
  createdAt: timestamp('created_at').defaultNow(),
}, (t) => [
  index('idx_notifications_tenant').on(t.tenantId),
  index('idx_notifications_tenant_read').on(t.tenantId, t.read),
  // Lets the GET sync step upsert idempotently (ON CONFLICT DO NOTHING) instead
  // of select-then-insert, so concurrent GETs can't double-create the same
  // task-derived notification.
  uniqueIndex('idx_notifications_source').on(t.tenantId, t.sourceType, t.sourceId),
])
