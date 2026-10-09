-- Operating expenses that are not stock (issue #416).
-- New accounts, a category catalogue, and an expenses table. No existing
-- column is rewritten and no historical journal line is inserted, so a
-- period that has no expense rows keeps the same P&L and trial balance.
INSERT INTO "accounts" ("id", "code", "name", "class", "normal_balance")
VALUES
  ('acct-5010', '5010', 'Transport and delivery', 'EXPENSE', 'DEBIT'),
  ('acct-5011', '5011', 'Casual labour', 'EXPENSE', 'DEBIT'),
  ('acct-5012', '5012', 'Veterinary and animal health', 'EXPENSE', 'DEBIT'),
  ('acct-5013', '5013', 'Airtime and communication', 'EXPENSE', 'DEBIT'),
  ('acct-5019', '5019', 'General operating expense', 'EXPENSE', 'DEBIT')
ON CONFLICT ("code") DO NOTHING;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "expense_categories" (
  "id" text PRIMARY KEY NOT NULL,
  "code" text NOT NULL,
  "name" text NOT NULL,
  "account_code" text NOT NULL,
  "active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_expense_categories_code" ON "expense_categories" USING btree ("code");
--> statement-breakpoint
INSERT INTO "expense_categories" ("id", "code", "name", "account_code", "active")
VALUES
  ('expcat-transport', 'transport', 'Transport and delivery', '5010', true),
  ('expcat-casual-labour', 'casual_labour', 'Casual labour', '5011', true),
  ('expcat-veterinary', 'veterinary', 'Veterinary and animal health', '5012', true),
  ('expcat-airtime', 'airtime', 'Airtime and communication', '5013', true),
  ('expcat-general', 'general', 'General operating expense', '5019', true)
ON CONFLICT ("code") DO NOTHING;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "expenses" (
  "id" text PRIMARY KEY NOT NULL,
  "tenant_id" text NOT NULL,
  "payee" text NOT NULL,
  "supplier_id" text,
  "category_id" text NOT NULL,
  "amount_cents" bigint NOT NULL,
  "amount_paid_cents" bigint DEFAULT 0 NOT NULL,
  "payment_method" text DEFAULT '' NOT NULL,
  "payment_reference" text,
  "farm_id" text,
  "unit_id" text,
  "notes" text,
  "photo_url" text,
  "transaction_date" timestamp,
  "posting_date" timestamp,
  "recorded_by" text,
  "reversed_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "expenses" ADD CONSTRAINT "expenses_category_id_expense_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."expense_categories"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_expenses_tenant" ON "expenses" USING btree ("tenant_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_expenses_tenant_posting" ON "expenses" USING btree ("tenant_id","posting_date");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_expenses_farm" ON "expenses" USING btree ("farm_id");
