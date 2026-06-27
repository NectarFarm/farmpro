CREATE TABLE "test_runs" (
	"tenant_id" text PRIMARY KEY NOT NULL,
	"status" text DEFAULT 'in_progress' NOT NULL,
	"steps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"started_at" text NOT NULL,
	"submitted_at" text
);
--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "testing_enabled" boolean DEFAULT false NOT NULL;