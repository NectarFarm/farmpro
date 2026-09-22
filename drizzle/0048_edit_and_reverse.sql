-- Edit and reverse, never silently delete or rewrite a posted figure (item
-- 23). One nullable marker column per table — the moment (if any) a sale/
-- purchase was reversed. Everything else (before/after values, the required
-- reason, who did it, and every plain edit that isn't a reversal) lives in
-- the existing append-only audit_log table (entity 'sale'/'purchase'), read
-- back by the same StatusTimeline component tasks already use. No backfill:
-- nothing that exists today has been reversed.
ALTER TABLE "sales" ADD COLUMN "reversed_at" timestamp;--> statement-breakpoint
ALTER TABLE "purchases" ADD COLUMN "reversed_at" timestamp;