import { NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import { db } from '@/db'
import { purchases, auditLog } from '@/db/schemas'
import { and, eq } from 'drizzle-orm'
import { requireTenantSession, forbidden } from '@/lib/api-auth'
import { canEdit, canModifyOwnRow, MODULES } from '@/lib/permissions'
import { reverseJournalEntry } from '@/lib/finance'

// ── POST /api/purchases/[id]/reverse (item 23) ──────────────────────────────
// Same shape and reasoning as POST /api/data/sales/[id]/reverse — see that
// route's comment. Note this does NOT reverse the stock the purchase put into
// `inventory_lots` (the lot's `qtyOnHand`) — item 23's brief is the ledger
// (sale/purchase/expense edit and reverse), not an inventory write-off, and
// reversing stock quantity would need its own reason-required, audited path
// (the existing PATCH /api/inventory/lots/[id] adjustment already covers a
// stock correction). A financially-reversed purchase whose stock should also
// be written off needs BOTH this reversal and a separate lot adjustment,
// today, by design — flagged here rather than silently conflated.
const ok = <T>(data: T) => NextResponse.json({ success: true, data }, { status: 200 })
const badRequest = (msg: string) => NextResponse.json({ success: false, error: msg }, { status: 400 })
const notFound = (msg: string) => NextResponse.json({ success: false, error: msg }, { status: 404 })

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    raw = {}
  }
  const b = (raw ?? {}) as Record<string, unknown>
  const auth = await requireTenantSession({ explicitTenantId: typeof b.tenantId === 'string' ? b.tenantId : undefined })
  if ('error' in auth) return auth.error
  const { session, tenantId } = auth

  if (!(await canEdit(tenantId, session.role, MODULES.finance))) {
    return forbidden('Your role does not have edit access to finance')
  }

  const reason = typeof b.reason === 'string' ? b.reason.trim() : ''
  if (!reason) return badRequest('A reason is required to reverse a purchase')

  const rows = await db.select().from(purchases).where(and(eq(purchases.id, id), eq(purchases.tenantId, tenantId)))
  const existing = rows[0]
  if (!existing) return notFound('Purchase not found for this tenant')
  if (existing.reversedAt) return badRequest('This purchase has already been reversed')

  if (!canModifyOwnRow(session.role, session.id, existing.recordedBy)) {
    return forbidden('You may only reverse purchases you recorded yourself')
  }

  let updated: typeof existing
  try {
    updated = await db.transaction(async (tx) => {
      const { contraEntry } = await reverseJournalEntry(tx, {
        tenantId, sourceType: 'purchase', sourceId: id, memo: `Reversal of purchase from: ${existing.supplier}`,
      })

      const reversedAt = new Date()
      const [row] = await tx.update(purchases).set({ reversedAt }).where(eq(purchases.id, id)).returning()

      await tx.insert(auditLog).values({
        id: randomUUID(),
        tenantId,
        actor: session.id,
        action: 'purchase.reversed',
        entity: 'purchase',
        entityId: id,
        meta: { reason, totalCostCents: existing.totalCostCents, supplier: existing.supplier, contraEntryId: contraEntry.id },
      })

      return row
    })
  } catch (err) {
    if (err instanceof Error) return badRequest(err.message)
    throw err
  }

  return ok(updated)
}
