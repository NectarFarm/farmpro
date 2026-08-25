// ── Server-side input validation ────────────────────────────────────────────
// These cover the three mistakes the hand-rolled checks in the money routes
// kept making, each of which corrupted real data:
//
//   1. `Number.isFinite(Number(x))` is not a number check. Number(null),
//      Number(''), Number([]) and Number(false) are all 0 — finite, and so
//      accepted. That is how PATCH /api/inventory/lots/[id] could be sent
//      `qtyOnHand: null` and silently zero a lot's entire stock, recording
//      `after: 0` in the audit row as though somebody meant it.
//   2. `Math.max(0, ...)` / `Math.trunc(...)` REWRITE bad input instead of
//      refusing it: a negative quantity became 0, and "0.5 bags at 4,000"
//      became a zero-quantity, zero-cost purchase that erased the money paid.
//   3. No upper bound. Quantity columns are Postgres `integer`, so 3e9 was a
//      500 rather than a 400, and money past 2^53 is imprecise before it ever
//      reaches the ledger.
//
// Pure functions, so these run everywhere — no database needed.
import { describe, it, expect } from 'vitest'
import {
  isInvalid, requireCount, requireNonNegativeCount, requireCents,
  requireEventDate, requireFutureAllowedDate, MAX_INT4, MAX_MONEY_CENTS,
} from '@/lib/validate-input'

function problem(v: unknown): string {
  if (typeof v === 'object' && v !== null && 'problem' in v) return String((v as { problem: string }).problem)
  throw new Error(`expected a refusal, got ${JSON.stringify(v)}`)
}

describe('requireCount — a whole, positive, bounded count', () => {
  it('accepts a real positive integer, as a number or a numeric string', () => {
    expect(requireCount(1000, 'quantity')).toBe(1000)
    expect(requireCount('1000', 'quantity')).toBe(1000)
    expect(requireCount(' 42 ', 'quantity')).toBe(42)
  })

  it('refuses the values Number() quietly turns into 0', () => {
    // The exact bug: every one of these passed `Number.isFinite(Number(x))`.
    for (const bad of [null, undefined, '', '   ', [], {}, false, true, NaN, Infinity]) {
      expect(isInvalid(requireCount(bad, 'quantity'))).toBe(true)
    }
  })

  it('refuses a fraction instead of truncating it to zero', () => {
    // "0.5 bags at 4,000" used to store quantity 0 and totalCost 0.
    expect(problem(requireCount(0.5, 'quantity'))).toMatch(/whole number/)
    expect(problem(requireCount('12.5', 'quantity'))).toMatch(/whole number/)
  })

  it('refuses zero and negatives rather than clamping them', () => {
    expect(problem(requireCount(0, 'quantity'))).toMatch(/greater than zero/)
    expect(problem(requireCount(-5, 'quantity'))).toMatch(/greater than zero/)
  })

  it('refuses a value that would overflow the integer column', () => {
    expect(requireCount(MAX_INT4, 'quantity')).toBe(MAX_INT4)
    expect(problem(requireCount(MAX_INT4 + 1, 'quantity'))).toMatch(/too large/)
    expect(problem(requireCount(3e9, 'quantity'))).toMatch(/too large/)
  })

  it('refuses notation that would parse into a number nobody typed', () => {
    // Same reasoning as parseMoneyToCents's regex: '1e5' is not what a user
    // meant to enter, and silently reading it as 100000 is worse than asking.
    expect(isInvalid(requireCount('1e5', 'quantity'))).toBe(true)
    expect(isInvalid(requireCount('12.34.56', 'quantity'))).toBe(true)
    expect(isInvalid(requireCount('1,000', 'quantity'))).toBe(true)
    expect(isInvalid(requireCount('20kg', 'quantity'))).toBe(true)
  })

  it('names the field in its refusal, so a form can point at the right input', () => {
    expect(problem(requireCount(null, 'quantity'))).toMatch(/^quantity/)
    expect(problem(requireCount(null, 'lowStockThreshold'))).toMatch(/^lowStockThreshold/)
  })
})

