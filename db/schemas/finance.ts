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
//   5002 Payroll Expense      EXPENSE    debit   — added by the payroll-and-gps task: every
//                                                  payroll run, in full, posted Dr Payroll
//                                                  Expense / Cr Cash (cash-basis, "paid in
//                                                  full at run time" — same treatment as a
//                                                  fully-paid purchase; see
//                                                  db/schemas/payroll.ts and
//                                                  lib/finance.ts's postPayrollJournal). This
//                                                  replaces the earlier "no payroll account
//                                                  and no payroll postings" state — a real
//                                                  `payroll_runs`/`payslips` pair now exists
//                                                  (db/schemas/payroll.ts) and deliberately
//                                                  DOES post, since leaving a real payroll
//                                                  expense out of the ledger would make the
//                                                  GL/trial balance/P&L quietly wrong once
//                                                  payroll is real money moving.
import { pgTable, text, timestamp, integer, bigint, boolean, index, uniqueIndex } from 'drizzle-orm/pg-core'

// A tenant's sales — the real backend for components/farm/finance.tsx's
// `SALES` mock (Sales tab). `batchId` is kept as a plain logical reference
// (no DB FK) — same "no import cycle with db/schemas/index.ts" convention
// `approvalRequests.batchId` (governance.ts) and `employees.assignedBatchIds`
// (people.ts) already use, since `batches` is defined in index.ts itself.
// `amountCents` and `method`/`status` match the issue's exact field list and
// the mock's shape 1:1 for everything except the money column itself:
// originally named `amount` and stored as a plain whole-currency-unit
// figure — inconsistent with every other money column in this schema
// (`purchases.totalCostCents` etc, all minor-unit/cents). Renamed to
// `amountCents` and converted x100 (issue: money-unit-enforcement; see
// drizzle/0024_*.sql) so the whole app has exactly one money unit. The old
// name is retired for good reason: a column called `amount` no longer
// exists to accidentally re-multiply if a migration ever ran twice.
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
  // How many were sold. Nullable because every sale recorded before this
  // column existed has no quantity to backfill with — and guessing one from
  // the amount would invent a per-unit price nobody entered. A sale with no
  // qty moves no stock, which is the honest reading of "we know it was sold,
  // we don't know how many".
  qty: integer('qty'),
  amountCents: bigint('amount_cents', { mode: 'number' }).notNull(),
  method: text('method').notNull().default(''),
  status: text('status').notNull().default('paid'), // 'paid' | 'pending'
  soldAt: timestamp('sold_at').defaultNow().notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  // Migration 0045 (forms-audit slice). `method` stays free text — old rows
  // keep whatever they already say — but the Record Sale sheet now offers a
  // fixed list (M-Pesa, Cash, Bank transfer, Credit, Cheque) and, for the
  // three that have one, a reference: the M-Pesa code, the bank reference,
  // the cheque number. One column for all three; which it means is implied
  // by `method`, the same way a bank statement line does.
  paymentReference: text('payment_reference'),
  // Set only when `status` is 'pending' (chosen via the Credit method) — the
  // date the customer is expected to pay. Nullable: most sales are paid on
  // the spot and never had a due date to begin with.
  dueDate: timestamp('due_date'),
  // "Sold to" — one optional free-text buyer name. Not a customer master
  // (that's a separate epic, #416): this is the note a farmer already writes
  // on paper, given somewhere to live.
  soldTo: text('sold_to'),
  notes: text('notes'),
  // Migration 0046 (three-date model, item 18). `soldAt` already IS the
  // transaction date (when the sale happened, "Sale date" in the sheet) —
  // no new column needed for that one. These two are the genuinely new
  // facts: `effectiveDate` (when the stock actually left / the service took
  // effect — usually the same moment as the transaction, but a dispatch can
  // lag a sale) and `postingDate` (which ledger period this counts in;
  // defaults to `effectiveDate`, which itself defaults to `soldAt`). Both
  // nullable, backfilled from `soldAt` for existing rows — see migration
  // 0046's own header for why that, and not `createdAt`, is the value that
  // keeps every P&L figure unchanged (lib/reports.ts has always filtered
  // sales by `soldAt`, never `createdAt`).
  effectiveDate: timestamp('effective_date'),
  postingDate: timestamp('posting_date'),
  // Migration 0047 (item 20). Optional link to the customer master — `soldTo`
  // above stays the free-text fact for an old row or a genuine one-off; this
  // is set only when the sheet's type-to-search picker actually resolved (or
  // created) a real customers row. Plain logical reference, no DB FK — same
  // convention every other cross-entity reference in this schema uses
  // (batchId above, purchases.supplierId below), checked against the
  // caller's tenant in the route rather than at the DB level.
  customerId: text('customer_id'),
  // Item 23: a reversed sale is never deleted and its amountCents/qty/status
  // are never rewritten in place — this is the ONLY mark a reversal leaves
  // on the row itself. Set once, by POST /api/data/sales/[id]/reverse, in
  // the same transaction as the contra journal entry (lib/finance.ts's
  // reverseJournalEntry) that actually cancels its ledger effect. The
  // before/after values, the reason and who did it live in audit_log
  // (entity: 'sale'), read back by the same StatusTimeline component tasks
  // already use — no second history mechanism.
  reversedAt: timestamp('reversed_at'),
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

