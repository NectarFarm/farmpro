// ── Client-side report export (issue #263 tasks 5-6; rebuilt in #376 Gap 7) ─
// Builds CSV and PDF exports from ANY report endpoint's `{ title, meta,
// columns, rows, headline?, notes?, totals?, … }` envelope (see
// lib/report-types.ts). There is deliberately NO per-report branching in this
// file: every report supplies the same optional presentation fields, and the
// renderer below turns them into the same document shape — masthead, banner,
// metadata panels, headline strip, sectioned table with a totals row, wrapped
// notes, and a footer carrying "Page N of M" on every page.
//
// Data-exposure contract (test-covered, tests/report-export.test.ts):
//   * `tenantId` and ANY raw UUID are never written into a CSV or PDF. Meta
//     reaches a document only through presentableMeta()'s whitelist — never
//     Object.entries(meta) printed raw.
//   * Long strings are wrapped with splitTextToSize before drawing and every
//     block checks the remaining page space BEFORE drawing — nothing is
//     clipped off the page edge and no block starts past the footer. Where a
//     value genuinely cannot fit (metadata panel cells, headline captions) it
//     is ellipsised VISIBLY, never cut silently.
//
// Page chrome is stamped through one `stampChrome()` helper wired into BOTH
// autoTable's didDrawPage and every manual doc.addPage() (tests/report-pdf.
// test.ts asserts a 90-row report repeats the masthead on all pages and loses
// no row at a boundary) — the earlier version drew the masthead once and left
// didDrawPage as an empty no-op, so page 2+ came out headerless.
//
// jsPDF is dynamically imported so the ~350KB bundle loads only on export.
'use client'
import type { ColumnFormat, ReportPayload } from './report-types'
import type { RowInput, Styles } from 'jspdf-autotable'

// ── Pure helpers (exported for tests; no jsPDF/DOM dependency) ──────────────

export const DEFAULT_ACCENT_RGB: [number, number, number] = [74, 124, 89]

