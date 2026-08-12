CREATE TABLE "sessions" (
	"token" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"expires_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"role" text NOT NULL,
	"password_hash" text NOT NULL,
	"password_salt" text NOT NULL,
	"pin_hash" text,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_sessions_user" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_users_tenant" ON "users" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_users_email" ON "users" USING btree ("email");