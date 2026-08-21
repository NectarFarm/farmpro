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
} as const

// The standard farm chart of accounts this issue seeds — see
// db/schemas/finance.ts's top-of-file comment for why each account exists
// (and why there is no payroll account).
const STANDARD_ACCOUNTS: { code: string; name: string; class: string; normalBalance: string }[] = [
  { code: ACCOUNT_CODES.CASH, name: 'Cash and Bank', class: 'ASSET', normalBalance: 'DEBIT' },
  { code: ACCOUNT_CODES.ACCOUNTS_RECEIVABLE, name: 'Accounts Receivable', class: 'ASSET', normalBalance: 'DEBIT' },
  { code: ACCOUNT_CODES.ACCOUNTS_PAYABLE, name: 'Accounts Payable', class: 'LIABILITY', normalBalance: 'CREDIT' },
  { code: ACCOUNT_CODES.OWNERS_EQUITY, name: "Owner's Equity", class: 'EQUITY', normalBalance: 'CREDIT' },
  { code: ACCOUNT_CODES.SALES_REVENUE, name: 'Sales Revenue', class: 'REVENUE', normalBalance: 'CREDIT' },
  { code: ACCOUNT_CODES.PURCHASES_EXPENSE, name: 'Purchases Expense', class: 'EXPENSE', normalBalance: 'DEBIT' },
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
export async function postSaleJournal(tx: Tx, sale: { id: string; tenantId: string; amount: number; status: string }) {
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
    { id: randomUUID(), entryId: entry.id, accountId: debitAccountId, debit: sale.amount, credit: 0 },
    { id: randomUUID(), entryId: entry.id, accountId: revenueAccountId, debit: 0, credit: sale.amount },
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
// ── Unit normalization (issue #290) ─────────────────────────────────────────
// `purchases.totalCostCents`/`amountPaidCents` are minor-unit (cents) figures
// while `sales.amount` (postSaleJournal, above) is a plain whole-currency-unit
// figure — both post into the same journal_lines ledger, so one side has to
// convert or the trial balance is wrong by ~100x on whichever side didn't.
// Converting cents -> whole units here (rather than converting sales.amount
// -> cents in postSaleJournal) matches the convention lib/reports.ts's OWN
// computation already established for this exact pair of columns:
// computePlReport takes `periodExpense`/its exported `rows` by dividing
// `purchases.totalCostCents` by 100 and leaving `sales.amount` untouched (see
// lib/reports.ts's "Known unit caveat" comment on computePlReport), and
// components/farm/finance.tsx's purchases-list display does the same
// (`p.totalCostCents / 100`). Posting purchases into the ledger in whole
// units — instead of posting sales in cents — keeps the GL convention
// consistent with every other consumer of these two columns instead of
// introducing a second, conflicting normalization. The division happens once,
// on the clamped total/paid cents figures, and `owed` is derived from the
// already-rounded totals (not rounded independently), so the entry still
// balances by construction even when totalCostCents isn't an exact multiple
// of 100.
export async function postPurchaseJournal(
  tx: Tx,
  purchase: { id: string; tenantId: string; totalCostCents: number; amountPaidCents: number }
) {
  await ensureAccountsSeeded(tx)
  const expenseAccountId = await accountIdByCode(tx, ACCOUNT_CODES.PURCHASES_EXPENSE)
  const totalCents = Math.max(0, purchase.totalCostCents)
  const paidCents = Math.min(Math.max(0, purchase.amountPaidCents), totalCents)
  const total = Math.round(totalCents / 100)
  const paid = Math.round(paidCents / 100)
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
    { id: randomUUID(), entryId: entry.id, accountId: expenseAccountId, debit: total, credit: 0 },
  ]
  if (paid > 0) {
    const cashAccountId = await accountIdByCode(tx, ACCOUNT_CODES.CASH)
    lines.push({ id: randomUUID(), entryId: entry.id, accountId: cashAccountId, debit: 0, credit: paid })
  }
  if (owed > 0) {
    const apAccountId = await accountIdByCode(tx, ACCOUNT_CODES.ACCOUNTS_PAYABLE)
    lines.push({ id: randomUUID(), entryId: entry.id, accountId: apAccountId, debit: 0, credit: owed })
  }
  await tx.insert(journalLines).values(lines)

  return entry
}

// POST /api/data/sales' transaction: insert the sale row, then post its
// journal entry in the same transaction — a sale can never exist without its
// journal entry, or vice versa (same shape as lib/inventory.ts's
// recordPurchase).
export async function recordSale(input: {
  tenantId: string
  batchId?: string | null
  item: string
  amount: number
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
        item: input.item,
        amount: input.amount,
        method: input.method ?? '',
        status: input.status ?? 'paid',
        soldAt: input.soldAt ?? new Date(),
      })
      .returning()

    await postSaleJournal(tx, sale)

    return sale
  })
}

export type TrialBalanceRow = {
  accountId: string
  code: string
  name: string
  class: string
  normalBalance: string
  debit: number
  credit: number
  balance: number
}

export type TrialBalance = {
  rows: TrialBalanceRow[]
  totalDebits: number
  totalCredits: number
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

  const sums = new Map<string, { debit: number; credit: number }>()
  for (const line of lines) {
    const cur = sums.get(line.accountId) ?? { debit: 0, credit: 0 }
    cur.debit += line.debit
    cur.credit += line.credit
    sums.set(line.accountId, cur)
  }

  const rows: TrialBalanceRow[] = allAccounts.map((a) => {
    const s = sums.get(a.id) ?? { debit: 0, credit: 0 }
    const balance = a.normalBalance === 'CREDIT' ? s.credit - s.debit : s.debit - s.credit
    return {
      accountId: a.id,
      code: a.code,
      name: a.name,
      class: a.class,
      normalBalance: a.normalBalance,
      debit: s.debit,
      credit: s.credit,
      balance,
    }
  })

  const totalDebits = rows.reduce((sum, r) => sum + r.debit, 0)
  const totalCredits = rows.reduce((sum, r) => sum + r.credit, 0)

  return { rows, totalDebits, totalCredits, balanced: totalDebits === totalCredits }
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
