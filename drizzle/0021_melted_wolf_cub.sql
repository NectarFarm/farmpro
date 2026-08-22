CREATE INDEX "idx_sales_product" ON "sales" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "idx_approval_requests_batch" ON "approval_requests" USING btree ("batch_id");