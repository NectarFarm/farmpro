CREATE TABLE "dimensions" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"level_count" integer DEFAULT 1 NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 100 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dimension_levels" (
	"id" text PRIMARY KEY NOT NULL,
	"dimension_id" text NOT NULL,
	"ordinal" integer NOT NULL,
	"name" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dimension_values" (
	"id" text PRIMARY KEY NOT NULL,
	"dimension_id" text NOT NULL,
	"tenant_id" text NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"level_ordinal" integer DEFAULT 1 NOT NULL,
	"parent_value_id" text,
	"source_type" text,
	"source_id" text,
	"archived" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "default_dimensions" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"master_type" text NOT NULL,
	"master_id" text NOT NULL,
	"dimension_id" text NOT NULL,
	"dimension_value_id" text,
	"requirement" text DEFAULT 'optional' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_dimensions" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"doc_type" text NOT NULL,
	"doc_id" text NOT NULL,
	"dimension_id" text NOT NULL,
	"value_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "journal_line_dimensions" (
	"id" text PRIMARY KEY NOT NULL,
	"line_id" text NOT NULL,
	"dimension_id" text NOT NULL,
	"value_id" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "journal_entries" ADD COLUMN "farm_id" text;--> statement-breakpoint
ALTER TABLE "batches" ADD COLUMN "enterprise_type" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "dimension_levels" ADD CONSTRAINT "dimension_levels_dimension_id_dimensions_id_fk" FOREIGN KEY ("dimension_id") REFERENCES "public"."dimensions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dimension_values" ADD CONSTRAINT "dimension_values_dimension_id_dimensions_id_fk" FOREIGN KEY ("dimension_id") REFERENCES "public"."dimensions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "default_dimensions" ADD CONSTRAINT "default_dimensions_dimension_id_dimensions_id_fk" FOREIGN KEY ("dimension_id") REFERENCES "public"."dimensions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "default_dimensions" ADD CONSTRAINT "default_dimensions_dimension_value_id_dimension_values_id_fk" FOREIGN KEY ("dimension_value_id") REFERENCES "public"."dimension_values"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_dimensions" ADD CONSTRAINT "document_dimensions_dimension_id_dimensions_id_fk" FOREIGN KEY ("dimension_id") REFERENCES "public"."dimensions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_dimensions" ADD CONSTRAINT "document_dimensions_value_id_dimension_values_id_fk" FOREIGN KEY ("value_id") REFERENCES "public"."dimension_values"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_line_dimensions" ADD CONSTRAINT "journal_line_dimensions_line_id_journal_lines_id_fk" FOREIGN KEY ("line_id") REFERENCES "public"."journal_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_line_dimensions" ADD CONSTRAINT "journal_line_dimensions_dimension_id_dimensions_id_fk" FOREIGN KEY ("dimension_id") REFERENCES "public"."dimensions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_line_dimensions" ADD CONSTRAINT "journal_line_dimensions_value_id_dimension_values_id_fk" FOREIGN KEY ("value_id") REFERENCES "public"."dimension_values"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_dimensions_tenant" ON "dimensions" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_dimensions_tenant_code" ON "dimensions" USING btree ("tenant_id","code");--> statement-breakpoint
CREATE INDEX "idx_dimension_levels_dimension" ON "dimension_levels" USING btree ("dimension_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_dimension_levels_dimension_ordinal" ON "dimension_levels" USING btree ("dimension_id","ordinal");--> statement-breakpoint
CREATE INDEX "idx_dimension_values_dimension" ON "dimension_values" USING btree ("dimension_id");--> statement-breakpoint
CREATE INDEX "idx_dimension_values_tenant" ON "dimension_values" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_dimension_values_dimension_code" ON "dimension_values" USING btree ("dimension_id","code");--> statement-breakpoint
CREATE INDEX "idx_dimension_values_source" ON "dimension_values" USING btree ("source_type","source_id");--> statement-breakpoint
CREATE INDEX "idx_dimension_values_parent" ON "dimension_values" USING btree ("parent_value_id");--> statement-breakpoint
CREATE INDEX "idx_default_dimensions_tenant" ON "default_dimensions" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_default_dimensions_master" ON "default_dimensions" USING btree ("tenant_id","master_type","master_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_default_dimensions_master_dimension" ON "default_dimensions" USING btree ("tenant_id","master_type","master_id","dimension_id");--> statement-breakpoint
CREATE INDEX "idx_document_dimensions_doc" ON "document_dimensions" USING btree ("doc_type","doc_id");--> statement-breakpoint
CREATE INDEX "idx_document_dimensions_tenant" ON "document_dimensions" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_document_dimensions_doc_dimension" ON "document_dimensions" USING btree ("doc_type","doc_id","dimension_id");--> statement-breakpoint
CREATE INDEX "idx_journal_line_dimensions_line" ON "journal_line_dimensions" USING btree ("line_id");--> statement-breakpoint
CREATE INDEX "idx_journal_line_dimensions_dimension_value" ON "journal_line_dimensions" USING btree ("dimension_id","value_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_journal_line_dimensions_line_dimension" ON "journal_line_dimensions" USING btree ("line_id","dimension_id");--> statement-breakpoint
CREATE INDEX "idx_journal_entries_tenant_farm" ON "journal_entries" USING btree ("tenant_id","farm_id");
--> statement-breakpoint
-- ── Backfill (dimensions-on-gl task) ────────────────────────────────────────
-- Without this, every tenant that existed before this migration gets an
-- EMPTY dimension layer — no UNIT/FARM/BATCH/ENTERPRISE dimensions, no
-- projected values for their real farms/units/batches, nothing for a
-- posting to derive. This block is the one-time equivalent of calling
-- lib/dimensions.ts's reconcileSystemDimensions() for every tenant that
-- already has data; new tenants provisioned after this migration get their
-- system dimensions lazily (ensureSystemDimensions runs on first posting/
-- projection instead of needing a migration each time).
--
-- Idempotent throughout (ON CONFLICT DO NOTHING on the same unique indexes
-- lib/dimensions.ts's upserts use) — safe to have run once by drizzle-kit's
-- migration tracking, and harmless if it were ever run twice.
--
-- Seed the four system dimensions for every tenant that exists today. UNIT
-- first (sort_order 1) per the owner's instruction that Production Unit is
-- the default analysis axis.
INSERT INTO "dimensions" ("id", "tenant_id", "code", "name", "level_count", "is_system", "sort_order", "created_at")
SELECT gen_random_uuid(), t."id", d.code, d.name, 1, true, d.sort_order, now()
FROM "tenants" t
CROSS JOIN (VALUES
  ('UNIT', 'Production Unit', 1),
  ('FARM', 'Farm', 2),
  ('BATCH', 'Batch', 3),
  ('ENTERPRISE', 'Enterprise', 4)
) AS d(code, name, sort_order)
ON CONFLICT ("tenant_id", "code") DO NOTHING;
--> statement-breakpoint
-- One ordinal-1 level per system dimension, named after the dimension
-- itself (every system dimension is single-level today).
INSERT INTO "dimension_levels" ("id", "dimension_id", "ordinal", "name")
SELECT gen_random_uuid(), dm."id", 1, dm."name"
FROM "dimensions" dm
WHERE dm."is_system" = true
ON CONFLICT ("dimension_id", "ordinal") DO NOTHING;
--> statement-breakpoint
-- Project every existing farm into the FARM dimension.
INSERT INTO "dimension_values" ("id", "dimension_id", "tenant_id", "code", "name", "level_ordinal", "parent_value_id", "source_type", "source_id", "archived", "created_at")
SELECT gen_random_uuid(), dm."id", f."tenant_id", f."code", f."name", 1, NULL, 'farm', f."id", false, now()
FROM "farms" f
JOIN "dimensions" dm ON dm."tenant_id" = f."tenant_id" AND dm."code" = 'FARM'
ON CONFLICT ("dimension_id", "code") DO NOTHING;
--> statement-breakpoint
-- Every farm defaults ITSELF for the FARM dimension (a farm IS a Farm).
INSERT INTO "default_dimensions" ("id", "tenant_id", "master_type", "master_id", "dimension_id", "dimension_value_id", "requirement", "created_at")
SELECT gen_random_uuid(), f."tenant_id", 'farm', f."id", dm."id", dv."id", 'optional', now()
FROM "farms" f
JOIN "dimensions" dm ON dm."tenant_id" = f."tenant_id" AND dm."code" = 'FARM'
JOIN "dimension_values" dv ON dv."dimension_id" = dm."id" AND dv."source_type" = 'farm' AND dv."source_id" = f."id"
ON CONFLICT ("tenant_id", "master_type", "master_id", "dimension_id") DO NOTHING;
--> statement-breakpoint
-- Project every existing production unit into the UNIT dimension.
INSERT INTO "dimension_values" ("id", "dimension_id", "tenant_id", "code", "name", "level_ordinal", "parent_value_id", "source_type", "source_id", "archived", "created_at")
SELECT gen_random_uuid(), dm."id", u."tenant_id", u."code", u."name", 1, NULL, 'unit', u."id", false, now()
FROM "production_units" u
JOIN "dimensions" dm ON dm."tenant_id" = u."tenant_id" AND dm."code" = 'UNIT'
ON CONFLICT ("dimension_id", "code") DO NOTHING;
--> statement-breakpoint
INSERT INTO "default_dimensions" ("id", "tenant_id", "master_type", "master_id", "dimension_id", "dimension_value_id", "requirement", "created_at")
SELECT gen_random_uuid(), u."tenant_id", 'unit', u."id", dm."id", dv."id", 'optional', now()
FROM "production_units" u
JOIN "dimensions" dm ON dm."tenant_id" = u."tenant_id" AND dm."code" = 'UNIT'
JOIN "dimension_values" dv ON dv."dimension_id" = dm."id" AND dv."source_type" = 'unit' AND dv."source_id" = u."id"
ON CONFLICT ("tenant_id", "master_type", "master_id", "dimension_id") DO NOTHING;
--> statement-breakpoint
-- Project every existing batch into the BATCH dimension.
INSERT INTO "dimension_values" ("id", "dimension_id", "tenant_id", "code", "name", "level_ordinal", "parent_value_id", "source_type", "source_id", "archived", "created_at")
SELECT gen_random_uuid(), dm."id", b."tenant_id", b."code", b."name", 1, NULL, 'batch', b."id", false, now()
FROM "batches" b
JOIN "dimensions" dm ON dm."tenant_id" = b."tenant_id" AND dm."code" = 'BATCH'
ON CONFLICT ("dimension_id", "code") DO NOTHING;
--> statement-breakpoint
INSERT INTO "default_dimensions" ("id", "tenant_id", "master_type", "master_id", "dimension_id", "dimension_value_id", "requirement", "created_at")
SELECT gen_random_uuid(), b."tenant_id", 'batch', b."id", dm."id", dv."id", 'optional', now()
FROM "batches" b
JOIN "dimensions" dm ON dm."tenant_id" = b."tenant_id" AND dm."code" = 'BATCH'
JOIN "dimension_values" dv ON dv."dimension_id" = dm."id" AND dv."source_type" = 'batch' AND dv."source_id" = b."id"
ON CONFLICT ("tenant_id", "master_type", "master_id", "dimension_id") DO NOTHING;
--> statement-breakpoint
-- ENTERPRISE is keyed on the subtype itself, one value shared by every batch
-- of that subtype — NOT one value per batch (see lib/dimensions.ts's
-- projectBatch comment).
INSERT INTO "dimension_values" ("id", "dimension_id", "tenant_id", "code", "name", "level_ordinal", "parent_value_id", "source_type", "source_id", "archived", "created_at")
SELECT gen_random_uuid(), dm."id", e."tenant_id", e."enterprise", initcap(replace(e."enterprise", '_', ' ')), 1, NULL, NULL, NULL, false, now()
FROM (SELECT DISTINCT "tenant_id", "enterprise" FROM "batches") e
JOIN "dimensions" dm ON dm."tenant_id" = e."tenant_id" AND dm."code" = 'ENTERPRISE'
ON CONFLICT ("dimension_id", "code") DO NOTHING;
--> statement-breakpoint
INSERT INTO "default_dimensions" ("id", "tenant_id", "master_type", "master_id", "dimension_id", "dimension_value_id", "requirement", "created_at")
SELECT gen_random_uuid(), b."tenant_id", 'batch', b."id", dm."id", dv."id", 'optional', now()
FROM "batches" b
JOIN "dimensions" dm ON dm."tenant_id" = b."tenant_id" AND dm."code" = 'ENTERPRISE'
JOIN "dimension_values" dv ON dv."dimension_id" = dm."id" AND dv."code" = b."enterprise"
ON CONFLICT ("tenant_id", "master_type", "master_id", "dimension_id") DO NOTHING;
--> statement-breakpoint
-- batches.enterprise_type (crop vs livestock, made explicit): backfill every
-- existing row from the same map lib/codes.ts's ENTERPRISE_TYPES has always
-- used, so no existing batch's classification changes because this column
-- now exists. An enterprise subtype the map doesn't know keeps '' (unknown),
-- exactly what lib/codes.ts's batchEnterpriseType() falls back to
-- enterpriseTypeFor() for.
UPDATE "batches" SET "enterprise_type" = CASE "enterprise"
  WHEN 'broiler' THEN 'livestock'
  WHEN 'layer' THEN 'livestock'
  WHEN 'pig' THEN 'livestock'
  WHEN 'dairy_cow' THEN 'livestock'
  WHEN 'beef_cow' THEN 'livestock'
  WHEN 'goat' THEN 'livestock'
  WHEN 'sheep' THEN 'livestock'
  WHEN 'rabbit' THEN 'livestock'
  WHEN 'turkey' THEN 'livestock'
  WHEN 'duck' THEN 'livestock'
  WHEN 'fish' THEN 'livestock'
  WHEN 'maize' THEN 'crop'
  WHEN 'wheat' THEN 'crop'
  WHEN 'sorghum' THEN 'crop'
  WHEN 'kitchen_garden' THEN 'crop'
  WHEN 'silage' THEN 'crop'
  WHEN 'fruit_orchard' THEN 'crop'
  WHEN 'vegetables' THEN 'crop'
  WHEN 'legumes' THEN 'crop'
  WHEN 'fodder' THEN 'crop'
  ELSE ''
END
WHERE "enterprise_type" = '';
