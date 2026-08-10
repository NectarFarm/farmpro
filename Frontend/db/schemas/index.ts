// IFMS Drizzle schema — SRS v1.0 §4. Every tenant-owned row carries tenant_id.
// Money is doublePrecision for the demo; production should use integer minor units.
import {
  bigint, boolean, doublePrecision, index, integer, jsonb, pgTable, text, timestamp, unique,
} from 'drizzle-orm/pg-core';
import type { FieldConfig } from '@/lib/types';
import { ALL_FEATURE_KEYS } from '@/lib/features';

export const tenants = pgTable('tenants', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  plan: text('plan').notNull().default('pro'),
  features: jsonb('features').$type<string[]>().notNull().default(ALL_FEATURE_KEYS),
  active: boolean('active').notNull().default(true), // super-admin can suspend on non-renewal
  testingEnabled: boolean('testing_enabled').notNull().default(false), // admin opens UAT for this farm
  testMaxScreenshots: integer('test_max_screenshots').notNull().default(0), // 0 = screenshots off
  createdAt: timestamp('created_at').defaultNow(),
});

// Guided front-end acceptance test (UAT). One current run per tenant; admin can
// reset it ("request a test again") and reads the report once it's submitted.
export const testRuns = pgTable('test_runs', {
  tenantId: text('tenant_id').primaryKey(),
  status: text('status').notNull().default('in_progress'), // in_progress | submitted
  steps: jsonb('steps').$type<import('@/lib/testing').TestStep[]>().notNull().default([]),
  startedAt: text('started_at').notNull(),
  submittedAt: text('submitted_at'),
});

// Screenshots a tester attaches to a failed step. Stored in R2 when configured,
// falling back to base64 data URLs in Postgres.
export const testPhotos = pgTable('test_photos', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  stepId: text('step_id').notNull(),
  data: text('data'), // data:image/jpeg;base64,… (legacy — nullable once migrated)
  storageKey: text('storage_key'), // e.g. "tenant_id/test/uuid.png"
  mime: text('mime'),
  createdAt: text('created_at').notNull(),
});

// Single-row global platform branding/config, editable by the super-admin.
export const platformSettings = pgTable('platform_settings', {
  id: text('id').primaryKey(), // always 'global'
  appName: text('app_name').notNull().default('IFMS'),
  tagline: text('tagline').notNull().default('Integrated Farm Management System'),
  logoUrl: text('logo_url'), // data URL or external URL; null → 🌾 emoji fallback
  // Admin-editable acceptance-test checklist (null → the built-in TEST_STEPS).
  testSteps: jsonb('test_steps').$type<import('@/lib/testing').TestStepDef[]>(),
  // Admin-editable subscription packages (null → DEFAULT_PACKAGES = free/standard/pro).
  packages: jsonb('packages').$type<import('@/lib/packages').Package[]>(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const users = pgTable('users', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  name: text('name').notNull(),
  // Globally unique (not per-tenant) — login is looked up by phone/email alone,
  // before the tenant is known (see app/api/auth/*), matching how the app already
  // queries this table. The DB constraint backs what the app-level duplicate check
  // in app/api/data/[resource]/route.ts was only racily enforcing before.
  phone: text('phone').notNull().unique(),
  email: text('email').unique(),
  role: text('role').notNull(),
  workerProfileId: text('worker_profile_id'),
  language: text('language').notNull().default('en'),
  passwordHash: text('password_hash'), // owner/manager/vet/auditor
  pinHash: text('pin_hash'),           // worker
}, (t) => [
  index('idx_users_tenant_role').on(t.tenantId, t.role),
]);

export const workerProfiles = pgTable('worker_profiles', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  name: text('name').notNull(),
  description: text('description'),
  fields: jsonb('fields').$type<FieldConfig[]>().notNull().default([]),
  modules: jsonb('modules').$type<string[]>().notNull().default([]),
  mortalityPhotoThreshold: integer('mortality_photo_threshold').notNull().default(1),
  alertThresholds: jsonb('alert_thresholds').$type<Record<string, number>>().notNull().default({}),
});

export const employees = pgTable('employees', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  name: text('name').notNull(),
  phone: text('phone').notNull(),
  role: text('role').notNull(),
  workerProfileId: text('worker_profile_id'),
  pinSet: boolean('pin_set').notNull().default(false),
  active: boolean('active').notNull().default(true),
  salary: doublePrecision('salary').notNull().default(0), // monthly wage (KSh); 0 = unpaid/unset
  salaryCents: bigint('salary_cents', { mode: 'number' }).notNull().default(0),
  payDay: integer('pay_day'),                             // day of month (1–31) wages are due
  paymentsFrom: text('payments_from'),                    // 'YYYY-MM' payroll begins (null = first run)
  // Batches this worker is assigned to. NULL = all (current & future) active batches
  // — the default. [] = none. [ids] = exactly those. Drives salary allocation.
  assignedBatchIds: jsonb('assigned_batch_ids').$type<string[]>(),
}, (t) => [
  index('idx_employees_tenant_active').on(t.tenantId, t.active),
]);

