-- Adds the client error-reporting table, plus mirrors into Drizzle's tracked
-- migration history the ~34 indexes that already exist in production Postgres
-- (added via raw SQL in 0022_audit_indexes.sql and 0026_security_hardening.sql,
-- which bypassed drizzle-kit's snapshot tracking — this migration is what makes
-- db/schemas/index.ts's new index() declarations match reality without
-- re-creating anything; every CREATE INDEX below is IF NOT EXISTS for exactly
-- that reason). Two genuinely new indexes: idx_health_tenant_captured
-- (health_records was missing the (tenant_id, captured_at) index every sibling
-- typed-record table already has) and idx_tasks_tenant_due (forward-looking).

CREATE TABLE IF NOT EXISTS "error_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text,
	"user_id" text,
	"context" text,
	"severity" text DEFAULT 'error' NOT NULL,
	"message" text NOT NULL,
	"digest" text,
	"stack" text,
	"url" text,
	"user_agent" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_error_logs_tenant_created" ON "error_logs" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_alerts_tenant_ack" ON "alerts" USING btree ("tenant_id","acknowledged");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_alerts_tenant_severity" ON "alerts" USING btree ("tenant_id","severity");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_audit_log_tenant_action" ON "audit_log" USING btree ("tenant_id","action");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_audit_log_tenant_at" ON "audit_log" USING btree ("tenant_id","at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_auditor_links_tenant" ON "auditor_links" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_batches_tenant_status" ON "batches" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_batches_tenant_species" ON "batches" USING btree ("tenant_id","species");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_conflict_log_tenant_reviewed" ON "conflict_log" USING btree ("tenant_id","reviewed");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_employee_ledger_tenant_emp" ON "employee_ledger" USING btree ("tenant_id","employee_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_employees_tenant_active" ON "employees" USING btree ("tenant_id","active");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_feeding_tenant_batch" ON "feeding_records" USING btree ("tenant_id","batch_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_feeding_tenant_captured" ON "feeding_records" USING btree ("tenant_id","captured_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_health_tenant_batch" ON "health_records" USING btree ("tenant_id","batch_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_health_tenant_captured" ON "health_records" USING btree ("tenant_id","captured_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_lots_tenant_item" ON "inventory_lots" USING btree ("tenant_id","item_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_lots_tenant_expiry" ON "inventory_lots" USING btree ("tenant_id","expiry_date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_labor_tenant_batch" ON "labor_logs" USING btree ("tenant_id","batch_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_mortality_tenant_batch" ON "mortality_records" USING btree ("tenant_id","batch_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_mortality_tenant_captured" ON "mortality_records" USING btree ("tenant_id","captured_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_observations_tenant_batch" ON "observations" USING btree ("tenant_id","batch_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_payslips_tenant_period" ON "payslips" USING btree ("tenant_id","period");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_photos_tenant" ON "photos" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_physical_counts_tenant_batch" ON "physical_counts" USING btree ("tenant_id","batch_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_production_tenant_batch" ON "production_records" USING btree ("tenant_id","batch_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_production_tenant_type" ON "production_records" USING btree ("tenant_id","type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_production_tenant_captured" ON "production_records" USING btree ("tenant_id","captured_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_products_tenant_batch" ON "products" USING btree ("tenant_id","batch_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_purchases_tenant_date" ON "purchases" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_records_tenant_type" ON "records" USING btree ("tenant_id","type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_records_tenant_captured_at" ON "records" USING btree ("tenant_id","captured_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_records_tenant_created_by" ON "records" USING btree ("tenant_id","created_by");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_revoked_sessions_expires" ON "revoked_sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_sales_tenant_batch" ON "sales" USING btree ("tenant_id","batch_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_sales_tenant_date" ON "sales" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_tasks_tenant_status" ON "tasks" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_tasks_tenant_assigned" ON "tasks" USING btree ("tenant_id","assigned_to");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_tasks_tenant_due" ON "tasks" USING btree ("tenant_id","due_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_users_tenant_role" ON "users" USING btree ("tenant_id","role");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_weight_samples_tenant_batch" ON "weight_samples" USING btree ("tenant_id","batch_id");