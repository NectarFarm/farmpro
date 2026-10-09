import { NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import { db } from '@/db'
import { purchases, suppliers } from '@/db/schemas'
import { PurchaseReceiptError, recordPurchase, recordPurchaseReceipt } from '@/lib/inventory'
import { allocateCharges, allocatePayment, isChargeKind, landedUnitCostCents } from '@/lib/landed-cost'
import { and, desc, eq } from 'drizzle-orm'
import { farmNotFoundResponse, resolveFarmFilter } from '@/lib/farm-scope'
import { requireTenantSession, forbidden } from '@/lib/api-auth'
import { canEdit, MODULES } from '@/lib/permissions'
import { DimensionRequirementError, DimensionValidationError, isPlainDimensionMap } from '@/lib/dimensions'
import {
  isInvalid, requireCount, requireNonNegativeCount, requireCents,
  requireEventDate, requireFutureAllowedDate,
} from '@/lib/validate-input'
import { isImageDataUrl, dataUrlByteSize, MAX_PHOTO_BYTES } from '@/lib/record-photos'
import { postingDayFrom } from '@/lib/tax'
import { resolveDocumentTax } from '@/lib/tax-catalogue'
import { UnbalancedTaxError } from '@/lib/finance'
import { combineLegs, judgeMoney, purchaseLegs } from '@/lib/posting-policy'
import { loadPostingPolicies } from '@/lib/posting-policies'
import { notifyMoneyPostings } from '@/lib/notify-money-posting'

// ── GET/POST /api/purchases (issue #235 task 2) ─────────────────────────────
// Fresh build: no `purchases` table existed on this branch before this issue.
// POST is the only way stock enters the system in v1 — it upserts the item
// (by tenant+name) and always creates a new lot; see lib/inventory.ts's
// recordPurchase for the transaction. Same tenant-resolution + envelope
// conventions as GET/POST /api/batches.

const ok = <T>(data: T) => NextResponse.json({ success: true, data }, { status: 200 })
const created = <T>(data: T) => NextResponse.json({ success: true, data }, { status: 201 })
const badRequest = (msg: string) => NextResponse.json({ success: false, error: msg }, { status: 400 })
const notFound = (msg: string) => NextResponse.json({ success: false, error: msg }, { status: 404 })

// GET /api/purchases?tenantId=...&itemId=... — list a tenant's purchases
// (newest first), optionally filtered to one item.
export async function GET(req: Request) {
  const url = new URL(req.url)
  const auth = await requireTenantSession()
  if ('error' in auth) return auth.error
  const { tenantId } = auth

  const itemId = url.searchParams.get('itemId')?.trim()

  // farmId (direct filter — purchases.farmId, farm-scoped-data task).
  const farmFilter = await resolveFarmFilter(tenantId, url.searchParams.get('farmId'))
  if (farmFilter === null) return NextResponse.json(farmNotFoundResponse(), { status: 404 })

  const conditions = [eq(purchases.tenantId, tenantId)]
  if (itemId) conditions.push(eq(purchases.itemId, itemId))
  if (farmFilter) conditions.push(eq(purchases.farmId, farmFilter))

  const rows = await db
    .select()
    .from(purchases)
    .where(and(...conditions))
    .orderBy(desc(purchases.createdAt), desc(purchases.id))

  return ok(rows)
}

// POST /api/purchases — record a purchase; upserts the item by tenant+name
// (case-insensitive) and always creates a new lot for the received quantity.
// Body: { tenantId?, supplier, itemName, category?, unit, lowStockThreshold?,
//         quantity, unitCostCents, totalCostCents?, paymentMethod?,
//         amountPaidCents?, lotNo?, expiryDate?, receivedDate?,
//         paymentReference?, dueDate?, invoiceNumber?, notes?, photoUrl? }
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

  // A receipt (several lines, or freight / loading / levies) is a different
  // body. The single-item body below is unchanged: one lot, no charge rows,
  // and the lot unit cost is the typed unit cost.
  if (b.lines !== undefined || b.charges !== undefined) {
    return postPurchaseReceipt(b, tenantId, session.id)
  }

  const supplier = typeof b.supplier === 'string' ? b.supplier.trim() : ''
  const itemName = typeof b.itemName === 'string' ? b.itemName.trim() : ''
  const unit = typeof b.unit === 'string' ? b.unit.trim() : ''

  if (!supplier) return badRequest('supplier is required')
  if (!itemName) return badRequest('itemName is required')
  if (!unit) return badRequest('unit is required')

  // ── Quantities and money go through lib/validate-input.ts ────────────────
  // What these replace, and why each mattered:
  //   - `quantity` was `Number.isFinite(q) && q > 0` and then `Math.trunc(q)`.
  //     0.5 passed the check and became 0, so "half a bag at 4,000" stored a
  //     zero-quantity, zero-cost purchase and silently erased the money paid.
  //     There was also no ceiling, so 3e9 overflowed the `integer` column into
  //     a 500 instead of a 400.
  //   - `amountPaidCents` was clamped with `Math.max(0, ...)`, rewriting a
  //     negative rather than refusing it.
  const quantity = requireCount(b.quantity, 'quantity')
  if (isInvalid(quantity)) return badRequest(quantity.problem)
  const unitCostCents = requireCents(b.unitCostCents, 'unitCostCents')
  if (isInvalid(unitCostCents)) return badRequest(unitCostCents.problem)

  // ── farmId stays optional, deliberately, and this is a KNOWN GAP ─────────
  // Both purchase sheets refuse to submit without one client-side, so the
  // route accepting its absence is a client-only validation with no server
  // counterpart: a POST with no farmId writes `farmId: null` to the lot and
  // the purchase, and `GET /api/inventory/items?farmId=X` then filters that
  // stock out for every farm, so it only ever appears under "ALL" —
  // inventory that exists, was paid for, and is unreachable from the screen
  // that manages it.
  //
  // Not closed here because there is a legitimate caller that omits it on
  // purpose: the CSV importer (components/farm/inventory.tsx) sends
  // `farmId: undefined` when the user has "ALL" selected, and tenant-wide
  // lots predate farm scoping and stay usable from anywhere by design (see
  // GET /api/inventory/available's fallback). Requiring it would break that
  // import path and several existing fixtures. Making it required needs the
  // importer to resolve a farm first — a real change, not a validation tweak.
  const farmFilter = await resolveFarmFilter(tenantId, typeof b.farmId === 'string' ? b.farmId : undefined)
  if (farmFilter === null) return NextResponse.json(farmNotFoundResponse(), { status: 404 })

  const category = typeof b.category === 'string' ? b.category.trim() : undefined

  let lowStockThreshold: number | undefined
  if (b.lowStockThreshold !== undefined) {
    const parsed = requireNonNegativeCount(b.lowStockThreshold, 'lowStockThreshold')
    if (isInvalid(parsed)) return badRequest(parsed.problem)
    lowStockThreshold = parsed
  }

  const paymentMethod = typeof b.paymentMethod === 'string' ? b.paymentMethod.trim() : undefined

  // ── The goods total is computed, never supplied ─────────────────────────
  // `totalCostCents` used to be accepted from the request body. quantity x
  // unitCostCents is the goods figure. A tax code, resolved after the
  // posting date is known, turns that into the settled gross. With no tax
  // code the settled total stays quantity x unitCostCents, and the lot keeps
  // the typed unit cost either way.
  const goodsCents = quantity * unitCostCents

  // Paid is compared to the settled gross further down, once tax is known.
  // Comparing it to the goods figure would refuse a payment of the gross on
  // an exclusive VATable purchase.
  let amountPaidCents: number | undefined
  if (b.amountPaidCents !== undefined) {
    const parsed = requireCents(b.amountPaidCents, 'amountPaidCents')
    if (isInvalid(parsed)) return badRequest(parsed.problem)
    amountPaidCents = parsed
  }

  const lotNo = typeof b.lotNo === 'string' ? b.lotNo.trim() : undefined

  // ── Dates have to parse, and have to be plausible ────────────────────────
  // `new Date('yesterday')` is an Invalid Date; recordPurchase calls
  // `.toISOString()` on it to build the lot number, which threw a RangeError
  // and surfaced as a 500. And `receivedDate` is written as `purchases.createdAt`
  // — the exact column lib/reports.ts filters on for periodExpense — so a
  // purchase dated next year disappears from every P&L period while staying in
  // the trial balance.
  let receivedDate: Date | undefined
  if (b.receivedDate !== undefined && b.receivedDate !== null && b.receivedDate !== '') {
    const parsed = requireEventDate(b.receivedDate, 'receivedDate')
    if (isInvalid(parsed)) return badRequest(parsed.problem)
    receivedDate = parsed
  }

  // An expiry MAY be in the past, so this is the future-allowed check plus a
  // plausible-year bound, and nothing more.
  //
  // Deliberately NOT rejecting "expiry before arrival": stock that is already
  // expired when it is recorded is a real thing — a bad delivery, or a
  // purchase entered retroactively for stock whose date has since passed —
  // and tests/inventory.test.ts asserts exactly that case, because an expired
  // item SHOWING as expiring is correct behaviour, not corruption. A
  // cross-field rule here would refuse legitimate records to catch a typo that
  // the plausible-year bound already catches in its worst form.
  let expiryDate: Date | null = null
  if (b.expiryDate !== undefined && b.expiryDate !== null && b.expiryDate !== '') {
    const parsed = requireFutureAllowedDate(b.expiryDate, 'expiryDate')
    if (isInvalid(parsed)) return badRequest(parsed.problem)
    expiryDate = parsed
  }

  // ── Forms-audit slice: reference, credit due date, invoice no., notes,
  // and one optional receipt photo ────────────────────────────────────────
  const paymentReference = typeof b.paymentReference === 'string' && b.paymentReference.trim() ? b.paymentReference.trim() : undefined
  let dueDate: Date | undefined
  if (b.dueDate !== undefined && b.dueDate !== null && b.dueDate !== '') {
    const parsed = requireFutureAllowedDate(b.dueDate, 'dueDate')
    if (isInvalid(parsed)) return badRequest(parsed.problem)
    dueDate = parsed
  }
  const invoiceNumber = typeof b.invoiceNumber === 'string' && b.invoiceNumber.trim() ? b.invoiceNumber.trim() : undefined
  const notes = typeof b.notes === 'string' && b.notes.trim() ? b.notes.trim() : undefined

  // One photo, reusing the exact rules the several-photos-per-record feature
  // already validates against (lib/record-photos.ts) — same shape, same
  // cap, just a single photo instead of up to four.
  let photoUrl: string | undefined
  if (typeof b.photoUrl === 'string' && b.photoUrl.trim()) {
    const candidate = b.photoUrl.trim()
    if (!isImageDataUrl(candidate)) return badRequest("The receipt photo isn't a photo this app can read — retake it")
    if (dataUrlByteSize(candidate) > MAX_PHOTO_BYTES) return badRequest('The receipt photo is too large — retake it and it will be compressed automatically')
    photoUrl = candidate
  }

  // ── Three-date model (item 18) ────────────────────────────────────────────
  // Both optional; recordPurchase defaults transactionDate and postingDate
  // from receivedDate when a caller (every caller today) sends neither.
  let transactionDate: Date | undefined
  if (b.transactionDate !== undefined && b.transactionDate !== null && b.transactionDate !== '') {
    const parsed = requireEventDate(b.transactionDate, 'transactionDate')
    if (isInvalid(parsed)) return badRequest(parsed.problem)
    transactionDate = parsed
  }
  let postingDate: Date | undefined
  if (b.postingDate !== undefined && b.postingDate !== null && b.postingDate !== '') {
    const parsed = requireEventDate(b.postingDate, 'postingDate')
    if (isInvalid(parsed)) return badRequest(parsed.problem)
    postingDate = parsed
  }

  // Item 20: an optional link to the supplier master, checked against this
  // tenant.
  const supplierId = typeof b.supplierId === 'string' && b.supplierId.trim() ? b.supplierId.trim() : undefined
  if (supplierId) {
    const rows = await db.select({ id: suppliers.id }).from(suppliers).where(and(eq(suppliers.id, supplierId), eq(suppliers.tenantId, tenantId)))
    if (rows.length === 0) return notFound('Supplier not found for this tenant')
  }

  const postingDay = postingDayFrom(
    [typeof b.postingDate === 'string' ? b.postingDate : null, typeof b.receivedDate === 'string' ? b.receivedDate : null],
    postingDate ?? receivedDate ?? new Date(),
  )
  const tax = await resolveDocumentTax({
    taxCode: b.taxCode,
    taxInclusive: b.taxInclusive,
    baseCents: goodsCents,
    postingDay,
  })
  if ('refused' in tax) return badRequest(tax.refused)
  const totalCostCents = tax.settledCents
  if (amountPaidCents !== undefined && amountPaidCents > totalCostCents) {
    return badRequest('Amount paid is more than the purchase total — check the figures')
  }

  const decision = judgeMoney(await loadPostingPolicies(tenantId), {
    amountCents: totalCostCents,
    farmId: farmFilter ?? null,
    legs: purchaseLegs({
      totalCents: totalCostCents,
      paidCents: amountPaidCents ?? 0,
      netCents: tax.columns.netCents,
      taxCents: tax.columns.taxCents,
    }),
  })
  if (decision.outcome === 'block') return badRequest(decision.message)

  let result
  try {
    result = await recordPurchase({
      tenantId,
      supplier,
      itemName,
      category,
      unit,
      lowStockThreshold,
      quantity,
      unitCostCents,
      // An inclusive VATable bill: the typed unit cost carries the VAT the
      // farm claims back, so stock is valued at the net, exactly (a net that
      // does not divide by the quantity becomes two lots, see splitLotCost).
      // Exclusive and uncoded bills keep the typed unit cost.
      lotValueCents: tax.columns.taxInclusive === true && tax.columns.netCents != null
        ? tax.columns.netCents
        : undefined,
      totalCostCents,
      paymentMethod,
      amountPaidCents,
      lotNo,
      expiryDate,
      receivedDate,
      paymentReference,
      dueDate,
      invoiceNumber,
      notes,
      photoUrl,
      transactionDate,
      postingDate,
      supplierId,
      farmId: farmFilter ?? null,
      recordedBy: session.id,
      dimensions: isPlainDimensionMap(b.dimensions) ? b.dimensions : undefined,
      ...tax.columns,
      hold: decision.outcome === 'pending',
    })
  } catch (err) {
    // dimensions-on-gl task: a required dimension missing on an account this
    // purchase posts to refuses the whole write (transaction rolled back)
    // rather than posting an unanalysed line — see lib/dimensions.ts's
    // attachLineDimensions.
    if (err instanceof DimensionRequirementError || err instanceof DimensionValidationError || err instanceof UnbalancedTaxError) {
      return badRequest(err.message)
    }
    throw err
  }

  if ('problem' in result) return badRequest(result.problem)
  if (result.purchase.approvalStatus === 'pending') await notifyMoneyPostings(tenantId, [result.purchase.id])
  return created(result)
}