// One payslip per employee per month. `gross` is SNAPSHOT at run time, so editing
// an employee's salary never rewrites a past payslip. Once status='paid' it's locked.
export const payslips = pgTable('payslips', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  employeeId: text('employee_id').notNull(),
  period: text('period').notNull(), // 'YYYY-MM'
  gross: doublePrecision('gross').notNull(),
  grossCents: bigint('gross_cents', { mode: 'number' }).notNull().default(0),
  advances: doublePrecision('advances').notNull().default(0),
  advancesCents: bigint('advances_cents', { mode: 'number' }).notNull().default(0),
  fines: doublePrecision('fines').notNull().default(0),
  finesCents: bigint('fines_cents', { mode: 'number' }).notNull().default(0),
  bonuses: doublePrecision('bonuses').notNull().default(0),
  bonusesCents: bigint('bonuses_cents', { mode: 'number' }).notNull().default(0),
  net: doublePrecision('net').notNull(),
  netCents: bigint('net_cents', { mode: 'number' }).notNull().default(0),
  status: text('status').notNull().default('pending'), // pending | paid
  paidAt: text('paid_at'),
  createdAt: text('created_at').notNull(),
}, (t) => [
  // One payslip per employee per period — blocks the double-INSERT race on
  // concurrent `action:'run'` requests (see app/api/payroll/route.ts).
  unique('payslips_tenant_employee_period_unique').on(t.tenantId, t.employeeId, t.period),
  index('idx_payslips_tenant_period').on(t.tenantId, t.period),
]);

// Advances, fines (fines are also farm income), bonuses & adjustments per employee,
// applied to a given month's payslip.
export const employeeLedger = pgTable('employee_ledger', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  employeeId: text('employee_id').notNull(),
  type: text('type').notNull(), // advance | fine | bonus | adjustment
  amount: doublePrecision('amount').notNull(),
  amountCents: bigint('amount_cents', { mode: 'number' }).notNull().default(0),
  note: text('note'),
  period: text('period').notNull(), // 'YYYY-MM' it applies to
  date: text('date').notNull(),
  createdAt: text('created_at').notNull(),
  // Optional client-generated idempotency key (a retry or double-click resolves to
  // one insert). Nullable — older clients may not send one, in which case we fall
  // back to a plain insert with a server-generated id.
  clientUuid: text('client_uuid').unique(),
}, (t) => [
  index('idx_employee_ledger_tenant_emp').on(t.tenantId, t.employeeId),
]);

export const productionUnits = pgTable('production_units', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  farmId: text('farm_id').notNull(),
  zoneId: text('zone_id'),
  type: text('type').notNull(),
  name: text('name').notNull(),
  code: text('code').notNull(),
  capacity: integer('capacity').notNull().default(0),
  status: text('status').notNull().default('ACTIVE'),
  currentQty: integer('current_qty').default(0),
  species: text('species'),
});

