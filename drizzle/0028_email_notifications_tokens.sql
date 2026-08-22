CREATE TABLE "onboard_update_tokens" (
	"id" text PRIMARY KEY NOT NULL,
	"onboard_request_id" text NOT NULL,
	"token" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"used_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "set_password_tokens" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"token" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"used_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "emailed_at" timestamp;--> statement-breakpoint
ALTER TABLE "onboard_update_tokens" ADD CONSTRAINT "onboard_update_tokens_onboard_request_id_onboard_requests_id_fk" FOREIGN KEY ("onboard_request_id") REFERENCES "public"."onboard_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "set_password_tokens" ADD CONSTRAINT "set_password_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_onboard_update_tokens_request" ON "onboard_update_tokens" USING btree ("onboard_request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_onboard_update_tokens_token" ON "onboard_update_tokens" USING btree ("token");--> statement-breakpoint
CREATE INDEX "idx_set_password_tokens_user" ON "set_password_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_set_password_tokens_token" ON "set_password_tokens" USING btree ("token");