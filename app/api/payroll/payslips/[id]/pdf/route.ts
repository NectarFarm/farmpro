import { NextResponse } from 'next/server'
import { and, eq } from 'drizzle-orm'
import { db } from '@/db'
import { employees, payrollRuns, payslipLines, payslips } from '@/db/schemas'
import { requireTenantSession } from '@/lib/api-auth'
import { canView, MODULES } from '@/lib/permissions'
import { formatMoney } from '@/lib/money'

// GET /api/payroll/payslips/[id]/pdf
// A worker downloads their own slip. Someone who can view payroll downloads
// any slip on the business. The file is built from the stored lines.

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const auth = await requireTenantSession({ explicitTenantId: new URL(req.url).searchParams.get('tenantId') })
  if ('error' in auth) return auth.error
  const { session, tenantId } = auth

  const [slip] = await db.select().from(payslips).where(and(eq(payslips.id, id), eq(payslips.tenantId, tenantId)))
  if (!slip) return NextResponse.json({ success: false, error: 'Payslip not found' }, { status: 404 })

  const [employee] = await db.select({ userId: employees.userId }).from(employees).where(eq(employees.id, slip.employeeId))
  const own = employee?.userId === session.id
  if (!own && !(await canView(tenantId, session.role, MODULES.payroll))) {
    return NextResponse.json({ success: false, error: 'Payslip not found' }, { status: 404 })
  }

  const [run] = await db.select().from(payrollRuns).where(eq(payrollRuns.id, slip.runId))
  if (!run || run.tenantId !== tenantId) {
    return NextResponse.json({ success: false, error: 'Payslip not found' }, { status: 404 })
  }
  const lines = await db.select().from(payslipLines).where(eq(payslipLines.payslipId, slip.id))

  const { jsPDF } = await import('jspdf')
  const doc = new jsPDF({ unit: 'pt', format: 'a4' })
  let y = 48
  doc.setFontSize(16)
  doc.text('Payslip', 40, y)
  y += 22
  doc.setFontSize(11)
  const period = `${run.periodStart.toISOString().slice(0, 10)} to ${run.periodEnd.toISOString().slice(0, 10)}`
  doc.text(slip.employeeName, 40, y)
  y += 16
  doc.text(period, 40, y)
  y += 22
  if (lines.length === 0) {
    doc.text('This payslip was recorded before line amounts were stored.', 40, y)
    y += 16
    doc.text(`Amount: ${formatMoney(slip.amountCents)}`, 40, y)
  } else {
    for (const line of lines) {
      doc.text(`${line.label}`, 40, y)
      doc.text(formatMoney(line.amountCents), 400, y)
      y += 16
    }
    y += 8
    const row = (label: string, cents: number | null) => {
      doc.text(label, 40, y)
      doc.text(cents == null ? 'Not stored' : formatMoney(cents), 400, y)
      y += 16
    }
    row('Gross', slip.grossCents)
    row('Deductions', slip.deductionCents)
    row('Net', slip.netCents)
    row('Employer cost', slip.employerCostCents)
  }
  y += 12
  if (run.statutoryNote) {
    const wrapped = doc.splitTextToSize(run.statutoryNote, 500)
    doc.text(wrapped, 40, y)
    y += wrapped.length * 14 + 8
  }
  if (run.status === 'paid') {
    const paidOn = run.payDate ? run.payDate.toISOString().slice(0, 10) : 'a date that was not stored'
    doc.text(`Paid on ${paidOn} by ${run.paymentMethod ?? 'a method that was not stored'}.`, 40, y)
    y += 16
    if (run.paymentReference) doc.text(`Reference: ${run.paymentReference}`, 40, y)
  } else {
    doc.text('Approved — not paid. This has not entered the books.', 40, y)
  }

  const bytes = doc.output('arraybuffer')
  return new NextResponse(Buffer.from(bytes), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="payslip-${slip.id.slice(0, 8)}.pdf"`,
    },
  })
}
