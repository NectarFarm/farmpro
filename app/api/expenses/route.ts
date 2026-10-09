import { NextResponse } from 'next/server'
import { db } from '@/db'
import { expenses, expenseCategories, suppliers, productionUnits } from '@/db/schemas'
import { recordExpense, ensureExpenseCategories } from '@/lib/expenses'
import { and, desc, eq } from 'drizzle-orm'
import { farmNotFoundResponse, resolveFarmFilter } from '@/lib/farm-scope'
import { requireTenantSession, forbidden } from '@/lib/api-auth'
import { canEdit, canView, MODULES } from '@/lib/permissions'
import { DimensionRequirementError, DimensionValidationError, isPlainDimensionMap } from '@/lib/dimensions'
import { isInvalid, requireCents, requireEventDate } from '@/lib/validate-input'
import { isImageDataUrl, dataUrlByteSize, MAX_PHOTO_BYTES } from '@/lib/record-photos'
import { PAYMENT_METHODS, referenceLabel } from '@/lib/payment-method'
import { postingDayFrom } from '@/lib/tax'
import { resolveDocumentTax } from '@/lib/tax-catalogue'
import { UnbalancedTaxError } from '@/lib/finance'

// ── GET/POST /api/expenses (issue #416) ─────────────────────────────────────
// Money out that is not stock. POST writes an expense row and a journal
// entry, and does not create an inventory lot or a purchase. GET lists the
// tenant's expenses, newest first, with the category name joined on so the
// list does not have to invent one.

const ok = <T>(data: T) => NextResponse.json({ success: true, data }, { status: 200 })
const created = <T>(data: T) => NextResponse.json({ success: true, data }, { status: 201 })
const badRequest = (msg: string) => NextResponse.json({ success: false, error: msg }, { status: 400 })
const notFound = (msg: string) => NextResponse.json({ success: false, error: msg }, { status: 404 })

