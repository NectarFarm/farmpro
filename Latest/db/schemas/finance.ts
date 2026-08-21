// IFMS Finance backend (issue #239). Fresh build: no `sales`, `accounts`,
// `journal_entries`, or `journal_lines` table existed anywhere on this branch
// before this issue (the issue's own branch-correction note confirms it —
// checked `db/schemas/*.ts` and grepped the repo). Only `purchases` (#235,
// merged) was real; there was no sales-tracking anywhere, so this issue's
// scope was expanded to build one, since without it there is nothing for the
// Sales tab (components/farm/finance.tsx `SALES` mock) or the revenue side of
// a trial balance to read/write.
//
// ── Posting-engine-vs-computed-on-read decision (see PR body for the full
// writeup) ── Chosen: a real, synchronous write-time posting engine — every
// `sales`/`purchases` insert posts its journal entry inside the SAME DB
// transaction as the domain write (see lib/finance.ts's postSaleJournal /
// postPurchaseJournal, and lib/inventory.ts's recordPurchase). NOT a
// computed-on-read trial balance, and NOT an async job or DB trigger. Reason:
// both sales and purchases already carry the exact fact a correct posting
// needs (sale.status distinguishes cash vs on-account; purchase's
// amountPaidCents vs totalCostCents distinguishes a fully-paid purchase from
// one still owed to a supplier) — a computed-on-read trial balance would have
// to re-derive that same Dr/Cr split from raw rows at query time, encoding
// the accounting rules twice (once implicitly in "what a computed reader
// assumes", once for real if anyone ever adds a genuine posting engine
// later) with no persisted, auditable ledger in between. Posting
// synchronously in the same transaction as the domain write means a sale or
// purchase can never exist without its journal entry (or vice versa), and
// GET /api/gl/trial-balance becomes a plain SUM/GROUP BY over real
// `journal_lines` rows — simpler to verify and to extend later (e.g. a
// journal-entries drill-down view) than re-implementing the business rules
// in a read endpoint.
//
// ── Chart of accounts (task 2) ───────────────────────────────────────────
// `accounts` is NOT tenant-scoped — it's a small, fixed, seeded taxonomy
// (same six-account "standard farm COA" every tenant posts against), not
// per-tenant configuration; keeping it global avoids reseeding it per tenant
// for no benefit. `journal_entries`/`journal_lines` ARE tenant-scoped (via
// `journal_entries.tenantId`) since they record a specific tenant's
// transactions. Minimal COA, matching the mock's GL_ENTRIES shape
// (components/farm/finance.tsx) trimmed to what real sales/purchases writes
// can actually post to:
//   1001 Cash and Bank        ASSET      debit   — cash sales / cash-paid purchases
//   1002 Accounts Receivable  ASSET      debit   — pending (on-account) sales
//   2001 Accounts Payable     LIABILITY  credit  — unpaid portion of a purchase
//   3001 Owner's Equity       EQUITY     credit  — present for a complete COA; no v1 postings touch it
//   4001 Sales Revenue        REVENUE    credit  — every sale, paid or pending
//   5001 Purchases Expense    EXPENSE    debit   — every purchase, in full (cash-basis;
//                                                  no deferred inventory-asset/COGS-at-sale
//                                                  matching in this pass — out of scope,
//                                                  same "minimal" instruction as the rest
//                                                  of this issue)
// No payroll account and no payroll postings — there is no payroll table
// anywhere in this app (explicitly out of scope, per People epic #247/#248).
import { pgTable, text, timestamp, integer, index, uniqueIndex } from 'drizzle-orm/pg-core'

