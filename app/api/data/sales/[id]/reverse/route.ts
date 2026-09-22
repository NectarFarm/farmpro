import { NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import { db } from '@/db'
import { sales, auditLog } from '@/db/schemas'
import { and, eq } from 'drizzle-orm'
import { requireTenantSession, forbidden } from '@/lib/api-auth'
import { canEdit, canModifyOwnRow, MODULES } from '@/lib/permissions'
import { reverseJournalEntry } from '@/lib/finance'

// ── POST /api/data/sales/[id]/reverse (item 23) ─────────────────────────────
// Reverses a posted sale — never a delete, never an in-place rewrite of
// amountCents/status. Two things happen in the SAME transaction, so a sale
// can never end up half-reversed:
//   1. A contra journal entry (lib/finance.ts's reverseJournalEntry) that
//      cancels the original entry's ledger effect exactly, dated to the
//      original entry's own date so a period that has already been reported
//      moves by exactly the reversed amount, nothing else.
//   2. `sales.reversedAt` is stamped — the row's only visible mark, and what
//      `lib/reports.ts`'s period queries now check to exclude it from a
//      period figure alongside the ledger cancellation.
//
// Permission: the same finance-edit gate + own-row check as PATCH .../[id]
// above (see that route's comment) — reversal is not a lesser action than
// edit, so it is not given a looser gate.
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
  if (!reason) return badRequest('A reason is required to reverse a sale')

  const rows = await db.select().from(sales).where(and(eq(sales.id, id), eq(sales.tenantId, tenantId)))
  const existing = rows[0]
  if (!existing) return notFound('Sale not found for this tenant')
  if (existing.reversedAt) return badRequest('This sale has already been reversed')

  if (!canModifyOwnRow(session.role, session.id, existing.recordedBy)) {
    return forbidden('You may only reverse sales you recorded yourself')
  }

  let updated: typeof existing
  try {
    updated = await db.transaction(async (tx) => {
      const { contraEntry } = await reverseJournalEntry(tx, {
        tenantId, sourceType: 'sale', sourceId: id, memo: `Reversal of sale: ${existing.item}`,
      })

      const reversedAt = new Date()
      const [row] = await tx.update(sales).set({ reversedAt }).where(eq(sales.id, id)).returning()

      await tx.insert(auditLog).values({
        id: randomUUID(),
        tenantId,
        actor: session.id,
        action: 'sale.reversed',
        entity: 'sale',
        entityId: id,
        meta: { reason, amountCents: existing.amountCents, item: existing.item, contraEntryId: contraEntry.id },
      })

      return row
    })
  } catch (err) {
    if (err instanceof Error) return badRequest(err.message)
    throw err
  }

  return ok(updated)
}
