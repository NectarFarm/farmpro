CREATE TABLE "location_types" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"display_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "location_types_name_unique" UNIQUE("name")
);
--> statement-breakpoint
INSERT INTO "location_types" ("id","name","display_order") VALUES ('brooder','Brooder',0),('grower','Grower',1),('layer','Layer',2) ON CONFLICT DO NOTHING;
--> statement-breakpoint
ALTER TABLE "cages" ALTER COLUMN "type" SET DATA TYPE text;
--> statement-breakpoint
DROP TYPE IF EXISTS "public"."cage_type";
--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN IF NOT EXISTS "enterprise_type" text DEFAULT 'poultry' NOT NULL;
