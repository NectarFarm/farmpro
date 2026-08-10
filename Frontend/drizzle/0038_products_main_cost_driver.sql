ALTER TABLE "products" ADD COLUMN "is_main_product" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "is_cost_driver" boolean DEFAULT false NOT NULL;--> statement-breakpoint

-- Backfill is_main_product / is_cost_driver on pre-existing product rows from
-- the templates in lib/server/productTemplates.ts, keyed by (batch enterprise,
-- product name). Idempotent — re-running only re-applies the same SET TRUE
-- statements. Batches created before the `enterprise` column existed (see
-- 0035_batches_enterprise.sql) or with a custom/renamed product cannot be
-- matched here and are left as-is (both flags false); the DO block below
-- reports how many such batches exist rather than silently skipping them.
DO $$
DECLARE
  main_products text[][] := ARRAY[
    ARRAY['layers', 'Spent hen'],
    ARRAY['broilers', 'Live bird'],
    ARRAY['pig_fatten', 'Pork (live weight)'],
    ARRAY['pig_breed', 'Piglets'],
    ARRAY['tilapia', 'Fish'],
    ARRAY['catfish', 'Fish'],
    ARRAY['maize', 'Maize grain'],
    ARRAY['goats', 'Live goat'],
    ARRAY['dairy', 'Mature cow'],
    ARRAY['ducks', 'Live duck'],
    ARRAY['rabbits', 'Rabbit meat'],
    ARRAY['bees', 'Colony / nuc']
  ];
  -- Cost driver differs from the main product wherever the batch's asset (the
  -- animal itself) isn't the commodity a farmer costs feed/effort against:
  -- layers/ducks (eggs, not the bird), dairy/goats (milk, not the animal),
  -- bees (honey, not the colony). Everywhere else the two coincide.
  cost_driver_products text[][] := ARRAY[
    ARRAY['layers', 'Eggs'],
    ARRAY['broilers', 'Live bird'],
    ARRAY['pig_fatten', 'Pork (live weight)'],
    ARRAY['pig_breed', 'Piglets'],
    ARRAY['tilapia', 'Fish'],
    ARRAY['catfish', 'Fish'],
    ARRAY['maize', 'Maize grain'],
    ARRAY['goats', 'Milk'],
    ARRAY['dairy', 'Milk'],
    ARRAY['ducks', 'Eggs (duck)'],
    ARRAY['rabbits', 'Rabbit meat'],
    ARRAY['bees', 'Honey']
  ];
  pair text[];
  main_resolved integer;
  driver_resolved integer;
  batches_with_products integer;
  batches_with_driver integer;
  batches_without_driver integer;
BEGIN
  FOREACH pair SLICE 1 IN ARRAY main_products LOOP
    UPDATE products p SET is_main_product = true
    FROM batches b
    WHERE p.batch_id = b.id AND b.enterprise = pair[1] AND p.name = pair[2] AND p.is_main_product = false;
  END LOOP;

  FOREACH pair SLICE 1 IN ARRAY cost_driver_products LOOP
    UPDATE products p SET is_cost_driver = true
    FROM batches b
    WHERE p.batch_id = b.id AND b.enterprise = pair[1] AND p.name = pair[2] AND p.is_cost_driver = false;
  END LOOP;

  SELECT count(*) INTO main_resolved FROM products WHERE is_main_product = true;
  SELECT count(*) INTO driver_resolved FROM products WHERE is_cost_driver = true;

  SELECT count(DISTINCT b.id) INTO batches_with_products
  FROM batches b JOIN products p ON p.batch_id = b.id;

  SELECT count(DISTINCT b.id) INTO batches_with_driver
  FROM batches b JOIN products p ON p.batch_id = b.id AND p.is_cost_driver = true;

  batches_without_driver := batches_with_products - batches_with_driver;

  RAISE NOTICE 'products backfill: % rows set is_main_product, % rows set is_cost_driver', main_resolved, driver_resolved;
  RAISE NOTICE 'products backfill: %/% batches-with-products now have a cost driver; % batch(es) unresolved (no enterprise/name match — likely pre-0035 batches or custom products)',
    batches_with_driver, batches_with_products, batches_without_driver;
END $$;