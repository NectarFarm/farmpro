// ── Payroll is an expense, and nobody gets paid twice for the same days ─────
// Two bugs the owner hit in one run.
//
// 1. Running payroll did not move the money in the system. POST
//    /api/payroll/runs has always posted a real journal entry (Dr Payroll
//    Expense, Cr Cash — lib/finance.ts#postPayrollJournal), so wages were in
//    the cumulative GL position. But `periodExpense` in lib/reports.ts was
//    built from the `purchases` table alone, so the P&L for a month showed
//    payroll in the all-time GL figure and NOT in that month's expenses or
//    net income. A month's wages appeared to cost nothing.
//
// 2. The only double-pay guard was the unique index on
//    (tenant_id, period_start, period_end), which catches an exact repeat — a
//    double-click. It does not catch an OVERLAPPING period: "1-31 Aug" then
//    "15 Aug-15 Sep" are two different keys, so both inserted and everyone was
//    paid twice for the fortnight they share.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')

describe('lib/reports.ts — payroll counts as an expense', () => {
  const source = read('lib/reports.ts')

  it('no longer builds the period expense from purchases alone', () => {
    expect(source).not.toMatch(
      /const periodExpense = centsToMajor\(periodPurchases\.reduce\(\(s, r\) => s \+ r\.totalCostCents, 0\)\)/
    )
  })

  it('adds payroll runs in range to the period expense', () => {
    expect(source).toMatch(/const periodPayrollExpense = centsToMajor\(periodPayroll\.reduce/)
    expect(source).toMatch(/const periodExpense = periodPurchaseExpense \+ periodPayrollExpense/)
  })

  it('queries payroll runs that overlap the reporting window', () => {
    // A run spanning the period boundary still belongs in it.
    expect(source).toMatch(/gte\(payrollRuns\.periodEnd, from\)/)
    expect(source).toMatch(/lte\(payrollRuns\.periodStart, to\)/)
  })

  it('lists payroll alongside sales and purchases in the transaction rows', () => {
    expect(source).toMatch(/type: 'Payroll'/)
  })

  it('stops captioning the expense figure as purchases only', () => {
    expect(source).not.toMatch(/caption: 'Revenue minus purchases'/)
    expect(source).toMatch(/caption: 'Revenue minus expenses'/)
  })

  it('splits the two kinds of expense in meta, since they behave differently', () => {
    expect(source).toMatch(/periodPurchaseExpense,/)
    expect(source).toMatch(/periodPayrollExpense,/)
  })

  it('says so when a farm filter excludes payroll, rather than omitting it silently', () => {
    // payroll_runs carries no farmId, so attributing wages to one farm would
    // be a guess — but a farm-scoped P&L quietly dropping wages is its own lie.
    expect(source).toMatch(/Payroll is EXCLUDED from this farm-scoped view/)
  })

  it('puts that warning in `basis`, where the notes toggle cannot hide it', () => {
    // Notes became switchable per-tenant. A data-quality caveat is the
    // farmer's to hide; a sentence saying wages are missing from the total
    // changes what the number MEANS, so it must survive the toggle.
    const basisLine = source.slice(source.indexOf('Compiled from recorded sales, purchases and payroll'))
    expect(basisLine.slice(0, 600)).toMatch(/Payroll is EXCLUDED/)
    expect(source).not.toMatch(/notesFor\(pres, \[[\s\S]{0,300}Payroll is EXCLUDED/)
  })
})

describe('POST /api/payroll/runs — no double pay', () => {
  const source = read('app/api/payroll/runs/route.ts')

  it('refuses a period overlapping a run that already exists', () => {
    // Half-open overlap: two ranges overlap when each starts before the other
    // ends.
    expect(source).toMatch(/lt\(payrollRuns\.periodStart, periodEnd\)/)
    expect(source).toMatch(/gt\(payrollRuns\.periodEnd, periodStart\)/)
  })

  it('checks for the clash BEFORE selecting who to pay', () => {
    const overlapAt = source.indexOf('const overlapping =')
    const eligibleAt = source.indexOf('const eligible =')
    expect(overlapAt).toBeGreaterThan(-1)
    expect(overlapAt).toBeLessThan(eligibleAt)
  })

  it('names the clashing period so the message is actionable', () => {
    expect(source).toMatch(/would be paid twice/)
    expect(source).toMatch(/periodStart: 'Overlaps a payroll run that already exists'/)
  })

  it('keeps the exact-duplicate index guard as well', () => {
    // The overlap check is a request-time rule; the unique index is what
    // survives a race between two simultaneous requests.
    expect(source).toMatch(/isUniqueViolation\(err\)/)
  })
})
