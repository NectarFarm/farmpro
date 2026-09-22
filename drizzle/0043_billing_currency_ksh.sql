-- Billing money is Kenyan shillings, not Ugandan.
--
-- 0042 seeded the hidden `legacy` plan and the three public plans with
-- 'UGX', and both `plans.currency` and `payments.currency` defaulted to it.
-- Nothing in the app displays a currency of its own any more (the admin
-- console reads the plan's), so a UGX row renders as "UGX 0" on the
-- Subscriptions table for every tenant on the founding plan — which is what
-- it actually says in the database, not a formatting bug.
--
-- This moves the stored value and the column default to 'KSh', matching
-- tenant_settings.currency_symbol, which is already 'KSh'. It rewrites every
-- existing plan row: a per-plan currency stays supported (a tenant billed in
-- another currency is a real future case), but nothing on this platform is
-- priced in UGX today, and leaving one row behind is exactly how the label
-- leaked in the first place. `payments` has no rows yet; the default is
-- changed so the next one is not born wrong.
--
-- Prices are NOT converted. The amounts in 0042 were written as the intended
-- shilling figures (and have since been edited to the real KSh prices from
-- the admin console); only the label was wrong, so touching the numbers here
-- would silently change what tenants are charged.
UPDATE "plans" SET "currency" = 'KSh' WHERE "currency" = 'UGX';
--> statement-breakpoint
UPDATE "payments" SET "currency" = 'KSh' WHERE "currency" = 'UGX';
--> statement-breakpoint
ALTER TABLE "plans" ALTER COLUMN "currency" SET DEFAULT 'KSh';
--> statement-breakpoint
ALTER TABLE "payments" ALTER COLUMN "currency" SET DEFAULT 'KSh';
