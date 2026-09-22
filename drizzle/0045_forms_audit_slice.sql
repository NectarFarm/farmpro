-- Forms-audit slice: structured payment method + reference and a credit due
-- date on sales and purchases, a buyer note and free-text notes on sales, an
-- invoice/receipt number, a genuinely separate received date and an optional
-- receipt photo on purchases, and an optional SKU on the item catalogue. See
-- db/schemas/finance.ts and db/schemas/inventory.ts for why each column
-- exists and, for `purchases.received_date` specifically, why it is a NEW
-- column rather than repointing the existing (already-accepted)
-- `receivedDate` request param at `purchases.created_at` — that column stays
-- exactly as it is, for P&L period continuity. `purchases.photo_url` reuses
-- the exact image-data-URL shape/cap lib/record-photos.ts already validates
-- for records, one photo instead of up to four.
--
-- Every column here is nullable and every existing row keeps saving exactly
-- as before; nothing is backfilled because none of these facts existed to
-- backfill from.
ALTER TABLE "sales" ADD COLUMN "payment_reference" text;--> statement-breakpoint
ALTER TABLE "sales" ADD COLUMN "due_date" timestamp;--> statement-breakpoint
ALTER TABLE "sales" ADD COLUMN "sold_to" text;--> statement-breakpoint
ALTER TABLE "sales" ADD COLUMN "notes" text;--> statement-breakpoint
ALTER TABLE "inventory_items" ADD COLUMN "sku" text;--> statement-breakpoint
ALTER TABLE "purchases" ADD COLUMN "payment_reference" text;--> statement-breakpoint
ALTER TABLE "purchases" ADD COLUMN "due_date" timestamp;--> statement-breakpoint
ALTER TABLE "purchases" ADD COLUMN "invoice_number" text;--> statement-breakpoint
ALTER TABLE "purchases" ADD COLUMN "received_date" timestamp;--> statement-breakpoint
ALTER TABLE "purchases" ADD COLUMN "notes" text;--> statement-breakpoint
ALTER TABLE "purchases" ADD COLUMN "photo_url" text;