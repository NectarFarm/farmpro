CREATE TABLE "login_throttle" (
	"identifier" text PRIMARY KEY NOT NULL,
	"failed_count" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "pin_prefilter" text;--> statement-breakpoint
CREATE INDEX "idx_users_pin_prefilter" ON "users" USING btree ("pin_prefilter");