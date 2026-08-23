CREATE TABLE "inventory_consumption" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"item_id" text NOT NULL,
	"lot_id" text NOT NULL,
	"batch_id" text NOT NULL,
	"record_id" text,
	"employee_id" text,
	"qty" integer NOT NULL,
	"unit_cost_cents" bigint DEFAULT 0 NOT NULL,
	"total_cost_cents" bigint DEFAULT 0 NOT NULL,
	"farm_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "inventory_consumption" ADD CONSTRAINT "inventory_consumption_item_id_inventory_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."inventory_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_consumption" ADD CONSTRAINT "inventory_consumption_lot_id_inventory_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."inventory_lots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_inventory_consumption_tenant" ON "inventory_consumption" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_inventory_consumption_batch" ON "inventory_consumption" USING btree ("tenant_id","batch_id");--> statement-breakpoint
CREATE INDEX "idx_inventory_consumption_item" ON "inventory_consumption" USING btree ("tenant_id","item_id");--> statement-breakpoint
CREATE INDEX "idx_inventory_consumption_record" ON "inventory_consumption" USING btree ("record_id");