-- Dual-write money migration: add integer (cents) columns alongside existing
-- doublePrecision (KES) columns. Both are written simultaneously during the
-- transition period. Once all code reads from _cents and old columns are verified,
-- a follow-up migration drops the doublePrecision originals.
-- Conversion: KSh 1 = 100 cents. e.g. KSh 1,500.50 = 150050 cents.

ALTER TABLE employees ADD COLUMN IF NOT EXISTS salary_cents integer NOT NULL DEFAULT 0;

ALTER TABLE payslips ADD COLUMN IF NOT EXISTS gross_cents integer NOT NULL DEFAULT 0;
ALTER TABLE payslips ADD COLUMN IF NOT EXISTS advances_cents integer NOT NULL DEFAULT 0;
ALTER TABLE payslips ADD COLUMN IF NOT EXISTS fines_cents integer NOT NULL DEFAULT 0;
ALTER TABLE payslips ADD COLUMN IF NOT EXISTS bonuses_cents integer NOT NULL DEFAULT 0;
ALTER TABLE payslips ADD COLUMN IF NOT EXISTS net_cents integer NOT NULL DEFAULT 0;

ALTER TABLE employee_ledger ADD COLUMN IF NOT EXISTS amount_cents integer NOT NULL DEFAULT 0;

ALTER TABLE batches ADD COLUMN IF NOT EXISTS acquisition_cost_cents integer NOT NULL DEFAULT 0;

ALTER TABLE inventory_lots ADD COLUMN IF NOT EXISTS unit_cost_cents integer NOT NULL DEFAULT 0;

ALTER TABLE sales ADD COLUMN IF NOT EXISTS unit_price_cents integer NOT NULL DEFAULT 0;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS total_amount_cents integer NOT NULL DEFAULT 0;

ALTER TABLE purchases ADD COLUMN IF NOT EXISTS unit_cost_cents integer NOT NULL DEFAULT 0;
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS total_cost_cents integer NOT NULL DEFAULT 0;

ALTER TABLE overheads ADD COLUMN IF NOT EXISTS amount_cents integer NOT NULL DEFAULT 0;

ALTER TABLE feed_formulas ADD COLUMN IF NOT EXISTS unit_cost_cents integer NOT NULL DEFAULT 0;
