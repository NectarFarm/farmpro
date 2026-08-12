-- Real multi-farm support (issue #219): a `farms` table that production_units.farm_id
-- foreign-keys into. Before this migration farm_id was a required text column with no
-- table behind it (the unit/setup routes hardcoded 'f1').
-- Idempotent: re-running against a partially-applied DB is a no-op (repo convention,
-- see 0035/0037).

CREATE TABLE IF NOT EXISTS "farms" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"name" text NOT NULL,
	"location" text DEFAULT '' NOT NULL,
	"code" text NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_farms_tenant" ON "farms" USING btree ("tenant_id");--> statement-breakpoint
-- Backfill: legacy farm_id values (e.g. 'f1') were reused across tenants, so the
-- new farm id is tenant-scoped (`tenant_id--farm_id`) to stay globally unique.
-- ON CONFLICT makes re-runs a no-op; the UPDATE below only touches rows that still
-- hold the legacy value, so it too is idempotent.
INSERT INTO "farms" ("id", "tenant_id", "name", "location", "code", "created_at")
SELECT DISTINCT
	pu."tenant_id" || '--' || pu."farm_id",
	pu."tenant_id",
	pu."farm_id",
	'',
	pu."farm_id",
	now()
FROM "production_units" pu
WHERE pu."farm_id" IS NOT NULL
ON CONFLICT ("id") DO NOTHING;--> statement-breakpoint
UPDATE "production_units" pu
SET "farm_id" = pu."tenant_id" || '--' || pu."farm_id"
FROM "farms" f
WHERE f."id" = pu."tenant_id" || '--' || pu."farm_id"
	AND pu."farm_id" <> f."id";--> statement-breakpoint
DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM pg_constraint
		WHERE conname = 'production_units_farm_id_farms_id_fk'
	) THEN
		ALTER TABLE "production_units"
		ADD CONSTRAINT "production_units_farm_id_farms_id_fk"
		FOREIGN KEY ("farm_id") REFERENCES "public"."farms"("id")
		ON DELETE no action ON UPDATE no action;
	END IF;
END $$;
