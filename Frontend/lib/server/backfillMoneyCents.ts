import 'server-only';
// One-time backfill: copy existing doublePrecision (KES) money values into the
// new integer (cents) columns. Safe to re-run (idempotent — only updates rows
// where _cents is still 0). Uses db.execute() for the raw UPDATE so we get a
// reliable row count from the server.
import { db } from '@/db';
import { sql } from 'drizzle-orm';

const BACKFILL_SQL = (col: string, centsCol: string) =>
  sql`UPDATE ${sql.raw(col)} SET ${sql.raw(centsCol)} = ROUND(${sql.raw(col.replace('_cents', ''))} * 100)::integer WHERE ${sql.raw(centsCol)} = 0 AND ${sql.raw(col.replace('_cents', ''))} != 0`;

export async function backfillMoneyCents(): Promise<Record<string, number>> {
  const tables: { label: string; sql: ReturnType<typeof sql> }[] = [
    { label: 'employees',        sql: BACKFILL_SQL('employees', 'salary_cents') },
    { label: 'payslips',         sql: BACKFILL_SQL('payslips', 'gross_cents') },
    { label: 'payslips_advances',sql: BACKFILL_SQL('payslips', 'advances_cents') },
    { label: 'payslips_fines',   sql: BACKFILL_SQL('payslips', 'fines_cents') },
    { label: 'payslips_bonuses', sql: BACKFILL_SQL('payslips', 'bonuses_cents') },
    { label: 'payslips_net',     sql: BACKFILL_SQL('payslips', 'net_cents') },
    { label: 'employee_ledger',  sql: BACKFILL_SQL('employee_ledger', 'amount_cents') },
    { label: 'batches',          sql: BACKFILL_SQL('batches', 'acquisition_cost_cents') },
    { label: 'inventory_lots',   sql: BACKFILL_SQL('inventory_lots', 'unit_cost_cents') },
    { label: 'sales_price',      sql: BACKFILL_SQL('sales', 'unit_price_cents') },
    { label: 'sales_total',      sql: BACKFILL_SQL('sales', 'total_amount_cents') },
    { label: 'purchases_price',  sql: BACKFILL_SQL('purchases', 'unit_cost_cents') },
    { label: 'purchases_total',  sql: BACKFILL_SQL('purchases', 'total_cost_cents') },
    { label: 'overheads',        sql: BACKFILL_SQL('overheads', 'amount_cents') },
    { label: 'feed_formulas',    sql: BACKFILL_SQL('feed_formulas', 'unit_cost_cents') },
  ];

  const counts: Record<string, number> = {};
  for (const t of tables) {
    const result = await db.execute(t.sql);
    counts[t.label] = (result as { rowCount?: number }).rowCount ?? 0;
  }
  return counts;
}
