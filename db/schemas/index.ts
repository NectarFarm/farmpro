// IFMS new-backend schema (mobile-ui-upgrade). Tenant is the account/billing
// scope; `farms` sits below it, and production units belong to a farm — the same
// shape the reference backend designs toward (issue #219).
import { pgTable, text, timestamp, integer, index, uniqueIndex } from 'drizzle-orm/pg-core'

export * from './auth'
export * from './dashboard'
export * from './onboarding'
export * from './governance'

// A tenant's farms. One tenant owns several farms; each farm carries its own
// production units. The farm switcher in the shell reads these via GET /api/farms.
export const farms = pgTable('farms', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  name: text('name').notNull(),
  location: text('location').notNull().default(''),
  code: text('code').notNull(),
  createdAt: timestamp('created_at').defaultNow(),
}, (t) => [
  index('idx_farms_tenant').on(t.tenantId),
  // Farm codes are a tenant's human-facing labels — enforce per-tenant uniqueness
  // at the DB level so POST /api/farms's dedupe can't be beaten by concurrent writes.
  uniqueIndex('idx_farms_tenant_code').on(t.tenantId, t.code),
])

// Production units live under a farm — farm_id is a real FK into `farms`
// (production_units.farm_id → farms.id), the relationship the reference system
// models. Minimal for now; the screen epics add the remaining columns.
export const productionUnits = pgTable('production_units', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  farmId: text('farm_id').notNull().references(() => farms.id),
  type: text('type').notNull(),
  name: text('name').notNull(),
  code: text('code').notNull(),
  status: text('status').notNull().default('ACTIVE'),
}, (t) => [
  index('idx_production_units_tenant_farm').on(t.tenantId, t.farmId),
])

// A tenant's production batches (issue #231) — one cohort of animals or a
// planted area within a single production unit, tracked from
// acquisition/planting through close-out. Fresh table: no `batches` table,
// `costing.ts`, or `/api/batches/*` route existed anywhere on this branch
// before this issue (the issue's own branch-correction note confirms it —
// checked db/schemas/*.ts and grepped the repo). The field list is not
// invented: it mirrors the UI's own contract — `Batch` / `BATCHES_DATA` in
// components/farm/data.ts, and how components/farm/crops.tsx's
// CropsScreen/BatchDetailScreen actually read it — trimmed to what a
// from-scratch backend can support today (the client-only transfer-form
// fields and per-batch process toggles stay UI-local; there's no
// transfers/process-config data source yet, and adding one is bigger scope
// than this issue).
//
// `enterprise` is the UI's subtype key (e.g. "broiler", "maize" — see
// ENTERPRISE_REGISTRY in data.ts); `species` is a free-text field for a
// finer-grained breed/variety than the enterprise subtype captures (e.g.
// enterprise "broiler", species "Cobb 500") — optional, defaults to ''.
//
// `acquisitionCostCents` is the ONLY real cost figure this table (or this
// issue) tracks — see GET /api/batches/[id]/cost-breakdown for the honesty
// contract on feed/health/labour/overhead (no purchases/expenses/labor_logs
// tables exist yet to source those from).
export const batches = pgTable('batches', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  unitId: text('unit_id').notNull().references(() => productionUnits.id),
  code: text('code').notNull(),
  name: text('name').notNull(),
  species: text('species').notNull().default(''),
  enterprise: text('enterprise').notNull(),
  stage: text('stage').notNull().default(''),
  status: text('status').notNull().default('ACTIVE'),
  initialQty: integer('initial_qty').notNull().default(0),
  currentQty: integer('current_qty').notNull().default(0),
  acquisitionCostCents: integer('acquisition_cost_cents').notNull().default(0),
  startDate: timestamp('start_date').defaultNow(),
  endDate: timestamp('end_date'),
  harvestDate: timestamp('harvest_date'),
  createdAt: timestamp('created_at').defaultNow(),
}, (t) => [
  index('idx_batches_tenant').on(t.tenantId),
  index('idx_batches_tenant_unit').on(t.tenantId, t.unitId),
  // Batch codes are the UI's primary human-facing identifier (issue #231
  // task 2) — enforce per-tenant uniqueness at the DB level, same guard
  // shape as idx_farms_tenant_code.
  uniqueIndex('idx_batches_tenant_code').on(t.tenantId, t.code),
])
