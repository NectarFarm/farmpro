import { NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import { db } from '@/db'
import { inventoryLots, auditLog } from '@/db/schemas'
import { canEdit, MODULES } from '@/lib/permissions'
import { and, eq } from 'drizzle-orm'
import { requireTenantSession, forbidden } from '@/lib/api-auth'

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

  if (b.qtyOnHand === undefined || !Number.isFinite(Number(b.qtyOnHand))) {
    return badRequest('qtyOnHand is required and must be a number')
  }
  const newQty = Math.max(0, Math.trunc(Number(b.qtyOnHand)))

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
