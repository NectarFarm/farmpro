// ── Billing period arithmetic (pure) ────────────────────────────────────────
import type { PlanPeriod } from './pricing'

const MONTHS_PER_PERIOD: Record<PlanPeriod, number> = { monthly: 1, quarterly: 3, annual: 12 }

/**
 * `from` plus one billing period, using calendar months (not a fixed day
 * count) so a monthly subscription started on the 31st renews sensibly in
 * shorter months — `Date.setMonth` already clamps to the last valid day of
 * the resulting month rather than overflowing into the next one twice.
 */
export function addPeriod(from: Date, period: PlanPeriod): Date {
  const result = new Date(from.getTime())
  result.setMonth(result.getMonth() + MONTHS_PER_PERIOD[period])
  return result
}
