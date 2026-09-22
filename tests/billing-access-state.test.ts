// ── Subscription access-state (pure-function unit tests) ───────────────────
import { describe, it, expect } from 'vitest'
import { computeAccessState, effectiveStatus, type SubscriptionSnapshot } from '@/lib/billing/access-state'

const NOW = new Date('2026-06-15T00:00:00Z')
const DAY = 24 * 60 * 60 * 1000

function sub(overrides: Partial<SubscriptionSnapshot> = {}): SubscriptionSnapshot {
  return {
    status: 'active',
    trialEndsAt: null,
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
    ...overrides,
  }
}

describe('computeAccessState', () => {
  it('no subscription at all -> needsPlan', () => {
    expect(computeAccessState(null, NOW)).toEqual({ status: 'none', needsPlan: true })
  })

  it('an active subscription with no end date never needsPlan (the legacy backfill case)', () => {
    expect(computeAccessState(sub({ status: 'active', currentPeriodEnd: null }), NOW)).toEqual({
      status: 'active',
      needsPlan: false,
    })
  })

  it('trialing, still within the trial window -> not needsPlan', () => {
    const s = sub({ status: 'trialing', trialEndsAt: new Date(NOW.getTime() + DAY) })
    expect(computeAccessState(s, NOW)).toEqual({ status: 'trialing', needsPlan: false })
  })

  it('trialing, trial just ended -> past_due, still within grace -> not needsPlan', () => {
    const s = sub({ status: 'trialing', trialEndsAt: new Date(NOW.getTime() - DAY) })
    expect(computeAccessState(s, NOW)).toEqual({ status: 'past_due', needsPlan: false })
  })

  it('trialing, trial ended more than 7 days ago with no payment -> expired -> needsPlan', () => {
    const s = sub({ status: 'trialing', trialEndsAt: new Date(NOW.getTime() - 8 * DAY) })
    expect(computeAccessState(s, NOW)).toEqual({ status: 'expired', needsPlan: true })
  })

  it('active, period ended, no cancel request -> past_due (payment lapsed), within grace -> not needsPlan', () => {
    const s = sub({ status: 'active', currentPeriodEnd: new Date(NOW.getTime() - DAY) })
    expect(computeAccessState(s, NOW)).toEqual({ status: 'past_due', needsPlan: false })
  })

  it('active, period ended more than 7 days ago, no cancel request -> expired -> needsPlan', () => {
    const s = sub({ status: 'active', currentPeriodEnd: new Date(NOW.getTime() - 8 * DAY) })
    expect(computeAccessState(s, NOW)).toEqual({ status: 'expired', needsPlan: true })
  })

  it('active with cancelAtPeriodEnd, period NOT yet ended -> still active, not needsPlan', () => {
    const s = sub({ status: 'active', currentPeriodEnd: new Date(NOW.getTime() + DAY), cancelAtPeriodEnd: true })
    expect(computeAccessState(s, NOW)).toEqual({ status: 'active', needsPlan: false })
  })

  it('active with cancelAtPeriodEnd, period ended -> cancelled immediately (no grace) -> needsPlan', () => {
    const s = sub({ status: 'active', currentPeriodEnd: new Date(NOW.getTime() - DAY), cancelAtPeriodEnd: true })
    expect(computeAccessState(s, NOW)).toEqual({ status: 'cancelled', needsPlan: true })
  })

  it('pending_payment (never paid at all) -> needsPlan immediately', () => {
    expect(computeAccessState(sub({ status: 'pending_payment' }), NOW)).toEqual({
      status: 'pending_payment',
      needsPlan: true,
    })
  })

  it('already expired stays expired -> needsPlan', () => {
    expect(computeAccessState(sub({ status: 'expired' }), NOW)).toEqual({ status: 'expired', needsPlan: true })
  })

  it('already cancelled stays cancelled -> needsPlan', () => {
    expect(computeAccessState(sub({ status: 'cancelled' }), NOW)).toEqual({ status: 'cancelled', needsPlan: true })
  })
})

describe('effectiveStatus edge: exactly at the grace boundary', () => {
  it('exactly 7 days past trial end is still within grace (strictly greater-than triggers expiry)', () => {
    const s = sub({ status: 'trialing', trialEndsAt: new Date(NOW.getTime() - 7 * DAY) })
    expect(effectiveStatus(s, NOW)).toBe('past_due')
  })
})
