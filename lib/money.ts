// ── Money: the single place amounts are parsed, converted, and formatted ───
// (issue: money-unit-enforcement). Every money-bearing DB column in this app
// is minor units (cents), always suffixed `_cents` — no exceptions. This
// file is the only place that crosses between that internal cents
// representation and the major-unit ("whole currency", e.g. KSh) numbers a
// human types into a form or reads on screen. Every remaining ad-hoc `* 100`
// / `/ 100` in a route or component should be one of the functions below
// instead — a single implementation is easier to audit for the 100x-error
// class of bug than N copies of `Math.round(x / 100)`.
//
// Deliberately NOT `server-only`: components (client-side) format money for
// display too, and don't need DB access to do it.

const DEFAULT_CURRENCY_SYMBOL = 'KSh'

// A money amount typed by a user, as free text — e.g. an <input> bound to a
// "Unit cost" or "Amount paid" field. Accepts thousands separators (",") and
// up to any number of decimal places (rounded to the nearest cent), leading
// "-" for a negative amount, and surrounding whitespace. Returns `null` —
// never a wrong number — for anything that isn't unambiguously a number:
// empty/whitespace-only input, and non-numeric text. This is the guard the
// task calls out explicitly: a string like "1,234.50" must not silently
// become NaN (which would poison downstream arithmetic) or silently lose the
// cents (e.g. truncating instead of rounding).
export function parseMoneyToCents(input: unknown): number | null {
  if (typeof input === 'number') {
    return Number.isFinite(input) ? Math.round(input * 100) : null
  }
  if (typeof input !== 'string') return null

  const trimmed = input.trim()
  if (trimmed === '') return null

  // Reject anything that isn't plain decimal notation (digits, thousands
  // commas, one optional decimal point, optional leading minus) BEFORE
  // stripping commas and handing off to Number() — this is what keeps
  // "1e5" (scientific notation) or "12.34.56" (garbage) from silently
  // parsing into some number that isn't what the user typed.
  if (!/^-?\d{1,3}(,\d{3})*(\.\d+)?$|^-?\d+(\.\d+)?$/.test(trimmed)) return null

  const cleaned = trimmed.replace(/,/g, '')
  const major = Number(cleaned)
  if (!Number.isFinite(major)) return null

  return Math.round(major * 100)
}

// Minor units (cents, as stored in every `_cents` column) -> major units
// (whole currency, e.g. KSh) as a plain number. The inverse of
// `majorToCents`. Use this instead of an ad-hoc `/ 100` at every display or
// report-aggregation site.
export function centsToMajor(cents: number): number {
  return cents / 100
}

// Major units (whole currency, e.g. what a user typed or a pre-cents legacy
// value) -> minor units (cents). Rounds to the nearest cent — use this
// instead of an ad-hoc `* 100`.
export function majorToCents(major: number): number {
  return Math.round(major * 100)
}

// Cents -> a human-readable "KSh 1,234.50" string, using the tenant's own
// `currencySymbol` (from `tenant_settings`, see db/schemas/settings.ts) when
// the caller has one; falls back to the app default otherwise (matching the
// hardcoded "KSh" every screen used before tenant-configurable currency
// symbols existed).
export function formatMoney(cents: number, currencySymbol: string = DEFAULT_CURRENCY_SYMBOL): string {
  const major = centsToMajor(cents)
  const formatted = major.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return `${currencySymbol} ${formatted}`
}
