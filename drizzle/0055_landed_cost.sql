-- Landed cost and multi-line receipts (issue #423).
-- New nullable columns and a new table. No existing row is updated, and no
-- journal line is inserted. A purchase with a null raw_unit_cost_cents still
-- has its raw cost in unit_cost_cents, which is every purchase recorded before
-- this migration. Purchases stay expensed; freight is not a stock item and
-- stock is not capitalised.
ALTER TABLE "purchases" ADD COLUMN IF NOT EXISTS "receipt_group_id" text;
--> statement-breakpoint
ALTER TABLE "purchases" ADD COLUMN IF NOT EXISTS "raw_unit_cost_cents" bigint;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "purchase_charges" (
  "id" text PRIMARY KEY NOT NULL,
  "tenant_id" text NOT NULL,
  "receipt_group_id" text NOT NULL,
  "kind" text NOT NULL,
  "amount_cents" bigint NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_purchase_charges_receipt" ON "purchase_charges" USING btree ("receipt_group_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_purchases_receipt_group" ON "purchases" USING btree ("receipt_group_id");
