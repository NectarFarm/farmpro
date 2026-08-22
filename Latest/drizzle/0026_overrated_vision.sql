CREATE TABLE "payroll_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"period_start" timestamp NOT NULL,
	"period_end" timestamp NOT NULL,
	"total_amount_cents" bigint DEFAULT 0 NOT NULL,
	"employee_count" integer DEFAULT 0 NOT NULL,
	"created_by_user_id" text NOT NULL,
	"memo" text DEFAULT '' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payslips" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"run_id" text NOT NULL,
	"employee_id" text NOT NULL,
	"employee_name" text NOT NULL,
	"amount_cents" bigint NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "monthly_salary_cents" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "payslips" ADD CONSTRAINT "payslips_run_id_payroll_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."payroll_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payslips" ADD CONSTRAINT "payslips_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_payroll_runs_tenant" ON "payroll_runs" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_payroll_runs_tenant_period" ON "payroll_runs" USING btree ("tenant_id","period_start","period_end");--> statement-breakpoint
CREATE INDEX "idx_payslips_tenant" ON "payslips" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_payslips_run" ON "payslips" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "idx_payslips_employee" ON "payslips" USING btree ("employee_id");