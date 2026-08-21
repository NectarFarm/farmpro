CREATE TABLE "auditor_links" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"token" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"revoked_at" timestamp
);
--> statement-breakpoint
CREATE INDEX "idx_auditor_links_tenant" ON "auditor_links" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_auditor_links_token" ON "auditor_links" USING btree ("token");