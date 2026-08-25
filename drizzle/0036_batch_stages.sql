CREATE TABLE "batch_stages" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"enterprise" text NOT NULL,
	"name" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"typical_days" integer,
	"created_at" timestamp DEFAULT now()
);--> statement-breakpoint
CREATE INDEX "idx_batch_stages_tenant" ON "batch_stages" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_batch_stages_tenant_enterprise" ON "batch_stages" USING btree ("tenant_id","enterprise");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_batch_stages_unique" ON "batch_stages" USING btree ("tenant_id","enterprise","name");--> statement-breakpoint

-- ── Backfill ───────────────────────────────────────────────────────────────
-- Without this, every existing farm opens the new stage dropdown to an empty
-- list and cannot advance a LIVE batch — and worse, PATCH /api/batches/[id]
-- now validates `stage` against this table, so a farm whose batches sit at
-- "Grower" would find "Grower" rejected as unconfigured. That is the "existing
-- rows left in a broken state" case, so the stage names each tenant already
-- uses are seeded from ground truth: their own batches.
--
-- `sort_order` is derived from the earliest batch that reached each stage
-- (min(start_date)), which approximates the real progression far better than
-- alphabetical would — Starter/Grower/Finisher is not alphabetical, and
-- guessing wrong makes the "next stage" default point backwards. It is a
-- starting point the farmer can reorder, not a claim to be correct.
--
-- `typical_days` is deliberately left NULL. The duration of a backfilled stage
-- is genuinely unknown — nothing in the schema ever recorded it — and putting a
-- fabricated number in the one field a farmer would most trust is worse than
-- showing "not set". Same honest-empty-state rule the rest of the app follows.
--
-- Names are stored trimmed but with their original casing (display value);
-- collisions that differ only by case are collapsed by the GROUP BY on
-- lower(), keeping whichever spelling sorts first, so the unique index cannot
-- be violated by a farm that has both "grower" and "Grower" in flight.
INSERT INTO "batch_stages" ("id", "tenant_id", "enterprise", "name", "sort_order", "typical_days", "created_at")
SELECT
	gen_random_uuid()::text,
	s."tenant_id",
	s."enterprise",
	s."name",
	(row_number() OVER (PARTITION BY s."tenant_id", s."enterprise" ORDER BY s."first_seen", s."name") - 1) * 10,
	NULL,
	now()
FROM (
	SELECT
		b."tenant_id"                AS "tenant_id",
		lower(trim(b."enterprise"))  AS "enterprise",
		min(trim(b."stage"))         AS "name",
		min(b."start_date")          AS "first_seen"
	FROM "batches" b
	WHERE b."stage" IS NOT NULL
		AND trim(b."stage") <> ''
		AND b."enterprise" IS NOT NULL
		AND trim(b."enterprise") <> ''
	GROUP BY b."tenant_id", lower(trim(b."enterprise")), lower(trim(b."stage"))
) s
ON CONFLICT ("tenant_id", "enterprise", "name") DO NOTHING;