export const batches = pgTable('batches', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  unitId: text('unit_id').notNull(),
  name: text('name').notNull(),
  species: text('species').notNull(),
  // Canonical enterprise key ('layers', 'broilers', 'tilapia', ...) set directly
  // from the batch-creation picker, or (setup wizard) guessed once at creation
  // time from the free-text species via enterpriseFromSpecies() and persisted.
  // The source of truth for costing/lifecycle/alert-engine enterprise lookups —
  // see resolveEnterprise() in lib/server/productTemplates.ts. Nullable: older
  // batches predating this column, and any species text that matches no known
  // enterprise, still fall back to re-running enterpriseFromSpecies(species)
  // at read time via resolveEnterprise().
  enterprise: text('enterprise'),
  breed: text('breed'),
  source: text('source').notNull(),
  acquiredDate: text('acquired_date').notNull(),
  ageAtAcquire: integer('age_at_acquire').notNull().default(0),
  initialQty: integer('initial_qty').notNull(),
  currentQty: integer('current_qty').notNull(),
  stage: text('stage').notNull(),
  acquisitionCost: doublePrecision('acquisition_cost').notNull().default(0),
  acquisitionCostCents: bigint('acquisition_cost_cents', { mode: 'number' }).notNull().default(0),
  status: text('status').notNull().default('ACTIVE'),
  parentBatchIds: jsonb('parent_batch_ids').$type<string[]>(),
  // Avg live weight (kg) of one animal, for stock sold by weight (fish, pork). Caps
  // a kg sale against the living headcount; refined by weight-sampling records.
  avgWeightKg: doublePrecision('avg_weight_kg'),
  // Date the batch entered its CURRENT lifecycle stage (see lifecycleStages) — used
  // to show "days in stage". `stage` holds the current stage name.
  stageEnteredAt: text('stage_entered_at'),
  // Set when this batch was created as one of several siblings from a single
  // delivery split across multiple units (e.g. 3600 fries, 1200 into each of
  // 3 tanks) — traceable via WHERE delivery_group_id = X. Distinct from
  // parentBatchIds (a merge — several PAST batches combining into one), this
  // is the opposite direction: one delivery event fanning out into several
  // sibling batches, each still a normal single-unit batch in every other respect.
  deliveryGroupId: text('delivery_group_id'),
}, (t) => [
  index('idx_batches_tenant_status').on(t.tenantId, t.status),
  index('idx_batches_tenant_species').on(t.tenantId, t.species),
]);

// Per-tenant lifecycle stage SET for an enterprise (broilers, layers, pig_fatten…).
// Ordered stages, each starting at an age in DAYS. Seeded from STAGE_TEMPLATES on
// tenant creation; the farmer edits them. Drives "due to move to the next phase".
export const lifecycleStages = pgTable('lifecycle_stages', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  enterprise: text('enterprise').notNull(),
  ord: integer('ord').notNull(),
  name: text('name').notNull(),
  startDay: integer('start_day').notNull(),
});

// History/audit of a batch moving stage and/or unit (and any head-count change on the
// move, e.g. eggs → chicks hatch loss). One row per transition.
export const batchStageEvents = pgTable('batch_stage_events', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  batchId: text('batch_id').notNull(),
  fromStage: text('from_stage'),
  toStage: text('to_stage').notNull(),
  fromUnitId: text('from_unit_id'),
  toUnitId: text('to_unit_id'),
  qtyBefore: integer('qty_before'),
  qtyAfter: integer('qty_after'),
  note: text('note'),
  at: text('at').notNull(),
  by: text('by').notNull(),
});

export const inventoryItems = pgTable('inventory_items', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  name: text('name').notNull(),
  category: text('category').notNull(),
  unit: text('unit').notNull(),
  lowStockThreshold: doublePrecision('low_stock_threshold').notNull().default(0),
});

export const inventoryLots = pgTable('inventory_lots', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  itemId: text('item_id').notNull(),
  lotNo: text('lot_no').notNull(),
  qtyOnHand: doublePrecision('qty_on_hand').notNull().default(0),
  unit: text('unit').notNull(),
  unitCost: doublePrecision('unit_cost').notNull().default(0),
  unitCostCents: bigint('unit_cost_cents', { mode: 'number' }).notNull().default(0),
  expiryDate: text('expiry_date'),
  supplierId: text('supplier_id'),
  receivedDate: text('received_date').notNull(),
  withdrawalDays: integer('withdrawal_days'),
}, (t) => [
  index('idx_lots_tenant_item').on(t.tenantId, t.itemId),
  index('idx_lots_tenant_expiry').on(t.tenantId, t.expiryDate),
]);

export const tasks = pgTable('tasks', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  title: text('title').notNull(),
  description: text('description'),
  type: text('type').notNull(),
  assignedTo: text('assigned_to').notNull(),
  unitId: text('unit_id'),
  batchId: text('batch_id'),
  scheduledFor: text('scheduled_for').notNull(),
  status: text('status').notNull().default('ASSIGNED'),
  dueAt: text('due_at').notNull(),
  overdue: boolean('overdue').default(false),
}, (t) => [
  index('idx_tasks_tenant_status').on(t.tenantId, t.status),
  index('idx_tasks_tenant_assigned').on(t.tenantId, t.assignedTo),
  // Forward-looking: no current query filters/sorts by due_at yet, but a
  // due-soon/overdue task view is a plausible near-term feature and this is cheap.
  index('idx_tasks_tenant_due').on(t.tenantId, t.dueAt),
]);

export const alerts = pgTable('alerts', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  severity: text('severity').notNull(),
  title: text('title').notNull(),
  message: text('message').notNull(),
  type: text('type').notNull(),
  createdAt: text('created_at').notNull(),
  acknowledged: boolean('acknowledged').notNull().default(false),
}, (t) => [
  index('idx_alerts_tenant_ack').on(t.tenantId, t.acknowledged),
  index('idx_alerts_tenant_severity').on(t.tenantId, t.severity),
]);

