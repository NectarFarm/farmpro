// ── lib/report-export.ts PDF layout (issue #376 Gap 7 + review defect 1) ────
// Issue #376's acceptance criteria include: "a report with 60+ rows paginates
// with masthead and footer repeated, and no row lost at a page boundary".
// That was NOT true when the renderer shipped — `didDrawPage` was an empty
// no-op, so every page after the first came out with no masthead at all.
//
// buildReportPdf() exists (split out of downloadReportPdf) so the layout can
// be built headlessly: jsPDF runs fine under Node, only `doc.save()` needs a
// browser. These tests inspect the REAL generated PDF byte stream — jsPDF
// writes uncompressed content streams with WinAnsi text literals, so a string
// that was drawn is findable in `doc.output()`, and one that was not is not.
import { describe, it, expect } from 'vitest'
import { buildReportPdf } from '@/lib/report-export'
import type { ReportPayload } from '@/lib/report-types'

const TENANT_ID = 'a1b2c3d4-e5f6-7890-abcd-ef0123456789'

// Masthead-only strings: neither appears in the banner, the panels or the
// footer, so counting them counts mastheads.
const MASTHEAD_MARK = 'REPORT GENERATED'
const ROWS = 90

function bigReport(overrides: Partial<ReportPayload> = {}): ReportPayload {
  return {
    title: 'Mortality Report',
    meta: {
      tenantId: TENANT_ID,
      from: '2026-08-01',
      to: '2026-08-31',
      farmId: 'ALL',
      recordCount: ROWS,
      periodLabel: '01/08/2026 – 31/08/2026',
    },
    columns: ['Date', 'Batch', 'Deaths', 'Cause'],
    rows: Array.from({ length: ROWS }, (_, i) => [
      '02/08/2026',
      `ROWMARK${String(i).padStart(3, '0')}`,
      i,
      'Coccidiosis',
    ]),
    headline: [
      { label: 'Total deaths', value: '142', caption: 'head, 01/08/2026 – 31/08/2026' },
      { label: 'Records filed', value: '90', caption: 'worker submissions' },
    ],
    notes: [
      'Cause is as entered by the recording worker and is not veterinary-confirmed.',
      'Mortality counts are taken at submission time; the batch headcount ledger remains the authoritative running total.',
    ],
    basis: 'Compiled from worker-submitted mortality records for the period above, across all farms.',
    totals: [null, null, 142, null],
    columnAlign: ['left', 'left', 'right', 'left'],
    columnFormats: ['text', 'text', 'number', 'text'],
    ...overrides,
  }
}

function occurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1
}

describe('buildReportPdf() pagination', () => {
  it('paginates a 90-row report and repeats the masthead + footer on every page', async () => {
    const doc = await buildReportPdf(bigReport(), { farmName: 'Kamau Poultry Farm', farmCode: 'KMU-01' })
    const pages = doc.getNumberOfPages()
    expect(pages).toBeGreaterThan(1)

    const out = doc.output()
    // One masthead per page — the defect this test exists for produced 1.
    expect(occurrences(out, MASTHEAD_MARK)).toBe(pages)
    // "Page N of M" on every page, with M equal to the real page count.
    for (let p = 1; p <= pages; p++) {
      expect(out).toContain(`Page ${p} of ${pages}`)
    }
    // Continuation pages say which document they belong to. Matched on the
    // ASCII tail only: jsPDF re-encodes the em dash to its WinAnsi byte, so
    // the JS string with a literal em dash never appears in the stream
    // (pdftotext on a rendered file confirms it round-trips as an em dash).
    expect(occurrences(out, 'CONTINUED')).toBe(pages - 1)
  })

  it('loses no row at a page boundary', async () => {
    const doc = await buildReportPdf(bigReport())
    const out = doc.output()
    const missing: string[] = []
    for (let i = 0; i < ROWS; i++) {
      const mark = `ROWMARK${String(i).padStart(3, '0')}`
      if (occurrences(out, mark) !== 1) missing.push(mark)
    }
    expect(missing).toEqual([])
  })

  it('keeps the table clear of the footer band and the repeated masthead', async () => {
    const doc = await buildReportPdf(bigReport())
    // jspdf-autotable records the geometry it actually used; assert the table
    // never entered the footer band (14mm) nor the masthead band (26mm).
    const table = (doc as unknown as { lastAutoTable?: { finalY?: number; settings?: { margin?: { top?: number; bottom?: number } } } }).lastAutoTable
    const H = doc.internal.pageSize.getHeight()
    expect(table?.settings?.margin?.top).toBeGreaterThanOrEqual(26)
    expect(table?.settings?.margin?.bottom).toBeGreaterThanOrEqual(14)
    expect(table?.finalY ?? H).toBeLessThan(H - 14)
  })

  it('never writes tenantId or a raw UUID into the PDF', async () => {
    const doc = await buildReportPdf(
      bigReport({ meta: { ...bigReport().meta, farmId: TENANT_ID } }),
      { farmName: 'Kamau Poultry Farm' },
    )
    const out = doc.output()
    expect(out).not.toContain(TENANT_ID)
    expect(out).not.toContain('tenantId')
  })

  it('renders an honest empty state instead of a headed table with no rows', async () => {
    const doc = await buildReportPdf(bigReport({ rows: [], totals: undefined }))
    expect(doc.output()).toContain('No records in this period.')
    expect(doc.getNumberOfPages()).toBe(1)
  })

  it('fits a single-page report on one page, with its notes and callout', async () => {
    const doc = await buildReportPdf(bigReport({ rows: bigReport().rows.slice(0, 5) }))
    expect(doc.getNumberOfPages()).toBe(1)
    const out = doc.output()
    expect(out).toContain('IMPORTANT')
    expect(out).toContain('NOTES & BASIS OF PREPARATION')
    expect(out).toContain('HEADLINE FIGURES')
  })
})
