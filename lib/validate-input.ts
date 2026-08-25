// ── Server-side field validation, in one place ──────────────────────────────
// Every route in this app hand-rolls its own `Number(...)` / `typeof` checks
// (there is no zod or schema validator anywhere in app/ or lib/), and the
// hand-rolled versions kept making the same three mistakes:
//
//   1. `Number.isFinite(Number(x))` is not a number check. `Number(null)`,
//      `Number('')`, `Number([])` and `Number(false)` are all 0 — finite, and
//      therefore accepted. That is how `PATCH /api/inventory/lots/[id]` could
//      be sent `qtyOnHand: null` and silently zero a lot's entire stock.
//   2. `Math.max(0, ...)` / `Math.trunc(...)` REWRITE bad input instead of
//      refusing it. A negative quantity became 0; `0.5` bags became 0, taking
//      the money paid for them to 0 as well. Clamping is right for a
//      deliberate policy (see lib/batch-ledger.ts's `allowClamp`, which is
//      documented as such) and wrong for input validation, where the honest
//      answer is a 400 telling the user what to fix.
//   3. No upper bound. Every quantity column here is a Postgres `integer`,
//      so 3e9 is not a big number, it is a 500 — and money past 2^53 is
//      arithmetically imprecise before it ever reaches the ledger.
//
// The client-side checks stay where they are; they are the courtesy. These are
// the authority. Anything reachable by curl has to pass through here.

/**
 * Postgres `integer` ceiling. Quantities and thresholds live in `integer`
 * columns (db/schemas/inventory.ts), so this is a real limit, not a guess.
 */
export const MAX_INT4 = 2147483647

/**
 * Money ceiling, in cents. `bigint` columns could hold more, but float
 * arithmetic on money stops being exact past 2^53, and this app multiplies
 * quantity by unit cost in plain JS (lib/inventory.ts) before storing the
 * result. A trillion major units is far beyond any real farm purchase and
 * keeps every product of two validated numbers exactly representable.
 */
export const MAX_MONEY_CENTS = 100_000_000_000_000

export type Invalid = { problem: string }

export function isInvalid<T>(v: T | Invalid): v is Invalid {
  return typeof v === 'object' && v !== null && 'problem' in v
}

/**
 * A real JSON number (or a numeric string), rejecting the values `Number()`
 * quietly turns into 0. Booleans, null, arrays, objects and empty strings are
 * refused rather than coerced.
 */
function toNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (trimmed === '') return null
  // Plain decimal notation only — same reasoning as parseMoneyToCents's
  // regex: '1e5' and '12.34.56' must not become some number nobody typed.
  if (!/^-?\d+(\.\d+)?$/.test(trimmed)) return null
  const n = Number(trimmed)
  return Number.isFinite(n) ? n : null
}

/**
 * A whole count: strictly positive, integral, within `integer` range.
 * Refuses a fraction rather than truncating it — "0.5 bags at 4,000" used to
 * be stored as a 0-quantity, 0-cost purchase, silently erasing the money.
 */
export function requireCount(value: unknown, field: string, max = MAX_INT4): number | Invalid {
  const n = toNumber(value)
  if (n === null) return { problem: `${field} must be a number` }
  if (n <= 0) return { problem: `${field} must be greater than zero` }
  if (!Number.isInteger(n)) {
    return { problem: `${field} must be a whole number — ${n} cannot be stored as a count` }
  }
  if (n > max) return { problem: `${field} is too large (maximum ${max})` }
  return n
}

/**
 * A count that may legitimately be zero — a stock recount finding nothing
 * left, for instance. Still integral, still bounded, still never negative.
 */
export function requireNonNegativeCount(value: unknown, field: string, max = MAX_INT4): number | Invalid {
  const n = toNumber(value)
  if (n === null) return { problem: `${field} must be a number` }
  if (n < 0) return { problem: `${field} cannot be negative` }
  if (!Number.isInteger(n)) return { problem: `${field} must be a whole number` }
  if (n > max) return { problem: `${field} is too large (maximum ${max})` }
  return n
}

/**
 * An amount in cents: integral, never negative, bounded. Callers that accept a
 * user-typed major-unit string should use parseMoneyToCents (lib/money.ts)
 * first and pass the result here.
 */
export function requireCents(value: unknown, field: string): number | Invalid {
  const n = toNumber(value)
  if (n === null) return { problem: `${field} must be a number` }
  if (n < 0) return { problem: `${field} cannot be negative` }
  if (!Number.isInteger(n)) return { problem: `${field} must be a whole number of cents` }
  if (n > MAX_MONEY_CENTS) return { problem: `${field} is too large to record` }
  return n
}

// How far ahead a date may be and still be a plausible record of something
// that happened. A purchase or sale dated next year silently drops out of
// every P&L period (lib/reports.ts filters on createdAt) while remaining in
// the trial balance, so the two can never be reconciled — the figures simply
// disagree and nothing says why. A little slack absorbs clock skew and
// timezone edges without admitting a typo'd year.
const FUTURE_TOLERANCE_MS = 36 * 60 * 60 * 1000
// Nothing in this system predates modern farm records; a date before this is a
// mistyped year, not history.
const EARLIEST_PLAUSIBLE = Date.UTC(2000, 0, 1)

/**
 * A date that actually parses and is plausible as a record of a real event.
 * `new Date('yesterday')` is an Invalid Date whose `.toISOString()` throws —
 * that used to surface as a 500 rather than a 400.
 */
export function requireEventDate(value: unknown, field: string, now = Date.now()): Date | Invalid {
  if (typeof value !== 'string' || value.trim() === '') {
    return { problem: `${field} must be a date` }
  }
  const d = new Date(value)
  const t = d.getTime()
  if (Number.isNaN(t)) return { problem: `${field} is not a date we can read` }
  if (t > now + FUTURE_TOLERANCE_MS) {
    return { problem: `${field} is in the future — a record cannot be dated ahead of today` }
  }
  if (t < EARLIEST_PLAUSIBLE) return { problem: `${field} looks like a mistyped year` }
  return d
}

/**
 * A date that is ALLOWED to be in the future — an expiry, a due date. Still
 * has to parse, and still cannot be absurd.
 */
export function requireFutureAllowedDate(value: unknown, field: string): Date | Invalid {
  if (typeof value !== 'string' || value.trim() === '') {
    return { problem: `${field} must be a date` }
  }
  const d = new Date(value)
  const t = d.getTime()
  if (Number.isNaN(t)) return { problem: `${field} is not a date we can read` }
  if (t < EARLIEST_PLAUSIBLE) return { problem: `${field} looks like a mistyped year` }
  // A century out is a typo, not a shelf life.
  if (t > Date.UTC(2200, 0, 1)) return { problem: `${field} looks like a mistyped year` }
  return d
}
