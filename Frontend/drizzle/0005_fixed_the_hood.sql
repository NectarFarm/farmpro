CREATE TABLE "products" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"batch_id" text,
	"name" text NOT NULL,
	"base_unit" text DEFAULT 'unit' NOT NULL,
	"sale_units" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"collect_frequency" text DEFAULT 'per_cycle' NOT NULL,
	"flow" text DEFAULT 'sale' NOT NULL,
	"field_key" text,
	"active" boolean DEFAULT true NOT NULL
);
