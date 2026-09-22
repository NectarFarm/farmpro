-- Supplier and customer masters (item 20). Two small tenant-scoped tables —
-- name, phone, contact, optional TIN, free-text credit terms, active flag.
-- purchases.supplier_id / sales.customer_id are optional links on top of the
-- existing free-text purchases.supplier / sales.sold_to (migration 0045) —
-- neither existing column changes meaning, and an old row or a genuine
-- one-off purchase/sale with no master behind it keeps saving exactly as
-- before. No backfill: there is no reliable way to match free-text supplier/
-- buyer strings to a real master without guessing, so every existing row's
-- new *_id column starts and stays null until someone links it forward.
CREATE TABLE "customers" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"name" text NOT NULL,
	"phone" text DEFAULT '' NOT NULL,
	"contact" text DEFAULT '' NOT NULL,
	"tin" text,
	"credit_terms" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "suppliers" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"name" text NOT NULL,
	"phone" text DEFAULT '' NOT NULL,
	"contact" text DEFAULT '' NOT NULL,
	"tin" text,
	"credit_terms" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sales" ADD COLUMN "customer_id" text;--> statement-breakpoint
ALTER TABLE "purchases" ADD COLUMN "supplier_id" text;--> statement-breakpoint
CREATE INDEX "idx_customers_tenant" ON "customers" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_suppliers_tenant" ON "suppliers" USING btree ("tenant_id");