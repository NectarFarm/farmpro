CREATE TABLE "discounts" (
	"id" text PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"kind" text NOT NULL,
	"value" bigint NOT NULL,
	"applies_to_plans" text[],
	"applies_to_periods" text[],
	"tenant_id" text,
	"valid_from" timestamp,
	"valid_until" timestamp,
	"max_redemptions" integer,
	"redemptions" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by" text NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" text PRIMARY KEY NOT NULL,
	"subscription_id" text NOT NULL,
	"tenant_id" text NOT NULL,
	"amount_cents" bigint NOT NULL,
	"currency" text DEFAULT 'UGX' NOT NULL,
	"method" text NOT NULL,
	"reference" text DEFAULT '' NOT NULL,
	"payer_note" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"submitted_by" text NOT NULL,
	"reviewed_by" text,
	"reviewed_at" timestamp,
	"review_note" text DEFAULT '' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plans" (
	"id" text PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"tagline" text DEFAULT '' NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"features" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"limits" jsonb DEFAULT '{"maxFarms":null,"maxUsers":null,"maxUnits":null}'::jsonb NOT NULL,
	"prices" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"currency" text DEFAULT 'UGX' NOT NULL,
	"trial_days" integer DEFAULT 14 NOT NULL,
	"is_public" boolean DEFAULT true NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"plan_id" text NOT NULL,
	"period" text NOT NULL,
	"status" text NOT NULL,
	"trial_ends_at" timestamp,
	"current_period_start" timestamp,
	"current_period_end" timestamp,
	"list_price_cents" bigint DEFAULT 0 NOT NULL,
	"discount_id" text,
	"discount_amount_cents" bigint DEFAULT 0 NOT NULL,
	"amount_due_cents" bigint DEFAULT 0 NOT NULL,
	"cancel_at_period_end" boolean DEFAULT false NOT NULL,
	"is_current" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform_staff" (
	"user_id" text PRIMARY KEY NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"capabilities" text[] DEFAULT '{}'::text[] NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tenant_admin_notes" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"author_id" text NOT NULL,
	"note" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chat_throttle" (
	"identifier" text PRIMARY KEY NOT NULL,
	"window_start" timestamp NOT NULL,
	"count" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "support_tickets" (
	"id" text PRIMARY KEY NOT NULL,
	"seq" bigint NOT NULL,
	"number" text NOT NULL,
	"tenant_id" text NOT NULL,
	"raised_by" text NOT NULL,
	"subject" text NOT NULL,
	"category" text DEFAULT 'question' NOT NULL,
	"priority" text DEFAULT 'normal' NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"assigned_to" text,
	"source" text DEFAULT 'form' NOT NULL,
	"rating" integer,
	"rating_comment" text DEFAULT '' NOT NULL,
	"resolved_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ticket_events" (
	"id" text PRIMARY KEY NOT NULL,
	"ticket_id" text NOT NULL,
	"kind" text NOT NULL,
	"from_value" text,
	"to_value" text,
	"actor_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ticket_messages" (
	"id" text PRIMARY KEY NOT NULL,
	"ticket_id" text NOT NULL,
	"author_id" text,
	"author_kind" text NOT NULL,
	"body" text NOT NULL,
	"is_internal" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "platform_staff" ADD CONSTRAINT "platform_staff_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_discounts_code" ON "discounts" USING btree ("code");--> statement-breakpoint
CREATE INDEX "idx_discounts_tenant" ON "discounts" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_payments_tenant" ON "payments" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_payments_subscription" ON "payments" USING btree ("subscription_id");--> statement-breakpoint
CREATE INDEX "idx_payments_status" ON "payments" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_plans_code" ON "plans" USING btree ("code");--> statement-breakpoint
CREATE INDEX "idx_plans_public_active" ON "plans" USING btree ("is_public","is_active");--> statement-breakpoint
CREATE INDEX "idx_subscriptions_tenant" ON "subscriptions" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_subscriptions_status" ON "subscriptions" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_subscriptions_tenant_current" ON "subscriptions" USING btree ("tenant_id") WHERE "subscriptions"."is_current" = true;--> statement-breakpoint
CREATE INDEX "idx_platform_staff_active" ON "platform_staff" USING btree ("active");--> statement-breakpoint
CREATE INDEX "idx_tenant_admin_notes_tenant" ON "tenant_admin_notes" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_support_tickets_number" ON "support_tickets" USING btree ("number");--> statement-breakpoint
CREATE INDEX "idx_support_tickets_tenant" ON "support_tickets" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_support_tickets_status" ON "support_tickets" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_support_tickets_assigned" ON "support_tickets" USING btree ("assigned_to");--> statement-breakpoint
CREATE INDEX "idx_support_tickets_raised_by" ON "support_tickets" USING btree ("raised_by");--> statement-breakpoint
CREATE INDEX "idx_ticket_events_ticket" ON "ticket_events" USING btree ("ticket_id");--> statement-breakpoint
CREATE INDEX "idx_ticket_messages_ticket" ON "ticket_messages" USING btree ("ticket_id");
--> statement-breakpoint
-- ── Support ticket numbering (SaaS back-office backend) ─────────────────────
-- Backs support_tickets.number ("T-1001", sequential, human-facing). A real
-- Postgres sequence rather than a max()+1 read: concurrent ticket creation
-- must never hand out the same number twice. Named explicitly (not the
-- bigserial-on-`seq`-column auto-name) so the starting value is deliberate
-- and documented here rather than an accident of column order.
CREATE SEQUENCE IF NOT EXISTS support_ticket_number_seq START WITH 1001 INCREMENT BY 1;
--> statement-breakpoint
-- ── Migration backfill: nobody is locked out (SaaS back-office backend) ─────
-- Every tenant that exists BEFORE billing existed must keep working exactly
-- as before. `legacy` is a hidden (is_public = false) plan with no limits and
-- no price — every existing tenant gets an `active` subscription on it with
-- NO end date (current_period_end NULL), so GET /api/auth/session's
-- needsPlan computation (lib/billing/access-state.ts) reads false for every
-- one of them, today and forever, unless a platform admin deliberately moves
-- them onto a real plan later via PATCH /api/admin/subscriptions/[tenantId].
INSERT INTO plans (id, code, name, tagline, description, features, limits, prices, currency, trial_days, is_public, is_active, sort_order, created_at, updated_at)
VALUES (
  gen_random_uuid(), 'legacy', 'Founding farm',
  'Grandfathered in — thank you for being here from the start.',
  'A hidden legacy plan for tenants that existed before subscription plans did. Not offered to new signups.',
  '["Full access to every module", "No enforced limits", "Grandfathered pricing — currently free"]'::jsonb,
  '{"maxFarms": null, "maxUsers": null, "maxUnits": null}'::jsonb,
  '{}'::jsonb,
  'UGX', 0, false, true, -1, now(), now()
)
ON CONFLICT (code) DO NOTHING;
--> statement-breakpoint
INSERT INTO subscriptions (
  id, tenant_id, plan_id, period, status, trial_ends_at, current_period_start, current_period_end,
  list_price_cents, discount_id, discount_amount_cents, amount_due_cents, cancel_at_period_end, is_current, created_at, updated_at
)
SELECT
  gen_random_uuid(), t.id, (SELECT id FROM plans WHERE code = 'legacy'), 'monthly', 'active',
  NULL, now(), NULL, 0, NULL, 0, 0, false, true, now(), now()
FROM tenants t
WHERE NOT EXISTS (SELECT 1 FROM subscriptions s WHERE s.tenant_id = t.id AND s.is_current = true);
--> statement-breakpoint
-- ── Seed 3 public plans (editable data, not code constants) ────────────────
-- Sensible starting price book for a smallholder/mid-size farm SaaS in
-- Uganda (UGX). Quarterly ≈10% cheaper per month than monthly; annual ≈20%
-- cheaper per month than monthly — same shape CRUD (PATCH /api/admin/plans)
-- can freely edit afterward; nothing here is hardcoded in application code.
INSERT INTO plans (id, code, name, tagline, description, features, limits, prices, currency, trial_days, is_public, is_active, sort_order, created_at, updated_at)
VALUES
(
  gen_random_uuid(), 'smallholder', 'Smallholder',
  'For one farm finding its feet.',
  'Everything a single small farm needs to track feeding, health, sales and stock in one place.',
  '["1 farm", "Up to 3 users", "Up to 5 production units", "Batch & inventory tracking", "Sales & basic finance", "Email support"]'::jsonb,
  '{"maxFarms": 1, "maxUsers": 3, "maxUnits": 5}'::jsonb,
  '{"monthly": 3000000, "quarterly": 8100000, "annual": 28800000}'::jsonb,
  'UGX', 14, true, true, 1, now(), now()
),
(
  gen_random_uuid(), 'growing-farm', 'Growing farm',
  'For a farm expanding across units and staff.',
  'Room to grow: more farms, more staff, and the reporting to manage them.',
  '["Up to 3 farms", "Up to 10 users", "Up to 20 production units", "Full finance & payroll", "Governance & approvals", "Priority support"]'::jsonb,
  '{"maxFarms": 3, "maxUsers": 10, "maxUnits": 20}'::jsonb,
  '{"monthly": 8000000, "quarterly": 21600000, "annual": 76800000}'::jsonb,
  'UGX', 14, true, true, 2, now(), now()
),
(
  gen_random_uuid(), 'enterprise', 'Enterprise',
  'For multi-farm operations with no ceiling.',
  'Unlimited farms, users and units, with dedicated onboarding support.',
  '["Unlimited farms", "Unlimited users", "Unlimited production units", "Dedicated onboarding", "Priority support with SLA"]'::jsonb,
  '{"maxFarms": null, "maxUsers": null, "maxUnits": null}'::jsonb,
  '{"monthly": 20000000, "quarterly": 54000000, "annual": 192000000}'::jsonb,
  'UGX', 14, true, true, 3, now(), now()
)
ON CONFLICT (code) DO NOTHING;
