CREATE TABLE "platform_settings" (
	"id" text PRIMARY KEY NOT NULL,
	"app_name" text DEFAULT 'IFMS' NOT NULL,
	"tagline" text DEFAULT 'Integrated Farm Management System' NOT NULL,
	"logo_url" text,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "active" boolean DEFAULT true NOT NULL;