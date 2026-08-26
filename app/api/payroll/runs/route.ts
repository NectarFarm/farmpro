import { NextResponse } from 'next/server'
import { db } from '@/db'
import { employees, payrollRuns, payslips } from '@/db/schemas'
import { and, desc, eq, gt, lt } from 'drizzle-orm'
import { requireTenantSession, forbidden } from '@/lib/api-auth'
import { canEdit, canView, MODULES } from '@/lib/permissions'
import { postPayrollJournal } from '@/lib/finance'
import { isUniqueViolation } from '@/lib/db-errors'
import { startOfUtcDay } from '@/app/api/tasks/route'

// ── GET/POST /api/payroll/runs (payroll-and-gps task) ───────────────────────
// Fresh build: no payroll table/route existed anywhere on this branch before
// this task (see db/schemas/payroll.ts's top comment). GET lists a tenant's
// past runs; POST creates a new run for a period and, in the same
// transaction, snapshots a payslip per eligible employee and posts the
// run's journal entry (lib/finance.ts's postPayrollJournal) — a run can
// never exist without its payslips or its ledger entry.
//
// Guard: both verbs require a session; POST additionally requires
// canEdit(tenantId, role, MODULES.payroll) — by default only `owner` (and
// `super_admin`) has edit on payroll (lib/permissions.ts's DEFAULT_MATRIX
// gives `manager` only 'view'), so a manager is refused the write exactly
// like the payroll module's stated intent. GET requires canView, which
// `manager` and `auditor` have by default but `worker`/`vet` do not —
// deliberately: a worker's own pay is GET /api/payroll/me, not this list
// (which would otherwise leak every other employee's pay to any viewer).

const ok = <T>(data: T) => NextResponse.json({ success: true, data }, { status: 200 })
const created = <T>(data: T) => NextResponse.json({ success: true, data }, { status: 201 })
const badRequest = (msg: string, fields?: Record<string, string>) =>
  NextResponse.json({ success: false, error: msg, ...(fields ? { fields } : {}) }, { status: 400 })

// GET /api/payroll/runs?tenantId= — list a tenant's payroll runs, newest
// period first.
export async function GET(req: Request) {
  const url = new URL(req.url)
  const auth = await requireTenantSession({ explicitTenantId: url.searchParams.get('tenantId') })
  if ('error' in auth) return auth.error
  const { session, tenantId } = auth

  if (!(await canView(tenantId, session.role, MODULES.payroll))) {
    return forbidden('Your role does not have access to payroll')
  }

  const rows = await db
    .select()
    .from(payrollRuns)
    .where(eq(payrollRuns.tenantId, tenantId))
    .orderBy(desc(payrollRuns.periodStart), desc(payrollRuns.id))

  return ok(rows)
}

