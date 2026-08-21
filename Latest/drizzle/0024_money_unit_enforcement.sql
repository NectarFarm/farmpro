-- Money unit enforcement (issue: money-unit-enforcement).
--
-- The ledger (sales.amount, journal_lines.debit/credit) stored WHOLE
-- currency units while every other money column (purchases.*Cents,
-- batches.acquisition_cost_cents, inventory_lots.unit_cost_cents) stored
-- CENTS. lib/finance.ts had to convert mid-posting to reconcile the two,
-- which is exactly the class of bug a single missed conversion turns into
-- a 100x accounting error. This migration puts every money column in cents,
-- renaming the three whole-unit columns and multiplying their existing
-- values by 100 so the real historical figures they hold are preserved
-- (KSh 100 stays KSh 100 -- it is now spelled 10000 cents instead of 100
-- whole units), then widens all eight money columns to bigint so none of
-- them are capped at `integer`'s 2,147,483,647 (~21.5M KSh once expressed
-- in cents).
--
-- Exactly-once safety: the RENAME runs before the multiply, on each table.
-- After this migration runs, no column named "amount" (on sales) or
-- "debit"/"credit" (on journal_lines) exists any more -- so re-running
-- this exact SQL a second time fails immediately at the first RENAME
-- COLUMN statement ("column \"amount\" does not exist") before it ever
-- reaches the UPDATE that multiplies by 100. (drizzle-kit's own migration
-- journal also tracks this file as applied and would not re-run it
-- through `pnpm db:migrate` regardless -- this is the belt-and-suspenders
-- guarantee on top of that.)
ALTER TABLE "sales" RENAME COLUMN "amount" TO "amount_cents";--> statement-breakpoint
ALTER TABLE "sales" ALTER COLUMN "amount_cents" TYPE bigint;--> statement-breakpoint
UPDATE "sales" SET "amount_cents" = "amount_cents" * 100;--> statement-breakpoint
ALTER TABLE "journal_lines" RENAME COLUMN "debit" TO "debit_cents";--> statement-breakpoint
ALTER TABLE "journal_lines" RENAME COLUMN "credit" TO "credit_cents";--> statement-breakpoint
ALTER TABLE "journal_lines" ALTER COLUMN "debit_cents" TYPE bigint;--> statement-breakpoint
ALTER TABLE "journal_lines" ALTER COLUMN "credit_cents" TYPE bigint;--> statement-breakpoint
UPDATE "journal_lines" SET "debit_cents" = "debit_cents" * 100, "credit_cents" = "credit_cents" * 100;--> statement-breakpoint
ALTER TABLE "batches" ALTER COLUMN "acquisition_cost_cents" TYPE bigint;--> statement-breakpoint
ALTER TABLE "inventory_lots" ALTER COLUMN "unit_cost_cents" TYPE bigint;--> statement-breakpoint
ALTER TABLE "purchases" ALTER COLUMN "unit_cost_cents" TYPE bigint;--> statement-breakpoint
ALTER TABLE "purchases" ALTER COLUMN "total_cost_cents" TYPE bigint;--> statement-breakpoint
ALTER TABLE "purchases" ALTER COLUMN "amount_paid_cents" TYPE bigint;
