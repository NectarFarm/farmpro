CREATE TABLE "approval_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"requested_by" text NOT NULL,
	"batch_id" text,
	"entity_id" text NOT NULL,
	"details" text DEFAULT '' NOT NULL,
	"requested_at" timestamp DEFAULT now() NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"priority" text DEFAULT 'medium' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"actor" text NOT NULL,
	"action" text NOT NULL,
	"entity" text NOT NULL,
	"entity_id" text NOT NULL,
	"meta" jsonb,
	"at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "role_permissions" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"role" text NOT NULL,
	"module" text NOT NULL,
	"access" text DEFAULT 'hidden' NOT NULL,
	"approval_required" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "priority" text DEFAULT 'medium' NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "requires_approval" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "notes" text;--> statement-breakpoint
CREATE INDEX "idx_approval_requests_tenant" ON "approval_requests" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_approval_requests_tenant_status" ON "approval_requests" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "idx_audit_log_tenant" ON "audit_log" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_audit_log_tenant_entity" ON "audit_log" USING btree ("tenant_id","entity","entity_id");--> statement-breakpoint
CREATE INDEX "idx_role_permissions_tenant" ON "role_permissions" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_role_permissions_tenant_role_module" ON "role_permissions" USING btree ("tenant_id","role","module");