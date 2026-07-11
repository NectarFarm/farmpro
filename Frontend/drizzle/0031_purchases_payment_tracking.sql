-- Purchases previously had no transaction date (createdAt was always "now",
-- with no way to backdate a delivery) and no payment/credit tracking at all
-- (every purchase was implicitly assumed paid in full on receipt). Existing
-- rows are backfilled as fully paid on their original createdAt, preserving
-- current behavior exactly for anything already recorded.
ALTER TABLE "purchases" ADD COLUMN "received_at" text;--> statement-breakpoint
UPDATE "purchases" SET "received_at" = "created_at" WHERE "received_at" IS NULL;--> statement-breakpoint
ALTER TABLE "purchases" ALTER COLUMN "received_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "purchases" ADD COLUMN "paid_at" text;--> statement-breakpoint
ALTER TABLE "purchases" ADD COLUMN "payment_method" text;--> statement-breakpoint
ALTER TABLE "purchases" ADD COLUMN "amount_paid" double precision NOT NULL DEFAULT 0;--> statement-breakpoint
ALTER TABLE "purchases" ADD COLUMN "amount_paid_cents" integer NOT NULL DEFAULT 0;--> statement-breakpoint
UPDATE "purchases" SET "paid_at" = "created_at", "payment_method" = 'cash',
  "amount_paid" = "total_cost", "amount_paid_cents" = "total_cost_cents"
  WHERE "paid_at" IS NULL;
