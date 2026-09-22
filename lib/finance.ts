// ── Shared finance logic (issue #239) ───────────────────────────────────────
// Chart-of-accounts seeding, the sale/purchase -> journal-entry posting rules,
// and the trial-balance query all live here so the routes that use them (and
// the tests that verify them) share one implementation instead of drifting —
// same convention as lib/inventory.ts for issue #235.
//
// See db/schemas/finance.ts for the posting-engine-vs-computed-on-read
// decision writeup and the chart-of-accounts rationale.
import 'server-only'
import { randomUUID } from 'node:crypto'
import { and, desc, eq, inArray } from 'drizzle-orm'
import type { PgTransaction } from 'drizzle-orm/pg-core'
import { db } from '@/db'
import { accounts, journalEntries, journalLines, journalLineDimensions, sales, purchases, batches, productionUnits } from '@/db/schemas'
import { applyMovement } from '@/lib/batch-ledger'
import { availableProduce, ProduceShortfallError } from '@/lib/produce'
import {
  resolveMasterDimensions, attachLineDimensions, attachDocumentDimensions,
  DimensionValidationError, DimensionRequirementError, type MasterRef,
} from '@/lib/dimensions'

export { DimensionValidationError, DimensionRequirementError }

// Minimal transaction type covering what the posting helpers below need —
// lets them run either inside `db.transaction(...)` (recordSale) or inside an
// already-open transaction started elsewhere (lib/inventory.ts's
// recordPurchase), matching how that function already threads its own `tx`.
type Tx = PgTransaction<any, any, any>

export const ACCOUNT_CODES = {
  CASH: '1001',
  ACCOUNTS_RECEIVABLE: '1002',
  ACCOUNTS_PAYABLE: '2001',
  OWNERS_EQUITY: '3001',
  SALES_REVENUE: '4001',
  PURCHASES_EXPENSE: '5001',
  // Added by the payroll-and-gps task — see db/schemas/finance.ts's
  // chart-of-accounts comment for why payroll posts at all.
  PAYROLL_EXPENSE: '5002',
} as const

// The standard farm chart of accounts this issue seeds — see
// db/schemas/finance.ts's top-of-file comment for why each account exists.
const STANDARD_ACCOUNTS: { code: string; name: string; class: string; normalBalance: string }[] = [
  { code: ACCOUNT_CODES.CASH, name: 'Cash and Bank', class: 'ASSET', normalBalance: 'DEBIT' },
  { code: ACCOUNT_CODES.ACCOUNTS_RECEIVABLE, name: 'Accounts Receivable', class: 'ASSET', normalBalance: 'DEBIT' },
  { code: ACCOUNT_CODES.ACCOUNTS_PAYABLE, name: 'Accounts Payable', class: 'LIABILITY', normalBalance: 'CREDIT' },
  { code: ACCOUNT_CODES.OWNERS_EQUITY, name: "Owner's Equity", class: 'EQUITY', normalBalance: 'CREDIT' },
  { code: ACCOUNT_CODES.SALES_REVENUE, name: 'Sales Revenue', class: 'REVENUE', normalBalance: 'CREDIT' },
  { code: ACCOUNT_CODES.PURCHASES_EXPENSE, name: 'Purchases Expense', class: 'EXPENSE', normalBalance: 'DEBIT' },
  { code: ACCOUNT_CODES.PAYROLL_EXPENSE, name: 'Payroll Expense', class: 'EXPENSE', normalBalance: 'DEBIT' },
]

// Idempotent: ON CONFLICT DO NOTHING on the unique `code` index, so this is
// safe to call on every request that needs the COA to exist (GET
// /api/gl/accounts, and before every posting) rather than depending on a
// separate seed script having been run first.
export async function ensureAccountsSeeded(dbOrTx: Tx | typeof db = db) {
  await dbOrTx
    .insert(accounts)
    .values(STANDARD_ACCOUNTS.map((a) => ({ id: randomUUID(), ...a })))
    .onConflictDoNothing({ target: accounts.code })
}

async function accountIdByCode(dbOrTx: Tx | typeof db, code: string): Promise<string> {
  const rows = await dbOrTx.select().from(accounts).where(eq(accounts.code, code))
  const row = rows[0]
  if (!row) throw new Error(`Chart-of-accounts account ${code} is missing — ensureAccountsSeeded was not called`)
  return row.id
}

