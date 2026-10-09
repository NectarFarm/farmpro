-- VAT codes, rates, and a gross / tax / net split (issue #419).
-- New accounts, new tables, and new nullable columns. No existing row is
-- updated and no journal line is inserted. No rate is seeded: a VATable
-- document whose posting date has no rate is refused, not taxed at a guess.
INSERT INTO "accounts" ("id", "code", "name", "class", "normal_balance")
VALUES
  ('acct-1300', '1300', 'VAT receivable', 'ASSET', 'DEBIT'),
  ('acct-2300', '2300', 'VAT payable', 'LIABILITY', 'CREDIT')
ON CONFLICT ("code") DO NOTHING;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tax_codes" (
  "id" text PRIMARY KEY NOT NULL,
  "code" text NOT NULL,
  "name" text NOT NULL,
  "active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_tax_codes_code" ON "tax_codes" USING btree ("code");
--> statement-breakpoint
INSERT INTO "tax_codes" ("id", "code", "name", "active")
VALUES
  ('taxcode-vatable', 'VATABLE', 'VATable', true),
  ('taxcode-zero-rated', 'ZERO_RATED', 'Zero-rated', true),
  ('taxcode-exempt', 'EXEMPT', 'Exempt', true),
  ('taxcode-outside-scope', 'OUTSIDE_SCOPE', 'Outside scope', true)
ON CONFLICT ("code") DO NOTHING;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tax_rates" (
  "id" text PRIMARY KEY NOT NULL,
  "tax_code" text NOT NULL,
  "rate_bps" integer NOT NULL,
  "effective_from" date NOT NULL,
  "effective_to" date,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_tax_rates_code" ON "tax_rates" USING btree ("tax_code");
--> statement-breakpoint
ALTER TABLE "sales"
  ADD COLUMN IF NOT EXISTS "tax_code" text,
  ADD COLUMN IF NOT EXISTS "tax_inclusive" boolean,
  ADD COLUMN IF NOT EXISTS "gross_cents" bigint,
  ADD COLUMN IF NOT EXISTS "tax_cents" bigint,
  ADD COLUMN IF NOT EXISTS "net_cents" bigint;
--> statement-breakpoint
ALTER TABLE "purchases"
  ADD COLUMN IF NOT EXISTS "tax_code" text,
  ADD COLUMN IF NOT EXISTS "tax_inclusive" boolean,
  ADD COLUMN IF NOT EXISTS "gross_cents" bigint,
  ADD COLUMN IF NOT EXISTS "tax_cents" bigint,
  ADD COLUMN IF NOT EXISTS "net_cents" bigint;
--> statement-breakpoint
ALTER TABLE "expenses"
  ADD COLUMN IF NOT EXISTS "tax_code" text,
  ADD COLUMN IF NOT EXISTS "tax_inclusive" boolean,
  ADD COLUMN IF NOT EXISTS "gross_cents" bigint,
  ADD COLUMN IF NOT EXISTS "tax_cents" bigint,
  ADD COLUMN IF NOT EXISTS "net_cents" bigint;
