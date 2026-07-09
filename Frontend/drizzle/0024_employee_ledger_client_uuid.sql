ALTER TABLE "employee_ledger" ADD COLUMN "client_uuid" text;--> statement-breakpoint
ALTER TABLE "employee_ledger" ADD CONSTRAINT "employee_ledger_client_uuid_unique" UNIQUE("client_uuid");