// One journal entry per posted sale, purchase or payroll run. `sourceType`/
// `sourceId` trace an entry back to the row that produced it — no entry is
// ever hand-created outside a real domain write in this pass.
//
// `farmId` (dimensions-on-gl task): plain logical reference, no DB FK — same
// convention as `sales.batchId` above (farms lives in db/schemas/index.ts,
// which itself re-exports this file, so a real FK here would be an import
// cycle). Filled in at posting time by lib/finance.ts wherever the source
// document resolves to one farm (a sale against a batch resolves batch ->
// unit -> farm; a purchase already carries its own farmId). NULL when the
// source has no farm relationship at all (a payroll run pays a person, not a
// farm) or when a sale/purchase carries no batch/farm of its own — this is
// exactly the gap lib/reports.ts's P&L used to paper over with an all-time,
// all-farm-only GL caveat; a farm-scoped dimension report
// (lib/reports.ts's computeDimensionPlReport) can now read this column
// directly instead of falling back to that caveat for every figure.
export const journalEntries = pgTable('journal_entries', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  sourceType: text('source_type').notNull(), // 'sale' | 'purchase' | 'payroll_run'
  sourceId: text('source_id').notNull(),
  farmId: text('farm_id'),
  memo: text('memo').notNull().default(''),
  entryDate: timestamp('entry_date').defaultNow().notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('idx_journal_entries_tenant').on(t.tenantId),
  index('idx_journal_entries_tenant_source').on(t.tenantId, t.sourceType, t.sourceId),
  index('idx_journal_entries_tenant_farm').on(t.tenantId, t.farmId),
])

// The debit/credit lines of a journal entry. Real FKs are fine here —
// `journal_entries`/`accounts` both live in this same file, no cross-file
// import-cycle concern. Exactly one of debitCents/creditCents is non-zero
// per line (enforced in lib/finance.ts's posting functions, not at the DB
// level, same "validated in application code" convention the rest of this
// branch uses for invariants a CHECK constraint could also express).
//
// Renamed debit/credit -> debitCents/creditCents and widened to bigint
// (issue: money-unit-enforcement) — the ledger used to store whole-currency
// units (matching `sales.amount`'s unit at the time); now that every money
// column in this schema is cents, these follow the same convention. Existing
// values converted x100 by drizzle/0024_*.sql.
export const journalLines = pgTable('journal_lines', {
  id: text('id').primaryKey(),
  entryId: text('entry_id').notNull().references(() => journalEntries.id),
  accountId: text('account_id').notNull().references(() => accounts.id),
  debitCents: bigint('debit_cents', { mode: 'number' }).notNull().default(0),
  creditCents: bigint('credit_cents', { mode: 'number' }).notNull().default(0),
}, (t) => [
  index('idx_journal_lines_entry').on(t.entryId),
  index('idx_journal_lines_account').on(t.accountId),
])

// ── Supplier and customer masters (item 20, forms-audit slice) ──────────────
// Two small, tenant-scoped masters — not a re-architecture of anything: a
// purchase/expense still stores its own free-text `supplier`, a sale still
// stores its own free-text `soldTo` (see migration 0045). These are an
// OPTIONAL link on top — `purchases.supplierId`/`sales.customerId`
// (migration 0047) — so an old row, and a genuine one-off with no master
// behind it, keep working exactly as they always have. Deliberately minimal
// fields: name, phone, a contact person (distinct from the phone — a
// supplier's phone often rings a shop, not the person the owner actually
// deals with), an optional TIN, free-text credit terms ("Net 30", "COD" —
// not a structured payment-terms engine), and an active flag so a supplier
// who closed shop stops showing up in the picker without losing their
// purchase history.
export const suppliers = pgTable('suppliers', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  name: text('name').notNull(),
  phone: text('phone').notNull().default(''),
  contact: text('contact').notNull().default(''),
  tin: text('tin'),
  creditTerms: text('credit_terms'),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('idx_suppliers_tenant').on(t.tenantId),
])

export const customers = pgTable('customers', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  name: text('name').notNull(),
  phone: text('phone').notNull().default(''),
  contact: text('contact').notNull().default(''),
  tin: text('tin'),
  creditTerms: text('credit_terms'),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('idx_customers_tenant').on(t.tenantId),
])
