import { NextResponse } from 'next/server'
import { db } from '@/db'
import { inventoryItems } from '@/db/schemas'
import { and, eq } from 'drizzle-orm'
import { requireTenantSession, forbidden } from '@/lib/api-auth'
import { canEdit, MODULES } from '@/lib/permissions'
import { isInvalid, requireNonNegativeCount } from '@/lib/validate-input'

// ── PATCH /api/inventory/items/[id] (forms-audit slice, item 6) ─────────────
// "Reorder threshold (new items only)" was the audit's complaint: a par
// level could only ever be set at the item's FIRST purchase (POST
// /api/purchases' recordPurchase only reads `lowStockThreshold` on insert),
// with no way to raise or lower it afterwards as consumption patterns
// change. One field, one route — this is not a general item-edit endpoint.
const ok = <T>(data: T) => NextResponse.json({ success: true, data }, { status: 200 })
const badRequest = (msg: string) => NextResponse.json({ success: false, error: msg }, { status: 400 })
const notFound = () => NextResponse.json({ success: false, error: 'Inventory item not found' }, { status: 404 })

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

  if (!(await canEdit(tenantId, session.role, MODULES.inventory))) {
    return forbidden('Your role does not have edit access to inventory')
  }

  const parsed = requireNonNegativeCount(b.lowStockThreshold, 'lowStockThreshold')
  if (isInvalid(parsed)) return badRequest(parsed.problem)

  const [updated] = await db
    .update(inventoryItems)
    .set({ lowStockThreshold: parsed })
    .where(and(eq(inventoryItems.id, id), eq(inventoryItems.tenantId, tenantId)))
    .returning()
  if (!updated) return notFound()

  return ok(updated)
}
