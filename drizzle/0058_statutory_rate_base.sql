-- Kenyan payroll follow-up (issue #420).
-- A fixed statutory amount was stored in rate_bps as cents. It gets its own
-- column, and rate_bps is only filled for a percent. Each rate row also says
-- whether the employee amount it produces reduces the pay PAYE is charged on.
-- Existing NSSF and SHIF employee rows default to reducing it, which is what
-- Kenyan law allows; every other row does not.

ALTER TABLE "statutory_rates" ADD COLUMN IF NOT EXISTS "amount_cents" bigint;--> statement-breakpoint
ALTER TABLE "statutory_rates" ADD COLUMN IF NOT EXISTS "reduces_paye_base" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "statutory_rates" ALTER COLUMN "rate_bps" DROP NOT NULL;--> statement-breakpoint
UPDATE "statutory_rates" SET "amount_cents" = "rate_bps", "rate_bps" = NULL WHERE "kind" = 'fixed' AND "amount_cents" IS NULL;--> statement-breakpoint
UPDATE "statutory_rates" SET "rate_bps" = NULL WHERE "kind" = 'bracket';--> statement-breakpoint
UPDATE "statutory_rates" SET "reduces_paye_base" = true WHERE "code" IN ('NSSF', 'SHIF') AND "payer" = 'employee';
