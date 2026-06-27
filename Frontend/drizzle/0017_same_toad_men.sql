CREATE TABLE "employee_ledger" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"employee_id" text NOT NULL,
	"type" text NOT NULL,
	"amount" double precision NOT NULL,
	"note" text,
	"period" text NOT NULL,
	"date" text NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payslips" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"employee_id" text NOT NULL,
	"period" text NOT NULL,
	"gross" double precision NOT NULL,
	"advances" double precision DEFAULT 0 NOT NULL,
	"fines" double precision DEFAULT 0 NOT NULL,
	"bonuses" double precision DEFAULT 0 NOT NULL,
	"net" double precision NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"paid_at" text,
	"created_at" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "payments_from" text;