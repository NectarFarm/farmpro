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
// `amountCents` stays the snapshotted gross. Gross, deductions, net and
// employer cost are stored beside it when a run is approved. Statutory
// amounts live on payslip_lines, snapshotted from statutory_rates. No rate
// is seeded. A scheme with no row on the period end contributes no line.
import { pgTable, text, timestamp, integer, bigint, real, date, index } from 'drizzle-orm/pg-core'
import { employees } from './people'

// A single payroll run: one tenant, one period, triggered once. `periodStart`/
// `periodEnd` are both normalized to UTC-midnight by the route (same
// "calendar day in server UTC" convention app/api/tasks/route.ts's
// `startOfUtcDay` already uses for `due=today`) so two runs for "the same"
// period can be found again. The index is not unique: a second employee may
// be paid for the same dates. The same employee cannot — overlap is checked
// per payslip before a run is saved.
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
  // Null on a row the migration has not marked. Backfill sets existing runs
  // to 'paid' because they already have journals. New runs are 'approved'
  // until payment, then 'paid'. total_amount_cents is not redefined.
  status: text('status'),
  payDate: timestamp('pay_date'),
  paymentMethod: text('payment_method'),
  paymentReference: text('payment_reference'),
  grossCents: bigint('gross_cents', { mode: 'number' }),
  deductionCents: bigint('deduction_cents', { mode: 'number' }),
  netCents: bigint('net_cents', { mode: 'number' }),
  employerCostCents: bigint('employer_cost_cents', { mode: 'number' }),
  // Money-threshold hold on the payment. Distinct from status. Null means
  // the pay step was not held. The P&L does not read this column.
  approvalStatus: text('approval_status'),
  // The one farm every included employee shared, for the journal dimension
  // only. The P&L does not attribute a run to a farm from this column.
  sharedFarmId: text('shared_farm_id'),
  dimensionOverrides: text('dimension_overrides'),
  statutoryNote: text('statutory_note'),
}, (t) => [
  index('idx_payroll_runs_tenant').on(t.tenantId),
  index('idx_payroll_runs_tenant_period').on(t.tenantId, t.periodStart, t.periodEnd),
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
  // amountCents stays the snapshotted gross. These are the breakdown.
  grossCents: bigint('gross_cents', { mode: 'number' }),
  deductionCents: bigint('deduction_cents', { mode: 'number' }),
  netCents: bigint('net_cents', { mode: 'number' }),
  employerCostCents: bigint('employer_cost_cents', { mode: 'number' }),
  payBasis: text('pay_basis'),
  daysWorked: integer('days_worked'),
  dailyRateCents: bigint('daily_rate_cents', { mode: 'number' }),
  overtimeHours: real('overtime_hours'),
  overtimeRateCents: bigint('overtime_rate_cents', { mode: 'number' }),
}, (t) => [
  index('idx_payslips_tenant').on(t.tenantId),
  index('idx_payslips_run').on(t.runId),
  // GET /api/payroll/me and GET /api/payroll/payslips?employeeId= both scan
  // by employee — this is the index either query needs.
  index('idx_payslips_employee').on(t.employeeId),
])

// Snapshotted lines. Advances and loan repayments are stored negative.
// Not recomputed when a rate row changes later.
export const payslipLines = pgTable('payslip_lines', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  payslipId: text('payslip_id').notNull().references(() => payslips.id, { onDelete: 'cascade' }),
  kind: text('kind').notNull(),
  label: text('label').notNull(),
  amountCents: bigint('amount_cents', { mode: 'number' }).notNull(),
}, (t) => [
  index('idx_payslip_lines_payslip').on(t.payslipId),
])

// Platform catalogue. No rows are seeded. effectiveTo is inclusive.
// A fixed row stores its cents in rateBps. A bracket row stores 0 there
// and the bands in brackets (JSON).
export const statutoryRates = pgTable('statutory_rates', {
  id: text('id').primaryKey(),
  code: text('code').notNull(),
  payer: text('payer').notNull(),
  kind: text('kind').notNull(),
  rateBps: integer('rate_bps').notNull(),
  brackets: text('brackets'),
  ceilingCents: bigint('ceiling_cents', { mode: 'number' }),
  floorCents: bigint('floor_cents', { mode: 'number' }),
  effectiveFrom: date('effective_from', { mode: 'string' }).notNull(),
  effectiveTo: date('effective_to', { mode: 'string' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('idx_statutory_rates_code').on(t.code),
])
