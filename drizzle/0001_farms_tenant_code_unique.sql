-- Follow-up migration (issue #219 review): per-tenant unique farm codes.
-- Delivered as its own migration so any DB that already applied 0000 (which had
-- no unique index) picks this up on the next db:migrate.
CREATE UNIQUE INDEX "idx_farms_tenant_code" ON "farms" USING btree ("tenant_id","code");