describe('requireNonNegativeCount — zero is allowed, but has to be asked for', () => {
  it('accepts zero, because a recount can genuinely find nothing left', () => {
    expect(requireNonNegativeCount(0, 'qtyOnHand')).toBe(0)
  })

  it('still refuses null — the stock-wipe bug', () => {
    // PATCH /api/inventory/lots/[id] with `{ qtyOnHand: null }` used to set
    // the lot to 0 and audit it as intentional.
    expect(isInvalid(requireNonNegativeCount(null, 'qtyOnHand'))).toBe(true)
    expect(isInvalid(requireNonNegativeCount('', 'qtyOnHand'))).toBe(true)
    expect(isInvalid(requireNonNegativeCount([], 'qtyOnHand'))).toBe(true)
  })

  it('refuses a negative rather than clamping it to zero', () => {
    expect(problem(requireNonNegativeCount(-500, 'qtyOnHand'))).toMatch(/cannot be negative/)
  })

  it('bounds the top end too', () => {
    expect(problem(requireNonNegativeCount(1e12, 'qtyOnHand'))).toMatch(/too large/)
  })
})

describe('requireCents — money', () => {
  it('accepts zero and positive whole cents', () => {
    expect(requireCents(0, 'unitCostCents')).toBe(0)
    expect(requireCents(480000, 'unitCostCents')).toBe(480000)
  })

  it('refuses a negative amount rather than clamping it', () => {
    expect(problem(requireCents(-50000, 'amountPaidCents'))).toMatch(/cannot be negative/)
  })

  it('refuses fractional cents', () => {
    expect(problem(requireCents(10.5, 'amountCents'))).toMatch(/whole number of cents/)
  })

  it('refuses an amount large enough to lose precision before it reaches the ledger', () => {
    expect(requireCents(MAX_MONEY_CENTS, 'amountCents')).toBe(MAX_MONEY_CENTS)
    expect(problem(requireCents(MAX_MONEY_CENTS + 1, 'amountCents'))).toMatch(/too large/)
  })

  it('keeps the product of two validated operands exactly representable', () => {
    // POST /api/purchases computes totalCostCents as quantity x unitCostCents
    // in plain JS. The two ceilings exist so that product is never silently
    // imprecise; this asserts the arithmetic actually holds.
    const q = MAX_INT4
    const c = requireCents(1000, 'unitCostCents')
    if (isInvalid(c)) throw new Error('unreachable')
    expect(Number.isSafeInteger(q * c)).toBe(true)
  })
})

describe('requireEventDate — something that already happened', () => {
  const now = Date.UTC(2026, 7, 25, 12, 0, 0)

  it('accepts a real past date', () => {
    const d = requireEventDate('2026-08-01', 'soldAt', now)
    expect(isInvalid(d)).toBe(false)
  })

  it('refuses a string that is not a date, instead of producing Invalid Date', () => {
    // `new Date('yesterday')` is an Invalid Date whose .toISOString() throws —
    // recordPurchase called exactly that to build a lot number, so this used
    // to surface as a 500 rather than a 400.
    expect(problem(requireEventDate('yesterday', 'receivedDate', now))).toMatch(/not a date/)
    expect(problem(requireEventDate('', 'receivedDate', now))).toMatch(/must be a date/)
    expect(problem(requireEventDate(null, 'receivedDate', now))).toMatch(/must be a date/)
  })

  it('refuses a future date, which would drop the record out of every P&L period', () => {
    // receivedDate becomes purchases.createdAt, the column lib/reports.ts
    // filters periodExpense on — while the journal entry stays in the trial
    // balance. The two then disagree with nothing to explain why.
    expect(problem(requireEventDate('2027-01-01', 'receivedDate', now))).toMatch(/in the future/)
  })

  it('tolerates a little clock skew rather than refusing "now"', () => {
    const almostNow = new Date(now + 60 * 60 * 1000).toISOString()
    expect(isInvalid(requireEventDate(almostNow, 'soldAt', now))).toBe(false)
  })

  it('refuses a mistyped year', () => {
    expect(problem(requireEventDate('1026-08-01', 'soldAt', now))).toMatch(/mistyped year/)
  })
})

describe('requireFutureAllowedDate — an expiry may be in the past OR the future', () => {
  it('accepts both directions', () => {
    expect(isInvalid(requireFutureAllowedDate('2030-01-01', 'expiryDate'))).toBe(false)
    // Already-expired stock is a real thing to record — a bad delivery, or a
    // purchase entered retroactively — and an expired item showing as
    // expiring is correct behaviour, not corruption.
    expect(isInvalid(requireFutureAllowedDate('2020-01-01', 'expiryDate'))).toBe(false)
  })

  it('still refuses garbage and absurd years', () => {
    expect(problem(requireFutureAllowedDate('soon', 'expiryDate'))).toMatch(/not a date/)
    expect(problem(requireFutureAllowedDate('9999-01-01', 'expiryDate'))).toMatch(/mistyped year/)
  })
})
