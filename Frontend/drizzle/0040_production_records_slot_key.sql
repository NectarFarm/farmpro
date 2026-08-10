CREATE TABLE "production_recovery_report" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"mode" text NOT NULL,
	"recovered" integer NOT NULL,
	"recovered_qty" double precision NOT NULL,
	"already_restored" integer NOT NULL,
	"unrecoverable" integer NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint

-- slot_key is the new logical-identity column behind #24's additive-collection
-- fix (see db/schemas/index.ts for the full rationale). It can't be added
-- NOT NULL in one step on a table that may already have rows, so: add it
-- nullable, backfill every pre-existing row with a slot derived from its OWN
-- client_uuid (which is already globally unique), THEN tighten to NOT NULL +
-- add the uniqueness constraint. Backfilling from client_uuid can never
-- collide, so this is safe to run against any amount of existing data and is
-- idempotent — the WHERE guard means a re-run only touches rows a previous
-- run left NULL (there shouldn't be any, but matches the 0039 backfill's
-- defensive style).
ALTER TABLE "production_records" ADD COLUMN "slot_key" text;--> statement-breakpoint

UPDATE production_records
SET slot_key = substring(captured_at, 1, 10) || ':' || coalesce(product_id, 'none') || ':' || client_uuid
WHERE slot_key IS NULL;--> statement-breakpoint

ALTER TABLE "production_records" ALTER COLUMN "slot_key" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "production_records" ADD CONSTRAINT "production_records_tenant_batch_slot_unique" UNIQUE("tenant_id","batch_id","slot_key");
