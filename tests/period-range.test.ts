// ── Budget Overview period toggle: date-range math (issue #299) ────────────
// Pure unit tests for lib/period-range.ts — no DB, so this always runs (even
// in CI, which has no database — see tests/finance.test.ts's top comment for
// that convention). Pins `now` explicitly per test rather than relying on the
// real clock, so the assertions are correct no matter what day this runs.
//
// Dates are built with the local `new Date(y, monthIndex0, day, ...)`
// constructor (not an ISO "...Z" string) — periodDateRange reads
// getFullYear/getMonth/getDate (local time, matching a browser's real clock
// for finance.tsx), so a UTC-string literal would shift a day in any test
// runner not in UTC.
import { describe, it, expect } from 'vitest'
import { periodDateRange, BUDGET_PERIODS } from '@/lib/period-range'

describe('periodDateRange (issue #299)', () => {
  const now = new Date(2026, 7, 15, 12, 0, 0) // Aug 15, 2026, local time

  it('lists exactly month, quarter, ytd — the three toggle options', () => {
    expect(BUDGET_PERIODS).toEqual(['month', 'quarter', 'ytd'])
  })

  it('"month" spans the 1st of the current month through today', () => {
    const r = periodDateRange('month', now)
    expect(r.from).toBe('2026-08-01')
    expect(r.to).toBe('2026-08-15')
    expect(r.label).toBe('August 2026')
  })

  it('"quarter" spans the 1st of the current quarter through today', () => {
    const r = periodDateRange('quarter', now)
    expect(r.from).toBe('2026-07-01') // Q3 starts July
    expect(r.to).toBe('2026-08-15')
    expect(r.label).toBe('Q3 2026')
  })

  it('"ytd" spans Jan 1 of the current year through today', () => {
    const r = periodDateRange('ytd', now)
    expect(r.from).toBe('2026-01-01')
    expect(r.to).toBe('2026-08-15')
    expect(r.label).toBe('YTD 2026')
  })

  it('picks the correct quarter start for each month of the year', () => {
    expect(periodDateRange('quarter', new Date(2026, 0, 20)).from).toBe('2026-01-01')
    expect(periodDateRange('quarter', new Date(2026, 2, 31)).from).toBe('2026-01-01')
    expect(periodDateRange('quarter', new Date(2026, 3, 1)).from).toBe('2026-04-01')
    expect(periodDateRange('quarter', new Date(2026, 5, 30)).from).toBe('2026-04-01')
    expect(periodDateRange('quarter', new Date(2026, 9, 5)).from).toBe('2026-10-01')
    expect(periodDateRange('quarter', new Date(2026, 11, 31)).from).toBe('2026-10-01')
  })
})
