-- Approval thresholds on money (issue #424).
-- Nullable approval_status on the three money documents. Null means the
-- document was posted when it was recorded, which is every existing row.
-- No row is updated and no journal line is rewritten.
-- posting_policies starts empty. No policy means a document still posts
-- immediately. The stock-count column variance_approval_threshold_cents is
-- left where it is and is not copied into this table.
ALTER TABLE "sales" ADD COLUMN IF NOT EXISTS "approval_status" text;
--> statement-breakpoint
ALTER TABLE "purchases" ADD COLUMN IF NOT EXISTS "approval_status" text;
--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN IF NOT EXISTS "approval_status" text;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "posting_policies" (
  "id" text PRIMARY KEY NOT NULL,
  "tenant_id" text NOT NULL,
  "kind" text NOT NULL,
  "account_code" text,
  "farm_id" text,
  "threshold_cents" bigint NOT NULL,
  "effect" text NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_posting_policies_tenant" ON "posting_policies" USING btree ("tenant_id");
