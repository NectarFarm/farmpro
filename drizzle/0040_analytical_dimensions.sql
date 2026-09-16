CREATE TABLE "dimensions" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"level_count" integer DEFAULT 1 NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 100 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dimension_levels" (
	"id" text PRIMARY KEY NOT NULL,
	"dimension_id" text NOT NULL,
	"ordinal" integer NOT NULL,
	"name" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dimension_values" (
	"id" text PRIMARY KEY NOT NULL,
	"dimension_id" text NOT NULL,
	"tenant_id" text NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"level_ordinal" integer DEFAULT 1 NOT NULL,
	"parent_value_id" text,
	"source_type" text,
	"source_id" text,
	"archived" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "default_dimensions" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"master_type" text NOT NULL,
	"master_id" text NOT NULL,
	"dimension_id" text NOT NULL,
	"dimension_value_id" text,
	"requirement" text DEFAULT 'optional' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_dimensions" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"doc_type" text NOT NULL,
	"doc_id" text NOT NULL,
	"dimension_id" text NOT NULL,
	"value_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "journal_line_dimensions" (
	"id" text PRIMARY KEY NOT NULL,
	"line_id" text NOT NULL,
	"dimension_id" text NOT NULL,
	"value_id" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "journal_entries" ADD COLUMN "farm_id" text;--> statement-breakpoint
ALTER TABLE "batches" ADD COLUMN "enterprise_type" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "dimension_levels" ADD CONSTRAINT "dimension_levels_dimension_id_dimensions_id_fk" FOREIGN KEY ("dimension_id") REFERENCES "public"."dimensions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dimension_values" ADD CONSTRAINT "dimension_values_dimension_id_dimensions_id_fk" FOREIGN KEY ("dimension_id") REFERENCES "public"."dimensions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "default_dimensions" ADD CONSTRAINT "default_dimensions_dimension_id_dimensions_id_fk" FOREIGN KEY ("dimension_id") REFERENCES "public"."dimensions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "default_dimensions" ADD CONSTRAINT "default_dimensions_dimension_value_id_dimension_values_id_fk" FOREIGN KEY ("dimension_value_id") REFERENCES "public"."dimension_values"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_dimensions" ADD CONSTRAINT "document_dimensions_dimension_id_dimensions_id_fk" FOREIGN KEY ("dimension_id") REFERENCES "public"."dimensions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_dimensions" ADD CONSTRAINT "document_dimensions_value_id_dimension_values_id_fk" FOREIGN KEY ("value_id") REFERENCES "public"."dimension_values"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_line_dimensions" ADD CONSTRAINT "journal_line_dimensions_line_id_journal_lines_id_fk" FOREIGN KEY ("line_id") REFERENCES "public"."journal_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_line_dimensions" ADD CONSTRAINT "journal_line_dimensions_dimension_id_dimensions_id_fk" FOREIGN KEY ("dimension_id") REFERENCES "public"."dimensions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_line_dimensions" ADD CONSTRAINT "journal_line_dimensions_value_id_dimension_values_id_fk" FOREIGN KEY ("value_id") REFERENCES "public"."dimension_values"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_dimensions_tenant" ON "dimensions" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_dimensions_tenant_code" ON "dimensions" USING btree ("tenant_id","code");--> statement-breakpoint
CREATE INDEX "idx_dimension_levels_dimension" ON "dimension_levels" USING btree ("dimension_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_dimension_levels_dimension_ordinal" ON "dimension_levels" USING btree ("dimension_id","ordinal");--> statement-breakpoint
CREATE INDEX "idx_dimension_values_dimension" ON "dimension_values" USING btree ("dimension_id");--> statement-breakpoint
CREATE INDEX "idx_dimension_values_tenant" ON "dimension_values" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_dimension_values_dimension_code" ON "dimension_values" USING btree ("dimension_id","code");--> statement-breakpoint
CREATE INDEX "idx_dimension_values_source" ON "dimension_values" USING btree ("source_type","source_id");--> statement-breakpoint
CREATE INDEX "idx_dimension_values_parent" ON "dimension_values" USING btree ("parent_value_id");--> statement-breakpoint
CREATE INDEX "idx_default_dimensions_tenant" ON "default_dimensions" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_default_dimensions_master" ON "default_dimensions" USING btree ("tenant_id","master_type","master_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_default_dimensions_master_dimension" ON "default_dimensions" USING btree ("tenant_id","master_type","master_id","dimension_id");--> statement-breakpoint
CREATE INDEX "idx_document_dimensions_doc" ON "document_dimensions" USING btree ("doc_type","doc_id");--> statement-breakpoint
CREATE INDEX "idx_document_dimensions_tenant" ON "document_dimensions" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_document_dimensions_doc_dimension" ON "document_dimensions" USING btree ("doc_type","doc_id","dimension_id");--> statement-breakpoint
CREATE INDEX "idx_journal_line_dimensions_line" ON "journal_line_dimensions" USING btree ("line_id");--> statement-breakpoint
CREATE INDEX "idx_journal_line_dimensions_dimension_value" ON "journal_line_dimensions" USING btree ("dimension_id","value_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_journal_line_dimensions_line_dimension" ON "journal_line_dimensions" USING btree ("line_id","dimension_id");--> statement-breakpoint
CREATE INDEX "idx_journal_entries_tenant_farm" ON "journal_entries" USING btree ("tenant_id","farm_id");
