// ── Budget Overview period toggle (issue #299) ──────────────────────────────
// Pure date-range math for the Month/Quarter/YTD toggle restored in
// components/farm/finance.tsx's Budget Overview tab. The toggle existed in
// the original Happy Seeds design (commit 80ab7db) but was silently dropped
// during the issue #240 real-data wiring, with the header hardcoded to
// "All-time" and no `period` state at all.
//
// Kept as a standalone pure function (not inline in the component) so the
// date-range math is unit-testable without a browser/DOM environment — see
// tests/period-range.test.ts. No `server-only` import: this needs to run
// client-side (finance.tsx computes `from`/`to` before calling
// GET /api/reports/pl) as well as in the plain-node vitest environment.
//
// Each period runs from its natural start (1st of the month / 1st of the
// quarter / Jan 1) through `now` — it never reaches into the future, unlike
// the original static mock's fixed "August 2026" / "Q3 2026" labels, which
// are replaced here with labels computed off the real current date.
export type BudgetPeriod = 'month' | 'quarter' | 'ytd'

export const BUDGET_PERIODS: readonly BudgetPeriod[] = ['month', 'quarter', 'ytd']

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

function isoDate(year: number, monthIndex0: number, day: number): string {
  return `${String(year).padStart(4, '0')}-${String(monthIndex0 + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

export interface PeriodRange {
  from: string
  to: string
  label: string
}

export function periodDateRange(period: BudgetPeriod, now: Date = new Date()): PeriodRange {
  const year = now.getFullYear()
  const month = now.getMonth()
  const to = isoDate(year, month, now.getDate())

  if (period === 'month') {
    return { from: isoDate(year, month, 1), to, label: `${MONTH_NAMES[month]} ${year}` }
  }
  if (period === 'quarter') {
    const quarterStartMonth = Math.floor(month / 3) * 3
    const quarterNumber = Math.floor(month / 3) + 1
    return { from: isoDate(year, quarterStartMonth, 1), to, label: `Q${quarterNumber} ${year}` }
  }
  // ytd
  return { from: isoDate(year, 0, 1), to, label: `YTD ${year}` }
}
