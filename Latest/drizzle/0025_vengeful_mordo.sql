ALTER TABLE "tenant_settings" ADD COLUMN "timezone" text DEFAULT 'Africa/Nairobi' NOT NULL;--> statement-breakpoint
ALTER TABLE "tenant_settings" ADD COLUMN "date_format" text DEFAULT 'DD/MM/YYYY' NOT NULL;--> statement-breakpoint
ALTER TABLE "tenant_settings" ADD COLUMN "session_timeout_minutes" integer;