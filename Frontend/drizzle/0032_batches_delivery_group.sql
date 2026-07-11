-- Lets several batches created from ONE delivery (split across multiple units,
-- e.g. 3600 fries into 3 tanks) be traced back to that shared delivery, without
-- changing the one-batch-one-unit rule everywhere else in the system relies on.
ALTER TABLE "batches" ADD COLUMN "delivery_group_id" text;
