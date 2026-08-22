import { NextResponse } from 'next/server'
import { db } from '@/db'
import { employees, payrollRuns, payslips } from '@/db/schemas'
import { and, desc, eq } from 'drizzle-orm'
import { requireTenantSession } from '@/lib/api-auth'

// ── GET /api/payroll/me (payroll-and-gps task) ──────────────────────────────
// The worker's own payslips — backs components/farm/worker.tsx's
// WorkerPayScreen. Deliberately NOT gated by canView(MODULES.payroll): that
// module governs the ADMINISTRATIVE runs/payslips-of-others views
// (GET /api/payroll/runs, GET /api/payroll/runs/[id], GET
// /api/payroll/payslips), and a worker has 'hidden' there by default — this
// route is a different, narrower guarantee: any authenticated tenant member
// may see their OWN pay, the same way GET /api/employees/me needs no module
// check either. tenantId and the caller's identity both come from the
// session only — never a query param — which is what makes "own payslips
// and nobody else's" a hard guarantee rather than a convention: there is no
// employeeId/userId parameter on this route for a caller to substitute.
//
// Resolution: employees row by (tenantId, userId = session.id) — same
// lookup GET /api/employees/me uses and the same reason (userId is the only
// exact-match link; see db/schemas/people.ts). No employees row linked to
// this login -> 404, same contract as /api/employees/me.
const ok = <T>(data: T) => NextResponse.json({ success: true, data }, { status: 200 })
const notFound = () => NextResponse.json({ success: false, error: 'No employee record linked to this account' }, { status: 404 })

export async function GET() {
  const auth = await requireTenantSession()
  if ('error' in auth) return auth.error
  const { session, tenantId } = auth

  const empRows = await db
    .select({ id: employees.id })
    .from(employees)
    .where(and(eq(employees.tenantId, tenantId), eq(employees.userId, session.id)))
  if (empRows.length === 0) return notFound()
  const employeeId = empRows[0].id

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
