ALTER TABLE "employees" ADD COLUMN "salary" double precision DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "pay_day" integer;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "assigned_batch_ids" jsonb;