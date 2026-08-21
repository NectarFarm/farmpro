// ── Postgres error classification ───────────────────────────────────────────
// Drizzle does NOT rethrow the driver's error as-is: it wraps it in a
// `DrizzleQueryError` whose `.cause` is the postgres.js error carrying the
// SQLSTATE. So the obvious `err.code === '23505'` check silently never matches
// — `code` is undefined on the wrapper — and every unique violation fell
// through to a bare 500 instead of the clean envelope the routes intended.
// Probed against the real driver:
//   TOPLEVEL_CODE=undefined  CTOR=DrizzleQueryError  CAUSE_CODE=23505
// Unwrap the cause chain rather than trusting either level alone, so this keeps
// working whether or not a future drizzle release stops wrapping.
function sqlStates(err: unknown, depth = 0): string[] {
  if (!err || typeof err !== 'object' || depth > 5) return []
  const e = err as { code?: unknown; cause?: unknown }
  const here = typeof e.code === 'string' ? [e.code] : []
  return [...here, ...sqlStates(e.cause, depth + 1)]
}

/** SQLSTATE 23505 — unique constraint violated (e.g. an email already taken). */
export function isUniqueViolation(err: unknown): boolean {
  return sqlStates(err).includes('23505')
}
