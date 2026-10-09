// Recording an operating expense (issue #416). One transaction: the expense
// row and its journal entry. There is no inventory write on this path.
import 'server-only'
import { randomUUID } from 'node:crypto'
import { db } from '@/db'
import { expenseCategories, expenses, auditLog } from '@/db/schemas'
import { ACCOUNT_CODES, ensureAccountsSeeded, postExpenseJournal } from '@/lib/finance'

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
