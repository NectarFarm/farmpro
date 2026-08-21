CREATE TABLE "onboard_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"farmer_name" text NOT NULL,
	"email" text NOT NULL,
	"phone" text NOT NULL,
	"farm_name" text NOT NULL,
	"location" text NOT NULL,
	"enterprises" text[] DEFAULT '{}' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"notes" text,
	"requested_at" timestamp DEFAULT now() NOT NULL,
	"tenant_id" text
);
--> statement-breakpoint
CREATE INDEX "idx_onboard_requests_status" ON "onboard_requests" USING btree ("status");