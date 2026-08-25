CREATE TABLE "tenant_enterprises" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"enterprise" text NOT NULL,
	"source" text DEFAULT 'onboarding' NOT NULL,
	"granted_by_user_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "enterprise_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"enterprise" text NOT NULL,
	"requested_by_user_id" text NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"decision_note" text DEFAULT '' NOT NULL,
	"decided_by_user_id" text,
	"decided_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "idx_tenant_enterprises_tenant" ON "tenant_enterprises" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_tenant_enterprises_tenant_enterprise" ON "tenant_enterprises" USING btree ("tenant_id","enterprise");--> statement-breakpoint
CREATE INDEX "idx_enterprise_requests_tenant" ON "enterprise_requests" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_enterprise_requests_status" ON "enterprise_requests" USING btree ("status");--> statement-breakpoint
-- One PENDING request per tenant per enterprise. Partial, so a rejected
-- request doesn't block asking again later.
CREATE UNIQUE INDEX "idx_enterprise_requests_one_pending" ON "enterprise_requests" USING btree ("tenant_id","enterprise") WHERE status = 'pending';--> statement-breakpoint

-- ── Backfill ───────────────────────────────────────────────────────────────
-- lib/enterprises.ts treats a tenant with no rows as UNRESTRICTED, so without
-- this every existing tenant would silently stay unscoped and the enforcement
-- added in this change would apply to nobody. Two sources, in priority order:
--
--   1. What the tenant's batches ALREADY use. This is ground truth — they are
--      demonstrably farming it, and a migration that locked them out of an
--      enterprise they have live batches in would break a working account.
--   2. What the approved application asked for, for tenants provisioned before
--      provisioning learned to write these rows. Covers a fresh account that
--      has not created its first batch yet, which is exactly the case where an
--      empty set would otherwise leave it unrestricted forever.
--
-- Both are lower-cased to match normalizeEnterprise(), and ON CONFLICT makes
-- the second pass additive rather than a failure where they overlap.
INSERT INTO "tenant_enterprises" ("id", "tenant_id", "enterprise", "source", "created_at")
SELECT
	gen_random_uuid()::text,
	b."tenant_id",
	lower(trim(b."enterprise")),
	'backfill',
	now()
FROM "batches" b
WHERE b."enterprise" IS NOT NULL AND trim(b."enterprise") <> ''
GROUP BY b."tenant_id", lower(trim(b."enterprise"))
ON CONFLICT ("tenant_id", "enterprise") DO NOTHING;--> statement-breakpoint

INSERT INTO "tenant_enterprises" ("id", "tenant_id", "enterprise", "source", "created_at")
SELECT
	gen_random_uuid()::text,
	o."tenant_id",
	lower(trim(e)),
	'onboarding',
	now()
FROM "onboard_requests" o
CROSS JOIN LATERAL unnest(o."enterprises") AS e
WHERE o."tenant_id" IS NOT NULL
	AND o."status" = 'approved'
	AND trim(e) <> ''
GROUP BY o."tenant_id", lower(trim(e))
ON CONFLICT ("tenant_id", "enterprise") DO NOTHING;
