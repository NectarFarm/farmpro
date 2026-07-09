-- IFMS performance indexes
-- Adds indexes on frequently queried columns identified in the codebase audit.
-- These cover the most common query patterns across all typed record tables:
--   • Filtering by tenant (every query)
--   • Filtering by batch (batch detail pages, costing)
--   • Filtering by type (production type, record type)
--   • Date-range queries (activity logs, reports)
--   • Status queries (alerts, batches, tasks)
--
-- Migration 0022 (audit: add performance indexes)

-- ── Generic records table (sync landing) ──────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_records_tenant_type ON records (tenant_id, type);
CREATE INDEX IF NOT EXISTS idx_records_tenant_captured_at ON records (tenant_id, captured_at);
CREATE INDEX IF NOT EXISTS idx_records_tenant_created_by ON records (tenant_id, created_by);

-- ── Typed record tables ───────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_feeding_tenant_batch ON feeding_records (tenant_id, batch_id);
CREATE INDEX IF NOT EXISTS idx_feeding_tenant_captured ON feeding_records (tenant_id, captured_at);

CREATE INDEX IF NOT EXISTS idx_mortality_tenant_batch ON mortality_records (tenant_id, batch_id);
CREATE INDEX IF NOT EXISTS idx_mortality_tenant_captured ON mortality_records (tenant_id, captured_at);

CREATE INDEX IF NOT EXISTS idx_production_tenant_batch ON production_records (tenant_id, batch_id);
CREATE INDEX IF NOT EXISTS idx_production_tenant_type ON production_records (tenant_id, type);
CREATE INDEX IF NOT EXISTS idx_production_tenant_captured ON production_records (tenant_id, captured_at);

CREATE INDEX IF NOT EXISTS idx_health_tenant_batch ON health_records (tenant_id, batch_id);

CREATE INDEX IF NOT EXISTS idx_labor_tenant_batch ON labor_logs (tenant_id, batch_id);

-- ── Batch & lifecycle ─────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_batches_tenant_status ON batches (tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_batches_tenant_species ON batches (tenant_id, species);

-- ── Inventory ─────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_lots_tenant_item ON inventory_lots (tenant_id, item_id);
CREATE INDEX IF NOT EXISTS idx_lots_tenant_expiry ON inventory_lots (tenant_id, expiry_date);
CREATE INDEX IF NOT EXISTS idx_purchases_tenant_date ON purchases (tenant_id, created_at);

-- ── Sales ─────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_sales_tenant_batch ON sales (tenant_id, batch_id);
CREATE INDEX IF NOT EXISTS idx_sales_tenant_date ON sales (tenant_id, created_at);

-- ── Alerts & tasks ────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_alerts_tenant_ack ON alerts (tenant_id, acknowledged);
CREATE INDEX IF NOT EXISTS idx_alerts_tenant_severity ON alerts (tenant_id, severity);
CREATE INDEX IF NOT EXISTS idx_tasks_tenant_status ON tasks (tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_tasks_tenant_assigned ON tasks (tenant_id, assigned_to);

-- ── Employees & users ─────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_employees_tenant_active ON employees (tenant_id, active);
CREATE INDEX IF NOT EXISTS idx_users_tenant_role ON users (tenant_id, role);

-- ── Observations, physical counts, weight samples ─────────────────────────
CREATE INDEX IF NOT EXISTS idx_observations_tenant_batch ON observations (tenant_id, batch_id);
CREATE INDEX IF NOT EXISTS idx_physical_counts_tenant_batch ON physical_counts (tenant_id, batch_id);
CREATE INDEX IF NOT EXISTS idx_weight_samples_tenant_batch ON weight_samples (tenant_id, batch_id);

-- ── Audit & conflict logs ─────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_audit_log_tenant_action ON audit_log (tenant_id, action);
CREATE INDEX IF NOT EXISTS idx_audit_log_tenant_at ON audit_log (tenant_id, at);
CREATE INDEX IF NOT EXISTS idx_conflict_log_tenant_reviewed ON conflict_log (tenant_id, reviewed);
