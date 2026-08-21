ALTER TABLE "onboard_requests" ADD COLUMN "address" text;--> statement-breakpoint
ALTER TABLE "onboard_requests" ADD COLUMN "latitude" double precision;--> statement-breakpoint
ALTER TABLE "onboard_requests" ADD COLUMN "longitude" double precision;--> statement-breakpoint
ALTER TABLE "onboard_requests" ADD COLUMN "consent_at" timestamp;--> statement-breakpoint
ALTER TABLE "onboard_requests" ADD COLUMN "consent_version" text;