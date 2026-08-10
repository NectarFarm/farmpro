-- DB-backed login brute-force protection (see lib/server/loginThrottle.ts).
-- Idempotent: IF NOT EXISTS so re-running against a DB that already has the table
-- (e.g. a partially-applied deploy) is a no-op and never destructive.
CREATE TABLE IF NOT EXISTS "login_attempts" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"ip" text,
	"success" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_login_attempts_identifier_created" ON "login_attempts" USING btree ("identifier","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_login_attempts_created" ON "login_attempts" USING btree ("created_at");
