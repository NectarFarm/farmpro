// People & Worker Portal backend (issue #247). Fresh build: no `employees`
// table, `records` table, or `/api/employees|records/*` route existed
// anywhere on this branch before this issue (the issue's own
// branch-correction note confirms it — checked `db/schemas/*.ts` and grepped
// the repo). Field lists mirror the issue's exact spec, cross-checked against
// the UI's mock contract — `EMPLOYEES_DATA` in components/farm/data.ts and
// how components/farm/people.tsx / components/farm/worker.tsx actually read
// it (name, phone, role, salary/payday stay UI-local for now — payroll is a
// separate, not-yet-built epic; this table only carries the fields the
// issue's task list actually asks for).
import { pgTable, text, timestamp, integer, bigint, boolean, jsonb, index } from 'drizzle-orm/pg-core'

// A tenant's employees — distinct from `users` (auth accounts): an employee
// may or may not have a login. `userId` is a nullable logical link to the
//
// `monthlySalaryCents` (payroll v1): the employee's pay basis. Chosen shape
// is a flat MONTHLY SALARY, not a daily/hourly wage, for one concrete reason
// — this app has no attendance/timesheet table anywhere (grepped
// db/schemas/*.ts), so a wage that depends on days-worked or hours-worked
// has no real data source to compute it from; inventing one (e.g. assuming
// every calendar day in the period counts) would be indistinguishable from
// making up the number. A flat rate per pay period needs no such input: a
// payroll run pays every active employee with a rate set their full
// `monthlySalaryCents` for the period, no pro-rating. That IS a real
// limitation — a worker who joined or left mid-period, or took unpaid leave,
// still gets a full month — noted as a follow-up once attendance tracking
// exists, not silently guessed at here. Defaults to 0 ("no pay rate set
// yet"); POST /api/payroll/runs only pays employees with a rate > 0, so an
// employee with no rate configured is simply excluded from a run rather than
// paid 0 (which would create a zero-amount payslip with no meaning).

// `users` row a worker signs in with (no DB FK, same "logical reference"
// choice `users.tenantId` already makes — an employee can be created before
// any login is provisioned for them). This is the field the issue's task 3
// asks to "document which" — GET /api/employees/me resolves the caller's
// employees row by `userId` (matched against the session user's id), not by
// phone: even though `users.phone` exists now (added for the admin
// user-management feature's forgot-password flow — db/schemas/auth.ts),
// phone-matching would still require format-normalizing two independently
// -entered free-text fields with no guarantee of a match, while `userId` is
// an exact id equality once set.
//
// `assignedBatchIds` references real `batches.id` rows (issue depends on
// #231, merged) — validated against the caller's tenant in the route (same
// pattern POST /api/batches uses for `unitId`), but kept as plain text[]
// here with no DB FK: same "plain logical reference, no import cycle with
// db/schemas/index.ts" convention `approvalRequests.batchId` already uses in
// governance.ts (an array column can't carry a `.references()` FK anyway).
// No "ALL" sentinel: that was a UI-mock-only shortcut (EMPLOYEES_DATA's
// `batches: ["ALL"]`); a from-scratch backend only stores real ids the route
// has actually checked.
export const employees = pgTable('employees', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  userId: text('user_id'),
  name: text('name').notNull(),
  phone: text('phone').notNull().default(''),
  role: text('role').notNull().default('worker'),
  monthlySalaryCents: bigint('monthly_salary_cents', { mode: 'number' }).notNull().default(0),
  assignedBatchIds: text('assigned_batch_ids').array().notNull().default([]),
  // Deaths-per-record threshold at/above which the worker app requires a
  // photo before a mortality record can be submitted (see
  // components/farm/worker.tsx's MortalityForm `needsPhoto = count >= 3`
  // client-side check — this column is the server-side source of truth GET
  // /api/employees/me hands back so that "3" isn't hardcoded per client).
  mortalityPhotoThreshold: integer('mortality_photo_threshold').notNull().default(3),
  status: text('status').notNull().default('ACTIVE'),
  // Multi-farm filtering (farm-scoped-data task) — the employee's home farm,
  // distinct from `assignedBatchIds` (which batches they work, not which
  // farm they're based at). Plain logical reference to farms.id, no DB FK —
  // same convention `assignedBatchIds`/`userId` already use in this table;
  // validated against the caller's tenant in the route. Nullable:
  // pre-existing employees predate farm scoping — backfilled to the
  // tenant's earliest-created farm by the migration.
  farmId: text('farm_id'),
  createdAt: timestamp('created_at').defaultNow(),
}, (t) => [
  index('idx_employees_tenant').on(t.tenantId),
  index('idx_employees_tenant_user').on(t.tenantId, t.userId),
  index('idx_employees_farm').on(t.farmId),
])

