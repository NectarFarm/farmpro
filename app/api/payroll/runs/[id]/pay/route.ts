import { NextResponse } from 'next/server'
import { and, eq, inArray, isNull, or } from 'drizzle-orm'
import { db } from '@/db'
import { payrollRuns, payslipLines, payslips } from '@/db/schemas'
import { requireTenantSession, forbidden } from '@/lib/api-auth'
import { canEdit, MODULES } from '@/lib/permissions'
import { DimensionRequirementError, DimensionValidationError } from '@/lib/finance'
import { isPlainDimensionMap } from '@/lib/dimensions'
import { requireEventDate } from '@/lib/validate-input'
import { judgeMoney, payrollLegs } from '@/lib/posting-policy'
import { loadPostingPolicies } from '@/lib/posting-policies'
import { journalSplits } from '@/lib/payroll-calc'
import { postStoredPayroll } from '@/lib/payroll-post'
import { insertMoneyApproval } from '@/lib/raise-money-approval'
import { notifyMoneyPostings } from '@/lib/notify-money-posting'

// POST /api/payroll/runs/[id]/pay
// The typed word PAY, a pay date, a method and a reference. This is the
// step that posts the journal. Saving the run does not.

const ok = <T>(data: T) => NextResponse.json({ success: true, data }, { status: 200 })
const badRequest = (msg: string) => NextResponse.json({ success: false, error: msg }, { status: 400 })
const notFound = () => NextResponse.json({ success: false, error: 'Payroll run not found' }, { status: 404 })

const METHODS = new Set(['Cash', 'M-Pesa', 'Bank transfer', 'Cheque'])

function storedDimensions(raw: string | null): Record<string, string> | undefined {
  if (!raw) return undefined
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined
    const dimensions: Record<string, string> = {}
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === 'string') dimensions[key] = value
    }
    return dimensions
  } catch {
    return undefined
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
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

  const { id } = await params
  if (b.confirmation !== 'PAY') return badRequest('Type PAY to record the payment.')
  const payDate = requireEventDate(b.payDate, 'payDate')
  if (typeof payDate === 'object' && 'problem' in payDate) return badRequest(payDate.problem)
  const paymentMethod = typeof b.paymentMethod === 'string' ? b.paymentMethod : ''
  if (!METHODS.has(paymentMethod)) return badRequest('Payment method must be Cash, M-Pesa, Bank transfer or Cheque.')
  const paymentReference = typeof b.paymentReference === 'string' ? b.paymentReference.trim() : ''
  if (!paymentReference) return badRequest('A payment reference is required.')

  const [run] = await db.select().from(payrollRuns).where(and(eq(payrollRuns.id, id), eq(payrollRuns.tenantId, tenantId)))
  if (!run) return notFound()
  if (run.status === 'paid') return badRequest('This run is already paid.')
  if (run.status !== 'approved') return badRequest('This run is not approved.')
  if (run.approvalStatus === 'pending') return badRequest('This payment is waiting for approval.')

  const slips = await db.select({ id: payslips.id }).from(payslips).where(and(eq(payslips.runId, run.id), eq(payslips.tenantId, tenantId)))
  const own = slips.length === 0
    ? []
    : await db.select().from(payslipLines).where(inArray(payslipLines.payslipId, slips.map((slip) => slip.id)))
  const splits = journalSplits(own)
  const dimensions = isPlainDimensionMap(b.dimensions) ? b.dimensions : storedDimensions(run.dimensionOverrides)
  const decision = judgeMoney(await loadPostingPolicies(tenantId), {
    amountCents: run.totalAmountCents,
    farmId: run.sharedFarmId,
    legs: payrollLegs({
      expenseCents: run.totalAmountCents,
      netCents: splits.netCents,
      payeCents: splits.payeCents,
      nssfCents: splits.nssfCents,
      shifCents: splits.shifCents,
      advanceCents: splits.advanceCents,
    }),
  })
  if (decision.outcome === 'block') return badRequest(decision.message)

  const waiting = and(
    eq(payrollRuns.id, run.id),
    eq(payrollRuns.tenantId, tenantId),
    eq(payrollRuns.status, 'approved'),
    or(isNull(payrollRuns.approvalStatus), eq(payrollRuns.approvalStatus, 'rejected'))!,
  )

  try {
    const result = await db.transaction(async (tx) => {
      if (decision.outcome === 'pending') {
        const [updated] = await tx.update(payrollRuns).set({ approvalStatus: 'pending' }).where(waiting).returning()
        if (!updated) return null
        await insertMoneyApproval(tx, {
          tenantId,
          requestedBy: session.id,
          title: 'Payroll payment',
          details: {
            docType: 'payroll',
            documentId: run.id,
            amountCents: run.totalAmountCents,
            payDate: (payDate as Date).toISOString(),
            paymentMethod,
            paymentReference,
          },
        })
        return { run: updated, pending: true as const }
      }
      const [updated] = await tx.update(payrollRuns).set({
        status: 'paid',
        payDate: payDate as Date,
        paymentMethod,
        paymentReference,
        approvalStatus: null,
      }).where(waiting).returning()
      if (!updated) return null
      await postStoredPayroll(tx, updated, dimensions)
      return { run: updated, pending: false as const }
    })
    if (!result) return NextResponse.json({ success: false, error: 'This payment is waiting for approval.' }, { status: 409 })
    if (result.pending) await notifyMoneyPostings(tenantId, [run.id])
    return ok(result)
  } catch (err) {
    if (err instanceof DimensionRequirementError || err instanceof DimensionValidationError) return badRequest(err.message)
    if (err instanceof Error && err.message === 'Payroll journal does not balance') return badRequest(err.message)
    throw err
  }
}
