CREATE TABLE "product_collections" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"batch_id" text NOT NULL,
	"product_id" text NOT NULL,
	"employee_id" text,
	"record_id" text,
	"qty" integer NOT NULL,
	"collected_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "routine_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"routine_id" text NOT NULL,
	"batch_id" text NOT NULL,
	"employee_id" text NOT NULL,
	"completed_steps" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"skipped_count" integer DEFAULT 0 NOT NULL,
	"completed_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "routine_steps" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"routine_id" text NOT NULL,
	"kind" text NOT NULL,
	"label" text NOT NULL,
	"required" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "routines" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"farm_id" text,
	"name" text NOT NULL,
	"time_of_day" text DEFAULT 'any' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "routine_steps" ADD CONSTRAINT "routine_steps_routine_id_routines_id_fk" FOREIGN KEY ("routine_id") REFERENCES "public"."routines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_product_collections_tenant" ON "product_collections" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_product_collections_batch" ON "product_collections" USING btree ("tenant_id","batch_id");--> statement-breakpoint
CREATE INDEX "idx_product_collections_product" ON "product_collections" USING btree ("tenant_id","product_id");--> statement-breakpoint
CREATE INDEX "idx_routine_runs_tenant" ON "routine_runs" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_routine_runs_batch" ON "routine_runs" USING btree ("tenant_id","batch_id");--> statement-breakpoint
CREATE INDEX "idx_routine_runs_routine" ON "routine_runs" USING btree ("routine_id");--> statement-breakpoint
CREATE INDEX "idx_routine_steps_routine" ON "routine_steps" USING btree ("routine_id");--> statement-breakpoint
CREATE INDEX "idx_routine_steps_tenant" ON "routine_steps" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_routines_tenant" ON "routines" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_routines_farm" ON "routines" USING btree ("farm_id");