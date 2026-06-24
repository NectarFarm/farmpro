CREATE TABLE "alert_rules" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"metric" text NOT NULL,
	"label" text NOT NULL,
	"threshold" double precision NOT NULL,
	"unit" text DEFAULT '' NOT NULL,
	"severity" text DEFAULT 'warning' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "feed_formulas" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"name" text NOT NULL,
	"components" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"total_kg" double precision NOT NULL,
	"unit_cost" double precision NOT NULL,
	"created_at" text NOT NULL
);
