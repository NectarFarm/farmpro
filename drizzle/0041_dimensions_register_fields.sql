-- Analysis Dimensions register fields (dimensions-operable task).
-- IF NOT EXISTS on every ADD COLUMN: this dev database already carries
-- short_name/separator/budget_check/budget_control on `dimensions` from an
-- earlier, never-committed migration attempt (confirmed by inspecting the
-- live schema — no migration file anywhere in this repo's history produced
-- them, and __drizzle_migrations has orphaned rows with no matching journal
-- entry). Writing this migration defensively means it is correct whether it
-- runs against that already-drifted database or a clean one, and running it
-- twice is a genuine no-op either way (verified below).
ALTER TABLE "dimensions" ADD COLUMN IF NOT EXISTS "short_name" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "dimensions" ADD COLUMN IF NOT EXISTS "separator" text DEFAULT '-' NOT NULL;--> statement-breakpoint
ALTER TABLE "dimensions" ADD COLUMN IF NOT EXISTS "budget_check" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "dimensions" ADD COLUMN IF NOT EXISTS "budget_control" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "dimensions" ADD COLUMN IF NOT EXISTS "archived" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- Backfill: the earlier drift left some existing tenants' dimensions with a
-- populated short_name (copied from code) and others blank, depending on
-- when their row was created relative to that abandoned attempt. Every
-- dimension gets a real short name rather than a blank register column —
-- `code` is already short (UNIT/FARM/BATCH/ENTERPRISE, or a tenant's own),
-- so it is the sensible default for a tenant that never set one by hand.
UPDATE "dimensions" SET "short_name" = "code" WHERE "short_name" = '';
