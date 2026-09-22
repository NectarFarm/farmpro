import { NextResponse } from 'next/server'
import { db } from '@/db'
import { purchases } from '@/db/schemas'
import { recordPurchase } from '@/lib/inventory'
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

// ── GET/POST /api/purchases (issue #235 task 2) ─────────────────────────────
// Fresh build: no `purchases` table existed on this branch before this issue.
// POST is the only way stock enters the system in v1 — it upserts the item
// (by tenant+name) and always creates a new lot; see lib/inventory.ts's
// recordPurchase for the transaction. Same tenant-resolution + envelope
// conventions as GET/POST /api/batches.

const ok = <T>(data: T) => NextResponse.json({ success: true, data }, { status: 200 })
const created = <T>(data: T) => NextResponse.json({ success: true, data }, { status: 201 })
const badRequest = (msg: string) => NextResponse.json({ success: false, error: msg }, { status: 400 })

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

  // ── The total is computed, never supplied ────────────────────────────────
  // `totalCostCents` used to be accepted from the request body and honoured
  // verbatim by recordPurchase, which is what postPurchaseJournal then debits
  // to Purchases Expense. Neither client ever sent it, so it was a
  // curl-reachable field with no validation beyond "non-negative": quantity 1
  // at 100 with totalCostCents 99999999 posted a KSh 999,999.99 expense
  // against one unit costing KSh 1, and the GL and the stock ledger disagreed
  // permanently with nothing to reconcile them.
  //
  // quantity x unitCostCents is the only defensible value, and both operands
  // are now bounded so the product is exactly representable.
  const totalCostCents = quantity * unitCostCents

  // ── Paid cannot exceed the bill ──────────────────────────────────────────
  // lib/finance.ts already clamps the JOURNAL to the total, but the purchases
  // row kept the raw figure — so paying 50,000 on a 500 purchase showed a
  // "PAID" chip while Cash was credited only 500, and 49,500 of cash outflow
  // vanished from the ledger. Refused here so the row and the journal agree.
  let amountPaidCents: number | undefined
  if (b.amountPaidCents !== undefined) {
    const parsed = requireCents(b.amountPaidCents, 'amountPaidCents')
    if (isInvalid(parsed)) return badRequest(parsed.problem)
    if (parsed > totalCostCents) {
      return badRequest('Amount paid is more than the purchase total — check the figures')
    }
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
      farmId: farmFilter ?? null,
      dimensions: isPlainDimensionMap(b.dimensions) ? b.dimensions : undefined,
    })
  } catch (err) {
    // dimensions-on-gl task: a required dimension missing on an account this
    // purchase posts to refuses the whole write (transaction rolled back)
    // rather than posting an unanalysed line — see lib/dimensions.ts's
    // attachLineDimensions.
    if (err instanceof DimensionRequirementError || err instanceof DimensionValidationError) {
      return badRequest(err.message)
    }
    throw err
  }

  if ('problem' in result) return badRequest(result.problem)
  return created(result)
}
