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
// `status` (product-unit-inheritance task): 'ACTIVE' | 'ARCHIVED'. Same
// loose-text-validated-in-route convention as farms.status/employees.status.
// A product is archived rather than deleted once anything references it —
// see DELETE /api/products/[id] for the exact rule (a product with zero
// references — no sale, no product_units/batch_products row — is genuinely
// deleted; one with any reference is archived instead, mirroring the
// farms.status precedent: a hard DELETE would either fail against
// sales.productId or silently orphan a historical sale's product link).
export const products = pgTable('products', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  type: text('type').notNull(),
  name: text('name').notNull(),
  saleUnits: numeric('sale_units', { precision: 12, scale: 2 }).notNull().default('0'),
  // ── What selling this takes away (batch-ledger task) ─────────────────────
  // The farmer's own question: which products reduce stock, and which stock
  // do they reduce? Selling twenty birds takes twenty off the batch's
  // headcount; selling twenty trays of eggs takes nothing off it, because
  // the hens are still there. Nothing in the data said which kind a product
  // was, so a sale could not safely change any count at all.
  //
  //   'batch_quantity' — the thing sold IS the livestock/crop in the batch
  //                      (live birds, culls, a harvested field). Reduces
  //                      batches.currentQty.
  //   'produce'        — what the batch yields while it stays intact (eggs,
  //                      milk, honey). Reduces collected produce, not the
  //                      batch.
  //   'none'           — a service or by-product nothing tracks (manure,
  //                      transport).
  //
  // Default 'produce' because that is what most catalogue rows in practice
  // are, and because it is the option that never silently deletes livestock
  // from a batch if somebody leaves it unset.
  stockEffect: text('stock_effect').notNull().default('produce'),
  status: text('status').notNull().default('ACTIVE'),
  createdAt: timestamp('created_at').defaultNow(),
}, (t) => [
  index('idx_products_tenant').on(t.tenantId),
])

// ── product_units (product-unit-inheritance task) ──────────────────────────
// Many-to-many: which production units offer/produce a product. This is the
// "shared across units" half of the requirement — a product row is defined
// ONCE at tenant level (above) and a farmer attaches it to as many units as
// actually produce it (e.g. "Tray Eggs (30)" attached to both Layer Pen A and
// Layer Pen B) instead of re-entering the product per unit.
//
// `unitId` is a plain logical reference to production_units.id, not a DB FK
// — same "no import cycle with db/schemas/index.ts" convention already used
// by sales.batchId (finance.ts) and employees.assignedBatchIds (people.ts),
// since `productionUnits` is defined in index.ts, which itself re-exports
// this file. Validated against the caller's tenant in the route
// (PUT /api/units/[id]/products) instead.
//
// `productId` DOES get a real FK — products is defined in this same file, so
// there's no cycle to avoid.
export const productUnits = pgTable('product_units', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  productId: text('product_id').notNull().references(() => products.id),
  unitId: text('unit_id').notNull(),
  createdAt: timestamp('created_at').defaultNow(),
}, (t) => [
  index('idx_product_units_tenant').on(t.tenantId),
  index('idx_product_units_unit').on(t.unitId),
  // Enforces "a unit offers a given product at most once" at the DB level —
  // PUT /api/units/[id]/products relies on this for the concurrent-write
  // race, same shape as every other join-table unique index in this codebase.
  uniqueIndex('idx_product_units_product_unit').on(t.productId, t.unitId),
])

// ── batch_products — OVERRIDES ONLY (product-unit-inheritance task) ────────
// A batch does NOT get its own product list by default: it inherits every
// product attached to its unit via `product_units` above. This table holds
// ONLY the exceptions — the common case (a batch selling exactly what its
// unit offers, which is nearly every batch, nearly all the time) costs zero
// rows here and zero data entry from the farmer. That is the entire point of
// building inheritance instead of copying the unit's product list onto every
// batch at creation time: copying would need updating on every batch whenever
// the unit's catalogue changes, and would erase the distinction between "the
// farmer chose this" and "this just came from the unit."
//
// `mode` expresses the two ways a batch can differ from its unit:
//   'ADD'     — this product is offered on this batch even though its unit
//               does NOT offer it (e.g. a one-off cull sale on a single
//               batch that isn't part of that unit's normal catalogue).
//   'EXCLUDE' — this product IS offered by the batch's unit, but this
//               specific batch does not sell it (e.g. one Layer Pen batch is
//               kept for breeding stock only and never sells eggs, while its
//               sibling batches under the same unit do).
// There is deliberately no third "INCLUDE, matching the unit" mode — a
// product inherited unchanged is represented by the ABSENCE of a row here,
// not by a row that just confirms what the unit already says. A future
// reader who sees a batch with no batch_products rows at all should read
// that as "this batch's list is 100% inherited," not "nobody has configured
// this batch yet."
//
// One query resolves the full list for a batch — see
// lib/products.ts's `resolveBatchProducts` for the exact SQL: inherited
// candidates come from product_units joined through the batch's unitId,
// MINUS anything EXCLUDEd here, UNION the ADDed extras. The `inherited` flag
// and source unit name in that result are what let the UI say "inherited
// from Layer Pen A" instead of presenting an override as if the farmer had
// picked it.
//
// `batchId` is a plain logical reference (no DB FK), same reasoning as
// `unitId` on product_units above — batches is defined in index.ts.
export const batchProducts = pgTable('batch_products', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  batchId: text('batch_id').notNull(),
  productId: text('product_id').notNull().references(() => products.id),
  mode: text('mode').notNull(), // 'ADD' | 'EXCLUDE'
  createdAt: timestamp('created_at').defaultNow(),
}, (t) => [
  index('idx_batch_products_tenant').on(t.tenantId),
  index('idx_batch_products_batch').on(t.batchId),
  // A batch can override a given product at most once (either ADD or
  // EXCLUDE it, not both — the route enforces which, this index just
  // prevents two rows for the same product existing at all).
  uniqueIndex('idx_batch_products_batch_product').on(t.batchId, t.productId),
])

