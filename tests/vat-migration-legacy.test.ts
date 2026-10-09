// Issue #419: every sale, purchase and expense that exists today predates VAT.
// This builds a scratch database at the schema of migration 0053, seeds
// older documents with their journal entries, records the books, applies
// 0054_vat.sql, and requires the reported figures to be identical and every
// old row to still read with no tax code. The scratch database is dropped.
import { describe, it, expect, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'

vi.mock('server-only', () => ({}))

const baseUrl = process.env.DATABASE_URL
const run = baseUrl ? describe : describe.skip

run('pre-VAT rows across the VAT migration', () => {
  it('moves no reported figure and leaves every old row untaxed', async () => {
    const admin = postgres(baseUrl as string, { max: 1, onnotice: () => {} })
    const name = `vat_scratch_${randomUUID().replace(/-/g, '').slice(0, 12)}`
    const scratchUrl = (() => { const u = new URL(baseUrl as string); u.pathname = `/${name}`; return u.toString() })()
    const tmp = mkdtempSync(join(tmpdir(), 'vat-old-'))
    let scratch: ReturnType<typeof postgres> | null = null
    try {
      await admin.unsafe(`CREATE DATABASE ${name}`)

      // Migrations 0000..0053 only.
      const journal = JSON.parse(readFileSync(join(process.cwd(), 'drizzle/meta/_journal.json'), 'utf8'))
      const kept = journal.entries.filter((e: { idx: number }) => e.idx <= 53)
      mkdirSync(join(tmp, 'meta'))
      writeFileSync(join(tmp, 'meta/_journal.json'), JSON.stringify({ ...journal, entries: kept }))
      for (const f of readdirSync(join(process.cwd(), 'drizzle'))) {
        if (f.endsWith('.sql') && !f.startsWith('0054_')) cpSync(join(process.cwd(), 'drizzle', f), join(tmp, f))
      }
      scratch = postgres(scratchUrl, { max: 1, onnotice: () => {} })
      await migrate(drizzle(scratch), { migrationsFolder: tmp })
      const cols = await scratch`select column_name from information_schema.columns where table_name = 'sales' and column_name = 'tax_code'`
      expect(cols).toHaveLength(0)

      // Books: a paid sale, a credit sale, a part-paid purchase, an expense.
      const t = `old-${randomUUID()}`
      await scratch`insert into tenants (id, name) values (${t}, 'Old Co')`
      await scratch`insert into accounts (id, code, name, class, normal_balance) values
        (${randomUUID()}, '1001', 'Cash', 'ASSET', 'DEBIT'), (${randomUUID()}, '1002', 'AR', 'ASSET', 'DEBIT'),
        (${randomUUID()}, '2001', 'AP', 'LIABILITY', 'CREDIT'), (${randomUUID()}, '4001', 'Sales', 'REVENUE', 'CREDIT'),
        (${randomUUID()}, '5001', 'Purchases', 'EXPENSE', 'DEBIT'), (${randomUUID()}, '5010', 'Transport', 'EXPENSE', 'DEBIT'),
        (${randomUUID()}, '5002', 'Payroll', 'EXPENSE', 'DEBIT')
        on conflict (code) do nothing`
      const acct = async (code: string) => (await scratch!`select id from accounts where code = ${code}`)[0].id as string
      const march = '2026-03-10T00:00:00.000Z'
      async function post(sourceType: string, sourceId: string, lines: [string, number, number][]) {
        const entryId = randomUUID()
        await scratch!`insert into journal_entries (id, tenant_id, source_type, source_id, entry_date) values (${entryId}, ${t}, ${sourceType}, ${sourceId}, ${march})`
        for (const [code, dr, cr] of lines) {
          await scratch!`insert into journal_lines (id, entry_id, account_id, debit_cents, credit_cents) values (${randomUUID()}, ${entryId}, ${await acct(code)}, ${dr}, ${cr})`
        }
      }
      const s1 = randomUUID(); const s2 = randomUUID(); const p1 = randomUUID(); const e1 = randomUUID()
      await scratch`insert into sales (id, tenant_id, item, amount_cents, status, posting_date, sold_at) values (${s1}, ${t}, 'Eggs', 500000, 'paid', ${march}, ${march})`
      await post('sale', s1, [['1001', 500000, 0], ['4001', 0, 500000]])
      await scratch`insert into sales (id, tenant_id, item, amount_cents, status, posting_date, sold_at) values (${s2}, ${t}, 'Broilers', 123457, 'pending', ${march}, ${march})`
      await post('sale', s2, [['1002', 123457, 0], ['4001', 0, 123457]])
      const item = randomUUID()
      await scratch`insert into inventory_items (id, tenant_id, name, unit) values (${item}, ${t}, 'Mash', 'kg')`
      await scratch`insert into purchases (id, tenant_id, supplier, item_id, quantity, unit_cost_cents, total_cost_cents, amount_paid_cents, posting_date, created_at) values (${p1}, ${t}, 'Mill', ${item}, 4, 2500, 10000, 5000, ${march}, ${march})`
      await post('purchase', p1, [['5001', 10000, 0], ['1001', 0, 5000], ['2001', 0, 5000]])
      const cat = randomUUID()
      await scratch`insert into expense_categories (id, code, name, account_code) values (${cat}, ${'old-' + cat.slice(0, 6)}, 'Transport', '5010')`
      await scratch`insert into expenses (id, tenant_id, payee, category_id, amount_cents, amount_paid_cents, posting_date) values (${e1}, ${t}, 'Matatu', ${cat}, 25000, 25000, ${march})`
      await post('expense', e1, [['5010', 25000, 0], ['1001', 0, 25000]])
      // A payroll run recorded before the payroll migration (no status).
      const r1 = randomUUID()
      const user = randomUUID()
      await scratch`insert into payroll_runs (id, tenant_id, period_start, period_end, total_amount_cents, employee_count, created_by_user_id, memo) values (${r1}, ${t}, '2026-03-01T00:00:00.000Z', '2026-03-31T00:00:00.000Z', 300000, 1, ${user}, 'March')`
      await post('payroll_run', r1, [['5002', 300000, 0], ['1001', 0, 300000]])

      const figures = async () => {
        const lines = await scratch!`select a.code, sum(l.debit_cents)::bigint as dr, sum(l.credit_cents)::bigint as cr
          from journal_lines l join journal_entries e on e.id = l.entry_id join accounts a on a.id = l.account_id
          where e.tenant_id = ${t} group by a.code order by a.code`
        return lines.map((r) => `${r.code}:${r.dr}:${r.cr}`)
      }
      const before = await figures()

      // 0054 is the migration under test; every later one is applied after it
      // so the app's current schema can read the scratch database. None of
      // them may move a figure either.
      const later = readdirSync(join(process.cwd(), 'drizzle'))
        .filter((f) => /^\d{4}_.*\.sql$/.test(f) && f >= '0054_')
        .sort()
      for (const file of later) {
        await scratch.unsafe(readFileSync(join(process.cwd(), 'drizzle', file), 'utf8').split('--> statement-breakpoint').join('\n'))
        expect(await figures()).toEqual(before)
      }

      // The app's own reports, pointed at the migrated scratch database.
      process.env.DATABASE_URL = scratchUrl
      vi.resetModules()
      const { computePlReport } = await import('@/lib/reports')
      const { computeTrialBalance } = await import('@/lib/finance')
      const pl = await computePlReport(t, new Date('2026-03-01T00:00:00.000Z'), new Date('2026-03-31T23:59:59.999Z'))
      expect(pl.meta.periodRevenue).toBe((500000 + 123457) / 100)
      expect(pl.meta.periodPurchaseExpense).toBe(10000 / 100)
      expect(pl.meta.periodOperatingExpense).toBe(25000 / 100)
      expect(pl.meta.periodExpense).toBe((10000 + 300000 + 25000) / 100)
      const tb = await computeTrialBalance(t)
      expect(tb.balanced).toBe(true)
      const tbFigures = tb.rows
        .filter((r) => r.debitCents !== 0 || r.creditCents !== 0)
        .map((r) => `${r.code}:${r.debitCents}:${r.creditCents}`)
      expect(tbFigures).toEqual(before)
      expect(tb.rows.find((r) => r.code === '1300')?.balanceCents ?? 0).toBe(0)
      expect(tb.rows.find((r) => r.code === '2300')?.balanceCents ?? 0).toBe(0)

      const untaxed = await scratch`select
        (select count(*) from sales where tenant_id = ${t} and (tax_code is not null or tax_cents is not null or net_cents is not null or gross_cents is not null)) +
        (select count(*) from purchases where tenant_id = ${t} and (tax_code is not null or tax_cents is not null)) +
        (select count(*) from expenses where tenant_id = ${t} and (tax_code is not null or tax_cents is not null)) as n`
      expect(Number(untaxed[0].n)).toBe(0)
    } finally {
      await scratch?.end({ timeout: 2 })
      await admin.unsafe(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`)
      await admin.end({ timeout: 2 })
      rmSync(tmp, { recursive: true, force: true })
      process.env.DATABASE_URL = baseUrl
    }
  }, 120000)
})
