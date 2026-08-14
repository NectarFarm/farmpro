CREATE TABLE "batches" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"unit_id" text NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"species" text DEFAULT '' NOT NULL,
	"enterprise" text NOT NULL,
	"stage" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"initial_qty" integer DEFAULT 0 NOT NULL,
	"current_qty" integer DEFAULT 0 NOT NULL,
	"acquisition_cost_cents" integer DEFAULT 0 NOT NULL,
	"start_date" timestamp DEFAULT now(),
	"end_date" timestamp,
	"harvest_date" timestamp,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "batches" ADD CONSTRAINT "batches_unit_id_production_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."production_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_batches_tenant" ON "batches" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_batches_tenant_unit" ON "batches" USING btree ("tenant_id","unit_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_batches_tenant_code" ON "batches" USING btree ("tenant_id","code");