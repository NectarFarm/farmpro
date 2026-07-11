CREATE TABLE "processing_events" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"input_item_id" text NOT NULL,
	"input_qty" double precision NOT NULL,
	"output_item_id" text NOT NULL,
	"output_qty" double precision NOT NULL,
	"fee" double precision DEFAULT 0 NOT NULL,
	"fee_cents" integer DEFAULT 0 NOT NULL,
	"note" text,
	"recorded_by" text NOT NULL,
	"captured_at" text NOT NULL
);
