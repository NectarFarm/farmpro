CREATE TABLE "health_records" (
	"client_uuid" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"batch_id" text NOT NULL,
	"type" text NOT NULL,
	"product_lot_id" text,
	"quantity" double precision DEFAULT 0 NOT NULL,
	"recorded_by" text NOT NULL,
	"captured_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "labor_logs" (
	"client_uuid" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"batch_id" text,
	"hours" double precision NOT NULL,
	"rate_per_hour" double precision NOT NULL,
	"recorded_by" text NOT NULL,
	"captured_at" text NOT NULL
);
