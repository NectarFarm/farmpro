CREATE TABLE "farms" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"name" text NOT NULL,
	"location" text DEFAULT '' NOT NULL,
	"code" text NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "production_units" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"farm_id" text NOT NULL,
	"type" text NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL
);
--> statement-breakpoint
ALTER TABLE "production_units" ADD CONSTRAINT "production_units_farm_id_farms_id_fk" FOREIGN KEY ("farm_id") REFERENCES "public"."farms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_farms_tenant" ON "farms" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_production_units_tenant_farm" ON "production_units" USING btree ("tenant_id","farm_id");