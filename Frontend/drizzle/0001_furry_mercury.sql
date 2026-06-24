CREATE TABLE "feeding_records" (
	"client_uuid" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"batch_id" text NOT NULL,
	"lot_id" text,
	"feed_item_id" text,
	"quantity_kg" double precision NOT NULL,
	"leftover_kg" double precision,
	"recorded_by" text NOT NULL,
	"captured_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mortality_records" (
	"client_uuid" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"batch_id" text NOT NULL,
	"unit_id" text,
	"count" integer NOT NULL,
	"cause" text,
	"photo_id" text,
	"recorded_by" text NOT NULL,
	"captured_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "production_records" (
	"client_uuid" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"batch_id" text NOT NULL,
	"type" text NOT NULL,
	"qty" double precision NOT NULL,
	"weight_kg" double precision,
	"recorded_by" text NOT NULL,
	"captured_at" text NOT NULL
);
