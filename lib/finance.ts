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
import { accounts, journalEntries, journalLines, sales, purchases } from '@/db/schemas'
import { applyMovement } from '@/lib/batch-ledger'

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
export async function postSaleJournal(tx: Tx, sale: { id: string; tenantId: string; amountCents: number; status: string }) {
  await ensureAccountsSeeded(tx)
  const debitAccountId = await accountIdByCode(tx, sale.status === 'pending' ? ACCOUNT_CODES.ACCOUNTS_RECEIVABLE : ACCOUNT_CODES.CASH)
  const revenueAccountId = await accountIdByCode(tx, ACCOUNT_CODES.SALES_REVENUE)

  const [entry] = await tx
    .insert(journalEntries)
    .values({
      id: randomUUID(),
      tenantId: sale.tenantId,
      sourceType: 'sale',
      sourceId: sale.id,
      memo: sale.status === 'pending' ? 'Sale recorded on account' : 'Cash sale recorded',
    })
    .returning()

  await tx.insert(journalLines).values([
    { id: randomUUID(), entryId: entry.id, accountId: debitAccountId, debitCents: sale.amountCents, creditCents: 0 },
    { id: randomUUID(), entryId: entry.id, accountId: revenueAccountId, debitCents: 0, creditCents: sale.amountCents },
  ])

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
  purchase: { id: string; tenantId: string; totalCostCents: number; amountPaidCents: number }
) {
  await ensureAccountsSeeded(tx)
  const expenseAccountId = await accountIdByCode(tx, ACCOUNT_CODES.PURCHASES_EXPENSE)
  const total = Math.max(0, purchase.totalCostCents)
  const paid = Math.min(Math.max(0, purchase.amountPaidCents), total)
  const owed = total - paid

  const [entry] = await tx
    .insert(journalEntries)
    .values({
      id: randomUUID(),
      tenantId: purchase.tenantId,
      sourceType: 'purchase',
      sourceId: purchase.id,
      memo: owed > 0 ? (paid > 0 ? 'Purchase recorded, partially paid' : 'Purchase recorded on account') : 'Purchase recorded, paid in full',
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
  await tx.insert(journalLines).values(lines)

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
  run: { id: string; tenantId: string; totalAmountCents: number; periodStart: Date; periodEnd: Date }
) {
  await ensureAccountsSeeded(tx)
  const expenseAccountId = await accountIdByCode(tx, ACCOUNT_CODES.PAYROLL_EXPENSE)
  const cashAccountId = await accountIdByCode(tx, ACCOUNT_CODES.CASH)

  const [entry] = await tx
    .insert(journalEntries)
    .values({
      id: randomUUID(),
      tenantId: run.tenantId,
      sourceType: 'payroll_run',
      sourceId: run.id,
      memo: `Payroll run ${run.periodStart.toISOString().slice(0, 10)} to ${run.periodEnd.toISOString().slice(0, 10)}`,
    })
    .returning()

  // Zero-amount entries would balance trivially but carry no information —
  // the route this is called from already refuses to create a run with no
  // eligible (rate > 0) employees, so `totalAmountCents` is always > 0 here.
  await tx.insert(journalLines).values([
    { id: randomUUID(), entryId: entry.id, accountId: expenseAccountId, debitCents: run.totalAmountCents, creditCents: 0 },
    { id: randomUUID(), entryId: entry.id, accountId: cashAccountId, debitCents: 0, creditCents: run.totalAmountCents },
  ])

  return entry
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
}) {
  return db.transaction(async (tx) => {
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
        soldAt: input.soldAt ?? new Date(),
      })
      .returning()

    await postSaleJournal(tx, sale)

    // ── Selling livestock takes it off the batch (batch-ledger task) ───────
    // Only when the product says it should. A sale of eggs leaves the hens
    // where they are; a sale of twenty birds must not. The product's
    // stockEffect is what distinguishes them, and without a quantity there
    // is nothing to subtract — so both have to be present before the
    // headcount moves, in this same transaction as the sale itself.
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
