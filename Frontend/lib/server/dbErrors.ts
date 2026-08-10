import 'server-only';

// Postgres SQLSTATE extraction for errors thrown through drizzle-orm.
//
// drizzle-orm (postgres-js driver) never lets the raw `postgres` package error
// surface directly from `db.select/insert/update/delete/execute(...)` — it
// always wraps it in a `DrizzleQueryError`, with the original `PostgresError`
// attached as `.cause` (verified empirically against this project's own
// drizzle-orm 0.45.1 + postgres client, for both the query builder AND
// `db.execute(sql\`...\`)` raw-SQL paths — both wrap identically). So
// `(e as { code?: string }).code` is always `undefined` for a query run
// through `db`; the real SQLSTATE is one level down, on `e.cause.code`.
//
// This walks the whole `cause` chain (not just one level) so it keeps working
// if a future drizzle version, a transaction wrapper, or some other layer
// adds another link, and so it's safe to use even on errors that were never
// wrapped at all (a plain `Object.assign(new Error(...), { code })`, or a
// raw `postgres` error from code that talks to the client directly).
export const pgErrorCode = (e: unknown): string | undefined => {
  let cur: unknown = e;
  const seen = new Set<unknown>();
  while (cur && typeof cur === 'object' && !seen.has(cur)) {
    seen.add(cur);
    const code = (cur as { code?: unknown }).code;
    if (typeof code === 'string') return code;
    cur = (cur as { cause?: unknown }).cause;
  }
  return undefined;
};
