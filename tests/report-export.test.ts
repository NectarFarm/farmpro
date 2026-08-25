// ── lib/report-export.ts pure helpers (issue #376 Gap 7) ────────────────────
// The rebuilt export path is mostly DOM/jsPDF code, but its CONTRACT lives in
// four pure helpers that everything (CSV, PDF, on-screen preview) routes
// through:
//
//   presentableMeta()   — the ONLY way `meta` reaches a document. Its job is
//                         to make it impossible for tenantId (or any raw UUID)
//                         to be printed into a file that gets handed to a
//                         bank or auditor.
//   deriveReportNumber()— stable reference per (title, range, scope); must
//                         never embed the raw identifiers it hashed.
//   parseAccentColor()/ — user input from tenant_settings; malformed values
//   textColorFor()        must fall back, never render black-on-black.
//   reportToCsv()/      — the exported file must agree with the screen: it
//   formatCell()          carries the period/basis/notes as labelled trailing
//                         rows (NOT a `#` preamble, which naive importers read
//                         as data — see the test below) and formats cells
//                         through the SAME function the preview uses.
//   toPdfText()         — jsPDF's standard fonts are WinAnsi-only; report
//                         prose that contains "≥" must degrade to ASCII rather
//                         than print garbage glyphs.
//
// These are plain functions with no DOM/jsPDF dependency, so they're tested
// directly (same convention as tests/nav-tab-badges.test.ts).
import { describe, it, expect } from 'vitest'
import {
  parseAccentColor,
  textColorFor,
  deriveReportNumber,
  presentableMeta,
  formatCell,
  formatTotalsCell,
  toPdfText,
  reportToCsv,
} from '@/lib/report-export'
import type { ReportPayload } from '@/lib/report-types'

const TENANT_ID = 'a1b2c3d4-e5f6-7890-abcd-ef0123456789'

function payload(overrides: Partial<ReportPayload> = {}): ReportPayload {
  return {
    title: 'Mortality Report',
    meta: {
      tenantId: TENANT_ID,
      from: '2026-08-01',
      to: '2026-08-31',
      farmId: 'ALL',
      recordCount: 37,
      totalDeaths: 142,
      periodLabel: '01/08/2026 – 31/08/2026',
    },
    columns: ['Date', 'Batch', 'Deaths', 'Cause'],
    rows: [['02/08/2026', 'BRO-KMU-022', 12, 'Coccidiosis']],
    ...overrides,
  }
}

describe('parseAccentColor()', () => {
  it('parses a valid #rrggbb value', () => {
    expect(parseAccentColor('#4ade80')).toEqual([74, 222, 128])
    expect(parseAccentColor('#4A7C59'.toUpperCase())).toEqual([74, 124, 89])
  })

  it('falls back on malformed user input instead of rendering black/transparent', () => {
    // A malformed accentColor must NOT become [0,0,0] (black masthead) or NaN.
    const fallback = parseAccentColor('not-a-colour')
    const fallback2 = parseAccentColor('#12345') // wrong length
    const fallback3 = parseAccentColor(undefined)
    expect(fallback).toEqual(fallback2)
    expect(fallback2).toEqual(fallback3)
    expect(fallback.every((v) => Number.isFinite(v) && v > 0)).toBe(true)
  })
})

describe('textColorFor()', () => {
  it('picks dark ink on light accents and white on dark ones', () => {
    const [r1] = textColorFor([74, 222, 128]) // #4ade80 — light green
    expect(r1).toBeLessThan(100) // dark ink
    const [r2] = textColorFor([38, 42, 39]) // near-black
    expect(r2).toBe(255) // white ink
  })
})

