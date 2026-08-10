ALTER TABLE "batches" ALTER COLUMN "acquisition_cost_cents" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "employee_ledger" ALTER COLUMN "amount_cents" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "employees" ALTER COLUMN "salary_cents" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "feed_formulas" ALTER COLUMN "unit_cost_cents" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "inventory_lots" ALTER COLUMN "unit_cost_cents" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "overheads" ALTER COLUMN "amount_cents" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "payslips" ALTER COLUMN "gross_cents" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "payslips" ALTER COLUMN "advances_cents" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "payslips" ALTER COLUMN "fines_cents" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "payslips" ALTER COLUMN "bonuses_cents" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "payslips" ALTER COLUMN "net_cents" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "processing_events" ALTER COLUMN "fee_cents" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "purchases" ALTER COLUMN "unit_cost_cents" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "purchases" ALTER COLUMN "total_cost_cents" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "purchases" ALTER COLUMN "amount_paid_cents" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "sales" ALTER COLUMN "unit_price_cents" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "sales" ALTER COLUMN "total_amount_cents" SET DATA TYPE bigint;