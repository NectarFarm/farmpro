import { NextResponse } from 'next/server'
import { db } from '@/db'
import { payrollRuns, payslips } from '@/db/schemas'
import { and, asc, eq } from 'drizzle-orm'
import { requireTenantSession, forbidden } from '@/lib/api-auth'
import { canView, MODULES } from '@/lib/permissions'

// ── GET /api/payroll/runs/[id] (payroll-and-gps task) ───────────────────────
// View one payroll run and its payslips. Tenant-scoped the same way GET
// /api/batches/[id] is: an id only resolves when its tenantId matches the
// caller's session tenant (or an explicit ?tenantId= for a super_admin
// session) — a run belonging to another tenant 404s rather than leaking
// which ids exist. Guarded by canView(payroll) — see runs/route.ts's comment
// for why a worker (payroll: 'hidden' by default) is refused here and must
// use GET /api/payroll/me instead.

const ok = <T>(data: T) => NextResponse.json({ success: true, data }, { status: 200 })
const notFound = () => NextResponse.json({ success: false, error: 'Payroll run not found' }, { status: 404 })

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const auth = await requireTenantSession({ explicitTenantId: new URL(req.url).searchParams.get('tenantId') })
  if ('error' in auth) return auth.error
  const { session, tenantId } = auth

  if (!(await canView(tenantId, session.role, MODULES.payroll))) {
    return forbidden('Your role does not have access to payroll')
  }

  const rows = await db.select().from(payrollRuns).where(and(eq(payrollRuns.id, id), eq(payrollRuns.tenantId, tenantId)))
  if (rows.length === 0) return notFound()
  const run = rows[0]

  const slips = await db
    .select()
    .from(payslips)
    .where(and(eq(payslips.runId, id), eq(payslips.tenantId, tenantId)))
    .orderBy(asc(payslips.employeeName))

  return ok({ run, payslips: slips })
}
