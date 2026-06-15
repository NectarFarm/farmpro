CREATE TABLE "platform_admins" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"name" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "platform_admins_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "farmers" (
	"id" text PRIMARY KEY NOT NULL,
	"farm_name" text NOT NULL,
	"owner_name" text,
	"email" text,
	"phone" text,
	"enterprise_type" text DEFAULT 'poultry' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"permissions" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "farmers_email_unique" UNIQUE("email")
);
