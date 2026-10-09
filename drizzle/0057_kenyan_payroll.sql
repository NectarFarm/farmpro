-- Kenyan payroll (issue #420).
-- Existing runs already have journals, so they are marked paid. Their
-- total_amount_cents is not rewritten. No PAYE, NSSF or SHIF rate is inserted.
-- The period unique index becomes a lookup: overlap is per employee.

ALTER TABLE "payroll_runs" ADD COLUMN IF NOT EXISTS "status" text;--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD COLUMN IF NOT EXISTS "pay_date" timestamp;--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD COLUMN IF NOT EXISTS "payment_method" text;--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD COLUMN IF NOT EXISTS "payment_reference" text;--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD COLUMN IF NOT EXISTS "gross_cents" bigint;--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD COLUMN IF NOT EXISTS "deduction_cents" bigint;--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD COLUMN IF NOT EXISTS "net_cents" bigint;--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD COLUMN IF NOT EXISTS "employer_cost_cents" bigint;--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD COLUMN IF NOT EXISTS "approval_status" text;--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD COLUMN IF NOT EXISTS "shared_farm_id" text;--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD COLUMN IF NOT EXISTS "dimension_overrides" text;--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD COLUMN IF NOT EXISTS "statutory_note" text;--> statement-breakpoint
ALTER TABLE "payslips" ADD COLUMN IF NOT EXISTS "gross_cents" bigint;--> statement-breakpoint
ALTER TABLE "payslips" ADD COLUMN IF NOT EXISTS "deduction_cents" bigint;--> statement-breakpoint
ALTER TABLE "payslips" ADD COLUMN IF NOT EXISTS "net_cents" bigint;--> statement-breakpoint
ALTER TABLE "payslips" ADD COLUMN IF NOT EXISTS "employer_cost_cents" bigint;--> statement-breakpoint
ALTER TABLE "payslips" ADD COLUMN IF NOT EXISTS "pay_basis" text;--> statement-breakpoint
ALTER TABLE "payslips" ADD COLUMN IF NOT EXISTS "days_worked" integer;--> statement-breakpoint
ALTER TABLE "payslips" ADD COLUMN IF NOT EXISTS "daily_rate_cents" bigint;--> statement-breakpoint
ALTER TABLE "payslips" ADD COLUMN IF NOT EXISTS "overtime_hours" real;--> statement-breakpoint
ALTER TABLE "payslips" ADD COLUMN IF NOT EXISTS "overtime_rate_cents" bigint;--> statement-breakpoint
UPDATE "payroll_runs" SET "status" = 'paid' WHERE "status" IS NULL;--> statement-breakpoint
DROP INDEX IF EXISTS "idx_payroll_runs_tenant_period";--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_payroll_runs_tenant_period" ON "payroll_runs" USING btree ("tenant_id","period_start","period_end");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "payslip_lines" (
  "id" text PRIMARY KEY NOT NULL,
  "tenant_id" text NOT NULL,
  "payslip_id" text NOT NULL,
  "kind" text NOT NULL,
  "label" text NOT NULL,
  "amount_cents" bigint NOT NULL
);--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "payslip_lines" ADD CONSTRAINT "payslip_lines_payslip_id_payslips_id_fk" FOREIGN KEY ("payslip_id") REFERENCES "public"."payslips"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_payslip_lines_payslip" ON "payslip_lines" USING btree ("payslip_id");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "statutory_rates" (
  "id" text PRIMARY KEY NOT NULL,
  "code" text NOT NULL,
  "payer" text NOT NULL,
  "kind" text NOT NULL,
  "rate_bps" integer NOT NULL,
  "brackets" text,
  "ceiling_cents" bigint,
  "floor_cents" bigint,
  "effective_from" date NOT NULL,
  "effective_to" date,
  "created_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_statutory_rates_code" ON "statutory_rates" USING btree ("code");
