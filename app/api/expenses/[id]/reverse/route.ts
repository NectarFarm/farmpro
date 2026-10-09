import { NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import { db } from '@/db'
import { expenses, auditLog, journalEntries } from '@/db/schemas'
import { and, eq } from 'drizzle-orm'
import { requireTenantSession, forbidden } from '@/lib/api-auth'
import { canEdit, canModifyOwnRow, MODULES } from '@/lib/permissions'
import { reverseJournalEntry } from '@/lib/finance'

// ── POST /api/expenses/[id]/reverse (issue #416) ────────────────────────────
// Same rule as a purchase reversal: the row's money is not rewritten, a
// contra journal entry dated to the original entry cancels the ledger, and
// `reversedAt` is the only mark on the row. There is no stock to put back.

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
  if (!reason) return badRequest('A reason is required to reverse an expense')

  const rows = await db.select().from(expenses).where(and(eq(expenses.id, id), eq(expenses.tenantId, tenantId)))
  const existing = rows[0]
  if (!existing) return notFound('Expense not found for this tenant')
  if (existing.reversedAt) return badRequest('This expense has already been reversed')

  if (!canModifyOwnRow(session.role, session.id, existing.recordedBy)) {
    return forbidden('You may only reverse expenses you recorded yourself')
  }

  let updated: typeof existing
  try {
    updated = await db.transaction(async (tx) => {
      const { contraEntry } = await reverseJournalEntry(tx, {
        tenantId, sourceType: 'expense', sourceId: id, memo: `Reversal of expense to ${existing.payee}`,
      })
      // Settlements recorded against this expense (Dr Accounts Payable / Cr
      // Cash) are cancelled with it. Reversing only the original would leave
      // a payment standing against an expense that no longer exists.
      const payments = await tx.select({ id: journalEntries.id }).from(journalEntries).where(and(
        eq(journalEntries.tenantId, tenantId),
        eq(journalEntries.sourceType, 'expense_payment'),
        eq(journalEntries.sourceId, id),
      ))
      for (const payment of payments) {
        await reverseJournalEntry(tx, {
          tenantId, sourceType: 'expense_payment', sourceId: id, entryId: payment.id,
          memo: `Reversal of a payment on the expense to ${existing.payee}`,
        })
      }
      const reversedAt = new Date()
      const [row] = await tx.update(expenses).set({ reversedAt }).where(eq(expenses.id, id)).returning()
      await tx.insert(auditLog).values({
        id: randomUUID(),
        tenantId,
        actor: session.id,
        action: 'expense.reversed',
        entity: 'expense',
        entityId: id,
        meta: { reason, amountCents: existing.amountCents, payee: existing.payee, contraEntryId: contraEntry.id },
      })
      return row
    })
  } catch (err) {
    if (err instanceof Error) return badRequest(err.message)
    throw err
  }

  return ok(updated)
}