export const sales = pgTable('sales', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  batchId: text('batch_id').notNull(),
  unitId: text('unit_id').notNull(),
  productType: text('product_type').notNull(),
  quantity: doublePrecision('quantity').notNull(), // in sale units (e.g. trays)
  baseQty: doublePrecision('base_qty'), // quantity converted to base units (e.g. eggs) — for stock math
  weightKg: doublePrecision('weight_kg'),
  unitPrice: doublePrecision('unit_price').notNull(),
  unitPriceCents: bigint('unit_price_cents', { mode: 'number' }).notNull().default(0),
  totalAmount: doublePrecision('total_amount').notNull(),
  totalAmountCents: bigint('total_amount_cents', { mode: 'number' }).notNull().default(0),
  buyer: text('buyer').notNull(),
  paymentMethod: text('payment_method').notNull(),
  status: text('status').notNull(),
  withdrawalCheck: text('withdrawal_check').notNull(),
  withdrawalUntil: text('withdrawal_until'),
  createdAt: text('created_at').notNull(),
}, (t) => [
  index('idx_sales_tenant_batch').on(t.tenantId, t.batchId),
  index('idx_sales_tenant_date').on(t.tenantId, t.createdAt),
]);

export const purchases = pgTable('purchases', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  itemId: text('item_id').notNull(),
  lotId: text('lot_id').notNull(),
  supplier: text('supplier').notNull(),
  quantity: doublePrecision('quantity').notNull(),
  unitCost: doublePrecision('unit_cost').notNull(),
  unitCostCents: bigint('unit_cost_cents', { mode: 'number' }).notNull().default(0),
  totalCost: doublePrecision('total_cost').notNull(),
  totalCostCents: bigint('total_cost_cents', { mode: 'number' }).notNull().default(0),
  createdAt: text('created_at').notNull(), // insert timestamp — not the transaction date, see receivedAt
  // The date the delivery actually happened (farmer-supplied, defaults to
  // today) — distinct from createdAt, which is just when the row was saved.
  // Lets a backlog of paper records be entered without every purchase
  // silently landing on "today."
  receivedAt: text('received_at').notNull(),
  // null = not yet paid in full. Most purchases are cash-on-delivery and are
  // paid in full immediately (amountPaid defaults to totalCost, paidAt to
  // receivedAt) — these fields only diverge for a credit/deferred-payment
  // purchase (e.g. paid via M-Pesa weeks after the goods were received).
  paidAt: text('paid_at'),
  paymentMethod: text('payment_method'), // 'cash' | 'mpesa' | 'credit' | ...
  amountPaid: doublePrecision('amount_paid').notNull().default(0),
  amountPaidCents: bigint('amount_paid_cents', { mode: 'number' }).notNull().default(0),
}, (t) => [
  index('idx_purchases_tenant_date').on(t.tenantId, t.createdAt),
]);

// Generic landing table for synced field events (mortality/feeding/health/…).
// clientUuid is the PK → upserts are idempotent (FR-M17-5).
export const records = pgTable('records', {
  clientUuid: text('client_uuid').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  type: text('type').notNull(),
  payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
  capturedAt: text('captured_at').notNull(),
  createdBy: text('created_by').notNull(),
  createdAt: timestamp('created_at').defaultNow(),
}, (t) => [
  index('idx_records_tenant_type').on(t.tenantId, t.type),
  index('idx_records_tenant_captured_at').on(t.tenantId, t.capturedAt),
  index('idx_records_tenant_created_by').on(t.tenantId, t.createdBy),
]);

// Append-only audit trail (FR-M18). UPDATE/DELETE should be revoked at the DB grant level.
export const auditLog = pgTable('audit_log', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  actor: text('actor').notNull(),
  action: text('action').notNull(),
  entity: text('entity'),
  before: jsonb('before'),
  after: jsonb('after'),
  meta: jsonb('meta'),
  at: timestamp('at').defaultNow(),
}, (t) => [
  index('idx_audit_log_tenant_action').on(t.tenantId, t.action),
  index('idx_audit_log_tenant_at').on(t.tenantId, t.at),
]);

