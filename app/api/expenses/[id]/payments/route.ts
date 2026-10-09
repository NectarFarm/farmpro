import { NextResponse } from 'next/server'
import { requireTenantSession, forbidden } from '@/lib/api-auth'
import { canEdit, MODULES } from '@/lib/permissions'
import { DimensionRequirementError, DimensionValidationError, isPlainDimensionMap } from '@/lib/dimensions'
import { recordExpensePayment, ExpensePaymentError } from '@/lib/expenses'
import { isInvalid, requireCents, requireEventDate } from '@/lib/validate-input'
import { PAYMENT_METHODS, referenceLabel } from '@/lib/payment-method'

// ── POST /api/expenses/[id]/payments ────────────────────────────────────────
// Pays off part or all of an expense recorded on account. Posts Dr Accounts
// Payable / Cr Cash as a new entry; the expense's own posting is never
// rewritten. Needs a reason, like every other correction to a posted record.
// Body: { tenantId?, amountCents, paymentMethod, paymentReference?, reason,
//         date?, dimensions? }

const ok = <T>(data: T) => NextResponse.json({ success: true, data }, { status: 200 })
const badRequest = (msg: string) => NextResponse.json({ success: false, error: msg }, { status: 400 })

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
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

  if (!(await canEdit(tenantId, session.role, MODULES.finance))) {
    return forbidden('Your role does not have edit access to finance')
  }

  const reason = typeof b.reason === 'string' ? b.reason.trim() : ''
  if (!reason) return badRequest('A reason is required to record a payment against an expense')

  const amountCents = requireCents(b.amountCents, 'amountCents')
  if (isInvalid(amountCents)) return badRequest(amountCents.problem)
  if (amountCents <= 0) return badRequest('Payment must be more than zero')

  const paymentMethod = typeof b.paymentMethod === 'string' ? b.paymentMethod.trim() : ''
  if (!paymentMethod || paymentMethod === 'Credit' || !(PAYMENT_METHODS as readonly string[]).includes(paymentMethod)) {
    return badRequest('Choose how this was paid')
  }
  const paymentReference = typeof b.paymentReference === 'string' ? b.paymentReference.trim() : ''
  const refLabel = referenceLabel(paymentMethod)
  if (refLabel && !paymentReference) return badRequest(`${refLabel} is required`)

  let postingDate = new Date()
  if (b.date !== undefined && b.date !== null && b.date !== '') {
    const parsed = requireEventDate(b.date, 'date')
    if (isInvalid(parsed)) return badRequest(parsed.problem)
    postingDate = parsed
  }

  try {
    const result = await recordExpensePayment({
      tenantId,
      expenseId: id,
      amountCents,
      paymentMethod,
      paymentReference: paymentReference || null,
      reason,
      postingDate,
      recordedBy: session.id,
      dimensions: isPlainDimensionMap(b.dimensions) ? b.dimensions : undefined,
    })
    return ok(result)
  } catch (err) {
    if (err instanceof ExpensePaymentError) {
      return NextResponse.json({ success: false, error: err.message }, { status: err.message.startsWith('Expense not found') ? 404 : 400 })
    }
    if (err instanceof DimensionRequirementError || err instanceof DimensionValidationError) return badRequest(err.message)
    throw err
  }
}
