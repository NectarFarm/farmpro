CREATE TABLE "batch_movements" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"batch_id" text NOT NULL,
	"type" text NOT NULL,
	"qty_delta" integer NOT NULL,
	"qty_after" integer NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"source_type" text,
	"source_id" text,
	"actor" text DEFAULT '' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "idx_batch_movements_tenant" ON "batch_movements" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_batch_movements_batch" ON "batch_movements" USING btree ("tenant_id","batch_id");--> statement-breakpoint
CREATE INDEX "idx_batch_movements_source" ON "batch_movements" USING btree ("source_type","source_id");