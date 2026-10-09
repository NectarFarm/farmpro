-- Stock-count approval line (issue #418).
-- Nullable on purpose: null means the farm has not set a line, and a stock
-- adjustment still saves immediately. No default amount is written, and no
-- existing row is updated, so nothing already reported can move.
ALTER TABLE "tenant_settings" ADD COLUMN IF NOT EXISTS "variance_approval_threshold_cents" bigint;