// ── Dimension capture (dimensions-on-gl task) ───────────────────────────────
// A sale/purchase/payroll run resolves to exactly one farm today (a batch
// belongs to one unit belongs to one farm; a purchase already carries its
// own farmId) — this is the fact `journal_entries.farmId` records, and it is
// what closes lib/reports.ts's "GL totals ... cover every farm" caveat for
// anything posted from here on. NOT the same thing as the FARM *dimension*
// value attached to each line below (that one goes through the same
// resolveMasterDimensions() every other dimension does) — this is a plain
// denormalised column for a cheap direct filter, same role
// purchases.farmId/sales already play elsewhere in this schema.
async function farmIdForBatch(dbOrTx: Tx | typeof db, tenantId: string, batchId: string): Promise<string | null> {
  const rows = await dbOrTx
    .select({ farmId: productionUnits.farmId })
    .from(batches)
    .innerJoin(productionUnits, eq(batches.unitId, productionUnits.id))
    .where(and(eq(batches.id, batchId), eq(batches.tenantId, tenantId), eq(productionUnits.tenantId, tenantId)))
    .limit(1)
  return rows[0]?.farmId ?? null
}

// Resolves a document's base dimension set, writes it to `document_dimensions`
// (owner instruction: dimensions ride on the document, not only the ledger
// line), then attaches the per-account-ruled final set to every one of its
// journal lines — refusing (via DimensionRequirementError) if any line's
// account has an unmet required dimension. Shared by every post*Journal
// function below so the capture/enforcement rule can't drift between them.
async function captureDimensions(
  tx: Tx,
  args: {
    tenantId: string
    docType: 'sale' | 'purchase' | 'payroll_run'
    docId: string
    sourceMaster: MasterRef | null
    explicit?: Record<string, string>
    lines: { id: string; accountId: string }[]
  },
): Promise<void> {
  const base = await resolveMasterDimensions(tx, args.tenantId, args.sourceMaster, args.explicit ?? {})
  await attachDocumentDimensions(tx, { tenantId: args.tenantId, docType: args.docType, docId: args.docId, base })
  for (const line of args.lines) {
    await attachLineDimensions(tx, { tenantId: args.tenantId, lineId: line.id, accountId: line.accountId, base })
  }
}

// ── Sale -> journal entry (issue #239 task 3) ───────────────────────────────
// A sale posts Dr Cash (status 'paid') or Dr Accounts Receivable (status
// 'pending') for the full amount, Cr Sales Revenue for the full amount — the
// entry balances by construction (both lines carry the same amount).
//
// Unit (issue: money-unit-enforcement): `sale.amountCents` and
// `journalLines.debitCents`/`creditCents` are both cents now — posted
// straight through, no conversion. (Before this issue, `sales.amount` was
// whole currency units and postPurchaseJournal below converted purchases'
// cents down to match it — the source of issue #290's bug class. Converting
// the whole ledger to cents instead of whole units removes that conversion
// entirely rather than moving it to the other side.)
export async function postSaleJournal(
  tx: Tx,
  sale: { id: string; tenantId: string; amountCents: number; status: string; batchId?: string | null; postingDate?: Date | null },
  opts: { dimensions?: Record<string, string> } = {},
) {
  await ensureAccountsSeeded(tx)
  const debitAccountId = await accountIdByCode(tx, sale.status === 'pending' ? ACCOUNT_CODES.ACCOUNTS_RECEIVABLE : ACCOUNT_CODES.CASH)
  const revenueAccountId = await accountIdByCode(tx, ACCOUNT_CODES.SALES_REVENUE)

  // A sale against a batch already knows its batch, hence its unit, hence
  // its farm (dimensions-on-gl task) — derived here rather than asking
  // anyone to re-enter it. An ad-hoc sale with no batchId derives nothing;
  // its lines carry only whatever an account's own default supplies.
  const farmId = sale.batchId ? await farmIdForBatch(tx, sale.tenantId, sale.batchId) : null
  const sourceMaster: MasterRef | null = sale.batchId ? { masterType: 'batch', masterId: sale.batchId } : null

  const [entry] = await tx
    .insert(journalEntries)
    .values({
      id: randomUUID(),
      tenantId: sale.tenantId,
      sourceType: 'sale',
      sourceId: sale.id,
      farmId,
      memo: sale.status === 'pending' ? 'Sale recorded on account' : 'Cash sale recorded',
      // Three-date model (item 18, part 2 of 2): a journal entry's own date
      // now agrees with the sale's posting date instead of silently defaulting
      // to whatever instant this transaction happened to commit at — this is
      // what makes computeDimensionPlReport (which has always filtered on
      // journal_entries.entry_date, not sales/purchases directly) period-
      // consistent with the plain P&L above for a backdated sale. Old entries
      // are untouched (see migration 0046 — this is new-row-only, exactly
      // like every other part of the repoint).
      ...(sale.postingDate ? { entryDate: sale.postingDate } : {}),
    })
    .returning()

  const lines = await tx.insert(journalLines).values([
    { id: randomUUID(), entryId: entry.id, accountId: debitAccountId, debitCents: sale.amountCents, creditCents: 0 },
    { id: randomUUID(), entryId: entry.id, accountId: revenueAccountId, debitCents: 0, creditCents: sale.amountCents },
  ]).returning()

  await captureDimensions(tx, {
    tenantId: sale.tenantId, docType: 'sale', docId: sale.id, sourceMaster, explicit: opts.dimensions,
    lines: lines.map((l) => ({ id: l.id, accountId: l.accountId })),
  })

  return entry
}

