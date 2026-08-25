import { NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import { db } from '@/db'
import { inventoryLots, auditLog } from '@/db/schemas'
import { canEdit, MODULES } from '@/lib/permissions'
import { and, eq } from 'drizzle-orm'
import { requireTenantSession, forbidden } from '@/lib/api-auth'
import { isInvalid, requireNonNegativeCount } from '@/lib/validate-input'

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
      meta: { itemId: existing.itemId, before, after: newQty, reason },
    })

    return updated
  })

  return ok(result)
}
