CREATE TABLE "production_backfill_report" (
	"id" text PRIMARY KEY NOT NULL,
	"migration" text NOT NULL,
	"tenant_id" text NOT NULL,
	"resolved" integer NOT NULL,
	"unresolved" integer NOT NULL,
	"total" integer NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "production_records" ADD COLUMN "product_id" text;--> statement-breakpoint
ALTER TABLE "production_records" ADD COLUMN "base_unit" text;--> statement-breakpoint
ALTER TABLE "production_records" ADD CONSTRAINT "production_records_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint

-- Backfill product_id/base_unit on pre-existing production_records rows (see
-- issue #22). Idempotent — every UPDATE below is guarded on product_id IS NULL,
-- so re-running only touches rows a previous run left unresolved.
--
-- Pass 1 (general): join production_records.type to products.name on the same
-- tenant + batch, case-insensitively. Covers the common case where the client
-- (app/worker/record/collect/page.tsx, via handleProduction) recorded
-- `type: product.name` verbatim — e.g. type='eggs' <-> a layers batch's
-- product named 'Eggs'.
--
-- Pass 2 (egg fallback, handleMorningRound): lib/server/syncHandlers.ts writes
-- the literal `type: 'eggs'` for every morning-round entry regardless of
-- species/naming, which will NOT match a product named e.g. 'Eggs (duck)' via
-- pass 1's exact (case-insensitive) equality. For rows pass 1 left unresolved,
-- match instead on the batch's egg-collecting product: base_unit = 'piece' and
-- a name containing "egg" (case-insensitive).
--
-- Rows matching more than one product in the same batch (not expected —
-- product names are effectively unique per batch by convention, but nothing
-- enforces it) are resolved to one of the matches non-deterministically by
-- Postgres; this is a pre-existing data-quality risk, not introduced here.
UPDATE production_records pr
SET product_id = p.id, base_unit = p.base_unit
FROM products p
WHERE pr.product_id IS NULL
  AND pr.tenant_id = p.tenant_id
  AND pr.batch_id = p.batch_id
  AND lower(pr.type) = lower(p.name);
--> statement-breakpoint

UPDATE production_records pr
SET product_id = p.id, base_unit = p.base_unit
FROM products p
WHERE pr.product_id IS NULL
  AND pr.tenant_id = p.tenant_id
  AND pr.batch_id = p.batch_id
  AND lower(pr.type) = 'eggs'
  AND p.base_unit = 'piece'
  AND p.name ILIKE '%egg%';
--> statement-breakpoint

-- Per-tenant resolved/unresolved/total counts — written to a durable,
-- queryable table rather than only a `RAISE NOTICE`, since `vercel-build` runs
-- `pnpm db:migrate` non-interactively and NOTICE output is not guaranteed to
-- surface in production deploy logs. An operator reads this after a deploy with:
--   SELECT * FROM production_backfill_report WHERE migration = '0039' ORDER BY tenant_id;
INSERT INTO production_backfill_report (id, migration, tenant_id, resolved, unresolved, total, created_at)
SELECT
  gen_random_uuid()::text,
  '0039',
  tenant_id,
  count(*) FILTER (WHERE product_id IS NOT NULL) AS resolved,
  count(*) FILTER (WHERE product_id IS NULL) AS unresolved,
  count(*) AS total,
  now()
FROM production_records
GROUP BY tenant_id;