// Several lines on one supplier invoice, with freight, loading and levies
// apportioned into each line's landed cost. Each line is still one purchase
// row and its own journal, so the P&L sum and a reversal keep working.
// Stock stays expensed. The client does not send the landed total.
async function postPurchaseReceipt(b: Record<string, unknown>, tenantId: string, recordedBy: string) {
  const supplier = typeof b.supplier === 'string' ? b.supplier.trim() : ''
  if (!supplier) return badRequest('supplier is required')
  if (!Array.isArray(b.lines) || b.lines.length === 0) return badRequest('lines must list at least one item')
  if (b.lines.length > 30) return badRequest('A receipt can have at most 30 lines')
  if (b.charges !== undefined && !Array.isArray(b.charges)) return badRequest('charges must be a list')

  const farmFilter = await resolveFarmFilter(tenantId, typeof b.farmId === 'string' ? b.farmId : undefined)
  if (farmFilter === null) return NextResponse.json(farmNotFoundResponse(), { status: 404 })

  const supplierId = typeof b.supplierId === 'string' && b.supplierId.trim() ? b.supplierId.trim() : undefined
  if (supplierId) {
    const rows = await db.select({ id: suppliers.id }).from(suppliers).where(and(eq(suppliers.id, supplierId), eq(suppliers.tenantId, tenantId)))
    if (rows.length === 0) return notFound('Supplier not found for this tenant')
  }

  let receivedDate: Date | undefined
  if (b.receivedDate !== undefined && b.receivedDate !== null && b.receivedDate !== '') {
    const parsed = requireEventDate(b.receivedDate, 'receivedDate')
    if (isInvalid(parsed)) return badRequest(parsed.problem)
    receivedDate = parsed
  }
  let transactionDate: Date | undefined
  if (b.transactionDate !== undefined && b.transactionDate !== null && b.transactionDate !== '') {
    const parsed = requireEventDate(b.transactionDate, 'transactionDate')
    if (isInvalid(parsed)) return badRequest(parsed.problem)
    transactionDate = parsed
  }
  let postingDate: Date | undefined
  if (b.postingDate !== undefined && b.postingDate !== null && b.postingDate !== '') {
    const parsed = requireEventDate(b.postingDate, 'postingDate')
    if (isInvalid(parsed)) return badRequest(parsed.problem)
    postingDate = parsed
  }
  let dueDate: Date | undefined
  if (b.dueDate !== undefined && b.dueDate !== null && b.dueDate !== '') {
    const parsed = requireFutureAllowedDate(b.dueDate, 'dueDate')
    if (isInvalid(parsed)) return badRequest(parsed.problem)
    dueDate = parsed
  }

  let photoUrl: string | undefined
  if (typeof b.photoUrl === 'string' && b.photoUrl.trim()) {
    const candidate = b.photoUrl.trim()
    if (!isImageDataUrl(candidate)) return badRequest("The receipt photo isn't a photo this app can read — retake it")
    if (dataUrlByteSize(candidate) > MAX_PHOTO_BYTES) return badRequest('The receipt photo is too large — retake it and it will be compressed automatically')
    photoUrl = candidate
  }

  const paymentMethod = typeof b.paymentMethod === 'string' ? b.paymentMethod.trim() : undefined
  const paymentReference = typeof b.paymentReference === 'string' && b.paymentReference.trim() ? b.paymentReference.trim() : undefined
  const invoiceNumber = typeof b.invoiceNumber === 'string' && b.invoiceNumber.trim() ? b.invoiceNumber.trim() : undefined
  const notes = typeof b.notes === 'string' && b.notes.trim() ? b.notes.trim() : undefined
  let amountPaidCents = 0
  if (b.amountPaidCents !== undefined) {
    const parsed = requireCents(b.amountPaidCents, 'amountPaidCents')
    if (isInvalid(parsed)) return badRequest(parsed.problem)
    amountPaidCents = parsed
  }

  const charges: { kind: string; amountCents: number }[] = []
  for (const rawCharge of (b.charges as unknown[]) ?? []) {
    if (!rawCharge || typeof rawCharge !== 'object') return badRequest('Each charge needs a kind and an amount')
    const charge = rawCharge as Record<string, unknown>
    const kind = typeof charge.kind === 'string' ? charge.kind.trim() : ''
    if (!isChargeKind(kind)) return badRequest('A charge kind must be freight, loading or levy')
    const amount = requireCents(charge.amountCents, 'amountCents')
    if (isInvalid(amount)) return badRequest(amount.problem)
    if (amount <= 0) return badRequest('A charge amount has to be more than zero')
    charges.push({ kind, amountCents: amount })
  }

  type ParsedLine = {
    itemName: string
    category?: string
    unit: string
    quantity: number
    rawUnitCostCents: number
    extendedCents: number
    lowStockThreshold?: number
    notes?: string
    expiryDate?: Date | null
    lots?: { quantity: number; expiryDate: Date | null; lotNo?: string | null }[]
  }
  const parsedLines: ParsedLine[] = []
  for (const rawLine of b.lines as unknown[]) {
    if (!rawLine || typeof rawLine !== 'object') return badRequest('Each line needs an item, a unit, a quantity and a unit cost')
    const line = rawLine as Record<string, unknown>
    const itemName = typeof line.itemName === 'string' ? line.itemName.trim() : ''
    const unit = typeof line.unit === 'string' ? line.unit.trim() : ''
    if (!itemName) return badRequest('Each line needs an item')
    if (!unit) return badRequest('Each line needs a unit')
    const quantity = requireCount(line.quantity, 'quantity')
    if (isInvalid(quantity)) return badRequest(quantity.problem)
    const rawUnitCostCents = requireCents(line.unitCostCents, 'unitCostCents')
    if (isInvalid(rawUnitCostCents)) return badRequest(rawUnitCostCents.problem)
    let lowStockThreshold: number | undefined
    if (line.lowStockThreshold !== undefined) {
      const parsed = requireNonNegativeCount(line.lowStockThreshold, 'lowStockThreshold')
      if (isInvalid(parsed)) return badRequest(parsed.problem)
      lowStockThreshold = parsed
    }
    let expiryDate: Date | null | undefined
    if (line.expiryDate !== undefined && line.expiryDate !== null && line.expiryDate !== '') {
      const parsed = requireFutureAllowedDate(line.expiryDate, 'expiryDate')
      if (isInvalid(parsed)) return badRequest(parsed.problem)
      expiryDate = parsed
    }
    let lots: ParsedLine['lots']
    if (line.lots !== undefined) {
      if (!Array.isArray(line.lots) || line.lots.length === 0) return badRequest('lots must list at least one lot')
      lots = []
      for (const rawLot of line.lots) {
        if (!rawLot || typeof rawLot !== 'object') return badRequest('Each lot needs a quantity')
        const lot = rawLot as Record<string, unknown>
        const lotQty = requireCount(lot.quantity, 'quantity')
        if (isInvalid(lotQty)) return badRequest(lotQty.problem)
        let lotExpiry: Date | null = null
        if (lot.expiryDate !== undefined && lot.expiryDate !== null && lot.expiryDate !== '') {
          const parsed = requireFutureAllowedDate(lot.expiryDate, 'expiryDate')
          if (isInvalid(parsed)) return badRequest(parsed.problem)
          lotExpiry = parsed
        }
        const lotNo = typeof lot.lotNo === 'string' && lot.lotNo.trim() ? lot.lotNo.trim() : null
        lots.push({ quantity: lotQty, expiryDate: lotExpiry, lotNo })
      }
      const lotSum = lots.reduce((sum, lot) => sum + lot.quantity, 0)
      if (lotSum !== quantity) return badRequest('Lot quantities must add up to the line quantity.')
    }
    parsedLines.push({
      itemName,
      category: typeof line.category === 'string' && line.category.trim() ? line.category.trim() : undefined,
      unit,
      quantity,
      rawUnitCostCents,
      extendedCents: quantity * rawUnitCostCents,
      lowStockThreshold,
      notes: typeof line.notes === 'string' && line.notes.trim() ? line.notes.trim() : undefined,
      expiryDate,
      lots,
    })
  }

  const chargeTotal = charges.reduce((sum, charge) => sum + charge.amountCents, 0)
  const allocated = allocateCharges(
    parsedLines.map((line) => ({ extendedCents: line.extendedCents, quantity: line.quantity })),
    charges,
  )
  if (chargeTotal > 0 && allocated.every((cents) => cents === 0)) {
    return badRequest('These lines have no quantity to spread the charges across.')
  }

  const postingDay = postingDayFrom(
    [typeof b.postingDate === 'string' ? b.postingDate : null, typeof b.receivedDate === 'string' ? b.receivedDate : null],
    postingDate ?? receivedDate ?? new Date(),
  )
  const settled: number[] = []
  const taxColumns: {
    taxCode?: string | null
    taxInclusive?: boolean | null
    grossCents?: number | null
    taxCents?: number | null
    netCents?: number | null
  }[] = []
  for (let i = 0; i < parsedLines.length; i++) {
    const landed = parsedLines[i].extendedCents + allocated[i]
    const tax = await resolveDocumentTax({
      taxCode: b.taxCode,
      taxInclusive: b.taxInclusive,
      baseCents: landed,
      postingDay,
    })
    if ('refused' in tax) return badRequest(tax.refused)
    settled.push(tax.settledCents)
    taxColumns.push(tax.columns)
  }
  const settledTotal = settled.reduce((sum, cents) => sum + cents, 0)
  if (amountPaidCents > settledTotal) {
    return badRequest('Amount paid is more than the purchase total — check the figures')
  }
  const paid = allocatePayment(amountPaidCents, settled)
  const decision = judgeMoney(await loadPostingPolicies(tenantId), {
    amountCents: settledTotal,
    farmId: farmFilter ?? null,
    legs: combineLegs(settled.map((total, i) => purchaseLegs({
      totalCents: total,
      paidCents: paid[i],
      netCents: taxColumns[i].netCents ?? null,
      taxCents: taxColumns[i].taxCents ?? null,
    }))),
  })
  if (decision.outcome === 'block') return badRequest(decision.message)

  try {
    const result = await recordPurchaseReceipt({
      tenantId,
      receiptGroupId: randomUUID(),
      charges,
      lines: parsedLines.map((line, i) => {
        const landed = line.extendedCents + allocated[i]
        return {
          tenantId,
          supplier,
          supplierId,
          itemName: line.itemName,
          category: line.category,
          unit: line.unit,
          quantity: line.quantity,
          unitCostCents: landedUnitCostCents(landed, line.quantity),
          // What stock is carried at, exactly: the landed cost, or its net of
          // VAT when the bill is inclusive. A figure that does not divide by
          // the quantity becomes two lots (splitLotCost) rather than drifting
          // from the ledger by the rounding of one unit cost.
          lotValueCents: taxColumns[i].taxInclusive === true && taxColumns[i].netCents != null
            ? taxColumns[i].netCents as number
            : landed,
          rawUnitCostCents: line.rawUnitCostCents,
          totalCostCents: settled[i],
          amountPaidCents: paid[i],
          paymentMethod,
          paymentReference,
          dueDate,
          invoiceNumber,
          notes: line.notes ?? notes,
          photoUrl,
          receivedDate,
          transactionDate,
          postingDate,
          expiryDate: line.expiryDate,
          lots: line.lots,
          lowStockThreshold: line.lowStockThreshold,
          farmId: farmFilter ?? null,
          recordedBy,
          dimensions: isPlainDimensionMap(b.dimensions) ? b.dimensions : undefined,
          ...taxColumns[i],
          hold: decision.outcome === 'pending',
        }
      }),
    })
    const heldIds = result.purchases.filter((row) => row.purchase.approvalStatus === 'pending').map((row) => row.purchase.id)
    await notifyMoneyPostings(tenantId, heldIds)
    return created(result)
  } catch (err) {
    if (
      err instanceof PurchaseReceiptError
      || err instanceof DimensionRequirementError
      || err instanceof DimensionValidationError
      || err instanceof UnbalancedTaxError
    ) {
      return badRequest(err.message)
    }
    throw err
  }
}