// ── Purchase -> journal entry (issue #239 task 3) ───────────────────────────
// A purchase posts Dr Purchases Expense for the full amount. The credit side
// splits by how much was actually paid: Cr Cash for `amountPaidCents`, Cr
// Accounts Payable for the unpaid remainder — so a fully-paid purchase posts
// only to Cash, an unpaid one posts only to Accounts Payable, and a partial
// payment posts to both. The entry balances by construction (paid + unpaid
// remainder always sums back to the full expense amount).
//
// ── Unit normalization (issue: money-unit-enforcement, supersedes #290) ─────
// `purchases.totalCostCents`/`amountPaidCents` and `journalLines.debitCents`/
// `creditCents` are ALL cents now (see db/schemas/finance.ts) — posted
// straight through, no conversion. (Issue #290 previously fixed the trial
// balance being wrong by ~100x by converting purchases' cents down to whole
// units here, to match `sales.amount`, which was whole units at the time.
// That conversion is gone, not moved: converting `sales.amount` itself to
// cents removes the unit mismatch at its source instead of compensating for
// it on the purchases side.) `owed` is still derived from the already-
// clamped total/paid cents figures (not rounded independently), so the entry
// still balances by construction.
export async function postPurchaseJournal(
  tx: Tx,
  purchase: { id: string; tenantId: string; totalCostCents: number; amountPaidCents: number; farmId?: string | null; postingDate?: Date | null },
  opts: { dimensions?: Record<string, string> } = {},
) {
  await ensureAccountsSeeded(tx)
  const expenseAccountId = await accountIdByCode(tx, ACCOUNT_CODES.PURCHASES_EXPENSE)
  const total = Math.max(0, purchase.totalCostCents)
  const paid = Math.min(Math.max(0, purchase.amountPaidCents), total)
  const owed = total - paid

  // A purchase already carries its own farmId (db/schemas/inventory.ts) —
  // no batch/unit hop needed, unlike a sale.
  const farmId = purchase.farmId ?? null
  const sourceMaster: MasterRef | null = farmId ? { masterType: 'farm', masterId: farmId } : null

  const [entry] = await tx
    .insert(journalEntries)
    .values({
      id: randomUUID(),
      tenantId: purchase.tenantId,
      sourceType: 'purchase',
      sourceId: purchase.id,
      farmId,
      memo: owed > 0 ? (paid > 0 ? 'Purchase recorded, partially paid' : 'Purchase recorded on account') : 'Purchase recorded, paid in full',
      // Three-date model (item 18, part 2 of 2) — see postSaleJournal's
      // identical comment.
      ...(purchase.postingDate ? { entryDate: purchase.postingDate } : {}),
    })
    .returning()

  const lines: (typeof journalLines.$inferInsert)[] = [
    { id: randomUUID(), entryId: entry.id, accountId: expenseAccountId, debitCents: total, creditCents: 0 },
  ]
  if (paid > 0) {
    const cashAccountId = await accountIdByCode(tx, ACCOUNT_CODES.CASH)
    lines.push({ id: randomUUID(), entryId: entry.id, accountId: cashAccountId, debitCents: 0, creditCents: paid })
  }
  if (owed > 0) {
    const apAccountId = await accountIdByCode(tx, ACCOUNT_CODES.ACCOUNTS_PAYABLE)
    lines.push({ id: randomUUID(), entryId: entry.id, accountId: apAccountId, debitCents: 0, creditCents: owed })
  }
  const insertedLines = await tx.insert(journalLines).values(lines).returning()

  await captureDimensions(tx, {
    tenantId: purchase.tenantId, docType: 'purchase', docId: purchase.id, sourceMaster, explicit: opts.dimensions,
    lines: insertedLines.map((l) => ({ id: l.id, accountId: l.accountId })),
  })

  return entry
}