// POST /api/payroll/runs — run payroll for a period.
// Body: { tenantId?, periodStart, periodEnd, memo? } — both dates required,
// parsed and normalized to UTC-midnight (same convention
// app/api/tasks/route.ts's `startOfUtcDay` already uses), so two attempts to
// run "the same" period collide at the DB's unique index
// (idx_payroll_runs_tenant_period) instead of only by timestamp-to-the-
// millisecond luck.
//
// Only ACTIVE employees with a monthlySalaryCents > 0 are paid — an employee
// with no rate configured is excluded, not paid KSh 0 (see
// db/schemas/people.ts's comment on that column). If that leaves zero
// eligible employees the run is refused outright: an empty payroll run with
// a real id and a real (empty) ledger posting would look like a completed
// payroll cycle when nothing was actually decided.
export async function POST(req: Request) {
  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return badRequest('Invalid JSON body')
  }
  const b = (raw ?? {}) as Record<string, unknown>
  const auth = await requireTenantSession({ explicitTenantId: typeof b.tenantId === 'string' ? b.tenantId : undefined })
  if ('error' in auth) return auth.error
  const { session, tenantId } = auth

  if (!(await canEdit(tenantId, session.role, MODULES.payroll))) {
    return forbidden('Your role does not have edit access to payroll')
  }

  const fields: Record<string, string> = {}
  const rawStart = typeof b.periodStart === 'string' ? new Date(b.periodStart) : null
  const rawEnd = typeof b.periodEnd === 'string' ? new Date(b.periodEnd) : null
  if (!rawStart || Number.isNaN(rawStart.getTime())) fields.periodStart = 'A valid periodStart date is required'
  if (!rawEnd || Number.isNaN(rawEnd.getTime())) fields.periodEnd = 'A valid periodEnd date is required'
  if (Object.keys(fields).length > 0) return badRequest('Invalid period', fields)

  const periodStart = startOfUtcDay(rawStart as Date)
  const periodEnd = startOfUtcDay(rawEnd as Date)
  if (periodEnd.getTime() <= periodStart.getTime()) {
    return badRequest('periodEnd must be after periodStart', { periodEnd: 'Must be after periodStart' })
  }

  const memo = typeof b.memo === 'string' ? b.memo.trim() : ''

  // ── Nobody gets paid twice for the same days ─────────────────────────────
  // The only guard here was the unique index on
  // (tenant_id, period_start, period_end), which catches an EXACT repeat — a
  // double-click, or a retried request. It does not catch the mistake that
  // actually loses money: a second run over an OVERLAPPING period. "1–31 Aug"
  // followed by "15 Aug–15 Sep" are two different keys, so both inserted, and
  // every employee was paid twice for the fortnight they share — with two
  // journal entries debiting Payroll Expense for the full month each.
  //
  // Standard half-open overlap test: two ranges overlap when each starts
  // before the other ends. Checked in the request rather than as a DB
  // constraint because expressing it in Postgres needs an exclusion
  // constraint over a range type, which is a schema change and a migration
  // for a rule this route is the only writer for.
  const overlapping = await db
    .select({
      id: payrollRuns.id,
      periodStart: payrollRuns.periodStart,
      periodEnd: payrollRuns.periodEnd,
    })
    .from(payrollRuns)
    .where(and(
      eq(payrollRuns.tenantId, tenantId),
      lt(payrollRuns.periodStart, periodEnd),
      gt(payrollRuns.periodEnd, periodStart),
    ))
    .limit(1)

  if (overlapping.length > 0) {
    const clash = overlapping[0]
    const iso = (d: Date) => d.toISOString().slice(0, 10)
    return badRequest(
      `Payroll has already been run for ${iso(clash.periodStart)} to ${iso(clash.periodEnd)}, `
      + 'which overlaps this period — those days would be paid twice. '
      + 'Pick a period that starts after that run ends.',
      { periodStart: 'Overlaps a payroll run that already exists' }
    )
  }

  const eligible = await db
    .select({ id: employees.id, name: employees.name, monthlySalaryCents: employees.monthlySalaryCents })
    .from(employees)
    .where(and(eq(employees.tenantId, tenantId), eq(employees.status, 'ACTIVE'), gt(employees.monthlySalaryCents, 0)))

  if (eligible.length === 0) {
    return badRequest('No active employees have a pay rate set — set a monthly salary on at least one employee before running payroll')
  }

  const totalAmountCents = eligible.reduce((sum, e) => sum + e.monthlySalaryCents, 0)

  try {
    const result = await db.transaction(async (tx) => {
      const [run] = await tx
        .insert(payrollRuns)
        .values({
          id: crypto.randomUUID(),
          tenantId,
          periodStart,
          periodEnd,
          totalAmountCents,
          employeeCount: eligible.length,
          createdByUserId: session.id,
          memo,
        })
        .returning()

      const slipRows = await tx
        .insert(payslips)
        .values(eligible.map((e) => ({
          id: crypto.randomUUID(),
          tenantId,
          runId: run.id,
          employeeId: e.id,
          employeeName: e.name,
          amountCents: e.monthlySalaryCents,
        })))
        .returning()

      await postPayrollJournal(tx, { id: run.id, tenantId, totalAmountCents, periodStart, periodEnd })

      return { run, payslips: slipRows }
    })

    return created(result)
  } catch (err) {
    if (isUniqueViolation(err)) {
      return badRequest('A payroll run already exists for this exact period')
    }
    throw err
  }
}
