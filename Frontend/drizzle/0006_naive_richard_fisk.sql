CREATE TABLE "closing_stock_counts" (
	"client_uuid" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"item_id" text NOT NULL,
	"closing_qty" double precision NOT NULL,
	"recorded_by" text NOT NULL,
	"captured_at" text NOT NULL
);