// A tenant's sales — the real backend for components/farm/finance.tsx's
// `SALES` mock (Sales tab). `batchId` is kept as a plain logical reference
// (no DB FK) — same "no import cycle with db/schemas/index.ts" convention
// `approvalRequests.batchId` (governance.ts) and `employees.assignedBatchIds`
// (people.ts) already use, since `batches` is defined in index.ts itself.
// `amount` and `method`/`status` match the issue's exact field list and the
// mock's shape 1:1 (no `*Cents` renaming — the issue names the column
// `amount` and the mock treats it as a plain number, not a minor-unit figure
// like `purchases.totalCostCents`).
// `productId` (product-unit-inheritance task): nullable logical reference to
// products.id (no DB FK — products lives in dashboard.ts; same "no import
// cycle with db/schemas/index.ts" convention `batchId` below already uses).
// `item` (free text) is NOT replaced or backfilled by this column — it stays
// required and keeps its own meaning for two reasons: (1) every sale row
// that predates this column has no product to guess-match it to (an item
// string like "Tray eggs (30) x 120" is not a reliable key into the products
// catalogue — guessing would silently misattribute historical revenue), and
// (2) the UI's Record-Sale sheet still supports a genuine one-off/ad-hoc
// sale with no catalogue product at all. So a sale now carries BOTH: `item`
// is always the human-readable label shown everywhere sales already render
// it, and `productId` is the optional link that lets revenue be attributed
// back to a catalogue product when the sale actually came from one (see
// POST /api/data/sales, which fills `item` from the chosen product's name
// when the caller doesn't supply its own).
export const sales = pgTable('sales', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  batchId: text('batch_id'),
  productId: text('product_id'),
  item: text('item').notNull(),
  amount: integer('amount').notNull(),
  method: text('method').notNull().default(''),
  status: text('status').notNull().default('paid'), // 'paid' | 'pending'
  soldAt: timestamp('sold_at').defaultNow().notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('idx_sales_tenant').on(t.tenantId),
  index('idx_sales_tenant_batch').on(t.tenantId, t.batchId),
  // Added with sales.product_id: attributing revenue to a product scans by
  // product alone, which the tenant-led composites above cannot serve.
  index('idx_sales_product').on(t.productId),
])

// The chart of accounts — fixed, global, seeded (see lib/finance.ts's
// ensureAccountsSeeded). `code` is the human-facing account number the mock's
// GL_ENTRIES/GL_CHART key off; `class` and `normalBalance` are the two facts
// double-entry postings and the trial balance need to know how to treat a
// balance (debit-normal vs credit-normal).
export const accounts = pgTable('accounts', {
  id: text('id').primaryKey(),
  code: text('code').notNull(),
  name: text('name').notNull(),
  class: text('class').notNull(), // 'ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE' | 'EXPENSE'
  normalBalance: text('normal_balance').notNull(), // 'DEBIT' | 'CREDIT'
}, (t) => [
  uniqueIndex('idx_accounts_code').on(t.code),
])

// One journal entry per posted sale or purchase. `sourceType`/`sourceId`
// trace an entry back to the `sales` or `purchases` row that produced it —
// no entry is ever hand-created outside a real domain write in this pass.
export const journalEntries = pgTable('journal_entries', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  sourceType: text('source_type').notNull(), // 'sale' | 'purchase'
  sourceId: text('source_id').notNull(),
  memo: text('memo').notNull().default(''),
  entryDate: timestamp('entry_date').defaultNow().notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('idx_journal_entries_tenant').on(t.tenantId),
  index('idx_journal_entries_tenant_source').on(t.tenantId, t.sourceType, t.sourceId),
])

// The debit/credit lines of a journal entry. Real FKs are fine here —
// `journal_entries`/`accounts` both live in this same file, no cross-file
// import-cycle concern. Exactly one of debit/credit is non-zero per line
// (enforced in lib/finance.ts's posting functions, not at the DB level, same
// "validated in application code" convention the rest of this branch uses for
// invariants a CHECK constraint could also express).
export const journalLines = pgTable('journal_lines', {
  id: text('id').primaryKey(),
  entryId: text('entry_id').notNull().references(() => journalEntries.id),
  accountId: text('account_id').notNull().references(() => accounts.id),
  debit: integer('debit').notNull().default(0),
  credit: integer('credit').notNull().default(0),
}, (t) => [
  index('idx_journal_lines_entry').on(t.entryId),
  index('idx_journal_lines_account').on(t.accountId),
])
