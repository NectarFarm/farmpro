ALTER TABLE "products" ADD COLUMN "stock_effect" text DEFAULT 'produce' NOT NULL;--> statement-breakpoint
ALTER TABLE "sales" ADD COLUMN "qty" integer;