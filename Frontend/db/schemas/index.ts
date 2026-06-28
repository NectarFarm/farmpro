// IFMS Drizzle schema — SRS v1.0 §4. Every tenant-owned row carries tenant_id.
// Money is doublePrecision for the demo; production should use integer minor units.
import {
  pgTable, text, integer, doublePrecision, boolean, timestamp, jsonb,
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

// Screenshots a tester attaches to a failed step. Stored as a compressed data URL;
// the admin can delete each one after viewing to reclaim space.
export const testPhotos = pgTable('test_photos', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  stepId: text('step_id').notNull(),
  data: text('data').notNull(), // data:image/jpeg;base64,…
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
  phone: text('phone').notNull(),
  email: text('email'),
  role: text('role').notNull(),
  workerProfileId: text('worker_profile_id'),
  language: text('language').notNull().default('en'),
  passwordHash: text('password_hash'), // owner/manager/vet/auditor
  pinHash: text('pin_hash'),           // worker
});

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
  payDay: integer('pay_day'),                             // day of month (1–31) wages are due
  paymentsFrom: text('payments_from'),                    // 'YYYY-MM' payroll begins (null = first run)
  // Batches this worker is assigned to. NULL = all (current & future) active batches
  // — the default. [] = none. [ids] = exactly those. Drives salary allocation.
  assignedBatchIds: jsonb('assigned_batch_ids').$type<string[]>(),
});

// One payslip per employee per month. `gross` is SNAPSHOT at run time, so editing
// an employee's salary never rewrites a past payslip. Once status='paid' it's locked.
export const payslips = pgTable('payslips', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  employeeId: text('employee_id').notNull(),
  period: text('period').notNull(), // 'YYYY-MM'
  gross: doublePrecision('gross').notNull(),
  advances: doublePrecision('advances').notNull().default(0),
  fines: doublePrecision('fines').notNull().default(0),
  bonuses: doublePrecision('bonuses').notNull().default(0),
  net: doublePrecision('net').notNull(),
  status: text('status').notNull().default('pending'), // pending | paid
  paidAt: text('paid_at'),
  createdAt: text('created_at').notNull(),
});

// Advances, fines (fines are also farm income), bonuses & adjustments per employee,
// applied to a given month's payslip.
export const employeeLedger = pgTable('employee_ledger', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  employeeId: text('employee_id').notNull(),
  type: text('type').notNull(), // advance | fine | bonus | adjustment
  amount: doublePrecision('amount').notNull(),
  note: text('note'),
  period: text('period').notNull(), // 'YYYY-MM' it applies to
  date: text('date').notNull(),
  createdAt: text('created_at').notNull(),
});

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
  breed: text('breed'),
  source: text('source').notNull(),
  acquiredDate: text('acquired_date').notNull(),
  ageAtAcquire: integer('age_at_acquire').notNull().default(0),
  initialQty: integer('initial_qty').notNull(),
  currentQty: integer('current_qty').notNull(),
  stage: text('stage').notNull(),
  acquisitionCost: doublePrecision('acquisition_cost').notNull().default(0),
  status: text('status').notNull().default('ACTIVE'),
  parentBatchIds: jsonb('parent_batch_ids').$type<string[]>(),
  // Avg live weight (kg) of one animal, for stock sold by weight (fish, pork). Caps
  // a kg sale against the living headcount; refined by weight-sampling records.
  avgWeightKg: doublePrecision('avg_weight_kg'),
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
  expiryDate: text('expiry_date'),
  supplierId: text('supplier_id'),
  receivedDate: text('received_date').notNull(),
  withdrawalDays: integer('withdrawal_days'),
});

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
});

export const alerts = pgTable('alerts', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  severity: text('severity').notNull(),
  title: text('title').notNull(),
  message: text('message').notNull(),
  type: text('type').notNull(),
  createdAt: text('created_at').notNull(),
  acknowledged: boolean('acknowledged').notNull().default(false),
});

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
  totalAmount: doublePrecision('total_amount').notNull(),
  buyer: text('buyer').notNull(),
  paymentMethod: text('payment_method').notNull(),
  status: text('status').notNull(),
  withdrawalCheck: text('withdrawal_check').notNull(),
  withdrawalUntil: text('withdrawal_until'),
  createdAt: text('created_at').notNull(),
});

export const purchases = pgTable('purchases', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  itemId: text('item_id').notNull(),
  lotId: text('lot_id').notNull(),
  supplier: text('supplier').notNull(),
  quantity: doublePrecision('quantity').notNull(),
  unitCost: doublePrecision('unit_cost').notNull(),
  totalCost: doublePrecision('total_cost').notNull(),
  createdAt: text('created_at').notNull(),
});

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
});

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
});

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
});

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
});

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
});

export const productionRecords = pgTable('production_records', {
  clientUuid: text('client_uuid').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  batchId: text('batch_id').notNull(),
  type: text('type').notNull(), // eggs | meat | fish | crop
  qty: doublePrecision('qty').notNull(),
  weightKg: doublePrecision('weight_kg'),
  recordedBy: text('recorded_by').notNull(),
  capturedAt: text('captured_at').notNull(),
});

export const healthRecords = pgTable('health_records', {
  clientUuid: text('client_uuid').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  batchId: text('batch_id').notNull(),
  type: text('type').notNull(), // VACCINE | MEDICATION | ...
  productLotId: text('product_lot_id'),
  quantity: doublePrecision('quantity').notNull().default(0), // units consumed from the lot
  recordedBy: text('recorded_by').notNull(),
  capturedAt: text('captured_at').notNull(),
});

export const laborLogs = pgTable('labor_logs', {
  clientUuid: text('client_uuid').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  batchId: text('batch_id'),
  hours: doublePrecision('hours').notNull(),
  ratePerHour: doublePrecision('rate_per_hour').notNull(),
  recordedBy: text('recorded_by').notNull(),
  capturedAt: text('captured_at').notNull(),
});

// Tenant overheads (rent/utilities/depreciation) — allocated to batches by a driver.
export const overheads = pgTable('overheads', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  label: text('label').notNull(),
  amount: doublePrecision('amount').notNull(),
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
});

// Worker-captured photos (mortality evidence, etc.). Stored as a compressed data
// URL for the demo; production would put bytes in R2/Supabase + keep a signed URL.
export const photos = pgTable('photos', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  data: text('data').notNull(), // data:image/jpeg;base64,...
  gpsLat: doublePrecision('gps_lat'),
  gpsLng: doublePrecision('gps_lng'),
  capturedBy: text('captured_by'),
  capturedAt: text('captured_at'),
  createdAt: timestamp('created_at').defaultNow(),
});

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
});

// Weight sampling history (drives the biomass sell-cap + growth/weight-loss warning).
export const weightSamples = pgTable('weight_samples', {
  clientUuid: text('client_uuid').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  batchId: text('batch_id').notNull(),
  sampleSize: integer('sample_size'),
  avgWeightKg: doublePrecision('avg_weight_kg').notNull(),
  recordedBy: text('recorded_by').notNull(),
  capturedAt: text('captured_at').notNull(),
});

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
});

// Feed-mix events (FR-M4-3): consumes ingredient lots → finished-feed lot.
export const feedFormulas = pgTable('feed_formulas', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  name: text('name').notNull(),
  components: jsonb('components').$type<{ itemId: string; kg: number }[]>().notNull().default([]),
  totalKg: doublePrecision('total_kg').notNull(),
  unitCost: doublePrecision('unit_cost').notNull(),
  createdAt: text('created_at').notNull(),
});
