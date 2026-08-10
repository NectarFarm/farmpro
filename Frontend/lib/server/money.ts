import 'server-only';
// Money helpers. Schema is migrating from doublePrecision (KSh) to bigint
// (cents, mode: 'number') for all monetary columns. New code reads from
// _cents columns and uses fromCents() for display; writes go to both columns
// during dual-write.
//
// bigint columns are declared with `{ mode: 'number' }` (see db/schemas/index.ts),
// so drizzle maps them to plain JS numbers, not native BigInt — safe up to
// Number.MAX_SAFE_INTEGER (2^53-1 ≈ 90 trillion KSh in cents), far beyond any
// realistic farm/cooperative figure, so every helper below stays on `number`.
//
// 1 KSh = 100 cents.  e.g. KSh 1,500.50 = 150050 cents.

/** Round to 2 decimal places (KES presentation). */
export function roundMoney(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** Convert KSh (major) → integer cents (minor). */
export function toCents(major: number): number {
  return Math.round(roundMoney(major) * 100);
}

/** Convert integer cents (minor) → KSh (major). */
export function fromCents(cents: number): number {
  return roundMoney(cents / 100);
}

/** Sum KSh amounts with intermediate cents arithmetic (less drift). */
export function sumMoney(amounts: number[]): number {
  return fromCents(amounts.reduce((s, a) => s + toCents(a), 0));
}

/**
 * Format cents as a KSh display string.
 * e.g. 150050 → "KSh 1,500.50"
 */
export function formatCents(cents: number): string {
  if (!Number.isFinite(cents)) return 'KSh 0';
  const major = fromCents(cents);
  const parts = major.toFixed(2).split('.');
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `KSh ${parts.join('.')}`;
}

/**
 * Dual-write helper: given a KSh value, returns an object with both the
 * doublePrecision KSh value and the integer cents value, so callers can
 * write both columns in one insert/update.
 *
 * Returns { salary: KSh, salaryCents: cents } for use in Drizzle inserts.
 */
export function dualWrite<T extends string>(prefix: T, ksh: number): Record<`${T}${'' | 'Cents'}`, number> {
  const cents = toCents(ksh);
  return { [prefix]: ksh, [`${prefix}Cents`]: cents } as Record<`${T}${'' | 'Cents'}`, number>;
}
