// Recording an operating expense (issue #416). One transaction: the expense
// row and its journal entry. There is no inventory write on this path.
import 'server-only'
import { randomUUID } from 'node:crypto'
import { db } from '@/db'
import { expenseCategories, expenses, auditLog } from '@/db/schemas'
import { and, eq } from 'drizzle-orm'
import { ACCOUNT_CODES, ensureAccountsSeeded, postExpenseJournal, postExpensePaymentJournal } from '@/lib/finance'

export const SEEDED_EXPENSE_CATEGORIES = [
  { id: 'expcat-transport', code: 'transport', name: 'Transport and delivery', accountCode: ACCOUNT_CODES.TRANSPORT },
  { id: 'expcat-casual-labour', code: 'casual_labour', name: 'Casual labour', accountCode: ACCOUNT_CODES.CASUAL_LABOUR },
  { id: 'expcat-veterinary', code: 'veterinary', name: 'Veterinary and animal health', accountCode: ACCOUNT_CODES.VETERINARY },
  { id: 'expcat-airtime', code: 'airtime', name: 'Airtime and communication', accountCode: ACCOUNT_CODES.AIRTIME },
  { id: 'expcat-general', code: 'general', name: 'General operating expense', accountCode: ACCOUNT_CODES.GENERAL_OPERATING },
] as const

// Idempotent, and it does not revive a category an admin has deactivated:
// the conflict target is `code`, and ON CONFLICT DO NOTHING leaves the
// existing row's `active` flag alone.
export async function ensureExpenseCategories(dbOrTx: typeof db = db) {
  await ensureAccountsSeeded(dbOrTx)
  await dbOrTx
    .insert(expenseCategories)
    .values(SEEDED_EXPENSE_CATEGORIES.map((c) => ({ ...c, active: true })))
    .onConflictDoNothing({ target: expenseCategories.code })
}

export async function recordExpense(input: {
  tenantId: string
  payee: string
  supplierId?: string | null
  categoryId: string
  accountCode: string
  amountCents: number
  amountPaidCents: number
  paymentMethod: string
  paymentReference?: string | null
  farmId: string
  unitId?: string | null
  notes?: string | null
  photoUrl?: string | null
  transactionDate: Date
  postingDate: Date
  recordedBy: string
  dimensions?: Record<string, string>
}) {
  return db.transaction(async (tx) => {
    const [expense] = await tx
      .insert(expenses)
      .values({
        id: randomUUID(),
        tenantId: input.tenantId,
        payee: input.payee,
        supplierId: input.supplierId ?? null,
        categoryId: input.categoryId,
        amountCents: input.amountCents,
        amountPaidCents: input.amountPaidCents,
        paymentMethod: input.paymentMethod,
        paymentReference: input.paymentReference ?? null,
        farmId: input.farmId,
        unitId: input.unitId ?? null,
        notes: input.notes ?? null,
        photoUrl: input.photoUrl ?? null,
        transactionDate: input.transactionDate,
        postingDate: input.postingDate,
        recordedBy: input.recordedBy,
      })
      .returning()

    const entry = await postExpenseJournal(tx, {
      id: expense.id,
      tenantId: expense.tenantId,
      amountCents: expense.amountCents,
      amountPaidCents: expense.amountPaidCents,
      accountCode: input.accountCode,
      farmId: expense.farmId,
      postingDate: expense.postingDate,
      payee: expense.payee,
    }, { dimensions: input.dimensions })

    await tx.insert(auditLog).values({
      id: randomUUID(),
      tenantId: input.tenantId,
      actor: input.recordedBy,
      action: 'expense.recorded',
      entity: 'expense',
      entityId: expense.id,
      meta: {
        payee: expense.payee,
        categoryId: expense.categoryId,
        accountCode: input.accountCode,
        amountCents: expense.amountCents,
        amountPaidCents: expense.amountPaidCents,
        farmId: expense.farmId,
        unitId: expense.unitId,
      },
    })

    return { expense, entry }
  })
}

export class ExpensePaymentError extends Error {}

// Settles part or all of what an expense still owes. The expense's own
// posting is untouched: this adds a Dr Accounts Payable / Cr Cash entry and
// moves `amountPaidCents` (the running paid total) so "still owed" falls. The
// amount, the original journal entry and every P&L figure stay as they were,
// because a settlement is a balance-sheet movement only.
export async function recordExpensePayment(input: {
  tenantId: string
  expenseId: string
  amountCents: number
  paymentMethod: string
  paymentReference?: string | null
  reason: string
  postingDate: Date
  recordedBy: string
  dimensions?: Record<string, string>
}) {
  return db.transaction(async (tx) => {
    const [expense] = await tx
      .select()
      .from(expenses)
      .where(and(eq(expenses.id, input.expenseId), eq(expenses.tenantId, input.tenantId)))
      .for('update')
    if (!expense) throw new ExpensePaymentError('Expense not found for this tenant')
    if (expense.reversedAt) throw new ExpensePaymentError('This expense has been reversed — there is nothing left to pay')
    const owed = expense.amountCents - expense.amountPaidCents
    if (owed <= 0) throw new ExpensePaymentError('This expense is already paid in full')
    if (input.amountCents > owed) throw new ExpensePaymentError('That is more than is still owed on this expense')

    const entry = await postExpensePaymentJournal(tx, {
      tenantId: input.tenantId,
      expenseId: expense.id,
      amountCents: input.amountCents,
      farmId: expense.farmId,
      postingDate: input.postingDate,
      payee: expense.payee,
    }, { dimensions: input.dimensions })

    const [updated] = await tx
      .update(expenses)
      .set({ amountPaidCents: expense.amountPaidCents + input.amountCents })
      .where(eq(expenses.id, expense.id))
      .returning()

    await tx.insert(auditLog).values({
      id: randomUUID(),
      tenantId: input.tenantId,
      actor: input.recordedBy,
      action: 'expense.payment_recorded',
      entity: 'expense',
      entityId: expense.id,
      meta: {
        reason: input.reason,
        amountCents: input.amountCents,
        paymentMethod: input.paymentMethod,
        paymentReference: input.paymentReference ?? null,
        paidBeforeCents: expense.amountPaidCents,
        paidAfterCents: updated.amountPaidCents,
        journalEntryId: entry.id,
      },
    })

    return { expense: updated, entry }
  })
}