export async function GET(req: Request) {
  const url = new URL(req.url)
  const auth = await requireTenantSession({ explicitTenantId: url.searchParams.get('tenantId') })
  if ('error' in auth) return auth.error
  const { session, tenantId } = auth

  if (!(await canView(tenantId, session.role, MODULES.finance))) {
    return forbidden('Your role does not have access to finance')
  }

  await ensureExpenseCategories()

  const farmFilter = await resolveFarmFilter(tenantId, url.searchParams.get('farmId'))
  if (farmFilter === null) return NextResponse.json(farmNotFoundResponse(), { status: 404 })

  const conditions = [eq(expenses.tenantId, tenantId)]
  if (farmFilter) conditions.push(eq(expenses.farmId, farmFilter))

  const rows = await db
    .select({
      id: expenses.id,
      tenantId: expenses.tenantId,
      payee: expenses.payee,
      supplierId: expenses.supplierId,
      categoryId: expenses.categoryId,
      categoryName: expenseCategories.name,
      accountCode: expenseCategories.accountCode,
      amountCents: expenses.amountCents,
      amountPaidCents: expenses.amountPaidCents,
      paymentMethod: expenses.paymentMethod,
      paymentReference: expenses.paymentReference,
      farmId: expenses.farmId,
      unitId: expenses.unitId,
      notes: expenses.notes,
      photoUrl: expenses.photoUrl,
      transactionDate: expenses.transactionDate,
      postingDate: expenses.postingDate,
      recordedBy: expenses.recordedBy,
      reversedAt: expenses.reversedAt,
      createdAt: expenses.createdAt,
    })
    .from(expenses)
    .innerJoin(expenseCategories, eq(expenses.categoryId, expenseCategories.id))
    .where(and(...conditions))
    .orderBy(desc(expenses.postingDate), desc(expenses.createdAt), desc(expenses.id))

  return ok(rows)
}

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

  if (!(await canEdit(tenantId, session.role, MODULES.finance))) {
    return forbidden('Your role does not have edit access to finance')
  }

  await ensureExpenseCategories()

  const payee = typeof b.payee === 'string' ? b.payee.trim() : ''
  if (!payee) return badRequest('payee is required')

  const categoryId = typeof b.categoryId === 'string' ? b.categoryId.trim() : ''
  if (!categoryId) return badRequest('categoryId is required')
  const categoryRows = await db
    .select()
    .from(expenseCategories)
    .where(eq(expenseCategories.id, categoryId))
  const category = categoryRows[0]
  if (!category || !category.active) return badRequest('Choose an expense category from the list')

  const amountCents = requireCents(b.amountCents, 'amountCents')
  if (isInvalid(amountCents)) return badRequest(amountCents.problem)
  if (amountCents <= 0) return badRequest('amountCents must be greater than zero')

  const paymentMethod = typeof b.paymentMethod === 'string' ? b.paymentMethod.trim() : ''
  if (!(PAYMENT_METHODS as readonly string[]).includes(paymentMethod)) {
    return badRequest(`paymentMethod must be one of: ${PAYMENT_METHODS.join(', ')}`)
  }
  const paymentReference = typeof b.paymentReference === 'string' && b.paymentReference.trim() ? b.paymentReference.trim() : ''
  const refLabel = referenceLabel(paymentMethod)
  if (refLabel && !paymentReference) return badRequest(`${refLabel} is required`)

  let amountPaidCents = 0
  if (b.amountPaidCents !== undefined && b.amountPaidCents !== null && b.amountPaidCents !== '') {
    const parsed = requireCents(b.amountPaidCents, 'amountPaidCents')
    if (isInvalid(parsed)) return badRequest(parsed.problem)
    amountPaidCents = parsed
  }

  const farmRaw = typeof b.farmId === 'string' ? b.farmId.trim() : ''
  if (!farmRaw || farmRaw === 'ALL') return badRequest('farmId is required')
  const farmFilter = await resolveFarmFilter(tenantId, farmRaw)
  if (farmFilter === null || !farmFilter) return NextResponse.json(farmNotFoundResponse(), { status: 404 })

  let unitId: string | null = null
  if (typeof b.unitId === 'string' && b.unitId.trim()) {
    const candidate = b.unitId.trim()
    const unitRows = await db
      .select({ id: productionUnits.id })
      .from(productionUnits)
      .where(and(
        eq(productionUnits.id, candidate),
        eq(productionUnits.tenantId, tenantId),
        eq(productionUnits.farmId, farmFilter),
      ))
    if (unitRows.length === 0) return badRequest('That house is not on this farm')
    unitId = candidate
  }

  const supplierId = typeof b.supplierId === 'string' && b.supplierId.trim() ? b.supplierId.trim() : null
  if (supplierId) {
    const rows = await db.select({ id: suppliers.id }).from(suppliers).where(and(eq(suppliers.id, supplierId), eq(suppliers.tenantId, tenantId)))
    if (rows.length === 0) return notFound('Supplier not found for this tenant')
  }

  const transactionDate = requireEventDate(b.date, 'date')
  if (isInvalid(transactionDate)) return badRequest(transactionDate.problem)

  let postingDate = transactionDate
  if (b.postingDate !== undefined && b.postingDate !== null && b.postingDate !== '') {
    const parsed = requireEventDate(b.postingDate, 'postingDate')
    if (isInvalid(parsed)) return badRequest(parsed.problem)
    postingDate = parsed
  }

  const notes = typeof b.notes === 'string' && b.notes.trim() ? b.notes.trim() : null

  let photoUrl: string | null = null
  if (typeof b.photoUrl === 'string' && b.photoUrl.trim()) {
    const candidate = b.photoUrl.trim()
    if (!isImageDataUrl(candidate)) return badRequest("The receipt photo isn't a photo this app can read — retake it")
    if (dataUrlByteSize(candidate) > MAX_PHOTO_BYTES) return badRequest('The receipt photo is too large — retake it and it will be compressed automatically')
    photoUrl = candidate
  }

  const postingDay = postingDayFrom(
    [typeof b.postingDate === 'string' ? b.postingDate : null, typeof b.date === 'string' ? b.date : null],
    postingDate,
  )
  const tax = await resolveDocumentTax({
    taxCode: b.taxCode,
    taxInclusive: b.taxInclusive,
    baseCents: amountCents,
    postingDay,
  })
  if ('refused' in tax) return badRequest(tax.refused)
  if (amountPaidCents > tax.settledCents) {
    return badRequest('Amount paid is more than the expense — check the figures')
  }

  try {
    const result = await recordExpense({
      tenantId,
      payee,
      supplierId,
      categoryId: category.id,
      accountCode: category.accountCode,
      amountCents: tax.settledCents,
      amountPaidCents,
      paymentMethod,
      paymentReference: paymentReference || null,
      farmId: farmFilter,
      unitId,
      notes,
      photoUrl,
      transactionDate,
      postingDate,
      recordedBy: session.id,
      dimensions: isPlainDimensionMap(b.dimensions) ? b.dimensions : undefined,
      ...tax.columns,
    })
    return created(result)
  } catch (err) {
    if (err instanceof DimensionRequirementError || err instanceof DimensionValidationError || err instanceof UnbalancedTaxError) {
      return badRequest(err.message)
    }
    throw err
  }
}
