CREATE TABLE "alerts" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"severity" text NOT NULL,
	"title" text NOT NULL,
	"message" text NOT NULL,
	"type" text NOT NULL,
	"created_at" text NOT NULL,
	"acknowledged" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"actor" text NOT NULL,
	"action" text NOT NULL,
	"entity" text,
	"before" jsonb,
	"after" jsonb,
	"meta" jsonb,
	"at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "batches" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"unit_id" text NOT NULL,
	"name" text NOT NULL,
	"species" text NOT NULL,
	"breed" text,
	"source" text NOT NULL,
	"acquired_date" text NOT NULL,
	"age_at_acquire" integer DEFAULT 0 NOT NULL,
	"initial_qty" integer NOT NULL,
	"current_qty" integer NOT NULL,
	"stage" text NOT NULL,
	"acquisition_cost" double precision DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"parent_batch_ids" jsonb
);
--> statement-breakpoint
CREATE TABLE "conflict_log" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"record_type" text NOT NULL,
	"record_id" text NOT NULL,
	"my_version" jsonb,
	"server_version" jsonb,
	"captured_at_mine" text,
	"captured_at_server" text,
	"resolution" text,
	"resolved_at" text
);
--> statement-breakpoint
CREATE TABLE "employees" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"name" text NOT NULL,
	"phone" text NOT NULL,
	"role" text NOT NULL,
	"worker_profile_id" text,
	"pin_set" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inventory_items" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"unit" text NOT NULL,
	"low_stock_threshold" double precision DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inventory_lots" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"item_id" text NOT NULL,
	"lot_no" text NOT NULL,
	"qty_on_hand" double precision DEFAULT 0 NOT NULL,
	"unit" text NOT NULL,
	"unit_cost" double precision DEFAULT 0 NOT NULL,
	"expiry_date" text,
	"supplier_id" text,
	"received_date" text NOT NULL,
	"withdrawal_days" integer
);
--> statement-breakpoint
CREATE TABLE "production_units" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"farm_id" text NOT NULL,
	"zone_id" text,
	"type" text NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"capacity" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"current_qty" integer DEFAULT 0,
	"species" text
);
--> statement-breakpoint
CREATE TABLE "purchases" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"item_id" text NOT NULL,
	"lot_id" text NOT NULL,
	"supplier" text NOT NULL,
	"quantity" double precision NOT NULL,
	"unit_cost" double precision NOT NULL,
	"total_cost" double precision NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "records" (
	"client_uuid" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"captured_at" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "sales" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"batch_id" text NOT NULL,
	"unit_id" text NOT NULL,
	"product_type" text NOT NULL,
	"quantity" double precision NOT NULL,
	"weight_kg" double precision,
	"unit_price" double precision NOT NULL,
	"total_amount" double precision NOT NULL,
	"buyer" text NOT NULL,
	"payment_method" text NOT NULL,
	"status" text NOT NULL,
	"withdrawal_check" text NOT NULL,
	"withdrawal_until" text,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"type" text NOT NULL,
	"assigned_to" text NOT NULL,
	"unit_id" text,
	"batch_id" text,
	"scheduled_for" text NOT NULL,
	"status" text DEFAULT 'ASSIGNED' NOT NULL,
	"due_at" text NOT NULL,
	"overdue" boolean DEFAULT false
);
--> statement-breakpoint
CREATE TABLE "tenants" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"name" text NOT NULL,
	"phone" text NOT NULL,
	"email" text,
	"role" text NOT NULL,
	"worker_profile_id" text,
	"language" text DEFAULT 'en' NOT NULL,
	"password_hash" text,
	"pin_hash" text
);
--> statement-breakpoint
CREATE TABLE "worker_profiles" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"fields" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"modules" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"mortality_photo_threshold" integer DEFAULT 1 NOT NULL,
	"alert_thresholds" jsonb DEFAULT '{}'::jsonb NOT NULL
);