// ── Payroll run -> journal entry (payroll-and-gps task) ─────────────────────
// A payroll run posts Dr Payroll Expense for the run's full total, Cr Cash
// for the same amount — treated as paid in full, in cash, at run time (same
// "cash-basis, no partial/on-account tracking" simplification the rest of
// this v1 payroll makes; there is no accrued-but-unpaid-wages liability
// account, unlike purchases' Accounts Payable). The entry balances by
// construction (one amount posted to both sides). Posted inside the SAME
// transaction as the run + its payslips (POST /api/payroll/runs) — a run can
// never exist without its journal entry, same convention as
// postSaleJournal/postPurchaseJournal above.
export async function postPayrollJournal(
  tx: Tx,
  run: { id: string; tenantId: string; totalAmountCents: number; periodStart: Date; periodEnd: Date; farmId?: string | null },
  opts: { dimensions?: Record<string, string> } = {},
) {
  await ensureAccountsSeeded(tx)
  const expenseAccountId = await accountIdByCode(tx, ACCOUNT_CODES.PAYROLL_EXPENSE)
  const cashAccountId = await accountIdByCode(tx, ACCOUNT_CODES.CASH)

  // "The employee master carries its unit and farm, so postPayrollJournal
  // picks them up without anyone re-keying" (owner instruction) — true for
  // the common case of a single-farm tenant, or a run whose eligible
  // employees all share one farm. This function still posts ONE aggregate
  // entry for the whole run (not one line per employee — that would be a
  // real posting-model change, out of scope here), so it can only carry ONE
  // farm's worth of dimension analysis. The caller (POST /api/payroll/runs)
  // resolves `run.farmId` to that shared farm, or leaves it null when the
  // run spans employees on different farms (or farm-less employees) — an
  // honest "not attributable to one farm" rather than a guess, the same
  // stance lib/reports.ts's P&L already takes on payroll.
  const farmId = run.farmId ?? null
  const sourceMaster: MasterRef | null = farmId ? { masterType: 'farm', masterId: farmId } : null

  const [entry] = await tx
    .insert(journalEntries)
    .values({
      id: randomUUID(),
      tenantId: run.tenantId,
      sourceType: 'payroll_run',
      sourceId: run.id,
      farmId,
      memo: `Payroll run ${run.periodStart.toISOString().slice(0, 10)} to ${run.periodEnd.toISOString().slice(0, 10)}`,
    })
    .returning()

  // Zero-amount entries would balance trivially but carry no information —
  // the route this is called from already refuses to create a run with no
  // eligible (rate > 0) employees, so `totalAmountCents` is always > 0 here.
  const lines = await tx.insert(journalLines).values([
    { id: randomUUID(), entryId: entry.id, accountId: expenseAccountId, debitCents: run.totalAmountCents, creditCents: 0 },
    { id: randomUUID(), entryId: entry.id, accountId: cashAccountId, debitCents: 0, creditCents: run.totalAmountCents },
  ]).returning()

  await captureDimensions(tx, {
    tenantId: run.tenantId, docType: 'payroll_run', docId: run.id, sourceMaster, explicit: opts.dimensions,
    lines: lines.map((l) => ({ id: l.id, accountId: l.accountId })),
  })

  return entry
}

