CREATE TYPE "public"."alert_type" AS ENUM('vaccination_overdue', 'high_mortality', 'budget_alert', 'low_feed', 'cage_capacity');--> statement-breakpoint
CREATE TYPE "public"."budget_period" AS ENUM('monthly', 'cycle');--> statement-breakpoint
CREATE TYPE "public"."cage_type" AS ENUM('brooder', 'grower', 'layer');--> statement-breakpoint
CREATE TYPE "public"."cost_category" AS ENUM('feed', 'vaccines', 'medications', 'labour', 'utilities', 'chicks', 'miscellaneous');--> statement-breakpoint
CREATE TYPE "public"."customer_type" AS ENUM('retail', 'restaurant', 'bakery', 'wholesale');--> statement-breakpoint
CREATE TYPE "public"."feed_source" AS ENUM('purchased', 'produced');--> statement-breakpoint
CREATE TYPE "public"."feed_type" AS ENUM('starter', 'grower', 'layer', 'finisher');--> statement-breakpoint
CREATE TYPE "public"."flock_stage" AS ENUM('brooder', 'grower', 'layer', 'disposal', 'sold');--> statement-breakpoint
CREATE TYPE "public"."order_product" AS ENUM('eggs', 'tray', 'chicks');--> statement-breakpoint
CREATE TYPE "public"."order_status" AS ENUM('pending', 'confirmed', 'delivered', 'paid', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."product_type" AS ENUM('eggs', 'birds');--> statement-breakpoint
CREATE TYPE "public"."session_user_type" AS ENUM('owner', 'employee', 'customer');--> statement-breakpoint
CREATE TABLE "alerts" (
	"id" text PRIMARY KEY NOT NULL,
	"type" "alert_type" NOT NULL,
	"message" text NOT NULL,
	"related_id" text,
	"route" text,
	"read" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bird_stage_sales" (
	"id" text PRIMARY KEY NOT NULL,
	"flock_id" text NOT NULL,
	"stage" "flock_stage" NOT NULL,
	"quantity" integer NOT NULL,
	"price_per_bird" numeric(10, 2) NOT NULL,
	"break_even_price" numeric(10, 2) NOT NULL,
	"total_amount" numeric(10, 2) NOT NULL,
	"customer_id" text,
	"date" text NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "budgets" (
	"id" text PRIMARY KEY NOT NULL,
	"category" "cost_category" NOT NULL,
	"period" "budget_period" NOT NULL,
	"amount" numeric(10, 2) NOT NULL,
	"month" text,
	"flock_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cages" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"type" "cage_type" NOT NULL,
	"capacity" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customer_portal_users" (
	"id" text PRIMARY KEY NOT NULL,
	"customer_id" text NOT NULL,
	"name" text NOT NULL,
	"phone" text NOT NULL,
	"pin_hash" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"phone" text NOT NULL,
	"email" text,
	"address" text,
	"type" "customer_type" NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "egg_collections" (
	"id" text PRIMARY KEY NOT NULL,
	"flock_id" text NOT NULL,
	"date" text NOT NULL,
	"count" integer NOT NULL,
	"broken" integer NOT NULL,
	"sellable" integer NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "employee_salaries" (
	"id" text PRIMARY KEY NOT NULL,
	"employee_id" text NOT NULL,
	"employee_name" text NOT NULL,
	"amount" numeric(10, 2) NOT NULL,
	"pay_day_of_month" integer NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "employees" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"pin_hash" text NOT NULL,
	"role" text DEFAULT 'employee' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "expenses" (
	"id" text PRIMARY KEY NOT NULL,
	"category" "cost_category" NOT NULL,
	"description" text NOT NULL,
	"amount" numeric(10, 2) NOT NULL,
	"date" text NOT NULL,
	"flock_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "feed_dispense_records" (
	"id" text PRIMARY KEY NOT NULL,
	"flock_id" text NOT NULL,
	"date" text NOT NULL,
	"quantity_kg" numeric(10, 2) NOT NULL,
	"feed_type" "feed_type" NOT NULL,
	"feed_source" "feed_source" NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "feed_inventory" (
	"id" text PRIMARY KEY NOT NULL,
	"feed_type" "feed_type" NOT NULL,
	"current_stock_kg" numeric(10, 2) NOT NULL,
	"reorder_level_kg" numeric(10, 2) NOT NULL,
	"last_updated" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "feed_inventory_feed_type_unique" UNIQUE("feed_type")
);
--> statement-breakpoint
CREATE TABLE "feed_records" (
	"id" text PRIMARY KEY NOT NULL,
	"flock_id" text NOT NULL,
	"date" text NOT NULL,
	"quantity_kg" numeric(10, 2) NOT NULL,
	"feed_type" "feed_type" NOT NULL,
	"feed_source" "feed_source" NOT NULL,
	"cost_per_kg" numeric(10, 2) NOT NULL,
	"total_cost" numeric(10, 2) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "flocks" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"date_acquired" text NOT NULL,
	"source" text NOT NULL,
	"initial_count" integer NOT NULL,
	"current_count" integer NOT NULL,
	"purchase_cost_per_chick" numeric(10, 2) NOT NULL,
	"initial_weight" numeric(10, 2) NOT NULL,
	"breed" text NOT NULL,
	"stage" "flock_stage" NOT NULL,
	"cage_id" text,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mortality_records" (
	"id" text PRIMARY KEY NOT NULL,
	"flock_id" text NOT NULL,
	"date" text NOT NULL,
	"count" integer NOT NULL,
	"cause" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"customer_id" text NOT NULL,
	"customer_name" text NOT NULL,
	"product" "order_product" NOT NULL,
	"quantity" numeric(10, 2) NOT NULL,
	"price_per_unit" numeric(10, 2) DEFAULT '0' NOT NULL,
	"total_amount" numeric(10, 2) DEFAULT '0' NOT NULL,
	"status" "order_status" DEFAULT 'pending' NOT NULL,
	"delivery_location" text NOT NULL,
	"contact_phone" text NOT NULL,
	"notes" text,
	"requested_date" text NOT NULL,
	"paid_by_customer" boolean DEFAULT false NOT NULL,
	"delivery_confirmed" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sales" (
	"id" text PRIMARY KEY NOT NULL,
	"customer_id" text NOT NULL,
	"flock_id" text,
	"product" "product_type" NOT NULL,
	"quantity" numeric(10, 2) NOT NULL,
	"price_per_unit" numeric(10, 2) NOT NULL,
	"total_amount" numeric(10, 2) NOT NULL,
	"date" text NOT NULL,
	"notes" text,
	"deletion_requested" boolean DEFAULT false,
	"deletion_reason" text,
	"deletion_requested_by" text,
	"deletion_requested_at" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_type" "session_user_type" NOT NULL,
	"user_id" text,
	"user_name" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"id" text PRIMARY KEY DEFAULT 'default' NOT NULL,
	"owner_pin_hash" text NOT NULL,
	"price_per_egg" numeric(10, 2) DEFAULT '18' NOT NULL,
	"price_per_tray" numeric(10, 2) DEFAULT '450' NOT NULL,
	"price_per_chick" numeric(10, 2) DEFAULT '120' NOT NULL,
	"bird_pricing_brooder" numeric(10, 2) DEFAULT '150' NOT NULL,
	"bird_pricing_grower" numeric(10, 2) DEFAULT '350' NOT NULL,
	"bird_pricing_layer" numeric(10, 2) DEFAULT '600' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vaccination_records" (
	"id" text PRIMARY KEY NOT NULL,
	"flock_id" text NOT NULL,
	"vaccine_name" text NOT NULL,
	"scheduled_date" text NOT NULL,
	"completed_date" text,
	"dosage" text,
	"cost" numeric(10, 2) NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bird_stage_sales" ADD CONSTRAINT "bird_stage_sales_flock_id_flocks_id_fk" FOREIGN KEY ("flock_id") REFERENCES "public"."flocks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bird_stage_sales" ADD CONSTRAINT "bird_stage_sales_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_flock_id_flocks_id_fk" FOREIGN KEY ("flock_id") REFERENCES "public"."flocks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_portal_users" ADD CONSTRAINT "customer_portal_users_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "egg_collections" ADD CONSTRAINT "egg_collections_flock_id_flocks_id_fk" FOREIGN KEY ("flock_id") REFERENCES "public"."flocks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_salaries" ADD CONSTRAINT "employee_salaries_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_flock_id_flocks_id_fk" FOREIGN KEY ("flock_id") REFERENCES "public"."flocks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feed_dispense_records" ADD CONSTRAINT "feed_dispense_records_flock_id_flocks_id_fk" FOREIGN KEY ("flock_id") REFERENCES "public"."flocks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feed_records" ADD CONSTRAINT "feed_records_flock_id_flocks_id_fk" FOREIGN KEY ("flock_id") REFERENCES "public"."flocks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flocks" ADD CONSTRAINT "flocks_cage_id_cages_id_fk" FOREIGN KEY ("cage_id") REFERENCES "public"."cages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mortality_records" ADD CONSTRAINT "mortality_records_flock_id_flocks_id_fk" FOREIGN KEY ("flock_id") REFERENCES "public"."flocks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_requests" ADD CONSTRAINT "order_requests_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_flock_id_flocks_id_fk" FOREIGN KEY ("flock_id") REFERENCES "public"."flocks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vaccination_records" ADD CONSTRAINT "vaccination_records_flock_id_flocks_id_fk" FOREIGN KEY ("flock_id") REFERENCES "public"."flocks"("id") ON DELETE cascade ON UPDATE no action;