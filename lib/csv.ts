// ── Building a CSV that survives a comma ────────────────────────────────────
// The inventory and finance exports were built with `row.join(',')` on values
// that include free-text item names, supplier names and GL account names. Any
// one of those containing a comma — "Maize, cracked", "Agrovet Ltd, Nakuru" —
// shifted every following column, so the exported quantity and cost columns
// silently misaligned. A corrupt financial artifact leaves the building and
// nothing in the app looks wrong.
//
// components/farm/tasks.tsx already quoted its export correctly; this is that
// implementation extracted so the other two stop being the odd ones out
// instead of a fourth copy appearing later.

/**
 * One CSV field, RFC 4180 style: always quoted, embedded quotes doubled.
 * Quoting unconditionally rather than only-when-needed keeps the output
 * stable and the rule impossible to get subtly wrong.
 *
 * `null`/`undefined` become an empty field rather than the strings "null" or
 * "undefined", which is what `String(v)` would have produced.
 */
export function csvField(value: unknown): string {
  if (value === null || value === undefined) return '""'
  return `"${String(value).replace(/"/g, '""')}"`
}

/** A header row plus data rows, joined with CRLF (what Excel expects). */
export function toCsv(headers: readonly unknown[], rows: readonly (readonly unknown[])[]): string {
  return [headers, ...rows].map((r) => r.map(csvField).join(',')).join('\r\n')
}
