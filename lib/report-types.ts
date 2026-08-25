// Shared report envelope shape — split out of lib/reports.ts (which is
// `server-only`) so client components (components/farm/reports.tsx) can
// import just the type without pulling in server-only DB code.
export type ReportRow = (string | number | null)[]

// One "headline figure" for the export's headline strip and the preview's
// figure cards: the 2–4 numbers that summarise the report, set large ABOVE
// the table. `value` is already display-formatted by the compute function
// (it knows the tenant's currencySymbol/weightUnit/timezone from
// tenant_settings) so neither the exporter nor any screen ever re-implements
// formatting. Max four — beyond that it is a table, not a headline.
export type HeadlineFigure = { label: string; value: string; caption?: string }

// How to align/format each column, index-aligned with `columns`. `money` and
// `weight` columns are right-aligned everywhere; the compute functions emit
// raw numbers in cells and the presentation layer decides rendering.
export type ColumnAlign = 'left' | 'right'
export type ColumnFormat = 'text' | 'number' | 'money' | 'weight'

export type ReportPayload = {
  title: string
  meta: Record<string, unknown>
  columns: string[]
  rows: ReportRow[]

  // ── Presentation fields (issue #376 Gap 7) ──
  // All optional so existing payloads keep validating; the exporter renders
  // whatever is present and nothing else. These are the ONLY per-report
  // inputs the export path takes — masthead, banner, metadata panels,
  // footers and page numbers are derived generically from meta + tenant
  // settings, keeping lib/report-export.ts free of per-report-type branching.

  // Headline figures for the strip above the table.
  headline?: HeadlineFigure[]
  // Prose notes: caveats and interpretive sentences as readable text,
  // replacing the old raw camelCase caveat keys printed into exports
  // (`glUnitCaveat: …`). Long strings are wrapped, never clipped.
  notes?: string[]
  // The dark total row under the table, aligned to `columns`
  // (null = empty cell). Omitted when a total makes no sense.
  totals?: (string | number | null)[]
  // Per-column alignment for the table body (default 'left').
  columnAlign?: ColumnAlign[]
  // Per-column format hint (default 'text') — drives right-alignment and
  // locale grouping in the preview and the PDF.
  columnFormats?: ColumnFormat[]
  // One-line "basis of preparation" — what records this was compiled from.
  basis?: string
}