// ── Reversal (item 23) ───────────────────────────────────────────────────────
// A posted sale/purchase is never deleted and its money is never rewritten in
// place — the ONLY way to cancel its ledger effect is a contra journal entry:
// one new entry, dated to match the ORIGINAL entry's entryDate (not "today"),
// with every line's debit/credit swapped against the same accounts for the
// same amounts, and the same dimension attributions mirrored onto the new
// lines. This is what makes the cancellation exact and period-honest:
//   - computeTrialBalance sums ALL journal_lines for the tenant with no date
//     filter, so the contra's swapped lines net every account back to
//     exactly where it was before the original entry posted, regardless of
//     when the reversal itself is clicked.
//   - computeDimensionPlReport filters journal_entries by entryDate — dating
//     the contra to the ORIGINAL entry's date (not now) means it lands in
//     the SAME reporting period as the transaction it cancels, so that
//     period's dimension-scoped revenue/expense nets to zero for this
//     document instead of the cancellation silently showing up in whatever
//     period happens to contain today.
//   - computePlReport/computeBatchPlReport read `sales`/`purchases` directly
//     (not the ledger) for their period figures — those routes additionally
//     filter out reversed rows (`reversedAt IS NULL`) so a reversed
//     transaction drops out of the period it was reported in, exactly like
//     it never happened, rather than being both reported AND ledger-zeroed.
//
// The contra entry is given its OWN sourceType (`${sourceType}_reversal`) —
// not a second `journal_entries` row under the original sourceType/sourceId —
// so `lib/dimensions.ts`'s getDocumentDimensions (`.limit(1)` on
// tenantId+sourceType+sourceId) keeps resolving to exactly the original
// entry, unambiguously, forever. `sourceId` stays the document id (the sale/
// purchase itself), not the original entry's id, so a reversal is still
// traceable straight back to the document it reverses without a join.
//
// Line-level dimensions are copied verbatim from the original lines' rows
// (not re-resolved via resolveMasterDimensions/applyAccountRules) — the
// original posting already proved every required dimension was present; a
// reversal mirrors that same analysis rather than re-deriving it against
// today's master data, which could have changed since.
export async function reverseJournalEntry(
  tx: Tx,
  args: { tenantId: string; sourceType: 'sale' | 'purchase'; sourceId: string; memo: string },
) {
  const [original] = await tx
    .select()
    .from(journalEntries)
    .where(and(
      eq(journalEntries.tenantId, args.tenantId),
      eq(journalEntries.sourceType, args.sourceType),
      eq(journalEntries.sourceId, args.sourceId),
    ))
    .limit(1)
  if (!original) {
    throw new Error(`No journal entry found for ${args.sourceType} ${args.sourceId} — nothing to reverse`)
  }

  const originalLines = await tx.select().from(journalLines).where(eq(journalLines.entryId, original.id))
  const originalLineIds = originalLines.map((l) => l.id)
  const originalLineDims = originalLineIds.length > 0
    ? await tx.select().from(journalLineDimensions).where(inArray(journalLineDimensions.lineId, originalLineIds))
    : []

  const [contraEntry] = await tx
    .insert(journalEntries)
    .values({
      id: randomUUID(),
      tenantId: args.tenantId,
      sourceType: `${args.sourceType}_reversal`,
      sourceId: args.sourceId,
      farmId: original.farmId,
      memo: args.memo,
      // Dated to the ORIGINAL entry, not now — see the header comment above.
      entryDate: original.entryDate,
    })
    .returning()

  const contraLines = await tx.insert(journalLines).values(
    originalLines.map((l) => ({
      id: randomUUID(),
      entryId: contraEntry.id,
      accountId: l.accountId,
      // The whole point of a contra: debit and credit swap per line.
      debitCents: l.creditCents,
      creditCents: l.debitCents,
    })),
  ).returning()

  const dimsByOriginalLineId = new Map<string, { dimensionId: string; valueId: string }[]>()
  for (const d of originalLineDims) {
    const list = dimsByOriginalLineId.get(d.lineId) ?? []
    list.push({ dimensionId: d.dimensionId, valueId: d.valueId })
    dimsByOriginalLineId.set(d.lineId, list)
  }
  const newDimRows: { id: string; lineId: string; dimensionId: string; valueId: string }[] = []
  originalLines.forEach((originalLine, i) => {
    const dims = dimsByOriginalLineId.get(originalLine.id) ?? []
    for (const d of dims) {
      newDimRows.push({ id: randomUUID(), lineId: contraLines[i].id, dimensionId: d.dimensionId, valueId: d.valueId })
    }
  })
  if (newDimRows.length > 0) await tx.insert(journalLineDimensions).values(newDimRows)

  return { original, contraEntry }
}