// Generic worker-submission log: feeding / mortality / physical_count today,
// shaped so a future record type doesn't need a new table (see WorkerRecordScreen's
// GROUPS in components/farm/worker.tsx — "morning round", "collect products",
// "health", "weight sample", "closing stock" are the same shape, just a
// different `type` and `data` payload — left for a follow-up issue rather
// than pre-building unused record types here).
//
// `data` is jsonb — the per-type payload (e.g. feeding: { feedItems: [...] },
// mortality: { count, cause, unitId }, physical_count: { batchId, count,
// varianceReason }) — deliberately loose, same "loose text/jsonb validated in
// the route, not a fixed column-per-field schema" choice `governance.ts`'s
// `audit_log.meta` already makes for this kind of heterogeneous-by-type log.
// `photoUrl` is nullable: only mortality records above an employee's
// `mortalityPhotoThreshold` are expected to carry one, and this table does
// not enforce that itself (see app/api/records/route.ts's POST handler
// comment for why that check stays client-side for now).
export const records = pgTable('records', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  // Plain logical reference (no DB FK) — same "no import cycle with
  // db/schemas/index.ts" convention `approvalRequests.batchId` uses in
  // governance.ts. Validated against the caller's tenant in the route.
  batchId: text('batch_id').notNull(),
  employeeId: text('employee_id').notNull().references(() => employees.id),
  type: text('type').notNull(),
  data: jsonb('data').$type<Record<string, unknown>>().notNull().default({}),
  photoUrl: text('photo_url'),
  createdAt: timestamp('created_at').defaultNow(),
}, (t) => [
  index('idx_records_tenant').on(t.tenantId),
  index('idx_records_tenant_batch').on(t.tenantId, t.batchId),
  index('idx_records_tenant_type').on(t.tenantId, t.type),
  index('idx_records_employee').on(t.employeeId),
])

// ── Routines: what a "morning round" actually is (worker-routines task) ─────
// The worker portal offered "Morning Round" as a greyed-out tile because
// nothing anywhere said what a morning round consists of. It differs per farm
// and per enterprise — one farm's morning round is feed, water check, egg
// collection and a mortality sweep; another's is milking and a temperature
// reading — so it cannot be a fixed list in the code, which is exactly what
// components/farm/data.ts's ENTERPRISE_REGISTRY tried to be and why it stayed
// unwired.
//
// The owner defines it instead. A routine is a named, ordered set of steps;
// the worker's portal shows the routine and walks them through it; each step
// that produces data files the same `records` row it would have filed on its
// own. Nothing here duplicates record storage — a routine is the CHECKLIST,
// not a second copy of what was recorded.
export const routines = pgTable('routines', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  // Nullable: a routine can be tenant-wide (every farm does the same morning
  // round) or specific to one farm. Same nullable-farm convention as
  // tasks.farmId.
  farmId: text('farm_id'),
  name: text('name').notNull(),
  // 'morning' | 'midday' | 'evening' | 'weekly' | 'any' — a hint for when it
  // is meant to happen, used to group the worker's tiles. Not a schedule:
  // nothing fires from it, and pretending otherwise would create a reminder
  // system that never reminds anyone.
  timeOfDay: text('time_of_day').notNull().default('any'),
  active: boolean('active').notNull().default(true),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('idx_routines_tenant').on(t.tenantId),
  index('idx_routines_farm').on(t.farmId),
])

// One step of a routine. `kind` decides which form the worker gets and, for
// the ones that produce data, which `records.type` it writes:
//
//   feeding | mortality | physical_count | production | health | weight
//     — real record types, each with its own form and permission module.
//   check
//     — an observation with no numbers: "water lines clear?", "lights off?".
//       Files a record too, because "the worker confirmed it" is exactly the
//       thing an owner wants to be able to look up later.
export const routineSteps = pgTable('routine_steps', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  routineId: text('routine_id').notNull().references(() => routines.id, { onDelete: 'cascade' }),
  kind: text('kind').notNull(),
  label: text('label').notNull(),
  // A step the worker cannot skip. Optional steps exist because half a round
  // recorded is still worth having, and forcing every step turns a checklist
  // into something people work around.
  required: boolean('required').notNull().default(true),
  sortOrder: integer('sort_order').notNull().default(0),
}, (t) => [
  index('idx_routine_steps_routine').on(t.routineId),
  index('idx_routine_steps_tenant').on(t.tenantId),
])

// One worker doing one routine on one batch, once. Kept separate from the
// records each step filed so an owner can ask "was the morning round done
// today?" — a question the records alone cannot answer, because a round with
// nothing to report produces no records at all.
export const routineRuns = pgTable('routine_runs', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  routineId: text('routine_id').notNull(),
  batchId: text('batch_id').notNull(),
  employeeId: text('employee_id').notNull(),
  // Which steps were actually completed, and any note left on each.
  completedSteps: jsonb('completed_steps').$type<Record<string, unknown>>().notNull().default({}),
  skippedCount: integer('skipped_count').notNull().default(0),
  completedAt: timestamp('completed_at').defaultNow().notNull(),
}, (t) => [
  index('idx_routine_runs_tenant').on(t.tenantId),
  index('idx_routine_runs_batch').on(t.tenantId, t.batchId),
  index('idx_routine_runs_routine').on(t.routineId),
])

// ── What the batch produced (worker-routines task) ─────────────────────────
// "Collect Products" was the other greyed-out tile. Eggs and milk leave the
// batch every day and nothing recorded them, so a layer batch's whole reason
// for existing was invisible: production charts had no source, and
// products.stockEffect = 'produce' had nothing to reduce when the produce was
// sold.
//
// Deliberately not folded into `records`: a collection is a quantity of a
// specific product that can later be SOLD, so it needs to be queryable as a
// balance (collected minus sold), not just as an activity-feed entry. The
// matching `records` row is still written for the worker's own history, and
// `recordId` ties the two together.
export const productCollections = pgTable('product_collections', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  batchId: text('batch_id').notNull(),
  productId: text('product_id').notNull(),
  employeeId: text('employee_id'),
  recordId: text('record_id'),
  qty: integer('qty').notNull(),
  collectedAt: timestamp('collected_at').defaultNow().notNull(),
}, (t) => [
  index('idx_product_collections_tenant').on(t.tenantId),
  index('idx_product_collections_batch').on(t.tenantId, t.batchId),
  index('idx_product_collections_product').on(t.tenantId, t.productId),
])
