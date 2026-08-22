// IFMS new-backend schema (mobile-ui-upgrade). Tenant is the account/billing
// scope; `farms` sits below it, and production units belong to a farm — the same
// shape the reference backend designs toward (issue #219).
import { pgTable, text, timestamp, integer, bigint, index, uniqueIndex, doublePrecision } from 'drizzle-orm/pg-core'

export * from './auth'
export * from './dashboard'
export * from './onboarding'
export * from './governance'
export * from './inventory'
export * from './people'
export * from './settings'
export * from './finance'
export * from './auditor'
export * from './payroll'
export * from './email'

// A tenant's farms. One tenant owns several farms; each farm carries its own
// production units. The farm switcher in the shell reads these via GET /api/farms.
export const farms = pgTable('farms', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  name: text('name').notNull(),
  location: text('location').notNull().default(''),
  // GPS pin for this farm (ui-polish-theme-weather: weather integration).
  // Nullable, all-or-nothing pair, same shape/rules as
  // onboard_requests.latitude/longitude (db/schemas/onboarding.ts) —
  // validated with the same lib/validation.ts#validateLocation. Onboarding
  // captures coordinates on the REQUEST row, but provisionTenant
  // (lib/tenant-provisioning.ts) never carried them onto the farm row it
  // creates, so every existing farm has NULL here regardless of what the
  // applicant supplied. GET /api/weather treats NULL as "no coordinates set"
  // and returns an honest empty state rather than guessing a location.
  latitude: doublePrecision('latitude'),
  longitude: doublePrecision('longitude'),
  code: text('code').notNull(),
  // 'ACTIVE' | 'ARCHIVED' — loose text validated in the route (same
  // convention as users.status/onboardRequests.status), not a DB enum.
  // Farms are archived, never deleted: production_units.farm_id is a real FK
  // into farms.id (below), so a hard DELETE would fail once a unit exists,
  // or orphan production history if that FK were ever dropped. Archiving
  // keeps the row (hidden from the default farm list/switcher) instead.
  status: text('status').notNull().default('ACTIVE'),
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
//
// `idx_production_units_tenant_code` (issue #232): GET/POST /api/units is the
// first route to create rows here — same per-tenant-unique-code guard shape as
// idx_farms_tenant_code / idx_batches_tenant_code, and exactly what
// lib/codes.ts's own comment says a units-create route should add ("callers
// must still check per-tenant collisions ... and rely on a DB unique index for
// the real concurrent-insert race").
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
  uniqueIndex('idx_production_units_tenant_code').on(t.tenantId, t.code),
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
  // Money units (issue: money-unit-enforcement) — widened to bigint (mode
  // 'number': safe up to 2^53, far beyond any real farm-finance figure) so
  // this cents-denominated column isn't capped at ~21.5M KSh by `integer`'s
  // 2,147,483,647 ceiling. See lib/money.ts for the one place cents<->major
  // conversion happens.
  acquisitionCostCents: bigint('acquisition_cost_cents', { mode: 'number' }).notNull().default(0),
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