// A tenant's work items. `dueAt` null means "no due date" — excluded from any
// due-today query. `status` is a free-form string (PENDING / DONE /
// PENDING_APPROVAL / APPROVED / REJECTED / OVERDUE / CANCELLED at minimum —
// see app/api/tasks/[id]/route.ts for the completion->approval transition).
//
// `priority`, `requiresApproval`, `notes` land here from Epic: Tasks &
// Governance (issue #243) — extending this existing table in place per the
// issue's branch-correction note, not forking a second one. `priority`
// mirrors the UI's Task.priority ("high" | "medium" | "low" —
// components/farm/data.ts) as free text, same "loose text, validated in the
// route" choice this codebase already makes for users.role/status and
// onboardRequests.status. `requiresApproval` gates whether marking a task
// DONE routes through an approval_requests row instead of completing
// directly (see the v1 approval-scope decision in db/schemas/governance.ts).
export const tasks = pgTable('tasks', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  title: text('title').notNull(),
  dueAt: timestamp('due_at'),
  status: text('status').notNull().default('PENDING'),
  priority: text('priority').notNull().default('medium'),
  requiresApproval: boolean('requires_approval').notNull().default(false),
  notes: text('notes'),
  // Multi-farm filtering (farm-scoped-data task — the farm switcher used to
  // change a label and nothing else; this is what makes it real for tasks).
  // Plain logical reference to farms.id, no DB FK — same "no import cycle
  // with db/schemas/index.ts" convention approvalRequests.batchId already
  // uses in governance.ts; validated against the caller's tenant in the
  // route instead. Nullable: every pre-existing task was created before farm
  // scoping existed, so there is no correct value to invent for a NOT NULL
  // column — the migration backfills every existing row to the tenant's
  // earliest-created farm (by createdAt) rather than leaving it permanently
  // unfilterable/invisible once farm filters land in the UI.
  farmId: text('farm_id'),
  // ── Who does it, who signs it off (tasks-scheduling task) ────────────────
  // `assigneeId` is an employees.id: the person ordered to do the work. It is
  // the employee rather than the user because not every worker has a login
  // yet, and a task can be assigned to someone before their account exists.
  //
  // `approverId` is a users.id, and deliberately not an employee: approving
  // is an action taken while signed in, so the only useful identity is the
  // one a session resolves to. NULL means "anyone with governance edit
  // rights", which is the behaviour every existing row had before this
  // column, and is what keeps the queue from deadlocking on a task nobody
  // was named on.
  assigneeId: text('assignee_id'),
  approverId: text('approver_id'),
  // ── Recurrence ───────────────────────────────────────────────────────────
  // Stored on the task rather than in a separate schedule table: a recurring
  // chore here is "when this one is done, the next one is due in N days",
  // not a calendar subscription with exceptions and overrides. Each
  // occurrence is a real, independently completable row, and
  // `recurrenceParentId` points back at the one it was spawned from so a
  // chain can be traced (and stopped) without inventing a series entity.
  recurrence: text('recurrence').notNull().default('none'),
  recurrenceUntil: timestamp('recurrence_until'),
  recurrenceParentId: text('recurrence_parent_id'),
  createdAt: timestamp('created_at').defaultNow(),
}, (t) => [
  index('idx_tasks_tenant').on(t.tenantId),
  index('idx_tasks_tenant_due').on(t.tenantId, t.dueAt),
  index('idx_tasks_farm').on(t.farmId),
  // The worker app's "my tasks" and the approver's "waiting on me" queue are
  // both single-column lookups within a tenant.
  index('idx_tasks_assignee').on(t.tenantId, t.assigneeId),
  index('idx_tasks_approver').on(t.tenantId, t.approverId),
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
//   - `sourceType: 'password_reset'` — created by POST /api/auth/forgot-password.
//
// notification-recipient-scoping fix: every row used to be tenant-wide by
// construction (no recipient column at all), so any user in the tenant could
// read every other user's notifications — including a password-reset row
// that names another user and their email. `userId`/`role` below fix that;
// see their own comments for the exact visibility rule GET /api/notifications
// applies.
export const notifications = pgTable('notifications', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  sourceType: text('source_type').notNull(), // 'task' | 'alert' | 'approval' | 'password_reset'
  sourceId: text('source_id'),
  title: text('title').notNull(),
  message: text('message').notNull().default(''),
  // Recipient targeting (notification-recipient-scoping fix). Nullable
  // because a single row must be able to mean THREE different things:
  //   - userId set              -> exactly that user (e.g. a password-reset
  //     alert, which carries another user's name/email and must never be
  //     tenant-wide).
  //   - role set (userId null)  -> every user in the tenant with that role.
  //   - both null                -> a genuine tenant-wide broadcast. This is
  //     the pre-existing behaviour (every row created before this fix has
  //     both columns null), so leaving them null is what keeps old rows
  //     visible to everyone exactly as before, instead of silently orphaning
  //     them the moment recipient targeting shipped.
  // See GET /api/notifications for the exact visibility predicate this backs:
  //   userId = me OR role = my role OR (userId IS NULL AND role IS NULL)
  userId: text('user_id'),
  role: text('role'),
  // Legacy shared "read by anyone" flag. Kept only for backward-compatible
  // reads of old rows/tools (e.g. GET /api/dashboard/kpis's tenant-wide
  // unreadNotifications count, out of scope for this fix) — it must no
  // longer decide what any individual caller sees as read. Per-user state
  // lives in `notification_reads` now; GET /api/notifications computes each
  // row's `read` for the calling user from that table, and PATCH
  // .../[id] writes to it instead of this column.
  read: boolean('read').notNull().default(false),
  createdAt: timestamp('created_at').defaultNow(),
  // Email delivery marker (feat/email-notifications). Null until this row's
  // email(s) have been resolved and attempted — see
  // lib/notification-email.ts's notifyRecipientsByEmail, which does an
  // atomic `UPDATE ... WHERE emailed_at IS NULL RETURNING id` before ever
  // sending anything, so a notification is emailed at most once even if two
  // requests race to process the same row (e.g. two concurrent
  // syncTaskNotifications callers). Set regardless of how many recipients a
  // row resolves to (one user, a whole role, or a tenant-wide broadcast) —
  // this is "has this notification been processed for email", not a
  // per-recipient log.
  emailedAt: timestamp('emailed_at'),
}, (t) => [
  index('idx_notifications_tenant').on(t.tenantId),
  index('idx_notifications_tenant_read').on(t.tenantId, t.read),
  index('idx_notifications_user').on(t.userId),
  // Lets the GET sync step upsert idempotently (ON CONFLICT DO NOTHING) instead
  // of select-then-insert, so concurrent GETs can't double-create the same
  // task-derived notification. Deliberately NOT extended with userId/role:
  // this fix keeps ONE row per notification (never fans out a row per
  // recipient) specifically so this index — and the ON CONFLICT upsert in
  // syncTaskNotifications that depends on it — keeps working unchanged.
  // Adding userId here would also be wrong even if we wanted per-recipient
  // rows: Postgres treats every NULL as distinct, so a broadcast
  // (userId IS NULL) row would never conflict with another broadcast row for
  // the same source and silently stop deduplicating.
  uniqueIndex('idx_notifications_source').on(t.tenantId, t.sourceType, t.sourceId),
])

// Per-user read state (notification-recipient-scoping fix). A single shared
// `notifications.read` boolean cannot express "read by the owner, still
// unread for the manager" — one person marking a broadcast read hid it for
// the whole tenant. One row per (notification, user) that has actually
// marked it read; absence of a row means unread for that user. The unique
// constraint is what makes PATCH's mark-read upsert idempotent (ON CONFLICT
// DO NOTHING / DO UPDATE) — marking the same notification read twice must
// not error.
export const notificationReads = pgTable('notification_reads', {
  id: text('id').primaryKey(),
  notificationId: text('notification_id').notNull(),
  userId: text('user_id').notNull(),
  readAt: timestamp('read_at').defaultNow(),
}, (t) => [
  index('idx_notification_reads_notification').on(t.notificationId),
  index('idx_notification_reads_user').on(t.userId),
  uniqueIndex('idx_notification_reads_unique').on(t.notificationId, t.userId),
])
