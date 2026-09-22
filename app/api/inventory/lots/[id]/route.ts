import { NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import { db } from '@/db'
import { inventoryLots, auditLog } from '@/db/schemas'
import { canEdit, MODULES } from '@/lib/permissions'
import { and, eq } from 'drizzle-orm'
import { requireTenantSession, forbidden } from '@/lib/api-auth'
import { isInvalid, requireNonNegativeCount } from '@/lib/validate-input'
import { isImageDataUrl, dataUrlByteSize, MAX_PHOTO_BYTES } from '@/lib/record-photos'

// ── PATCH /api/inventory/lots/[id] (issue #235 task 5) ──────────────────────
// Reason-required quantity adjustment. Every adjustment writes a real
// `audit_log` row (action: 'inventory.adjust') with before/after/reason — the
// real audit trail from issue #243, reused as instructed, not a second
// mechanism. `reason` is validated here (non-empty, required) rather than
// left to the caller, since an unaudited/unexplained stock correction is
// exactly the gap this endpoint exists to close (theft/waste/recording-error
// visibility — see components/farm/inventory.tsx's Variance tab).
//
// Actor is always the session user's id now (auth fix:
// fix/authenticate-all-apis) — a session is required, so there is no
// `actorId`-in-body fallback for a session-less caller any more.

const ok = <T>(data: T) => NextResponse.json({ success: true, data }, { status: 200 })
const badRequest = (msg: string) => NextResponse.json({ success: false, error: msg }, { status: 400 })
const notFound = () => NextResponse.json({ success: false, error: 'Inventory lot not found' }, { status: 404 })

// forms-audit slice, item 11: WHY this adjustment happened, not just the
// reason text — a recount, spoilage, damage, theft, a transfer out, or the
// very first balance a lot is ever given. No new column: same as `reason`,
// this rides in `audit_log.meta` (the real audit trail from issue #243,
// reused rather than a second mechanism — see this file's own header
// comment). Optional, so an older/simpler caller that only sends `reason`
// still works exactly as before.
const ADJUSTMENT_TYPES = new Set(['count', 'spoilage', 'damage', 'theft', 'transfer', 'opening_balance'])

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const auth = await requireTenantSession({ explicitTenantId: new URL(req.url).searchParams.get('tenantId') })
  if ('error' in auth) return auth.error
  const { session, tenantId } = auth

  // role-permission-enforcement task: `canEdit`/`MODULES` were imported here
  // before but never actually called — this route was the "one route that
  // imports lib/permissions.ts" the task brief measured, yet it enforced
  // nothing. Wired for real now.
  if (!(await canEdit(tenantId, session.role, MODULES.inventory))) {
    return forbidden('Your role does not have edit access to inventory')
  }

  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return badRequest('Invalid JSON body')
  }
  const b = (raw ?? {}) as Record<string, unknown>

  const reason = typeof b.reason === 'string' ? b.reason.trim() : ''
  if (!reason) return badRequest('reason is required')

  const adjustmentType = typeof b.adjustmentType === 'string' && b.adjustmentType.trim() ? b.adjustmentType.trim() : null
  if (adjustmentType && !ADJUSTMENT_TYPES.has(adjustmentType)) {
    return badRequest(`adjustmentType must be one of: ${Array.from(ADJUSTMENT_TYPES).join(', ')}`)
  }

  // One optional evidence photo — same validation the several-photos-per-
  // record feature already applies (lib/record-photos.ts), stored in
  // audit_log.meta alongside the reason rather than a new inventoryLots
  // column: it documents THIS adjustment event, not a lasting fact about
  // the lot the way expiryDate/unitCostCents are.
  let photoUrl: string | null = null
  if (typeof b.photoUrl === 'string' && b.photoUrl.trim()) {
    const candidate = b.photoUrl.trim()
    if (!isImageDataUrl(candidate)) return badRequest("The evidence photo isn't a photo this app can read — retake it")
    if (dataUrlByteSize(candidate) > MAX_PHOTO_BYTES) return badRequest('The evidence photo is too large — retake it and it will be compressed automatically')
    photoUrl = candidate
  }

  // ── This guard used to let a lot's whole stock be wiped by accident ──────
  // `Number.isFinite(Number(x))` is not a number check: `Number(null)`,
  // `Number('')`, `Number([])` and `Number(false)` are all 0, all finite, and
  // all passed. So `{ qtyOnHand: null }` — or a JS client sending an empty
  // field — set the lot to 0 and the audit row recorded `after: 0` as though
  // somebody had meant it. `Math.max(0, ...)` compounded it by rewriting a
  // negative into 0 instead of refusing, and there was no ceiling at all, so a
  // large value overflowed the `integer` column into a 500.
  //
  // Zero is still a legitimate value here — a recount can genuinely find
  // nothing left — so this is requireNonNegativeCount, not requireCount. What
  // changed is that zero now has to be asked for.
  const parsedQty = requireNonNegativeCount(b.qtyOnHand, 'qtyOnHand')
  if (isInvalid(parsedQty)) return badRequest(parsedQty.problem)
  const newQty = parsedQty

  const actor = session.id

  const existingRows = await db
    .select()
    .from(inventoryLots)
    .where(and(eq(inventoryLots.id, id), eq(inventoryLots.tenantId, tenantId)))
  const existing = existingRows[0]
  if (!existing) return notFound()

  const before = existing.qtyOnHand
  // The shilling impact, computed from the LOT's own recorded cost — not
  // invented, not re-priced at today's rate. A recount that finds fewer
  // units found that much cost gone; more found is a positive correction.
  const costImpactCents = (newQty - before) * existing.unitCostCents

  // Who physically did the count — optional, and distinct from `actor`
  // (the session that recorded it): an owner often logs a count a worker or
  // storekeeper actually did. Free text, same "no new master for this" call
  // as sales.soldTo.
  const countedBy = typeof b.countedBy === 'string' && b.countedBy.trim() ? b.countedBy.trim() : null

  const result = await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(inventoryLots)
      .set({ qtyOnHand: newQty })
      .where(and(eq(inventoryLots.id, id), eq(inventoryLots.tenantId, tenantId)))
      .returning()

    await tx.insert(auditLog).values({
      id: randomUUID(),
      tenantId,
      actor,
      action: 'inventory.adjust',
      entity: 'inventory_lot',
      entityId: id,
      meta: { itemId: existing.itemId, before, after: newQty, reason, adjustmentType, photoUrl, costImpactCents, countedBy },
    })

    return updated
  })

  return ok({ ...result, costImpactCents })
}
