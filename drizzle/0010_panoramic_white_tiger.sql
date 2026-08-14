CREATE TABLE "inventory_items" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"name" text NOT NULL,
	"category" text DEFAULT '' NOT NULL,
	"unit" text NOT NULL,
	"low_stock_threshold" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "inventory_lots" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"item_id" text NOT NULL,
	"lot_no" text NOT NULL,
	"qty_on_hand" integer DEFAULT 0 NOT NULL,
	"unit_cost_cents" integer DEFAULT 0 NOT NULL,
	"expiry_date" timestamp,
	"received_date" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "purchases" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"supplier" text NOT NULL,
	"item_id" text NOT NULL,
	"quantity" integer NOT NULL,
	"unit_cost_cents" integer DEFAULT 0 NOT NULL,
	"total_cost_cents" integer DEFAULT 0 NOT NULL,
	"payment_method" text DEFAULT '' NOT NULL,
	"amount_paid_cents" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "inventory_lots" ADD CONSTRAINT "inventory_lots_item_id_inventory_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."inventory_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_item_id_inventory_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."inventory_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_inventory_items_tenant" ON "inventory_items" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_inventory_lots_tenant" ON "inventory_lots" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_inventory_lots_tenant_item" ON "inventory_lots" USING btree ("tenant_id","item_id");--> statement-breakpoint
CREATE INDEX "idx_purchases_tenant" ON "purchases" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_purchases_tenant_item" ON "purchases" USING btree ("tenant_id","item_id");