export const conflictLog = pgTable('conflict_log', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  recordType: text('record_type').notNull(),
  recordId: text('record_id').notNull(),
  myVersion: jsonb('my_version'),
  serverVersion: jsonb('server_version'),
  capturedAtMine: text('captured_at_mine'),
  capturedAtServer: text('captured_at_server'),
  resolution: text('resolution'),
  resolvedAt: text('resolved_at'),
  // The owner has reviewed this conflict (accepted the auto last-write-wins, or
  // overridden it) → it drops off the "needs review" list.
  reviewed: boolean('reviewed').notNull().default(false),
}, (t) => [
  index('idx_conflict_log_tenant_reviewed').on(t.tenantId, t.reviewed),
]);

// Typed field-event tables. /api/sync routes known record types here (clientUuid PK
// → idempotent). The costing engine reads these.
export const feedingRecords = pgTable('feeding_records', {
  clientUuid: text('client_uuid').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  batchId: text('batch_id').notNull(),
  lotId: text('lot_id'),
  feedItemId: text('feed_item_id'),
  quantityKg: doublePrecision('quantity_kg').notNull(),
  leftoverKg: doublePrecision('leftover_kg'),
  recordedBy: text('recorded_by').notNull(),
  capturedAt: text('captured_at').notNull(),
}, (t) => [
  index('idx_feeding_tenant_batch').on(t.tenantId, t.batchId),
  index('idx_feeding_tenant_captured').on(t.tenantId, t.capturedAt),
]);

export const mortalityRecords = pgTable('mortality_records', {
  clientUuid: text('client_uuid').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  batchId: text('batch_id').notNull(),
  unitId: text('unit_id'),
  count: integer('count').notNull(),
  cause: text('cause'),
  photoId: text('photo_id'),
  recordedBy: text('recorded_by').notNull(),
  capturedAt: text('captured_at').notNull(),
}, (t) => [
  index('idx_mortality_tenant_batch').on(t.tenantId, t.batchId),
  index('idx_mortality_tenant_captured').on(t.tenantId, t.capturedAt),
]);

export const productionRecords = pgTable('production_records', {
  clientUuid: text('client_uuid').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  batchId: text('batch_id').notNull(),
  type: text('type').notNull(), // eggs | meat | fish | crop
  qty: doublePrecision('qty').notNull(),
  weightKg: doublePrecision('weight_kg'),
  // The product this collection was recorded against (client already sends
  // this — see app/worker/record/collect/page.tsx). Nullable: legacy rows and
  // unresolved backfill rows have no product match, and the worker payload
  // itself is defensive about a missing id. ON DELETE RESTRICT (not SET NULL,
  // not CASCADE): products are hard-deletable (DELETE /api/products), but once
  // a product has recorded production against it, that history must not be
  // silently orphaned (null) or destroyed (cascaded) by an unrelated product
  // edit/delete — the delete itself should fail instead. See issue #22.
  productId: text('product_id').references(() => products.id, { onDelete: 'restrict' }),
  // Snapshot of the product's base unit at capture time — products are
  // editable (baseUnit can change later), so this preserves what the qty
  // above was actually measured in, independent of the product's current state.
  baseUnit: text('base_unit'),
  // Logical identity of this collection event within a (tenant, batch) — see
  // issue #24. `${day}:${productId ?? 'none'}:${slot}`, where `slot` is either
  // an explicit slot the client chose ('morning', 'evening', 'morning_round' …)
  // or, when the client sent none, this row's OWN client_uuid. Folding
  // client_uuid in as the default makes the slot globally unique per
  // submission, so two workers collecting the same product on the same day
  // land as two ADDITIVE rows instead of colliding. An explicit slot is how a
  // genuine edit is expressed: a second submission on the same slot UPDATES
  // the existing row in place (see lib/server/syncHandlers.ts) — it is never
  // DELETEd.
  slotKey: text('slot_key').notNull(),
  recordedBy: text('recorded_by').notNull(),
  capturedAt: text('captured_at').notNull(),
}, (t) => [
  index('idx_production_tenant_batch').on(t.tenantId, t.batchId),
  index('idx_production_tenant_type').on(t.tenantId, t.type),
  index('idx_production_tenant_captured').on(t.tenantId, t.capturedAt),
  // One row per logical slot per batch. This is the mechanism that makes
  // collection additive by default (each no-slot submission gets its own
  // globally-unique slot) while still letting an explicit edit collapse onto
  // one row instead of ever duplicating or deleting.
  unique('production_records_tenant_batch_slot_unique').on(t.tenantId, t.batchId, t.slotKey),
]);