// POST /api/data/sales' transaction: insert the sale row, then post its
// journal entry in the same transaction — a sale can never exist without its
// journal entry, or vice versa (same shape as lib/inventory.ts's
// recordPurchase).
export async function recordSale(input: {
  tenantId: string
  batchId?: string | null
  /** How many units were sold — required for a sale to move any stock. */
  qty?: number | null
  /** From products.stockEffect; decides what, if anything, the sale reduces. */
  stockEffect?: string | null
  actor?: string
  // product-unit-inheritance task: optional link to the products catalogue.
  // `item` stays required and independent of this — see db/schemas/
  // finance.ts's comment on sales.productId for why both fields exist.
  productId?: string | null
  item: string
  amountCents: number
  method?: string
  status?: string
  soldAt?: Date
  // Forms-audit slice: paymentReference/dueDate/soldTo/notes are all
  // optional pass-throughs onto the columns db/schemas/finance.ts added —
  // nothing here changes what a sale without them looks like.
  paymentReference?: string | null
  dueDate?: Date | null
  soldTo?: string | null
  notes?: string | null
  // Item 20: optional link to the customer master — validated against the
  // caller's tenant by the route, not here (same "route validates, function
  // trusts" split as productId above).
  customerId?: string | null
  // Item 23: the recording actor's user id — see db/schemas/finance.ts's
  // sales.recordedBy for what this unlocks (edit/reverse ownership).
  recordedBy?: string | null
  // Three-date model (item 18). `soldAt` above is already the transaction
  // date. `effectiveDate` defaults to it (a sale's stock/service effect is
  // usually the same moment as the sale itself); `postingDate` defaults to
  // `effectiveDate` — the chain the sheet's own copy states. Neither is ever
  // left null: a caller that sends nothing still gets real, consistent dates,
  // which is what keeps `lib/reports.ts`'s posting_date filter equivalent to
  // its old sold_at filter for every row this function has ever written.
  effectiveDate?: Date | null
  postingDate?: Date | null
  // Explicit dimension overrides (dimensions-on-gl task), keyed by dimension
  // CODE — highest priority in resolveMasterDimensions' resolution order.
  // Optional: most sales carry nothing here and rely entirely on the
  // batch-derived system dimensions.
  dimensions?: Record<string, string>
}) {
  return db.transaction(async (tx) => {
    const soldAt = input.soldAt ?? new Date()
    const effectiveDate = input.effectiveDate ?? soldAt
    const postingDate = input.postingDate ?? effectiveDate
    const [sale] = await tx
      .insert(sales)
      .values({
        id: randomUUID(),
        tenantId: input.tenantId,
        batchId: input.batchId ?? null,
        productId: input.productId ?? null,
        item: input.item,
        qty: input.qty ?? null,
        amountCents: input.amountCents,
        method: input.method ?? '',
        status: input.status ?? 'paid',
        soldAt,
        paymentReference: input.paymentReference ?? null,
        dueDate: input.dueDate ?? null,
        soldTo: input.soldTo ?? null,
        customerId: input.customerId ?? null,
        notes: input.notes ?? null,
        effectiveDate,
        postingDate,
        recordedBy: input.recordedBy ?? null,
      })
      .returning()

    await postSaleJournal(tx, sale, { dimensions: input.dimensions })

    // ── Selling livestock takes it off the batch (batch-ledger task) ───────
    // Only when the product says it should. A sale of eggs leaves the hens
    // where they are; a sale of twenty birds must not. The product's
    // stockEffect is what distinguishes them, and without a quantity there
    // is nothing to subtract — so both have to be present before the
    // headcount moves, in this same transaction as the sale itself.
    // Selling produce cannot exceed what was collected and not already sold.
    // Checked inside the transaction and after the sale row is written, so
    // the balance being read already includes this sale — two concurrent
    // sales of the last tray cannot both pass.
    if (input.stockEffect === 'produce' && input.productId && input.qty && input.qty > 0) {
      const remaining = await availableProduce(input.tenantId, input.productId, input.batchId ?? null, tx)
      if (remaining < 0) {
        throw new ProduceShortfallError(input.item, input.qty, input.qty + remaining)
      }
    }

    if (input.stockEffect === 'batch_quantity' && input.batchId && input.qty && input.qty > 0) {
      await applyMovement(tx, {
        tenantId: input.tenantId,
        batchId: input.batchId,
        type: 'sale',
        qtyDelta: -Math.trunc(input.qty),
        reason: `Sold: ${input.item}`,
        sourceType: 'sale',
        sourceId: sale.id,
        actor: input.actor ?? '',
      })
    }

    return sale
  })
}

