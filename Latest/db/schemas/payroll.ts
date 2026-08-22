// ── Payroll v1 (payroll-and-gps task) ───────────────────────────────────────
// Before this: no payroll table anywhere in this app — `employees` had no
// pay field, and db/schemas/finance.ts said outright "no payroll account and
// no payroll postings" (see that file's now-updated top comment). The Worker
// Pay screen (components/farm/worker.tsx's WorkerPayScreen) and the
// `payroll` module in lib/permissions.ts's MODULES both predated any real
// data behind them.
//
// Two tables, matching how this app already models a similarly "committed
// once, then frozen" fact (sales/purchases -> journal_entries/journal_lines):
//   - `payroll_runs`: one per tenant per pay period (owner/manager-triggered
//     via POST /api/payroll/runs). Carries the period boundaries and a
//     cached total (sum of its payslips) so a runs list doesn't need to
//     re-aggregate on every GET.
//   - `payslips`: one row per employee paid in a run. `amountCents` and
//     `employeeName` are SNAPSHOTTED at run time from
//     `employees.monthlySalaryCents`/`employees.name` — deliberately NOT a
//     live join to `employees` — so a later salary change, name change, or
//     even the employee being deactivated never rewrites a past payslip's
//     history. This is the same "capture the fact at the time, not a live
//     reference" reasoning `journal_lines.debitCents/creditCents` already
//     embodies for a sale/purchase's amount.
//
// No tax/statutory-deduction/overtime columns anywhere here — deliberately.
// This app has no NHIF/NSSF/PAYE bracket data and guessing Kenyan statutory
// rates would be worse than omitting them outright (explicit instruction).
// `amountCents` is therefore always the employee's full gross pay for the
// period; net-of-deductions payroll is a real, separate follow-up once those
// rules are sourced for real.
import { pgTable, text, timestamp, integer, bigint, index, uniqueIndex } from 'drizzle-orm/pg-core'
import { employees } from './people'

// A single payroll run: one tenant, one period, triggered once. `periodStart`/
// `periodEnd` are both normalized to UTC-midnight by the route (same
// "calendar day in server UTC" convention app/api/tasks/route.ts's
// `startOfUtcDay` already uses for `due=today`) so two runs for "the same"
// period collide reliably at the DB level (idx_payroll_runs_tenant_period)
// instead of only by accident of matching timestamps to the millisecond —
// this is what stops an accidental double-click (or a retried request) from
// paying every employee twice for one period.
export const payrollRuns = pgTable('payroll_runs', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  periodStart: timestamp('period_start').notNull(),
  periodEnd: timestamp('period_end').notNull(),
  // Cached from the payslips created in the same transaction — see
  // POST /api/payroll/runs. Kept in sync only at creation time; this app has
  // no payslip edit/void route yet, so there is nothing to keep it in sync
  // WITH after that.
  totalAmountCents: bigint('total_amount_cents', { mode: 'number' }).notNull().default(0),
  employeeCount: integer('employee_count').notNull().default(0),
  createdByUserId: text('created_by_user_id').notNull(),
  memo: text('memo').notNull().default(''),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('idx_payroll_runs_tenant').on(t.tenantId),
  uniqueIndex('idx_payroll_runs_tenant_period').on(t.tenantId, t.periodStart, t.periodEnd),
])

// One line per employee paid in a run — see this file's top comment for why
// `employeeName`/`amountCents` are snapshots, not a live join.
export const payslips = pgTable('payslips', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  runId: text('run_id').notNull().references(() => payrollRuns.id),
  employeeId: text('employee_id').notNull().references(() => employees.id),
  employeeName: text('employee_name').notNull(),
  amountCents: bigint('amount_cents', { mode: 'number' }).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('idx_payslips_tenant').on(t.tenantId),
  index('idx_payslips_run').on(t.runId),
  // GET /api/payroll/me and GET /api/payroll/payslips?employeeId= both scan
  // by employee — this is the index either query needs.
  index('idx_payslips_employee').on(t.employeeId),
])
