// ── Price maths (pure-function unit tests) ──────────────────────────────────
import { describe, it, expect } from 'vitest'
import { computeQuote, discountAmountCents, planPriceCents, validateDiscount, type DiscountLike } from '@/lib/billing/pricing'

const PRICES = { monthly: 3000000, quarterly: 8100000, annual: 28800000 }

function discount(overrides: Partial<DiscountLike> = {}): DiscountLike {
  return {
    kind: 'percent',
    value: 10,
    appliesToPlans: null,
    appliesToPeriods: null,
    tenantId: null,
    validFrom: null,
    validUntil: null,
    maxRedemptions: null,
    redemptions: 0,
    isActive: true,
    ...overrides,
  }
}

const NOW = new Date('2026-01-15T00:00:00Z')
const ctx = { planId: 'plan-1', period: 'monthly' as const, tenantId: 'tenant-1', now: NOW }

describe('planPriceCents', () => {
  it('returns the price for a period the plan sells', () => {
    expect(planPriceCents(PRICES, 'monthly')).toBe(3000000)
  })
  it('returns null for a period the plan does not sell', () => {
    expect(planPriceCents({ monthly: 100 }, 'annual')).toBeNull()
  })
})

describe('discountAmountCents', () => {
  it('percent: rounds to the nearest cent', () => {
    expect(discountAmountCents(3000000, { kind: 'percent', value: 10 })).toBe(300000)
    expect(discountAmountCents(999, { kind: 'percent', value: 33 })).toBe(330) // 329.67 -> 330
  })
  it('fixed: the flat amount, never more than the list price', () => {
    expect(discountAmountCents(3000000, { kind: 'fixed', value: 500000 })).toBe(500000)
    expect(discountAmountCents(300000, { kind: 'fixed', value: 500000 })).toBe(300000) // capped
  })
  it('never negative even for a bogus negative value', () => {
    expect(discountAmountCents(3000000, { kind: 'fixed', value: -100 })).toBe(0)
  })
})

describe('validateDiscount', () => {
  it('accepts a plain always-on discount', () => {
    expect(validateDiscount(discount(), ctx)).toEqual({ ok: true })
  })
  it('rejects an inactive discount', () => {
    expect(validateDiscount(discount({ isActive: false }), ctx).ok).toBe(false)
  })
  it('rejects before validFrom', () => {
    const d = discount({ validFrom: new Date('2026-02-01') })
    expect(validateDiscount(d, ctx).ok).toBe(false)
  })
  it('rejects after validUntil', () => {
    const d = discount({ validUntil: new Date('2026-01-01') })
    expect(validateDiscount(d, ctx).ok).toBe(false)
  })
  it('rejects once maxRedemptions is reached', () => {
    const d = discount({ maxRedemptions: 5, redemptions: 5 })
    expect(validateDiscount(d, ctx).ok).toBe(false)
  })
  it('accepts right up to (not including) maxRedemptions', () => {
    const d = discount({ maxRedemptions: 5, redemptions: 4 })
    expect(validateDiscount(d, ctx).ok).toBe(true)
  })
  it('rejects a plan not in appliesToPlans', () => {
    const d = discount({ appliesToPlans: ['other-plan'] })
    expect(validateDiscount(d, ctx).ok).toBe(false)
  })
  it('null appliesToPlans means every plan is fine', () => {
    const d = discount({ appliesToPlans: null })
    expect(validateDiscount(d, ctx).ok).toBe(true)
  })
  it('rejects a period not in appliesToPeriods', () => {
    const d = discount({ appliesToPeriods: ['annual'] })
    expect(validateDiscount(d, ctx).ok).toBe(false)
  })
  it('rejects a discount targeted at a different tenant', () => {
    const d = discount({ tenantId: 'someone-else' })
    expect(validateDiscount(d, ctx).ok).toBe(false)
  })
  it('accepts a discount targeted at exactly this tenant', () => {
    const d = discount({ tenantId: 'tenant-1' })
    expect(validateDiscount(d, ctx).ok).toBe(true)
  })
})

describe('computeQuote', () => {
  it('no discount: amount due equals list price', () => {
    const result = computeQuote(PRICES, 'monthly')
    expect(result).toEqual({ ok: true, quote: { listPriceCents: 3000000, discountAmountCents: 0, amountDueCents: 3000000 } })
  })
  it('fails cleanly for a period the plan does not sell', () => {
    const result = computeQuote({ monthly: 100 }, 'annual')
    expect(result.ok).toBe(false)
  })
  it('applies a valid percent discount', () => {
    const result = computeQuote(PRICES, 'monthly', { discount: discount({ value: 10 }), ctx })
    expect(result).toEqual({
      ok: true,
      quote: { listPriceCents: 3000000, discountAmountCents: 300000, amountDueCents: 2700000 },
    })
  })
  it('a 100% discount never goes negative — floors at zero', () => {
    const result = computeQuote(PRICES, 'monthly', { discount: discount({ kind: 'percent', value: 150 }), ctx })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.quote.amountDueCents).toBe(0)
  })
  it('an invalid discount fails the whole quote with a clear error, not a silent full-price fallback', () => {
    const result = computeQuote(PRICES, 'monthly', { discount: discount({ isActive: false }), ctx })
    expect(result.ok).toBe(false)
  })
})
