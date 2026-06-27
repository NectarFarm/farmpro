CREATE TABLE "test_photos" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"step_id" text NOT NULL,
	"data" text NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "test_max_screenshots" integer DEFAULT 0 NOT NULL;