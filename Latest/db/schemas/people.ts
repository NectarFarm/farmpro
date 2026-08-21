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
import { pgTable, text, timestamp, integer, jsonb, index } from 'drizzle-orm/pg-core'

// A tenant's employees — distinct from `users` (auth accounts): an employee
// may or may not have a login. `userId` is a nullable logical link to the
// `users` row a worker signs in with (no DB FK, same "logical reference"
// choice `users.tenantId` already makes — an employee can be created before
// any login is provisioned for them). This is the field the issue's task 3
// asks to "document which" — GET /api/employees/me resolves the caller's
// employees row by `userId` (matched against the session user's id), not by
// phone: `users` has no phone column on this branch, so phone-matching would
// require format-normalizing two independently-entered free-text fields with
// no guarantee of a match, while `userId` is an exact id equality once set.
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
  assignedBatchIds: text('assigned_batch_ids').array().notNull().default([]),
  // Deaths-per-record threshold at/above which the worker app requires a
  // photo before a mortality record can be submitted (see
  // components/farm/worker.tsx's MortalityForm `needsPhoto = count >= 3`
  // client-side check — this column is the server-side source of truth GET
  // /api/employees/me hands back so that "3" isn't hardcoded per client).
  mortalityPhotoThreshold: integer('mortality_photo_threshold').notNull().default(3),
  status: text('status').notNull().default('ACTIVE'),
  createdAt: timestamp('created_at').defaultNow(),
}, (t) => [
  index('idx_employees_tenant').on(t.tenantId),
  index('idx_employees_tenant_user').on(t.tenantId, t.userId),
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
