import { NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import { db } from '@/db'
import { purchases, suppliers, auditLog } from '@/db/schemas'
import { and, eq } from 'drizzle-orm'
import { requireTenantSession, forbidden } from '@/lib/api-auth'
import { canEdit, canModifyOwnRow, MODULES } from '@/lib/permissions'
import { isInvalid, requireFutureAllowedDate } from '@/lib/validate-input'
import { isImageDataUrl, dataUrlByteSize, MAX_PHOTO_BYTES } from '@/lib/record-photos'

// ── PATCH /api/purchases/[id] (item 23) ─────────────────────────────────────
// Same shape and same reasoning as PATCH /api/data/sales/[id] — see that
// route's comment for the full rationale. Editable here: `supplier` (the
// free-text name), `supplierId`, `notes`, `paymentReference`, `dueDate`,
// `invoiceNumber`, `photoUrl`. Deliberately excluded: `quantity`,
// `unitCostCents`, `totalCostCents`, `paymentMethod`, `amountPaidCents`,
// `itemId`, `farmId`, `receivedDate`/`transactionDate`/`postingDate` — every
// one of those drives the journal entry, the stock lot it created, or the
// period it was reported in. A purchase that needs one of THOSE changed must
// be reversed and re-recorded, not edited.

const ok = <T>(data: T) => NextResponse.json({ success: true, data }, { status: 200 })
const badRequest = (msg: string) => NextResponse.json({ success: false, error: msg }, { status: 400 })
const notFound = (msg: string) => NextResponse.json({ success: false, error: msg }, { status: 404 })

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
  if (!reason) return badRequest('A reason is required to edit a purchase')

  const rows = await db.select().from(purchases).where(and(eq(purchases.id, id), eq(purchases.tenantId, tenantId)))
  const existing = rows[0]
  if (!existing) return notFound('Purchase not found for this tenant')
  if (existing.reversedAt) return badRequest('This purchase has been reversed and can no longer be edited')

  if (!canModifyOwnRow(session.role, session.id, existing.recordedBy)) {
    return forbidden('You may only edit purchases you recorded yourself')
  }

  const patch: Partial<typeof purchases.$inferInsert> = {}
  const before: Record<string, unknown> = {}
  const after: Record<string, unknown> = {}

  const setField = <K extends keyof typeof purchases.$inferSelect>(field: K, value: unknown) => {
    before[field as string] = existing[field]
    after[field as string] = value
    ;(patch as Record<string, unknown>)[field as string] = value
  }

  if (b.supplier !== undefined) {
    const supplier = typeof b.supplier === 'string' ? b.supplier.trim() : ''
    if (!supplier) return badRequest('supplier cannot be blank')
    if (supplier !== existing.supplier) setField('supplier', supplier)
  }
  if (b.supplierId !== undefined) {
    const supplierId = typeof b.supplierId === 'string' && b.supplierId.trim() ? b.supplierId.trim() : null
    if (supplierId) {
      const found = await db.select({ id: suppliers.id }).from(suppliers).where(and(eq(suppliers.id, supplierId), eq(suppliers.tenantId, tenantId)))
      if (found.length === 0) return notFound('Supplier not found for this tenant')
    }
    if (supplierId !== existing.supplierId) setField('supplierId', supplierId)
  }
  if (b.notes !== undefined) {
    const notes = typeof b.notes === 'string' && b.notes.trim() ? b.notes.trim() : null
    if (notes !== existing.notes) setField('notes', notes)
  }
  if (b.paymentReference !== undefined) {
    const paymentReference = typeof b.paymentReference === 'string' && b.paymentReference.trim() ? b.paymentReference.trim() : null
    if (paymentReference !== existing.paymentReference) setField('paymentReference', paymentReference)
  }
  if (b.invoiceNumber !== undefined) {
    const invoiceNumber = typeof b.invoiceNumber === 'string' && b.invoiceNumber.trim() ? b.invoiceNumber.trim() : null
    if (invoiceNumber !== existing.invoiceNumber) setField('invoiceNumber', invoiceNumber)
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
  if (b.photoUrl !== undefined) {
    let photoUrl: string | null = null
    if (typeof b.photoUrl === 'string' && b.photoUrl.trim()) {
      const candidate = b.photoUrl.trim()
      if (!isImageDataUrl(candidate)) return badRequest("The receipt photo isn't a photo this app can read — retake it")
      if (dataUrlByteSize(candidate) > MAX_PHOTO_BYTES) return badRequest('The receipt photo is too large — retake it and it will be compressed automatically')
      photoUrl = candidate
    }
    if (photoUrl !== existing.photoUrl) setField('photoUrl', photoUrl)
  }

  if (Object.keys(patch).length === 0) {
    return badRequest('Nothing to update')
  }

  const [updated] = await db.update(purchases).set(patch).where(eq(purchases.id, id)).returning()

  await db.insert(auditLog).values({
    id: randomUUID(),
    tenantId,
    actor: session.id,
    action: 'purchase.edited',
    entity: 'purchase',
    entityId: id,
    meta: { reason, before, after },
  })

  return ok(updated)
}
