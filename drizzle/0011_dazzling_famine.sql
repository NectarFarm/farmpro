CREATE TABLE "employees" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"user_id" text,
	"name" text NOT NULL,
	"phone" text DEFAULT '' NOT NULL,
	"role" text DEFAULT 'worker' NOT NULL,
	"assigned_batch_ids" text[] DEFAULT '{}' NOT NULL,
	"mortality_photo_threshold" integer DEFAULT 3 NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "records" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"batch_id" text NOT NULL,
	"employee_id" text NOT NULL,
	"type" text NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"photo_url" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "records" ADD CONSTRAINT "records_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_employees_tenant" ON "employees" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_employees_tenant_user" ON "employees" USING btree ("tenant_id","user_id");--> statement-breakpoint
CREATE INDEX "idx_records_tenant" ON "records" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_records_tenant_batch" ON "records" USING btree ("tenant_id","batch_id");--> statement-breakpoint
CREATE INDEX "idx_records_tenant_type" ON "records" USING btree ("tenant_id","type");--> statement-breakpoint
CREATE INDEX "idx_records_employee" ON "records" USING btree ("employee_id");