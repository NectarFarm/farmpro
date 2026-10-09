// Operating expenses that are not stock (issue #416).
//
// A purchase (db/schemas/inventory.ts) always creates an inventory lot and
// debits Purchases Expense. Transport, casual labour, a vet visit and airtime
// are money out with nothing to put on a shelf. They live here, in their own
// table, and post to the expense account their category names. No purchase
// column is reused: an old purchase row is still exactly a stock receipt.
//
// `expense_categories` is a global catalogue (same stance as `accounts` —
// one chart for every farm). The platform admin maintains it. An owner only
// picks. `account_code` is a logical reference to accounts.code, not a FK,
// because accounts lives in finance.ts and a FK from this file back into
// that one is the import cycle the rest of this schema refuses.
import { pgTable, text, timestamp, bigint, boolean, index, uniqueIndex } from 'drizzle-orm/pg-core'

export const expenseCategories = pgTable('expense_categories', {
  id: text('id').primaryKey(),
  code: text('code').notNull(),
  name: text('name').notNull(),
  accountCode: text('account_code').notNull(),
  active: boolean('active').notNull().default(true),
}, (t) => [
  uniqueIndex('idx_expense_categories_code').on(t.code),
])

export const expenses = pgTable('expenses', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  payee: text('payee').notNull(),
  // Optional link to the supplier master. `payee` stays the free-text fact
  // for a one-off (a boda rider with no supplier row). Same split as
  // purchases.supplier / purchases.supplierId.
  supplierId: text('supplier_id'),
  categoryId: text('category_id').notNull().references(() => expenseCategories.id),
  amountCents: bigint('amount_cents', { mode: 'number' }).notNull(),
  amountPaidCents: bigint('amount_paid_cents', { mode: 'number' }).notNull().default(0),
  paymentMethod: text('payment_method').notNull().default(''),
  paymentReference: text('payment_reference'),
  farmId: text('farm_id'),
  // A production unit (house) on that farm. Optional: an expense can belong
  // to the farm without belonging to one house. Plain logical reference, no
  // FK — production_units lives in index.ts, which re-exports this file.
  unitId: text('unit_id'),
  notes: text('notes'),
  photoUrl: text('photo_url'),
  transactionDate: timestamp('transaction_date'),
  postingDate: timestamp('posting_date'),
  recordedBy: text('recorded_by'),
  reversedAt: timestamp('reversed_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  // Issue #419. Same five nullable columns as sales. amount_cents stays the
  // settled amount (the gross, once a code is present).
  taxCode: text('tax_code'),
  taxInclusive: boolean('tax_inclusive'),
  grossCents: bigint('gross_cents', { mode: 'number' }),
  taxCents: bigint('tax_cents', { mode: 'number' }),
  netCents: bigint('net_cents', { mode: 'number' }),
}, (t) => [
  index('idx_expenses_tenant').on(t.tenantId),
  index('idx_expenses_tenant_posting').on(t.tenantId, t.postingDate),
  index('idx_expenses_farm').on(t.farmId),
])