// One row per tenant per backfill run — durable, queryable record of how many
// production_records.product_id values the 0039 migration's backfill resolved
// vs left NULL. `RAISE NOTICE` (used by 0038's products backfill) isn't
// guaranteed to surface in production deploy logs (`vercel-build` runs
// `pnpm db:migrate` non-interactively), so #22's AC — per-tenant resolved vs
// unresolved counts — is written here instead. An operator reads it with:
//   SELECT * FROM production_backfill_report ORDER BY created_at DESC;
export const productionBackfillReport = pgTable('production_backfill_report', {
  id: text('id').primaryKey(),
  migration: text('migration').notNull(), // e.g. '0039' — which run produced this run
  tenantId: text('tenant_id').notNull(),
  resolved: integer('resolved').notNull(),
  unresolved: integer('unresolved').notNull(),
  total: integer('total').notNull(),
  createdAt: timestamp('created_at').defaultNow(),
});

// One row per tenant per run of scripts/recoverProductionConflicts.ts (#25) —
// same durable-report pattern as production_backfill_report above, since that
// script is dry-run-first/operator-triggered rather than a migration, and its
// per-tenant recovered/unrecoverable counts must survive past the terminal
// output. `mode` distinguishes a dry run (report only) from an actual restore
// (rows written) so the operator can tell which counts describe what actually
// happened to the data vs. what a dry run merely found. An operator reads
// this after a run with:
//   SELECT * FROM production_recovery_report ORDER BY created_at DESC;
export const productionRecoveryReport = pgTable('production_recovery_report', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  mode: text('mode').notNull(), // 'dry_run' | 'restore'
  recovered: integer('recovered').notNull(),
  recoveredQty: doublePrecision('recovered_qty').notNull(),
  alreadyRestored: integer('already_restored').notNull(), // idempotency: recovered on a prior run
  unrecoverable: integer('unrecoverable').notNull(), // malformed/missing server_version — reported, never guessed
  createdAt: timestamp('created_at').defaultNow(),
});

export const healthRecords = pgTable('health_records', {
  clientUuid: text('client_uuid').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  batchId: text('batch_id').notNull(),
  type: text('type').notNull(), // VACCINE | MEDICATION | PRESCRIPTION | ...
  productLotId: text('product_lot_id'),
  quantity: doublePrecision('quantity').notNull().default(0), // units consumed from the lot
  recordedBy: text('recorded_by').notNull(),
  capturedAt: text('captured_at').notNull(),
  // Set on vet prescriptions that don't reference a specific inventory lot
  // (free-text treatment). When a lot IS referenced, the withdrawal period lives
  // on inventoryLots.withdrawalDays instead — read both when computing a batch's
  // withdrawal status.
  withdrawalDays: integer('withdrawal_days'),
  notes: text('notes'), // free-text: product/treatment name, route, vet's advisory note
  // Delivery method (e.g. 'Drinking water', 'Injection', 'Wing stab') — the worker
  // form has always collected this; it had nowhere to land until this column.
  route: text('route'),
}, (t) => [
  index('idx_health_tenant_batch').on(t.tenantId, t.batchId),
  // Every sibling typed-record table (feeding/mortality/production) already has a
  // (tenant_id, captured_at) index; health_records was the one left out — added here.
  index('idx_health_tenant_captured').on(t.tenantId, t.capturedAt),
]);

export const laborLogs = pgTable('labor_logs', {
  clientUuid: text('client_uuid').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  batchId: text('batch_id'),
  hours: doublePrecision('hours').notNull(),
  ratePerHour: doublePrecision('rate_per_hour').notNull(),
  recordedBy: text('recorded_by').notNull(),
  capturedAt: text('captured_at').notNull(),
}, (t) => [
  index('idx_labor_tenant_batch').on(t.tenantId, t.batchId),
]);

// Tenant overheads (rent/utilities/depreciation) — allocated to batches by a driver.
export const overheads = pgTable('overheads', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  label: text('label').notNull(),
  amount: doublePrecision('amount').notNull(),
  amountCents: bigint('amount_cents', { mode: 'number' }).notNull().default(0),
  driver: text('driver').notNull().default('population'), // population | even | revenue
});

// Configurable alert rules (FR-M14-3).
export const alertRules = pgTable('alert_rules', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  metric: text('metric').notNull(),
  label: text('label').notNull(),
  threshold: doublePrecision('threshold').notNull(),
  unit: text('unit').notNull().default(''),
  severity: text('severity').notNull().default('warning'),
  enabled: boolean('enabled').notNull().default(true),
});

