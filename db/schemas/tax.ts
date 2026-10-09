// VAT catalogue (issue #419). Global, like accounts and expense categories:
// one list of codes for every farm, and rates maintained by the platform
// admin. A document stores the code it was given as text, not a foreign key,
// the same way an expense stores account_code — so a later rename of a
// catalogue row cannot rewrite a posted document.
//
// No rate is seeded. VATable with no rate covering the posting date is
// refused. Zero-rated, exempt, and outside scope compute no tax from the
// code itself and do not read this table.
import { pgTable, text, timestamp, integer, boolean, date, index, uniqueIndex } from 'drizzle-orm/pg-core'

export const taxCodes = pgTable('tax_codes', {
  id: text('id').primaryKey(),
  code: text('code').notNull(),
  name: text('name').notNull(),
  active: boolean('active').notNull().default(true),
}, (t) => [
  uniqueIndex('idx_tax_codes_code').on(t.code),
])

export const taxRates = pgTable('tax_rates', {
  id: text('id').primaryKey(),
  // Logical reference to tax_codes.code. Not a FK: the route checks it, and
  // a rate row is a historical fact that should survive a code being retired.
  taxCode: text('tax_code').notNull(),
  // Hundredths of a percent. 1600 is 16.00%. Never edited in place — a new
  // row with its own effective dates replaces it, so an old document still
  // resolves the rate that was in force on its posting date.
  rateBps: integer('rate_bps').notNull(),
  effectiveFrom: date('effective_from', { mode: 'string' }).notNull(),
  // Inclusive. Null means the rate has not been given an end date.
  effectiveTo: date('effective_to', { mode: 'string' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('idx_tax_rates_code').on(t.taxCode),
])
