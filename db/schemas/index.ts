// IFMS new-backend schema (mobile-ui-upgrade). Tenant is the account/billing
// scope; `farms` sits below it, and production units belong to a farm — the same
// shape the reference backend designs toward (issue #219).
import { pgTable, text, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core'

export * from './auth'

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