// Products a batch yields (eggs, pork, manure, piglets, maize…). Each has multiple
// priced sale units, a collection cadence, and a worker-collection permission key.
export const products = pgTable('products', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  batchId: text('batch_id'),
  name: text('name').notNull(),
  baseUnit: text('base_unit').notNull().default('unit'), // piece | kg | head | bag
  saleUnits: jsonb('sale_units').$type<{ name: string; perBase: number; price: number }[]>().notNull().default([]),
  collectFrequency: text('collect_frequency').notNull().default('per_cycle'), // daily | weekly | monthly | per_cycle
  flow: text('flow').notNull().default('sale'), // sale (output) | expense (input)
  fieldKey: text('field_key'), // permission key on worker profiles for collecting it
  active: boolean('active').notNull().default(true),
  isAnimalProduct: boolean('is_animal_product').notNull().default(false),
  // The asset itself (the live animal at this batch's stage) — drives headcount
  // decrement on sale. Previously inferred from isAnimalProduct; now recorded
  // directly so a batch's main product is unambiguous. See productTemplates.ts.
  isMainProduct: boolean('is_main_product').notNull().default(false),
  // The costing denominator for this batch — exactly one per batch. Distinct from
  // isMainProduct: for layers the asset is the spent hen but the costing
  // denominator is eggs, so one flag cannot carry both meanings.
  isCostDriver: boolean('is_cost_driver').notNull().default(false),
}, (t) => [
  index('idx_products_tenant_batch').on(t.tenantId, t.batchId),
]);

// Worker-captured photos (mortality evidence, etc.). Stored in R2 (object storage)
// when configured, falling back to base64 data URLs in Postgres for small-scale use.
export const photos = pgTable('photos', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  data: text('data'), // data:image/jpeg;base64,... (legacy — nullable once migrated)
  storageKey: text('storage_key'), // e.g. "tenant_id/uuid.jpg" — set when stored in R2
  mime: text('mime'),               // e.g. "image/jpeg"
  gpsLat: doublePrecision('gps_lat'),
  gpsLng: doublePrecision('gps_lng'),
  capturedBy: text('captured_by'),
  capturedAt: text('captured_at'),
  createdAt: timestamp('created_at').defaultNow(),
}, (t) => [
  index('idx_photos_tenant').on(t.tenantId),
]);

// Daily closing-stock counts (FR-M4-4): a worker's physical count per item.
export const closingStockCounts = pgTable('closing_stock_counts', {
  clientUuid: text('client_uuid').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  itemId: text('item_id').notNull(),
  closingQty: doublePrecision('closing_qty').notNull(),
  recordedBy: text('recorded_by').notNull(),
  capturedAt: text('captured_at').notNull(),
});

// Head count: a worker counts the live animals; the variance vs the system count is
// recorded and the owner is alerted. currentQty changes ONLY when the owner applies it.
export const physicalCounts = pgTable('physical_counts', {
  clientUuid: text('client_uuid').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  batchId: text('batch_id').notNull(),
  unitId: text('unit_id'),
  systemCount: integer('system_count').notNull(),
  physicalCount: integer('physical_count').notNull(),
  variance: integer('variance').notNull(),
  reason: text('reason'),
  notes: text('notes'),
  reconciled: boolean('reconciled').notNull().default(false), // owner applied / dismissed
  recordedBy: text('recorded_by').notNull(),
  capturedAt: text('captured_at').notNull(),
}, (t) => [
  index('idx_physical_counts_tenant_batch').on(t.tenantId, t.batchId),
]);

// Weight sampling history (drives the biomass sell-cap + growth/weight-loss warning).
export const weightSamples = pgTable('weight_samples', {
  clientUuid: text('client_uuid').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  batchId: text('batch_id').notNull(),
  sampleSize: integer('sample_size'),
  avgWeightKg: doublePrecision('avg_weight_kg').notNull(),
  recordedBy: text('recorded_by').notNull(),
  capturedAt: text('captured_at').notNull(),
}, (t) => [
  index('idx_weight_samples_tenant_batch').on(t.tenantId, t.batchId),
]);

// Morning-round observations: water readings + the abnormal flag. An abnormal report
// raises an owner alert so a problem in the field is never silently lost.
export const observations = pgTable('observations', {
  clientUuid: text('client_uuid').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  batchId: text('batch_id').notNull(),
  unitId: text('unit_id'),
  waterLevel: text('water_level'),
  waterColour: text('water_colour'),
  tempC: doublePrecision('temp_c'),
  doMgL: doublePrecision('do_mgl'),
  ph: doublePrecision('ph'),
  ammonia: doublePrecision('ammonia'),
  abnormal: boolean('abnormal').notNull().default(false),
  abnormalNote: text('abnormal_note'),
  recordedBy: text('recorded_by').notNull(),
  capturedAt: text('captured_at').notNull(),
}, (t) => [
  index('idx_observations_tenant_batch').on(t.tenantId, t.batchId),
]);

