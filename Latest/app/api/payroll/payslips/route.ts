import { NextResponse } from 'next/server'
import { db } from '@/db'
import { employees, payrollRuns, payslips } from '@/db/schemas'
import { and, desc, eq } from 'drizzle-orm'
import { requireTenantSession, forbidden } from '@/lib/api-auth'
import { canView, MODULES } from '@/lib/permissions'

// ── GET /api/payroll/payslips?employeeId= (payroll-and-gps task) ───────────
// An owner/manager viewing ONE employee's pay history across every run —
// backs the per-employee "Payroll" tab in components/farm/people.tsx
// (activeSection === 'payroll'). Distinct from GET /api/payroll/me (a
// worker's own pay, no module gate) and GET /api/payroll/runs/[id] (every
// payslip IN one run) — this is every payslip FOR one employee, across runs.
//
// Guarded by canView(payroll), same as the runs endpoints — a worker looking
// at their OWN employeeId here would still be refused (payroll: 'hidden' by
// default), which is correct: this route's whole point is administrative
// visibility into someone else's pay, and a worker's self-service path is
// /api/payroll/me, not this one.

const ok = <T>(data: T) => NextResponse.json({ success: true, data }, { status: 200 })
const badRequest = (msg: string) => NextResponse.json({ success: false, error: msg }, { status: 400 })
const notFound = (msg: string) => NextResponse.json({ success: false, error: msg }, { status: 404 })

export async function GET(req: Request) {
  const url = new URL(req.url)
  const auth = await requireTenantSession({ explicitTenantId: url.searchParams.get('tenantId') })
  if ('error' in auth) return auth.error
  const { session, tenantId } = auth

  if (!(await canView(tenantId, session.role, MODULES.payroll))) {
    return forbidden('Your role does not have access to payroll')
  }

  const employeeId = url.searchParams.get('employeeId')?.trim()
  if (!employeeId) return badRequest('employeeId is required')

  const empRows = await db
    .select({ id: employees.id })
    .from(employees)
    .where(and(eq(employees.id, employeeId), eq(employees.tenantId, tenantId)))
  if (empRows.length === 0) return notFound('Employee not found for this tenant')

  const rows = await db
    .select({
      id: payslips.id,
      amountCents: payslips.amountCents,
      createdAt: payslips.createdAt,
      runId: payslips.runId,
      periodStart: payrollRuns.periodStart,
      periodEnd: payrollRuns.periodEnd,
    })
    .from(payslips)
    .innerJoin(payrollRuns, eq(payslips.runId, payrollRuns.id))
    .where(and(eq(payslips.employeeId, employeeId), eq(payslips.tenantId, tenantId)))
    .orderBy(desc(payrollRuns.periodStart))

  return ok(rows)
}