// `accentColor` comes from tenant_settings and is user input. Parse STRICTLY;
// anything malformed falls back to the app green rather than producing a
// black or transparent masthead (#376 Gap 7 implementation note).
export function parseAccentColor(input: string | undefined | null): [number, number, number] {
  const m = typeof input === 'string' ? input.trim().match(/^#([0-9a-fA-F]{6})$/) : null
  if (!m) return DEFAULT_ACCENT_RGB
  const n = parseInt(m[1], 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

// White text on a light accent would vanish — pick ink colour per luminance.
export function textColorFor(rgb: [number, number, number]): [number, number, number] {
  const lin = rgb.map((v) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
  }) as [number, number, number]
  const L = 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2] // WCAG relative luminance
  return L > 0.45 ? [20, 24, 21] : [255, 255, 255]
}

// Deterministic report reference: re-exporting the same report (same type +
// range + scope) yields the SAME reference, so a printed copy can be matched
// back to what the screen shows. FNV-1a over the identity fields — the raw
// inputs (including any UUID) never appear in the output.
export function deriveReportNumber(report: ReportPayload): string {
  const meta = report.meta as Record<string, unknown>
  const seed = `${report.title}|${String(meta.from ?? '')}|${String(meta.to ?? '')}|${String(meta.farmId ?? '')}`
  let hash = 0x811c9dc5
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return `RPT-${hash.toString(16).toUpperCase().padStart(8, '0')}`
}

// camelCase / snake_case -> "Camel case", for meta keys without a curated label.
function humanizeKey(key: string): string {
  const spaced = key.replace(/[_-]+/g, ' ').replace(/([a-z0-9])([A-Z])/g, '$1 $2')
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

// Keys whose values are machine-facing and must never reach a document.
// tenantId is the explicit leak this exists to prevent (#376 Gap 7 defect 2).
const INTERNAL_META_KEYS = new Set(['tenantId', 'generatedAt'])

// Meta keys the document HEADER already presents (documentHeader() below).
// Callers rendering a secondary "figures" grid pass these as `exclude` so the
// period/scope aren't printed twice — once as a panel and again as a chip.
export const HEADER_META_KEYS: readonly string[] = ['from', 'to', 'periodLabel', 'farmId']

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface MetaEntry { label: string; value: string }

// The ONLY way meta reaches an export or the preview's figures grid:
// whitelisted, labelled, uuid-guarded. `farmLabel` lets the caller replace a
// real farms.id (itself a UUID!) with its display name ahead of the guard.
export function presentableMeta(
  report: ReportPayload,
  opts: { farmLabel?: string; exclude?: readonly string[] } = {},
): MetaEntry[] {
  const entries: MetaEntry[] = []
  const exclude = new Set(opts.exclude ?? [])
  for (const [key, raw] of Object.entries(report.meta)) {
    if (INTERNAL_META_KEYS.has(key) || exclude.has(key)) continue
    if (raw === undefined || raw === null || raw === '' ) continue
    if (typeof raw !== 'string' && typeof raw !== 'number') continue

    let value: string
    if (key === 'farmId') {
      if (raw === 'ALL') value = 'All farms'
      else if (UUID_RE.test(String(raw))) value = opts.farmLabel ?? ''
      else value = String(raw)
      if (!value) continue
    } else if (typeof raw === 'string' && UUID_RE.test(raw)) {
      // Any other field carrying a bare UUID (source ids etc.) stays internal.
      continue
    } else if (typeof raw === 'number') {
      value = Number.isInteger(raw) ? raw.toLocaleString('en-US') : String(Math.round(raw * 100) / 100)
    } else {
      value = raw
    }
    entries.push({ label: humanizeKey(key), value })
  }
  return entries
}

export interface ExportOptions {
  accentColor?: string
  currencySymbol?: string
  weightUnit?: string
  // Masthead identity (all optional — the renderer degrades gracefully).
  farmName?: string
  farmCode?: string
  location?: string
  preparedFor?: string
}

const DEFAULT_OPTIONS: Required<Pick<ExportOptions, 'currencySymbol' | 'weightUnit'>> = {
  currencySymbol: 'KSh',
  weightUnit: 'kg',
}

// The document header — reference, period, scope, size, source. Computed HERE
// so the on-screen preview (components/farm/reports.tsx) shows exactly the
// panel values the exported PDF prints, from one implementation. Nothing in
// here is per-report-type: it is all derived from the shared envelope.
export interface DocumentHeader {
  reportNo: string
  periodText: string
  scopeText: string
  entriesText: string
  sourceText: string
}

export function documentHeader(report: ReportPayload, opts: ExportOptions = {}): DocumentHeader {
  const meta = report.meta as Record<string, unknown>
  const periodText =
    typeof meta.periodLabel === 'string' && meta.periodLabel
      ? meta.periodLabel
      : [meta.from, meta.to].filter(Boolean).join(' – ') || 'All time'
  const scopeText =
    typeof meta.farmId === 'string' && meta.farmId !== 'ALL'
      ? opts.farmName ?? 'Selected farm'
      : 'All farms'
  return {
    reportNo: deriveReportNumber(report),
    periodText,
    scopeText,
    entriesText: `${report.rows.length.toLocaleString('en-US')} row${report.rows.length === 1 ? '' : 's'}`,
    sourceText: 'Recorded operational data',
  }
}

// Cell formatting lives HERE and nowhere else — the screen preview imports
// this same function (components/farm/reports.tsx), so the exported document
// and the on-screen table cannot disagree about what a number says.
export function formatCell(
  value: string | number | null,
  format: ColumnFormat | undefined,
  opts: Pick<ExportOptions, 'currencySymbol' | 'weightUnit'> = {},
): string {
  if (value === null || value === '') return '—'
  if (typeof value === 'number') {
    const o = { ...DEFAULT_OPTIONS, ...opts }
    switch (format) {
      case 'money':
        return `${o.currencySymbol} ${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
      case 'weight':
        return `${value.toLocaleString('en-US')} ${o.weightUnit}`
      case 'number':
        return value.toLocaleString('en-US')
      default:
        return String(value)
    }
  }
  return value
}

// Right-aligned everywhere a column holds a quantity: the preview and the PDF
// both read alignment from here so a money column can never be left-aligned
// on screen and right-aligned in the file.
export function columnAlignFor(report: ReportPayload, i: number): 'left' | 'right' {
  return report.columnAlign?.[i]
    ?? (['money', 'weight', 'number'].includes(report.columnFormats?.[i] ?? '') ? 'right' : 'left')
}

export function hasTotalsRow(report: ReportPayload): boolean {
  return !!report.totals && report.totals.some((t) => t !== null && t !== '')
}

// The totals row is aligned to `columns`, so most of its cells are structural
// padding rather than missing data. Those render BLANK, not as formatCell's
// em dash: "— — 142 —" across a dark total band reads as four unknown values
// when only one figure is being totalled. Body cells keep the em dash, which
// does mean "we have no value for this".
export function formatTotalsCell(
  value: string | number | null,
  format: ColumnFormat | undefined,
  opts: Pick<ExportOptions, 'currencySymbol' | 'weightUnit'> = {},
): string {
  if (value === null || value === '') return ''
  return formatCell(value, format, opts)
}

// ── PDF text encoding guard ────────────────────────────────────────────────
// jsPDF's standard fonts (Helvetica) can only encode WinAnsi/cp1252. Anything
// outside it comes out as garbage glyphs — exactly the reason this file draws
// an initials badge instead of tenant_settings.logoEmoji. The same trap bites
// ordinary report prose: lib/reports.ts's FCR headline caption says "need ≥2
// weight samples" and U+2265 rendered as `"e2` in a real export.
//
// So every string that reaches the PDF is mapped through here first: common
// typographic/mathematical symbols degrade to an ASCII equivalent, and
// anything still unrepresentable becomes '?' rather than a glyph that looks
// like a bug. The CSV is UTF-8 and is deliberately NOT sanitised — it keeps
// the real characters. On screen the browser renders them properly too; this
// is a PDF-font limitation, not a data one.
const PDF_TEXT_MAP: [RegExp, string][] = [
  [/[≥]/g, '>='], [/[≤]/g, '<='], [/[≈]/g, '~'], [/[≠]/g, '!='],
  [/[→⇒]/g, '->'], [/[←⇐]/g, '<-'],
  [/[−‑]/g, '-'], [/[⁄]/g, '/'],
  // Written as escapes on purpose: thin/narrow/figure spaces and the
  // zero-width family are invisible in an editor.
  [/[\u2009\u202f\u2007\u2008]/g, ' '], [/[\u200b\u200c\u200d\ufeff]/g, ''],
  [/[′]/g, "'"], [/[″]/g, '"'],
]

// cp1252's 0x80–0x9F block: characters Unicode places far above 0xFF that
// WinAnsi nonetheless encodes (em dash, curly quotes, bullet, ellipsis…).
const CP1252_HIGH =
  '€‚ƒ„…†‡ˆ‰Š‹ŒŽ' +
  '‘’“”•–—˜™š›œžŸ'

export function toPdfText(input: string): string {
  let s = input
  for (const [re, to] of PDF_TEXT_MAP) s = s.replace(re, to)
  let out = ''
  for (const ch of s) {
    const c = ch.codePointAt(0)!
    if (c === 9 || c === 10 || (c >= 0x20 && c <= 0x7e) || (c >= 0xa0 && c <= 0xff) || CP1252_HIGH.includes(ch)) {
      out += ch
    } else {
      out += '?'
    }
  }
  return out
}

// Whole-envelope pass, so the renderer below never has to remember to call
// toPdfText() at each of its ~40 draw sites.
function reportForPdf(report: ReportPayload): ReportPayload {
  const cell = (v: string | number | null) => (typeof v === 'string' ? toPdfText(v) : v)
  return {
    ...report,
    title: toPdfText(report.title),
    meta: Object.fromEntries(
      Object.entries(report.meta).map(([k, v]) => [k, typeof v === 'string' ? toPdfText(v) : v]),
    ),
    columns: report.columns.map(toPdfText),
    rows: report.rows.map((row) => row.map(cell)),
    totals: report.totals?.map(cell),
    headline: report.headline?.map((h) => ({
      label: toPdfText(h.label),
      value: toPdfText(h.value),
      caption: h.caption ? toPdfText(h.caption) : undefined,
    })),
    notes: report.notes?.map(toPdfText),
    basis: report.basis ? toPdfText(report.basis) : undefined,
  }
}

function optionsForPdf(opts: ExportOptions): ExportOptions {
  const t = (v: string | undefined) => (v === undefined ? undefined : toPdfText(v))
  return {
    ...opts,
    currencySymbol: t(opts.currencySymbol),
    weightUnit: t(opts.weightUnit),
    farmName: t(opts.farmName),
    farmCode: t(opts.farmCode),
    location: t(opts.location),
    preparedFor: t(opts.preparedFor),
  }
}

function csvCell(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`
  return value
}

// CSV carries the attribution the old export dropped entirely (#376 Gap 7):
// title, reference, period, basis and every note ride along, so a bare file
// opened six months later still says what it is.
//
// It rides along as TRAILING key/value rows after a blank separator line, not
// as leading `# comment` lines. That is a deliberate reversal (#376 review
// defect 6): a `#` preamble is only a comment to tools you tell about it —
// Excel and `pandas.read_csv()` with default settings both treat those lines
// as DATA, so the first attribution line became the header row and every
// column name was lost. With the header row first, a naive import gets the
// right column names and the right dtypes; the attribution lands as clearly
// labelled rows at the bottom (a blank line separates them, and pandas skips
// blank lines by default). Cells go through formatCell so the file agrees
// with the screen and the PDF.
export function reportToCsv(report: ReportPayload, opts: ExportOptions = {}): string {
  const header = documentHeader(report, opts)
  const lines: string[] = []

  lines.push(report.columns.map(csvCell).join(','))
  for (const row of report.rows) {
    lines.push(row.map((cell, i) => csvCell(formatCell(cell, report.columnFormats?.[i], opts))).join(','))
  }
  if (hasTotalsRow(report)) {
    lines.push(report.totals!.map((cell, i) => csvCell(formatTotalsCell(cell, report.columnFormats?.[i], opts))).join(','))
  }

  // Two-column key/value attribution. Keys keep a leading "#" so a human
  // scanning the bottom of the sheet can see these rows are about the report
  // rather than part of it.
  const attribution: [string, string][] = [
    ['# Report', report.title],
    ['# Reference', header.reportNo],
    ['# Period', header.periodText],
    ['# Scope', header.scopeText],
    ...(opts.farmName ? [['# Prepared by', opts.farmName] as [string, string]] : []),
    ...(report.basis ? [['# Basis', report.basis] as [string, string]] : []),
    ...(report.notes ?? []).map((note, i): [string, string] => [`# Note ${i + 1}`, note]),
  ]
  lines.push('')
  for (const [k, v] of attribution) lines.push(`${csvCell(k)},${csvCell(v)}`)

  return lines.join('\n')
}

function triggerDownload(blob: Blob, filename: string) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  a.click()
  URL.revokeObjectURL(a.href)
}

export function downloadReportCsv(report: ReportPayload, filename: string, opts: ExportOptions = {}) {
  triggerDownload(new Blob(['\ufeff' + reportToCsv(report, opts)], { type: 'text/csv;charset=utf-8' }), filename)
}

// ── PDF layout constants ────────────────────────────────────────────────────

const MARGIN = 14
const MASTHEAD_HEIGHT = 26
const FOOTER_HEIGHT = 14
// Where content starts on a CONTINUATION page: clear of the repeated masthead
// AND of the "continued" strip drawn under it (whose text baseline sits at
// MASTHEAD_HEIGHT + 9.1). Also autoTable's margin.top, so a table flowing
// onto page 2 never lands under either.
const CONTINUED_TOP = MASTHEAD_HEIGHT + 12
// Anything below this line belongs to the footer; content never enters it.
function maxContentY(H: number): number {
  return H - FOOTER_HEIGHT - 2
}

// Neutral ink/rule palette — one place, so the panels, section bars, table
// and callout stay visually related whatever the tenant's accent is.
const INK = [30, 34, 31] as const
const INK_MUTED = [110, 118, 112] as const
const INK_FAINT = [138, 146, 140] as const
const RULE = [216, 222, 217] as const
const TINT = [247, 249, 247] as const
const DARK = [38, 42, 39] as const

interface Layout {
  W: number
  H: number
  accent: [number, number, number]
  inkOnAccent: [number, number, number]
}

type Doc = import('jspdf').default

// Initials mark instead of logoEmoji: Helvetica/WinAnsi CANNOT encode emoji —
// it renders as garbage glyphs. The farm's initials in an accent square carry
// the same identity safely (#376 Gap 7 implementation note).
export function initialsFor(name: string | undefined): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return 'IF'
  return parts.slice(0, 2).map((p) => p.charAt(0).toUpperCase()).join('')
}

function fmtStampDate(d: Date): string {
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}
function fmtStamp(d: Date): string {
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${fmtStampDate(d)} ${hh}:${mm}`
}

// Wrap `text` to `width`, but never return more than `maxLines`: the last
// line is ellipsised so a truncation is VISIBLE. Silent clipping was #376
// review defect 4 — `valueLines.slice(0, 2)` dropped line three of a long
// metadata value with nothing on the page to say so.
function clampLines(doc: Doc, text: string, width: number, maxLines: number): string[] {
  const lines = doc.splitTextToSize(text, width) as string[]
  if (lines.length <= maxLines) return lines
  const kept = lines.slice(0, maxLines)
  let last = kept[maxLines - 1]
  while (last.length > 1 && doc.getTextWidth(`${last}…`) > width) last = last.slice(0, -1)
  kept[maxLines - 1] = `${last.replace(/[\s,.;:]+$/, '')}…`
  return kept
}

// Step a font size down until `text` fits `width` (floor at `min`). Headline
// values are tenant-formatted money strings — "KSh 12,345,678.00" in a 4-up
// strip does not fit at 12pt, and shrinking it is better than overflowing
// into the neighbouring card.
function fitFontSize(doc: Doc, text: string, width: number, start: number, min: number): number {
  let size = start
  doc.setFontSize(size)
  while (size > min && doc.getTextWidth(text) > width) {
    size -= 0.5
    doc.setFontSize(size)
  }
  return size
}

function drawMasthead(doc: Doc, layout: Layout, opts: ExportOptions, generatedAt: Date) {
  const { W, accent, inkOnAccent } = layout
  doc.setFillColor(...accent)
  doc.rect(0, 0, W, MASTHEAD_HEIGHT, 'F')

  // Initials badge — deliberately NOT logoEmoji (jsPDF standard fonts cannot
  // encode emoji; see header comment).
  doc.setFillColor(255, 255, 255)
  doc.roundedRect(MARGIN, 5.5, 15, 15, 2.5, 2.5, 'F')
  doc.setTextColor(...accent)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.text(initialsFor(opts.farmName), MARGIN + 7.5, 15, { align: 'center' })

  // Identity block, left. The letter-spaced small-caps second line is the
  // "registration line" pattern that makes an issuer read as an institution
  // rather than a script's output.
  const leftX = MARGIN + 19
  doc.setTextColor(...inkOnAccent)
  doc.setFontSize(13)
  doc.text(opts.farmName || 'Integrated Farm Management System', leftX, 10.5)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(6.6)
  doc.text(
    (opts.farmName ? 'Integrated Farm Management System' : 'Farm management reporting').toUpperCase(),
    leftX, 15, { charSpace: 0.45 },
  )
  const codeLine = [opts.farmCode, opts.location].filter(Boolean).join('  ·  ')
  if (codeLine) {
    doc.setFontSize(7.4)
    doc.text(codeLine, leftX, 19.6)
  }

  // Right-aligned generation block.
  const rightX = W - MARGIN
  doc.setFontSize(6.2)
  doc.text('REPORT GENERATED', rightX, 10, { align: 'right', charSpace: 0.4 })
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8.6)
  doc.text(fmtStamp(generatedAt), rightX, 15, { align: 'right' })
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7.4)
  if (opts.preparedFor) doc.text(`Prepared for: ${opts.preparedFor}`, rightX, 19.6, { align: 'right' })
}

function drawBanner(doc: Doc, layout: Layout, title: string): number {
  const { W, accent, inkOnAccent } = layout
  const y = MASTHEAD_HEIGHT + 4
  const h = 9
  doc.setFillColor(...accent)
  doc.rect(MARGIN, y, W - MARGIN * 2, h, 'F')
  doc.setTextColor(...inkOnAccent)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10.5)
  doc.text(title.toUpperCase(), W / 2, y + h / 2 + 1.4, { align: 'center', charSpace: 0.7 })
  return y + h
}

// Continuation-page identity: the masthead says WHO issued this sheet, this
// says WHICH document it is part of and that it is not page one. Drawn in the
// same band autoTable's margin.top clears.
function drawContinuedStrip(doc: Doc, layout: Layout, title: string, reportNo: string) {
  const y = MASTHEAD_HEIGHT + 5.5
  doc.setDrawColor(...layout.accent)
  doc.setLineWidth(0.6)
  doc.line(MARGIN, y, MARGIN + 16, y)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(6.4)
  doc.setTextColor(...INK_MUTED)
  doc.text(`${title.toUpperCase()} — CONTINUED`, MARGIN, y + 3.6, { charSpace: 0.4 })
  doc.setFont('helvetica', 'normal')
  doc.text(reportNo, layout.W - MARGIN, y + 3.6, { align: 'right' })
}

// A dark small-caps section bar, the device that separates "CHARGES
// BREAKDOWN" from "PAYMENT INSTRUCTIONS" on a real utility document. Returns
// the y below the bar.
function drawSectionBar(doc: Doc, layout: Layout, label: string, y: number): number {
  const h = 6
  doc.setFillColor(...DARK)
  doc.rect(MARGIN, y, layout.W - MARGIN * 2, h, 'F')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(6.4)
  doc.setTextColor(255, 255, 255)
  doc.text(label.toUpperCase(), MARGIN + 3.5, y + 4, { charSpace: 0.5 })
  return y + h
}

// ── Metadata panels ────────────────────────────────────────────────────────
// Small-caps label above bold values in a ruled box, never "camelCaseKey:
// value" prose (#376 Gap 7 defect 1).
const PANEL_LABEL_W = 16
const PANEL_ROW_LEAD = 3.6
const PANEL_ROW_GAP = 1.6
const PANEL_MAX_VALUE_LINES = 2

// Each panel row's value wraps to at most PANEL_MAX_VALUE_LINES; a row that
// wraps advances by the lines it ACTUALLY drew (#376 review defect 4 — a
// fixed 5.4mm advance let a two-line value overprint the row beneath it).
function panelRowLines(doc: Doc, rows: [string, string][], w: number): string[][] {
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(7.4)
  const valueWidth = w - 3 - PANEL_LABEL_W - 1
  return rows.map(([, value]) => clampLines(doc, value, valueWidth, PANEL_MAX_VALUE_LINES))
}

function measurePanel(doc: Doc, rows: [string, string][], w: number): number {
  const lineCounts = panelRowLines(doc, rows, w).map((l) => l.length)
  const body = lineCounts.reduce((sum, n) => sum + n * PANEL_ROW_LEAD + PANEL_ROW_GAP, 0)
  return Math.max(18, 8.5 + body + 1.5)
}

function drawPanel(
  doc: Doc,
  x: number, y: number, w: number, h: number,
  title: string,
  rows: [string, string][],
  stamp?: { text: string; color: [number, number, number] },
) {
  doc.setDrawColor(...RULE)
  doc.setLineWidth(0.25)
  doc.roundedRect(x, y, w, h, 1.5, 1.5, 'S')
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(...INK_MUTED)
  doc.setFontSize(5.8)
  doc.text(title.toUpperCase(), x + 3, y + 4, { charSpace: 0.4 })
  doc.setDrawColor(...RULE)
  doc.line(x + 3, y + 5.6, x + w - 3, y + 5.6)

  const wrapped = panelRowLines(doc, rows, w)
  let ty = y + 9.6
  rows.forEach(([label], i) => {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(6.2)
    doc.setTextColor(...INK_MUTED)
    doc.text(label.toUpperCase(), x + 3, ty, { charSpace: 0.25 })
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(7.4)
    doc.setTextColor(...INK)
    doc.text(wrapped[i], x + 3 + PANEL_LABEL_W, ty)
    ty += wrapped[i].length * PANEL_ROW_LEAD + PANEL_ROW_GAP
  })

  if (stamp) {
    doc.setDrawColor(...stamp.color)
    doc.setLineWidth(0.5)
    doc.roundedRect(x + w / 2 - 12, y + h / 2 - 3, 24, 9, 1.5, 1.5, 'S')
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(6.6)
    doc.setTextColor(...stamp.color)
    doc.text(stamp.text, x + w / 2, y + h / 2 + 3.4, { align: 'center', charSpace: 0.4 })
  }
}

// ── Headline strip ─────────────────────────────────────────────────────────
// The anti-table requirement (#376 Gap 7): the 2–4 numbers that matter, set
// large ABOVE the detail table, each on an accent-ruled card. Returns the new y.
function drawHeadline(doc: Doc, layout: Layout, startY: number, report: ReportPayload): number {
  const items = (report.headline ?? []).slice(0, 4)
  if (items.length === 0) return startY
  const { W, accent } = layout
  let y = drawSectionBar(doc, layout, 'Headline figures', startY)
  y += 3
  const gap = 3.5
  const w = (W - MARGIN * 2 - gap * (items.length - 1)) / items.length

  // One height for every card, driven by the longest caption, so the strip
  // reads as a row rather than a ragged set of boxes.
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(5.8)
  const captions = items.map((it) => (it.caption ? clampLines(doc, it.caption, w - 6, 2) : []))
  const captionLines = Math.max(0, ...captions.map((c) => c.length))
  const h = 14.5 + captionLines * 2.9

  items.forEach((item, i) => {
    const x = MARGIN + i * (w + gap)
    doc.setFillColor(...TINT)
    doc.setDrawColor(...RULE)
    doc.setLineWidth(0.25)
    doc.roundedRect(x, y, w, h, 1.5, 1.5, 'FD')
    // Accent rule along the top edge — the one place the tenant's colour
    // touches the figures, tying them to the masthead.
    doc.setFillColor(...accent)
    doc.rect(x + 1, y, w - 2, 1.1, 'F')

    doc.setFont('helvetica', 'bold')
    doc.setFontSize(5.6)
    doc.setTextColor(...INK_MUTED)
    doc.text(clampLines(doc, item.label.toUpperCase(), w - 6, 1), x + 3, y + 5, { charSpace: 0.35 })

    doc.setFont('helvetica', 'bold')
    fitFontSize(doc, item.value, w - 6, 13, 7.5)
    doc.setTextColor(...INK)
    doc.text(item.value, x + 3, y + 11.6)

    if (captions[i].length > 0) {
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(5.8)
      doc.setTextColor(...INK_FAINT)
      let cy = y + 14.6
      for (const line of captions[i]) { doc.text(line, x + 3, cy); cy += 2.9 }
    }
  })
  return y + h
}

// ── Prose (basis + notes) ──────────────────────────────────────────────────
// Measured BEFORE drawing: every block computes its wrapped line count and
// checks the page boundary first, then draws. This is where Gap 7 defects 3
// (clipped caveats) and 4 (unguarded page breaks) are fixed for good.
// `bullet` blocks get an accent marker and a hanging indent — that is the
// whole difference, and it replaces the `bullet ? 'normal' : 'normal'`
// no-op ternary the review flagged (#376 review defect 5).
interface ProseBlock { text: string; size: number; lead: number; gapAfter: number; bullet?: boolean }

const BULLET_INDENT = 4.4

function drawProseBlocks(
  doc: Doc,
  layout: Layout,
  blocks: ProseBlock[],
  startY: number,
  newPage: () => number,
): number {
  const { W, H, accent } = layout
  let y = startY
  for (const block of blocks) {
    const indent = block.bullet ? BULLET_INDENT : 0
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(block.size)
    const lines = doc.splitTextToSize(block.text, W - MARGIN * 2 - indent) as string[]
    const h = lines.length * block.lead + block.gapAfter
    if (y + h > maxContentY(H)) y = newPage()

    let ly = y + block.lead
    if (block.bullet) {
      doc.setFillColor(...accent)
      doc.circle(MARGIN + 1.1, ly - 1.1, 0.7, 'F')
    }
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(block.size)
    doc.setTextColor(60, 66, 62)
    for (const line of lines) {
      doc.text(line, MARGIN + indent, ly)
      ly += block.lead
    }
    y += h
  }
  return y
}

// The accent-ruled validity callout — the line that makes a recipient accept
// an unsigned document. Returns the y below it.
function drawCallout(doc: Doc, layout: Layout, startY: number, newPage: () => number): number {
  const { W, H, accent } = layout
  const text =
    'This report is computer-generated directly from recorded farm data and is valid without a signature. Figures reflect what has been recorded up to the generation time above; verify any figure against the live dashboard if in doubt.'
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7)
  const lines = doc.splitTextToSize(text, W - MARGIN * 2 - 11) as string[]
  const h = lines.length * 3.5 + 9
  let y = startY
  if (y + h > maxContentY(H)) y = newPage()

  doc.setFillColor(...TINT)
  doc.setDrawColor(...RULE)
  doc.setLineWidth(0.25)
  doc.roundedRect(MARGIN, y, W - MARGIN * 2, h, 1.5, 1.5, 'FD')
  doc.setFillColor(...accent)
  doc.rect(MARGIN, y + 0.6, 1.8, h - 1.2, 'F')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(6.2)
  doc.setTextColor(...INK_MUTED)
  doc.text('IMPORTANT', MARGIN + 6, y + 4.6, { charSpace: 0.5 })
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7)
  doc.setTextColor(60, 66, 62)
  let ly = y + 8.6
  for (const line of lines) { doc.text(line, MARGIN + 6, ly); ly += 3.5 }
  return y + h
}

// ── The document ───────────────────────────────────────────────────────────
// Split out of downloadReportPdf so the layout is testable without a DOM:
// tests/report-pdf.test.ts builds a 90-row report here and inspects the real
// jsPDF output (page count, repeated masthead, every row present). Only
// `doc.save()` needs a browser.
export async function buildReportPdf(
  rawReport: ReportPayload,
  rawOpts: ExportOptions = {},
): Promise<Doc> {
  // Named exports, not `default`: under a bundler `default` is the class, but
  // under Node/vitest CJS interop it is the module namespace object, and
  // `new namespace()` throws. The named export is the class in both.
  const { jsPDF } = await import('jspdf')
  const { autoTable } = await import('jspdf-autotable')

  // One encoding pass at the boundary — see toPdfText() above for why.
  const report = reportForPdf(rawReport)
  const opts = optionsForPdf(rawOpts)

  // Wide tables read badly in portrait A4 — P&L (6 cols), Batch P&L (7),
  // Vaccination (7), FCR (7) go landscape; 4-column reports stay portrait.
  const landscape = report.columns.length > 5
  const doc = new jsPDF({ orientation: landscape ? 'landscape' : 'portrait', unit: 'mm', format: 'a4' }) as Doc
  const accent = parseAccentColor(opts.accentColor)
  const layout: Layout = {
    W: doc.internal.pageSize.getWidth(),
    H: doc.internal.pageSize.getHeight(),
    accent,
    inkOnAccent: textColorFor(accent),
  }

  const generatedAt = new Date()
  // Header text comes from the sanitised payload (it gets drawn), but the
  // REFERENCE is derived from the raw one: it is the key that matches this PDF
  // to the CSV of the same report, and the two must not diverge just because
  // one of them ran text through toPdfText() first.
  const header = { ...documentHeader(report, opts), reportNo: deriveReportNumber(rawReport) }

  // Page chrome, stamped exactly once per page and from ONE place: autoTable's
  // didDrawPage (continuation pages of a long table) and every manual
  // addPage() below both route through it, so no page can end up headerless.
  const stampedPages = new Set<number>()
  const stampChrome = () => {
    const page = doc.getCurrentPageInfo().pageNumber
    if (stampedPages.has(page)) return
    stampedPages.add(page)
    drawMasthead(doc, layout, opts, generatedAt)
    if (page > 1) drawContinuedStrip(doc, layout, report.title, header.reportNo)
  }
  const newPage = (): number => {
    doc.addPage()
    stampChrome()
    return CONTINUED_TOP
  }

  stampChrome()
  let y = drawBanner(doc, layout, report.title)

  // Metadata panels: report details / scope & source / status stamp. All
  // three share the tallest measured height so their boxes line up.
  const panelGap = 3
  const pw = (layout.W - MARGIN * 2 - panelGap * 2) / 3
  const detailRows: [string, string][] = [
    ['No.', header.reportNo],
    ['Period', header.periodText],
    ['Entries', header.entriesText],
  ]
  const scopeRows: [string, string][] = [
    ['Scope', header.scopeText],
    ['Source', header.sourceText],
    ['Prepared', fmtStampDate(generatedAt)],
  ]
  const panelY = y + 4
  const panelH = Math.max(measurePanel(doc, detailRows, pw), measurePanel(doc, scopeRows, pw))
  drawPanel(doc, MARGIN, panelY, pw, panelH, 'Report details', detailRows)
  drawPanel(doc, MARGIN + pw + panelGap, panelY, pw, panelH, 'Scope & source', scopeRows)
  drawPanel(doc, MARGIN + 2 * (pw + panelGap), panelY, pw, panelH, 'Status', [], { text: 'UNAUDITED', color: accent })
  y = panelY + panelH

  y = drawHeadline(doc, layout, y + 5, report)

  const columnStyles: Record<number, Partial<Styles>> = {}
  report.columns.forEach((_, i) => { columnStyles[i] = { halign: columnAlignFor(report, i) } })

  // Honest empty state, same convention as the on-screen preview: one spanned
  // row saying so, never a table with a head and nothing under it.
  const body: RowInput[] = report.rows.length > 0
    ? report.rows.map((row) => row.map((cell, i) => formatCell(cell, report.columnFormats?.[i], opts)))
    : [[{
        content: 'No records in this period.',
        colSpan: report.columns.length,
        styles: { halign: 'left', textColor: [...INK_MUTED] as [number, number, number], fontStyle: 'italic' as const },
      }]]
  const foot = hasTotalsRow(report)
    ? [report.totals!.map((cell, i) => formatTotalsCell(cell, report.columnFormats?.[i], opts))]
    : undefined

  y = drawSectionBar(doc, layout, 'Itemised detail', y + 5)

  autoTable(doc, {
    startY: y,
    head: [report.columns],
    body,
    foot,
    styles: { fontSize: 7.4, cellPadding: 1.5, lineColor: [...RULE] as [number, number, number], lineWidth: 0.15, textColor: [...INK] as [number, number, number] },
    headStyles: { fillColor: accent, textColor: layout.inkOnAccent, fontStyle: 'bold', fontSize: 6.8, cellPadding: { top: 2, bottom: 2, left: 1.5, right: 1.5 } },
    footStyles: { fillColor: [...DARK] as [number, number, number], textColor: [255, 255, 255], fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [...TINT] as [number, number, number] },
    columnStyles,
    // The totals row is a GRAND total, so it belongs at the end of the table
    // and nowhere else — autoTable repeats `foot` on every page by default,
    // which made a 3-page report look like it totalled 142 deaths three times.
    showFoot: 'lastPage',
    // top: continuation pages start clear of the repeated masthead.
    // bottom: the table can never draw into the footer band.
    margin: { left: MARGIN, right: MARGIN, top: CONTINUED_TOP, bottom: FOOTER_HEIGHT + 4 },
    // Repeats the masthead (and the "continued" strip) on every page the
    // table spills onto — this was an empty no-op before (#376 review
    // defect 1), so a 60-row report produced headerless pages 2+.
    didDrawPage: stampChrome,
  })

  const lastAutoTable = (doc as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable
  y = (lastAutoTable?.finalY ?? y) + 7

  // Prose: basis paragraph, then the notes as bullets.
  const proseBlocks: ProseBlock[] = []
  if (report.basis) proseBlocks.push({ text: report.basis, size: 7.6, lead: 3.4, gapAfter: 2.4 })
  for (const note of report.notes ?? []) {
    proseBlocks.push({ text: note, size: 7.6, lead: 3.4, gapAfter: 2, bullet: true })
  }
  if (proseBlocks.length > 0) {
    // Break BEFORE the section bar if the bar plus its first block would not
    // fit: a dark heading alone at the foot of a page, with the prose starting
    // overleaf, reads as a rendering fault rather than a section.
    const first = proseBlocks[0]
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(first.size)
    const firstLines = (doc.splitTextToSize(
      first.text, layout.W - MARGIN * 2 - (first.bullet ? BULLET_INDENT : 0),
    ) as string[]).length
    const need = 6 + 3.5 + firstLines * first.lead + first.gapAfter
    if (y + need > maxContentY(layout.H)) y = newPage()
    y = drawSectionBar(doc, layout, 'Notes & basis of preparation', y) + 3.5
    y = drawProseBlocks(doc, layout, proseBlocks, y, newPage)
  }
  y = drawCallout(doc, layout, y + 2, newPage)

  // Footers for EVERY page, stamped once here so "Page N of M" is exact.
  const total = doc.getNumberOfPages()
  for (let p = 1; p <= total; p++) {
    doc.setPage(p)
    doc.setDrawColor(...RULE)
    doc.setLineWidth(0.2)
    doc.line(MARGIN, layout.H - FOOTER_HEIGHT + 2, layout.W - MARGIN, layout.H - FOOTER_HEIGHT + 2)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(6.4)
    doc.setTextColor(...INK_FAINT)
    const left = [opts.farmName || 'IFMS', header.reportNo, `Generated ${fmtStampDate(generatedAt)}`, 'Unaudited management report']
      .filter(Boolean).join('  ·  ')
    doc.text(left, MARGIN, layout.H - FOOTER_HEIGHT + 6.5)
    doc.text(`Page ${p} of ${total}`, layout.W - MARGIN, layout.H - FOOTER_HEIGHT + 6.5, { align: 'right' })
  }

  return doc
}

export async function downloadReportPdf(report: ReportPayload, filename: string, opts: ExportOptions = {}) {
  const doc = await buildReportPdf(report, opts)
  doc.save(filename)
}