export type TrialBalanceRow = {
  accountId: string
  code: string
  name: string
  class: string
  normalBalance: string
  debitCents: number
  creditCents: number
  balanceCents: number
}

export type TrialBalance = {
  rows: TrialBalanceRow[]
  totalDebitsCents: number
  totalCreditsCents: number
  balanced: boolean
}

// GET /api/gl/trial-balance's query: sum journal_lines (debit, credit) per
// account, scoped to one tenant's journal_entries, joined against the full
// (global) chart of accounts so every account appears even with a zero
// balance. `balance` is signed by the account's normal-balance side (a
// debit-normal account's balance is debit-minus-credit; a credit-normal
// account's is credit-minus-debit) — the conventional trial-balance
// presentation.
export async function computeTrialBalance(tenantId: string): Promise<TrialBalance> {
  await ensureAccountsSeeded()

  const allAccounts = await db.select().from(accounts).orderBy(accounts.code)

  const entries = await db
    .select({ id: journalEntries.id })
    .from(journalEntries)
    .where(eq(journalEntries.tenantId, tenantId))
  const entryIds = entries.map((e) => e.id)

  const lines = entryIds.length > 0
    ? await db.select().from(journalLines).where(inArray(journalLines.entryId, entryIds))
    : []

  const sums = new Map<string, { debitCents: number; creditCents: number }>()
  for (const line of lines) {
    const cur = sums.get(line.accountId) ?? { debitCents: 0, creditCents: 0 }
    cur.debitCents += line.debitCents
    cur.creditCents += line.creditCents
    sums.set(line.accountId, cur)
  }

  const rows: TrialBalanceRow[] = allAccounts.map((a) => {
    const s = sums.get(a.id) ?? { debitCents: 0, creditCents: 0 }
    const balanceCents = a.normalBalance === 'CREDIT' ? s.creditCents - s.debitCents : s.debitCents - s.creditCents
    return {
      accountId: a.id,
      code: a.code,
      name: a.name,
      class: a.class,
      normalBalance: a.normalBalance,
      debitCents: s.debitCents,
      creditCents: s.creditCents,
      balanceCents,
    }
  })

  const totalDebitsCents = rows.reduce((sum, r) => sum + r.debitCents, 0)
  const totalCreditsCents = rows.reduce((sum, r) => sum + r.creditCents, 0)

  return { rows, totalDebitsCents, totalCreditsCents, balanced: totalDebitsCents === totalCreditsCents }
}

// GET /api/data/sales' list query.
// `batchIds` (farm-scoped-data task): when provided, restricts to sales
// whose batchId is in this list — the caller (GET /api/data/sales) resolves
// it from a farmId via lib/farm-scope.ts's batchIdsForFarm (sales has no
// farm_id of its own; batchId -> batches.unitId -> production_units.farmId
// is the join). `undefined` means unfiltered, matching every call site that
// predates this parameter. An explicit `[]` (farm has no batches) returns no
// rows — the caller is expected to short-circuit before calling with `[]`
// the same way GET /api/batches does, but this stays correct either way.
export async function listSales(tenantId: string, batchIds?: string[]) {
  const conditions = [eq(sales.tenantId, tenantId)]
  if (batchIds) conditions.push(inArray(sales.batchId, batchIds))
  return db.select().from(sales).where(and(...conditions)).orderBy(desc(sales.soldAt), desc(sales.id))
}

export { sales, purchases }
