import { NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import { db } from '@/db'
import { inventoryLots, auditLog } from '@/db/schemas'
import { getSessionUser } from '@/lib/auth'
import { and, eq } from 'drizzle-orm'

// ── PATCH /api/inventory/lots/[id] (issue #235 task 5) ──────────────────────
// Reason-required quantity adjustment. Every adjustment writes a real
// `audit_log` row (action: 'inventory.adjust') with before/after/reason — the
// real audit trail from issue #243, reused as instructed, not a second
// mechanism. `reason` is validated here (non-empty, required) rather than
// left to the caller, since an unaudited/unexplained stock correction is
// exactly the gap this endpoint exists to close (theft/waste/recording-error
// visibility — see components/farm/inventory.tsx's Variance tab).
//
// Actor resolution follows the same convention as PATCH /api/tasks/[id]:
// session user id wins; `actorId` in the body is the fallback (standalone
// mock mode / no active session).

const ok = <T>(data: T) => NextResponse.json({ success: true, data }, { status: 200 })
const badRequest = (msg: string) => NextResponse.json({ success: false, error: msg }, { status: 400 })
const notFound = () => NextResponse.json({ success: false, error: 'Inventory lot not found' }, { status: 404 })

function resolveTenantId(req: Request, sessionTenantId: string | null | undefined): string {
  return sessionTenantId ?? new URL(req.url).searchParams.get('tenantId')?.trim() ?? ''
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = await getSessionUser()
  const tenantId = resolveTenantId(req, session?.tenantId)
  if (!tenantId) return badRequest('tenantId is required')

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

  const actor = session?.id ?? (typeof b.actorId === 'string' ? b.actorId.trim() : '')
  if (!actor) return badRequest('actorId is required to record a quantity adjustment')

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
