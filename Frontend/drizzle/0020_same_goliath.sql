CREATE TABLE "batch_stage_events" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"batch_id" text NOT NULL,
	"from_stage" text,
	"to_stage" text NOT NULL,
	"from_unit_id" text,
	"to_unit_id" text,
	"qty_before" integer,
	"qty_after" integer,
	"note" text,
	"at" text NOT NULL,
	"by" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lifecycle_stages" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"enterprise" text NOT NULL,
	"ord" integer NOT NULL,
	"name" text NOT NULL,
	"start_day" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "batches" ADD COLUMN "stage_entered_at" text;