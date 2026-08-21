ALTER TABLE "tasks" ADD COLUMN "farm_id" text;--> statement-breakpoint
ALTER TABLE "inventory_lots" ADD COLUMN "farm_id" text;--> statement-breakpoint
ALTER TABLE "purchases" ADD COLUMN "farm_id" text;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "farm_id" text;--> statement-breakpoint
CREATE INDEX "idx_tasks_farm" ON "tasks" USING btree ("farm_id");--> statement-breakpoint
CREATE INDEX "idx_inventory_lots_farm" ON "inventory_lots" USING btree ("farm_id");--> statement-breakpoint
CREATE INDEX "idx_purchases_farm" ON "purchases" USING btree ("farm_id");--> statement-breakpoint
CREATE INDEX "idx_employees_farm" ON "employees" USING btree ("farm_id");--> statement-breakpoint
-- ── Backfill (farm-scoped-data task) ────────────────────────────────────────
-- The four columns above are nullable because a NOT NULL column can't be
-- added to a populated table with nothing correct to put in it. But leaving
-- every pre-existing row NULL and then having the API/UI treat "no farmId
-- filter selected" the same as "this row has no farm" would make all
-- existing production data silently vanish the moment someone picks a real
-- farm in the switcher — worse than today's bug, where at least the numbers
-- are visible (just unfiltered). So: assign every existing row to its
-- tenant's PRIMARY farm, defined as the tenant's earliest-created farm
-- (lowest created_at, id as a stable tiebreak) — the same farm that is
-- "the only farm" for every tenant that has just one, which is the common
-- case today. A tenant with zero farms yields NULL from the subquery and the
-- row stays NULL — there is genuinely no farm to assign it to; see
-- lib/farm-scope.ts for how a NULL farm_id is treated at read time (never
-- silently dropped from an unfiltered or ALL-farms view).
UPDATE "tasks" t
SET "farm_id" = (
  SELECT f.id FROM "farms" f WHERE f.tenant_id = t.tenant_id ORDER BY f.created_at ASC, f.id ASC LIMIT 1
)
WHERE t."farm_id" IS NULL;--> statement-breakpoint

UPDATE "inventory_lots" l
SET "farm_id" = (
  SELECT f.id FROM "farms" f WHERE f.tenant_id = l.tenant_id ORDER BY f.created_at ASC, f.id ASC LIMIT 1
)
WHERE l."farm_id" IS NULL;--> statement-breakpoint

UPDATE "purchases" p
SET "farm_id" = (
  SELECT f.id FROM "farms" f WHERE f.tenant_id = p.tenant_id ORDER BY f.created_at ASC, f.id ASC LIMIT 1
)
WHERE p."farm_id" IS NULL;--> statement-breakpoint

UPDATE "employees" e
SET "farm_id" = (
  SELECT f.id FROM "farms" f WHERE f.tenant_id = e.tenant_id ORDER BY f.created_at ASC, f.id ASC LIMIT 1
)
WHERE e."farm_id" IS NULL;