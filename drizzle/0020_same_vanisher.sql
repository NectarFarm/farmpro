CREATE TABLE "batch_products" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"batch_id" text NOT NULL,
	"product_id" text NOT NULL,
	"mode" text NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "product_units" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"product_id" text NOT NULL,
	"unit_id" text NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "status" text DEFAULT 'ACTIVE' NOT NULL;--> statement-breakpoint
ALTER TABLE "sales" ADD COLUMN "product_id" text;--> statement-breakpoint
ALTER TABLE "batch_products" ADD CONSTRAINT "batch_products_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_units" ADD CONSTRAINT "product_units_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_batch_products_tenant" ON "batch_products" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_batch_products_batch" ON "batch_products" USING btree ("batch_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_batch_products_batch_product" ON "batch_products" USING btree ("batch_id","product_id");--> statement-breakpoint
CREATE INDEX "idx_product_units_tenant" ON "product_units" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_product_units_unit" ON "product_units" USING btree ("unit_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_product_units_product_unit" ON "product_units" USING btree ("product_id","unit_id");