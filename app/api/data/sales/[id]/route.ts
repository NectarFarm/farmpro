import { NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import { db } from '@/db'
import { sales, customers, auditLog } from '@/db/schemas'
import { and, eq } from 'drizzle-orm'
import { requireTenantSession, forbidden } from '@/lib/api-auth'
import { canEdit, canModifyOwnRow, MODULES } from '@/lib/permissions'
import { isInvalid, requireFutureAllowedDate } from '@/lib/validate-input'

// ── PATCH /api/data/sales/[id] (item 23) ────────────────────────────────────
// Edits a sale with a required reason — but only the fields that do NOT
// drive the ledger or the batch/stock ledger: `item` (the label), `notes`,
// `paymentReference`, `soldTo`, `customerId`, `dueDate`. Deliberately
// excluded: `amountCents`, `qty`, `status`, `method`, `batchId`, `productId`,
// `soldAt`/`effectiveDate`/`postingDate` — every one of those either decides
// which account a sale posted to (status -> Cash vs Accounts Receivable) or
// is the fact a contra entry (reversal) exists to correct instead. Rewriting
// any of them here would silently move a figure that was already posted —
// exactly what the "never rewrite a posted figure in place" rule forbids. A
// sale that needs its amount or status changed must be reversed and
// re-recorded, not edited.
//
// Permission: the SAME canEdit(MODULES.finance) gate POST /api/data/sales
// uses — "whoever may record it decides who may edit it", not a new gate —
// plus canModifyOwnRow (lib/permissions.ts): a non-owner actor may only edit
// a sale they themselves recorded (sales.recordedBy), so a worker/manager
// granted finance edit access cannot silently edit a colleague's sale.
//
// History: writes one `audit_log` row (entity 'sale') carrying the reason and
// every changed field's before/after value — read back by
// <StatusTimeline entity="sale" entityId={id} />, the same component tasks
// already use. No second history mechanism.

const ok = <T>(data: T) => NextResponse.json({ success: true, data }, { status: 200 })
const badRequest = (msg: string) => NextResponse.json({ success: false, error: msg }, { status: 400 })
const notFound = (msg: string) => NextResponse.json({ success: false, error: msg }, { status: 404 })

type EditableField = 'item' | 'notes' | 'paymentReference' | 'soldTo' | 'customerId' | 'dueDate'

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
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
  if (!reason) return badRequest('A reason is required to edit a sale')

  const rows = await db.select().from(sales).where(and(eq(sales.id, id), eq(sales.tenantId, tenantId)))
  const existing = rows[0]
  if (!existing) return notFound('Sale not found for this tenant')
  if (existing.reversedAt) return badRequest('This sale has been reversed and can no longer be edited')

  if (!canModifyOwnRow(session.role, session.id, existing.recordedBy)) {
    return forbidden('You may only edit sales you recorded yourself')
  }

  const patch: Partial<typeof sales.$inferInsert> = {}
  const before: Record<string, unknown> = {}
  const after: Record<string, unknown> = {}

  const setField = (field: EditableField, value: unknown) => {
    before[field] = existing[field]
    after[field] = value
    ;(patch as Record<string, unknown>)[field] = value
  }

  if (b.item !== undefined) {
    const item = typeof b.item === 'string' ? b.item.trim() : ''
    if (!item) return badRequest('item cannot be blank')
    if (item !== existing.item) setField('item', item)
  }
  if (b.notes !== undefined) {
    const notes = typeof b.notes === 'string' && b.notes.trim() ? b.notes.trim() : null
    if (notes !== existing.notes) setField('notes', notes)
  }
  if (b.paymentReference !== undefined) {
    const paymentReference = typeof b.paymentReference === 'string' && b.paymentReference.trim() ? b.paymentReference.trim() : null
    if (paymentReference !== existing.paymentReference) setField('paymentReference', paymentReference)
  }
  if (b.soldTo !== undefined) {
    const soldTo = typeof b.soldTo === 'string' && b.soldTo.trim() ? b.soldTo.trim() : null
    if (soldTo !== existing.soldTo) setField('soldTo', soldTo)
  }
  if (b.customerId !== undefined) {
    const customerId = typeof b.customerId === 'string' && b.customerId.trim() ? b.customerId.trim() : null
    if (customerId) {
      const found = await db.select({ id: customers.id }).from(customers).where(and(eq(customers.id, customerId), eq(customers.tenantId, tenantId)))
      if (found.length === 0) return notFound('Customer not found for this tenant')
    }
    if (customerId !== existing.customerId) setField('customerId', customerId)
  }
  if (b.dueDate !== undefined) {
    let dueDate: Date | null = null
    if (b.dueDate !== null && b.dueDate !== '') {
      const parsed = requireFutureAllowedDate(b.dueDate, 'dueDate')
      if (isInvalid(parsed)) return badRequest(parsed.problem)
      dueDate = parsed
    }
    const existingTime = existing.dueDate ? existing.dueDate.getTime() : null
    const newTime = dueDate ? dueDate.getTime() : null
    if (existingTime !== newTime) setField('dueDate', dueDate)
  }

  if (Object.keys(patch).length === 0) {
    return badRequest('Nothing to update')
  }

  const [updated] = await db.update(sales).set(patch).where(eq(sales.id, id)).returning()

  await db.insert(auditLog).values({
    id: randomUUID(),
    tenantId,
    actor: session.id,
    action: 'sale.edited',
    entity: 'sale',
    entityId: id,
    meta: { reason, before, after },
  })

  return ok(updated)
}
