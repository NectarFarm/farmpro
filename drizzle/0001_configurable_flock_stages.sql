--> statement-breakpoint
CREATE TABLE "flock_stages" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"display_order" integer DEFAULT 0 NOT NULL,
	"role" text,
	"price_per_bird" numeric(10, 2) DEFAULT '0' NOT NULL,
	CONSTRAINT "flock_stages_name_unique" UNIQUE("name")
);
--> statement-breakpoint
INSERT INTO "flock_stages" ("id", "name", "display_order", "role", "price_per_bird") VALUES
	('brooder', 'Brooder', 0, NULL, '150'),
	('grower',  'Grower',  1, NULL, '350'),
	('layer',   'Layer',   2, NULL, '600'),
	('disposal','Disposal',3, 'disposed', '0'),
	('sold',    'Sold',    4, 'sold', '0');
--> statement-breakpoint
ALTER TABLE "flocks" ALTER COLUMN "stage" TYPE text;
--> statement-breakpoint
ALTER TABLE "bird_stage_sales" ALTER COLUMN "stage" TYPE text;
--> statement-breakpoint
DROP TYPE IF EXISTS "public"."flock_stage";
--> statement-breakpoint
ALTER TABLE "settings" DROP COLUMN IF EXISTS "bird_pricing_brooder";
--> statement-breakpoint
ALTER TABLE "settings" DROP COLUMN IF EXISTS "bird_pricing_grower";
--> statement-breakpoint
ALTER TABLE "settings" DROP COLUMN IF EXISTS "bird_pricing_layer";
