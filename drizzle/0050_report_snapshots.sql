CREATE TABLE IF NOT EXISTS "report_snapshots" (
  "id" text PRIMARY KEY NOT NULL,
  "tenant_id" text NOT NULL,
  "report_type" text NOT NULL,
  "status" text DEFAULT 'GENERATED' NOT NULL,
  "purpose" text DEFAULT 'Internal' NOT NULL,
  "farm_id" text,
  "payload" jsonb NOT NULL,
  "payload_hash" text NOT NULL,
  "public_token" text NOT NULL,
  "created_by" text NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "attested_by" text,
  "attested_role" text,
  "attested_at" timestamp
);
CREATE INDEX IF NOT EXISTS "idx_report_snapshots_tenant_created" ON "report_snapshots" USING btree ("tenant_id","created_at");
CREATE UNIQUE INDEX IF NOT EXISTS "idx_report_snapshots_public_token" ON "report_snapshots" USING btree ("public_token");
