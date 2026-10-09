import { NextResponse } from 'next/server'
import { db } from '@/db'
import { payrollRuns, payslips, payslipLines } from '@/db/schemas'
import { desc, eq } from 'drizzle-orm'
import { requireTenantSession, forbidden } from '@/lib/api-auth'
import { canEdit, canView, MODULES } from '@/lib/permissions'
import { DimensionRequirementError, DimensionValidationError } from '@/lib/finance'
import { isPlainDimensionMap } from '@/lib/dimensions'
import { isUniqueViolation } from '@/lib/db-errors'
import { preparePayroll } from '@/lib/payroll-prepare'
import { startOfUtcDay } from '@/app/api/tasks/route'

// ── GET/POST /api/payroll/runs (payroll-and-gps task) ───────────────────────
// Fresh build: no payroll table/route existed anywhere on this branch before
// this task (see db/schemas/payroll.ts's top comment). GET lists a tenant's
// past runs; POST approves a run for the people named in the body and
// snapshots their payslips. It does not post a journal. Payment is
// POST /api/payroll/runs/[id]/pay, and that is the step that posts.
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

  // The list is required. Omitting it used to pay every active salaried
  // employee. Overlap is per employee, inside preparePayroll: a different
  // person can be paid for the same dates.
  const prepared = await preparePayroll({ tenantId, periodStart, periodEnd, employees: b.employees })
  if ('refused' in prepared) {
    const fields = prepared.refused.includes('would be paid twice')
      ? { periodStart: 'Overlaps a payroll run that already exists' }
      : undefined
    return badRequest(prepared.refused, fields)
  }
  const { figures, employees: included, farmId, statutoryNote } = prepared

  // dryRun writes nothing. The preview is this same preparation.
  if (b.dryRun === true) {
    return ok({
      periodStart,
      periodEnd,
      totalAmountCents: figures.expenseCents,
      grossCents: figures.grossCents,
      deductionCents: figures.deductionCents,
      netCents: figures.netCents,
      employerCostCents: figures.employerCostCents,
      employeeCount: included.length,
      statutoryNote,
      unconfigured: figures.unconfigured,
      employees: included.map((person, index) => {
        const pay = figures.people[index]
        return {
          id: person.id,
          name: person.name,
          amountCents: pay.grossCents,
          grossCents: pay.grossCents,
          deductionCents: pay.deductionCents,
          netCents: pay.netCents,
          employerCostCents: pay.employerCostCents,
          lines: pay.lines,
        }
      }),
      farmId,
    })
  }

  const dimensions = isPlainDimensionMap(b.dimensions) ? b.dimensions : undefined

  try {
    const result = await db.transaction(async (tx) => {
      const [run] = await tx.insert(payrollRuns).values({
        id: crypto.randomUUID(),
        tenantId,
        periodStart,
        periodEnd,
        totalAmountCents: figures.expenseCents,
        employeeCount: included.length,
        createdByUserId: session.id,
        memo,
        status: 'approved',
        grossCents: figures.grossCents,
        deductionCents: figures.deductionCents,
        netCents: figures.netCents,
        employerCostCents: figures.employerCostCents,
        sharedFarmId: farmId,
        dimensionOverrides: dimensions ? JSON.stringify(dimensions) : null,
        statutoryNote,
      }).returning()

      const slipRows = await tx.insert(payslips).values(included.map((person, index) => {
        const pay = figures.people[index]
        return {
          id: crypto.randomUUID(),
          tenantId,
          runId: run.id,
          employeeId: person.id,
          employeeName: person.name,
          amountCents: pay.grossCents,
          grossCents: pay.grossCents,
          deductionCents: pay.deductionCents,
          netCents: pay.netCents,
          employerCostCents: pay.employerCostCents,
          payBasis: pay.payBasis,
          daysWorked: pay.daysWorked,
          dailyRateCents: pay.dailyRateCents,
          overtimeHours: pay.overtimeHours,
          overtimeRateCents: pay.overtimeRateCents,
        }
      })).returning()

      const lineRows = slipRows.flatMap((slip, index) => figures.people[index].lines.map((line) => ({
        id: crypto.randomUUID(),
        tenantId,
        payslipId: slip.id,
        kind: line.kind,
        label: line.label,
        amountCents: line.amountCents,
      })))
      if (lineRows.length > 0) await tx.insert(payslipLines).values(lineRows)

      return { run, payslips: slipRows }
    })
    return created(result)
  } catch (err) {
    if (isUniqueViolation(err)) {
      return badRequest('A payroll run already exists for this exact period')
    }
    if (err instanceof DimensionRequirementError || err instanceof DimensionValidationError) {
      return badRequest(err.message)
    }
    throw err
  }
}