describe('deriveReportNumber()', () => {
  it('is deterministic for the same title + range + scope', () => {
    expect(deriveReportNumber(payload())).toBe(deriveReportNumber(payload()))
  })

  it('changes when range or scope changes', () => {
    const otherRange = payload({ meta: { ...payload().meta, from: '2026-07-01' } })
    const otherScope = payload({ meta: { ...payload().meta, farmId: 'ALLX' } })
    expect(deriveReportNumber(otherRange)).not.toBe(deriveReportNumber(payload()))
    expect(deriveReportNumber(otherScope)).not.toBe(deriveReportNumber(payload()))
  })

  it('never embeds the raw identifiers it hashed (RPT-XXXXXXXX shape only)', () => {
    const no = deriveReportNumber(payload({ meta: { ...payload().meta, farmId: TENANT_ID } }))
    expect(no).toMatch(/^RPT-[0-9A-F]{8}$/)
    expect(no).not.toContain(TENANT_ID.slice(0, 8))
    expect(no.includes('-') && no.split('-').length).toBe(2)
  })
})

describe('presentableMeta()', () => {
  it('never lets tenantId through', () => {
    const entries = presentableMeta(payload())
    expect(entries.find((e) => e.label.toLowerCase().includes('tenant'))).toBeUndefined()
    expect(JSON.stringify(entries)).not.toContain(TENANT_ID)
  })

  it('maps farmId=ALL to "All farms"', () => {
    const entries = presentableMeta(payload())
    expect(entries.find((e) => e.label === 'Farm Id')?.value).toBe('All farms')
  })

  it("replaces a real farms.id UUID with the caller's farm label, and drops it without one", () => {
    const p = payload({ meta: { ...payload().meta, farmId: TENANT_ID } })
    expect(presentableMeta(p, { farmLabel: 'Kamau Poultry' }).find((e) => e.label === 'Farm Id')?.value).toBe('Kamau Poultry')
    // Without a label the UUID is DROPPED, not printed.
    expect(presentableMeta(p).find((e) => e.label === 'Farm Id')).toBeUndefined()
    expect(JSON.stringify(presentableMeta(p))).not.toContain(TENANT_ID)
  })

  it('drops any OTHER key carrying a bare UUID value', () => {
    const p = payload({ meta: { ...payload().meta, sourceRef: TENANT_ID } })
    expect(presentableMeta(p).find((e) => e.label === 'Source Ref')).toBeUndefined()
  })

  it('labels camelCase keys readably and formats integers with separators', () => {
    const entries = presentableMeta(payload())
    expect(entries.find((e) => e.label === 'Record Count')?.value).toBe('37')
    expect(entries.find((e) => e.label === 'Period Label')?.value).toContain('/2026')
  })

  it('skips empty and non-primitive values', () => {
    const p = payload({ meta: { ...payload().meta, nothing: '', nul: null, obj: { x: 1 }, flag: true } })
    const labels = presentableMeta(p).map((e) => e.label)
    expect(labels).not.toContain('Nothing')
    expect(labels).not.toContain('Nul')
    expect(labels).not.toContain('Obj')
    expect(labels).not.toContain('Flag')
  })
})

describe('formatCell()', () => {
  it('formats money with symbol and thousands separators', () => {
    expect(formatCell(145000, 'money', { currencySymbol: 'KSh' })).toBe('KSh 145,000.00')
  })

  it('formats weights with the tenant unit', () => {
    expect(formatCell(1250, 'weight', { weightUnit: 'kg' })).toBe('1,250 kg')
  })

  it('renders null as an em dash — never as 0 or "null"', () => {
    expect(formatCell(null, 'number')).toBe('—')
    expect(formatCell(null, undefined)).toBe('—')
  })
})

