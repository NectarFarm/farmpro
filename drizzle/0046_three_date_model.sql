-- Three explicit dates on a sale/purchase (item 18): transaction date (when
-- it happened), effective/received date (when stock or the service took
-- effect), and posting date (which ledger period it belongs to).
--
-- `sales.sold_at` already IS the transaction date, and `purchases.
-- received_date` (migration 0045) already IS the effective date — neither
-- is renamed or repurposed. The two genuinely new facts per table are
-- `effective_date`/`posting_date` (sales) and `transaction_date`/
-- `posting_date` (purchases).
--
-- ── The backfill, and why it is NOT the same column on both tables ─────────
-- The one rule this whole migration exists to satisfy is "not one historical
-- figure moves" once lib/reports.ts is repointed at posting_date (a separate,
-- follow-up commit — this one changes no read path at all). That means
-- posting_date has to be backfilled to whatever column each report ALREADY
-- filters by today, not to whichever column merely sounds most like it:
--   - lib/reports.ts's computePlReport/computeBatchPlReport have always
--     filtered SALES by `sold_at` — so sales.posting_date backfills from
--     `sold_at`, not `created_at`. A tenant who ever backdated a sale (the
--     route has accepted an explicit `soldAt` since before this task) has
--     `sold_at <> created_at`; backfilling from `created_at` would silently
--     move that sale into a different reporting period the moment the read
--     side switches over.
--   - The same functions have always filtered PURCHASES by `created_at` (see
--     db/schemas/inventory.ts's own long-standing comment on why
--     `receivedDate` was never wired into that filter) — so
--     purchases.posting_date backfills from `created_at`.
-- effective_date/transaction_date carry no read-path risk either way (no
-- report has ever filtered on them) and are backfilled from the closest
-- honest proxy available: sold_at (sales' effective date) and created_at
-- (purchases' transaction date — there is no better historical source for
-- "when the purchase transaction itself happened").
--
-- Proven, not just asserted: tests/three-date-model.test.ts seeds a
-- deliberately backdated sale (sold_at far from created_at) alongside
-- ordinary rows, computes the P&L two ways — once via the real
-- computePlReport, once by hand-filtering the same seeded rows on the
-- columns the report used to read — and asserts they agree.
ALTER TABLE "sales" ADD COLUMN "effective_date" timestamp;--> statement-breakpoint
ALTER TABLE "sales" ADD COLUMN "posting_date" timestamp;--> statement-breakpoint
ALTER TABLE "purchases" ADD COLUMN "transaction_date" timestamp;--> statement-breakpoint
ALTER TABLE "purchases" ADD COLUMN "posting_date" timestamp;--> statement-breakpoint
UPDATE "sales" SET "effective_date" = "sold_at", "posting_date" = "sold_at" WHERE "posting_date" IS NULL;
--> statement-breakpoint
UPDATE "purchases" SET "transaction_date" = "created_at", "posting_date" = "created_at" WHERE "posting_date" IS NULL;
