// ── Price maths: the ONE place a plan/period/discount becomes an amount due ──
// (SaaS back-office backend). Pure and unit-tested (tests/billing-pricing.test.ts)
// — no DB access here, so every rule about what a discount is worth, and
// when it's even usable, is provable without Postgres. Money is always
// integer minor units (cents), matching lib/money.ts's convention.
//
// Deliberately NOT server-only: these are plain value transforms a test (or,
// later, a client-side quote preview) can call directly.
import type { DiscountKind, PlanPeriod, PlanPrices } from '@/db/schemas'

export type { PlanPeriod, PlanPrices }

/** The list price for one period, or null if the plan doesn't sell that period. */
export function planPriceCents(prices: PlanPrices, period: PlanPeriod): number | null {
  const value = prices[period]
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

export interface DiscountLike {
  kind: DiscountKind
  value: number
  appliesToPlans: readonly string[] | null
  appliesToPeriods: readonly string[] | null
  tenantId: string | null
  validFrom: Date | null
  validUntil: Date | null
  maxRedemptions: number | null
  redemptions: number
  isActive: boolean
}

export interface DiscountContext {
  planId: string
  period: PlanPeriod
  tenantId: string
  now: Date
}

export type DiscountValidation = { ok: true } | { ok: false; error: string }

/**
 * Whether `discount` may be applied to this plan/period/tenant right now.
 * Every check a real coupon system needs, and nothing DB-shaped (redemption
 * counting happens where the row is written, under a transaction — this
 * function only judges the numbers it's handed).
 */
export function validateDiscount(discount: DiscountLike, ctx: DiscountContext): DiscountValidation {
  if (!discount.isActive) return { ok: false, error: 'This discount code is no longer active.' }
  if (discount.validFrom && ctx.now < discount.validFrom) return { ok: false, error: 'This discount code is not active yet.' }
  if (discount.validUntil && ctx.now > discount.validUntil) return { ok: false, error: 'This discount code has expired.' }
  if (discount.maxRedemptions !== null && discount.redemptions >= discount.maxRedemptions) {
    return { ok: false, error: 'This discount code has reached its redemption limit.' }
  }
  if (discount.appliesToPlans && !discount.appliesToPlans.includes(ctx.planId)) {
    return { ok: false, error: 'This discount code does not apply to the selected plan.' }
  }
  if (discount.appliesToPeriods && !discount.appliesToPeriods.includes(ctx.period)) {
    return { ok: false, error: 'This discount code does not apply to the selected billing period.' }
  }
  if (discount.tenantId && discount.tenantId !== ctx.tenantId) {
    return { ok: false, error: 'This discount code is not available for this account.' }
  }
  return { ok: true }
}

/**
 * The discount amount in cents for an ALREADY-VALIDATED discount against a
 * list price. Never negative, never more than the list price itself (a
 * discount can zero out a bill, never make it negative).
 */
export function discountAmountCents(listPriceCents: number, discount: Pick<DiscountLike, 'kind' | 'value'>): number {
  const raw = discount.kind === 'percent' ? Math.round((listPriceCents * discount.value) / 100) : discount.value
  return Math.min(Math.max(0, Math.round(raw)), listPriceCents)
}

export interface QuoteResult {
  listPriceCents: number
  discountAmountCents: number
  amountDueCents: number
}

export type QuoteFailure = { ok: false; error: string }
export type QuoteSuccess = { ok: true; quote: QuoteResult }

/**
 * Full price computation for a plan+period, optionally with a discount code
 * already looked up. Never returns a negative amountDueCents, and rounds to
 * the nearest cent throughout (discountAmountCents already rounds; the final
 * subtraction is exact integer arithmetic on already-rounded cents).
 */
export function computeQuote(
  prices: PlanPrices,
  period: PlanPeriod,
  discount?: { discount: DiscountLike; ctx: DiscountContext }
): QuoteSuccess | QuoteFailure {
  const listPriceCents = planPriceCents(prices, period)
  if (listPriceCents === null) return { ok: false, error: `This plan does not offer a ${period} price.` }

  if (!discount) {
    return { ok: true, quote: { listPriceCents, discountAmountCents: 0, amountDueCents: listPriceCents } }
  }

  const validation = validateDiscount(discount.discount, discount.ctx)
  if (!validation.ok) return { ok: false, error: validation.error }

  const discountCents = discountAmountCents(listPriceCents, discount.discount)
  const amountDueCents = Math.max(0, listPriceCents - discountCents)
  return { ok: true, quote: { listPriceCents, discountAmountCents: discountCents, amountDueCents } }
}
