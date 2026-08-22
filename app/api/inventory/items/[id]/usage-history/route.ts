import { NextResponse } from 'next/server'
import { db } from '@/db'
import { purchases, inventoryItems } from '@/db/schemas'
import { and, desc, eq } from 'drizzle-orm'
import { requireTenantSession } from '@/lib/api-auth'

// ── GET /api/inventory/items/[id]/usage-history (issue #235 task 6) ────────
// "derive from purchases (when stock came in) — a real query, not a new
// table". This is a receipt history (when stock came IN, per the issue's own
// parenthetical), not a consumption/usage-out ledger — there is no
// feeding/consumption table on this branch to derive usage-out from, and
// building one is out of scope for this issue. The route name matches the
// issue and UI's "Usage History" button (components/farm/inventory.tsx's
// InventoryDetailScreen); what it returns is honestly the item's purchase
// history.

const ok = <T>(data: T) => NextResponse.json({ success: true, data }, { status: 200 })
const notFound = () => NextResponse.json({ success: false, error: 'Inventory item not found' }, { status: 404 })

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const auth = await requireTenantSession()
  if ('error' in auth) return auth.error
  const { tenantId } = auth

  const itemRows = await db
    .select()
    .from(inventoryItems)
    .where(and(eq(inventoryItems.id, id), eq(inventoryItems.tenantId, tenantId)))
  if (itemRows.length === 0) return notFound()

  const rows = await db
    .select()
    .from(purchases)
    .where(and(eq(purchases.itemId, id), eq(purchases.tenantId, tenantId)))
    .orderBy(desc(purchases.createdAt), desc(purchases.id))

  return ok(rows)
}