describe('reportToCsv()', () => {
  it('starts with the real header row so a naive import gets the right columns', () => {
    // Deliberate reversal of the original `#`-preamble design: Excel and
    // pandas.read_csv() with default settings treat `# ...` lines as DATA, so
    // a leading preamble made "# Mortality Report" the header row and lost
    // every column name. The header row must come first.
    const csv = reportToCsv(payload({ basis: 'Compiled from worker-submitted mortality records.' }))
    expect(csv.split('\n')[0]).toBe('Date,Batch,Deaths,Cause')
    expect(csv.startsWith('#')).toBe(false)
  })

  it('carries attribution as labelled trailing rows after a blank separator', () => {
    const csv = reportToCsv(
      payload({
        basis: 'Compiled from worker-submitted mortality records.',
        notes: ['Cause is worker-entered, not vet-confirmed.'],
      }),
    )
    const lines = csv.split('\n')
    const blank = lines.indexOf('')
    expect(blank).toBeGreaterThan(1) // header + at least one data row precede it
    const tail = lines.slice(blank + 1).join('\n')
    expect(tail).toContain('# Report,Mortality Report')
    expect(tail).toContain('# Reference,RPT-')
    expect(tail).toContain('01/08/2026 – 31/08/2026')
    expect(tail).toContain('# Basis,Compiled from worker-submitted mortality records.')
    expect(tail).toContain('# Note 1,"Cause is worker-entered, not vet-confirmed."')
  })

  it('never writes tenantId into the file', () => {
    const csv = reportToCsv(payload())
    expect(csv).not.toContain(TENANT_ID)
    expect(csv).not.toContain('tenantId')
  })

  it('formats cells through formatCell so screen and file agree, and appends the totals row', () => {
    const csv = reportToCsv(
      payload({
        columns: ['Batch', 'Revenue'],
        rows: [['BRO-KMU-022', 322000]],
        totals: [null, 322000],
        columnFormats: ['text', 'money'],
      }),
      { currencySymbol: 'KSh' },
    )
    // RFC-4180: "KSh 322,000.00" contains a comma, so it MUST be quoted —
    // otherwise the thousands separator would split into two CSV fields and
    // every downstream parser would read a 3-column row from a 2-column table.
    expect(csv).toContain('BRO-KMU-022,"KSh 322,000.00"')
    // The totals row's empty cells are structural padding, so they are blank
    // rather than formatCell's em dash (which means "no value recorded"), and
    // the row sits directly above the blank attribution separator.
    expect(csv).toContain(',"KSh 322,000.00"\n\n')
  })
})

describe('formatTotalsCell()', () => {
  it('renders a structural empty totals cell blank, not as an em dash', () => {
    // A body cell's em dash means "no value recorded"; a totals row's empty
    // cells are just columns that nothing is being totalled in.
    expect(formatTotalsCell(null, 'number')).toBe('')
    expect(formatTotalsCell('', 'text')).toBe('')
    expect(formatTotalsCell(142, 'number')).toBe('142')
  })
})

describe('toPdfText()', () => {
  it('degrades symbols Helvetica/WinAnsi cannot encode to ASCII', () => {
    // Real regression: the FCR headline caption "need ≥2 weight samples + feed"
    // printed as `need "e2 weight samples + feed` in an exported PDF.
    expect(toPdfText('need ≥2 weight samples')).toBe('need >=2 weight samples')
    expect(toPdfText('a ≤ b, c ≈ d, e ≠ f')).toBe('a <= b, c ~ d, e != f')
    expect(toPdfText('2250 → 2490')).toBe('2250 -> 2490')
  })

  it('leaves characters WinAnsi DOES encode alone', () => {
    // Em/en dashes, the bullet, the ellipsis, ÷ and × all survive — they are
    // what the report prose actually uses.
    const keep = '01/08/2026 – 31/08/2026 — feed ÷ (gain × head) • note… 30°C µg'
    expect(toPdfText(keep)).toBe(keep)
  })

  it('replaces anything still unrepresentable with a visible placeholder', () => {
    // An emoji (the reason exports draw an initials badge instead of
    // tenant_settings.logoEmoji) must not become a random glyph.
    // Iterated by code point, so an astral emoji becomes ONE placeholder.
    expect(toPdfText('🌾 Harvest')).toBe('? Harvest')
    expect(toPdfText('ферма')).toBe('?????')
  })
})