// Feed-mix events (FR-M4-3): consumes ingredient lots → finished-feed lot.
export const feedFormulas = pgTable('feed_formulas', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  name: text('name').notNull(),
  components: jsonb('components').$type<{ itemId: string; kg: number }[]>().notNull().default([]),
  totalKg: doublePrecision('total_kg').notNull(),
  unitCost: doublePrecision('unit_cost').notNull(),
  unitCostCents: bigint('unit_cost_cents', { mode: 'number' }).notNull().default(0),
  createdAt: text('created_at').notNull(),
});

// Milling/processing events: one raw item converts into a different, already-
// existing item at less than 1:1 (e.g. 74kg whole maize -> 73kg flour). Distinct
// from feedFormulas above, which COMBINES several ingredients into one recipe
// at 1:1 input — this is a single ingredient shrinking into a different product.
export const processingEvents = pgTable('processing_events', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  inputItemId: text('input_item_id').notNull(),
  inputQty: doublePrecision('input_qty').notNull(),
  outputItemId: text('output_item_id').notNull(),
  outputQty: doublePrecision('output_qty').notNull(),
  fee: doublePrecision('fee').notNull().default(0), // e.g. a milling/grinding charge
  feeCents: bigint('fee_cents', { mode: 'number' }).notNull().default(0),
  note: text('note'),
  recordedBy: text('recorded_by').notNull(),
  capturedAt: text('captured_at').notNull(),
});

// Owner-issued auditor access links. Token is HMAC-signed; we store a hash so
// links can be revoked server-side without keeping the raw bearer token.
export const auditorLinks = pgTable('auditor_links', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  tokenHash: text('token_hash').notNull().unique(),
  email: text('email'),
  createdBy: text('created_by').notNull(),
  expiresAt: timestamp('expires_at').notNull(),
  revokedAt: timestamp('revoked_at'),
  createdAt: timestamp('created_at').defaultNow(),
}, (t) => [
  index('idx_auditor_links_tenant').on(t.tenantId),
]);

// Server-side session kill list. Logout (and future remote revoke) insert the
// session jti here; getSession rejects revoked tokens even if the cookie remains.
export const revokedSessions = pgTable('revoked_sessions', {
  jti: text('jti').primaryKey(),
  userId: text('user_id'),
  revokedAt: timestamp('revoked_at').defaultNow(),
  expiresAt: timestamp('expires_at').notNull(),
}, (t) => [
  index('idx_revoked_sessions_expires').on(t.expiresAt),
]);

// DB-backed brute-force protection for login. Every FAILED sign-in inserts a row
// keyed by the normalized identifier (email or phone); a SUCCESSFUL sign-in clears
// that identifier's failures. Unlike the in-memory limiter in lib/server/rateLimit.ts
// — which each Vercel serverless instance holds separately and every cold start
// wipes — this survives across instances, so a brute-force attempt fanned out over
// many instances is still counted against one shared table. Only recent rows are
// ever queried (WHERE created_at > now() - window); older rows are inert and can be
// truncated by an admin/cleanup job (see purgeOldLoginAttempts in loginThrottle.ts).
export const loginAttempts = pgTable('login_attempts', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(), // normalized email or phone (trimmed, lowercased)
  ip: text('ip'),                            // best-effort client IP (may be absent behind proxies)
  success: boolean('success').notNull().default(false),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  // The lockout query filters by identifier + recency, so lead with identifier.
  index('idx_login_attempts_identifier_created').on(t.identifier, t.createdAt),
  // Supports the cleanup/purge sweep over old rows regardless of identifier.
  index('idx_login_attempts_created').on(t.createdAt),
]);

// Client-reported error/crash log — populated by the error boundaries
// (app/{global-error,error}.tsx and the section-level error.tsx files) via
// POST /api/errors. tenantId/userId are nullable: a crash can happen before a
// session exists (e.g. on /login) or with a broken/expired session.
export const errorLogs = pgTable('error_logs', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id'),
  userId: text('user_id'),
  context: text('context'), // 'root' | 'global' | 'worker' | 'owner' | 'admin' | 'manager' | 'auditor'
  severity: text('severity').notNull().default('error'), // 'error' | 'fatal' (global-error.tsx)
  message: text('message').notNull(),
  digest: text('digest'), // Next.js error.digest — correlates with server logs
  stack: text('stack'),
  url: text('url'),
  userAgent: text('user_agent'),
  createdAt: timestamp('created_at').defaultNow(),
}, (t) => [
  index('idx_error_logs_tenant_created').on(t.tenantId, t.createdAt),
]);
