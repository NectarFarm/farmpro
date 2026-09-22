'use client';
// ── Report document preview (package F, ui/governance-reference-redesign) ──
// Extracted from reports.tsx so both Reports and the Auditor screen render
// the exact same "designed document" (masthead, sections, totals) — the
// lead's instruction that the auditor view "give it the same document
// language as Reports." No logic changed from the original component; only
// its home moved.
import React from 'react';
import type { ReportPayload } from '@/lib/report-types';
import {
  columnAlignFor, documentHeader, formatCell,
  formatTotalsCell, hasTotalsRow, initialsFor, parseAccentColor,
  presentableMeta, textColorFor, HEADER_META_KEYS, type ExportOptions,
} from '@/lib/report-export';

/* ── On-screen document preview (#376 Gap 7; SaaS reporting-template pass) ────
 * The preview used to be a chip strip over a cramped 8-row HTML table — the
 * same "debug dump" look the issue complains about in the exports, just on
 * screen. It now renders the SAME document shape lib/report-export.ts prints:
 * accent masthead with issuer identity, document-type banner, boxed
 * metadata panels, a strip of large headline figures ABOVE the table, an
 * itemised table with a header band / zebra rows / right-aligned numerics /
 * an inverted totals row, and the basis+notes as an accent-ruled callout.
 *
 * Everything it shows comes from the same helpers the export uses
 * (documentHeader, columnAlignFor, formatCell, formatTotalsCell,
 * parseAccentColor, textColorFor), so "what you see" and "what you export"
 * cannot drift apart — including the tenant's own accent colour.
 *
 * Mobile first (this ships as an Android APK): every grid is auto-fit so it
 * collapses to one or two columns on a narrow viewport, the table scrolls
 * horizontally inside its own container rather than widening the page, and
 * the masthead's long strings ellipsise instead of wrapping into the badge.
 */
const PREVIEW_ROW_CAP = 12;

// Small-caps label used for panel titles and section bars, matching the PDF's
// letter-spaced eyebrows.
const eyebrowStyle: React.CSSProperties = {
  fontSize: 'var(--fs-2xs)', fontWeight: 700, letterSpacing: '0.1em',
  textTransform: 'uppercase', color: 'var(--text-muted)',
};

// The PDF draws its section bars in near-black, which works because a page is
// always light. On screen the theme decides: a near-black band vanishes into a
// dark-farm card, and inverting it (background: var(--text-primary)) puts a
// glaring WHITE band in the middle of a dark UI. An accent tint plus an accent
// left rule reads as the same device in every theme.
function PreviewSectionBar({ label, accent }: { label: string; accent: [number, number, number] }) {
  return (
    <div style={{
      background: `rgba(${accent.join(',')},0.14)`, color: 'var(--text-primary)',
      borderLeft: `3px solid rgb(${accent.join(',')})`, borderRadius: 6,
      padding: '5px 10px', marginBottom: 8,
      fontSize: 'var(--fs-2xs)', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase',
    }}>{label}</div>
  );
}

function PreviewPanel({ title, rows, children }: { title: string; rows?: [string, string][]; children?: React.ReactNode }) {
  return (
    <div style={{ border: '1px solid var(--border-subtle)', borderRadius: 8, padding: '8px 10px', minWidth: 0 }}>
      <div style={{ ...eyebrowStyle, paddingBottom: 5, borderBottom: '1px solid var(--border-subtle)', marginBottom: 6 }}>{title}</div>
      {(rows ?? []).map(([label, value]) => (
        <div key={label} style={{ display: 'flex', gap: 8, alignItems: 'baseline', marginBottom: 3 }}>
          <span style={{ fontSize: 'var(--fs-2xs)', color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.04em', minWidth: 52, flexShrink: 0 }}>{label}</span>
          <span style={{ fontSize: 'var(--fs-xs)', fontWeight: 700, color: 'var(--text-primary)', minWidth: 0, overflowWrap: 'anywhere' }}>{value}</span>
        </div>
      ))}
      {children}
    </div>
  );
}

export function ReportDocumentPreview({ report, opts, farmLabel }: { report: ReportPayload; opts: ExportOptions; farmLabel?: string }) {
  const accent = parseAccentColor(opts.accentColor);
  const accentCss = `rgb(${accent.join(',')})`;
  const inkOnAccent = `rgb(${textColorFor(accent).join(',')})`;
  const header = documentHeader(report, opts);
  const issuer = opts.farmName || 'Integrated Farm Management System';
  const codeLine = [opts.farmCode, opts.location].filter(Boolean).join(' · ');
  // The remaining machine-facing meta — everything the header panels don't
  // already say. Still routed through presentableMeta(), which is what keeps
  // tenantId and any raw UUID out of what gets rendered; collapsed by default
  // so the document reads as a document and the raw fields stay available for
  // anyone reconciling a figure.
  const dataFields = presentableMeta(report, { farmLabel, exclude: HEADER_META_KEYS });
  const shownRows = report.rows.slice(0, PREVIEW_ROW_CAP);
  const showTotals = hasTotalsRow(report);

  return (
    <div className="farm-card" style={{ padding: 0, overflow: 'hidden', marginBottom: 16 }}>
      {/* Masthead — full-bleed, exactly as the PDF prints it. */}
      <div style={{ background: accentCss, color: inkOnAccent, padding: '12px 14px', display: 'flex', gap: 10, alignItems: 'flex-start' }}>
        <div style={{
          width: 34, height: 34, borderRadius: 8, background: 'rgba(255,255,255,0.94)', color: accentCss,
          display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          fontSize: 'var(--fs-sm)', fontWeight: 800, letterSpacing: '0.04em',
        }} aria-hidden="true">{initialsFor(opts.farmName)}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 'var(--fs-md)', fontWeight: 800, lineHeight: 1.2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{issuer}</div>
          {/* Wraps rather than ellipsises: on a 360px phone the registration
              line is the part that says WHAT issued this, and "INTEGRATED FARM
              MANAGEME…" reads like a bug. */}
          <div style={{ fontSize: 'var(--fs-2xs)', fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', opacity: 0.85, marginTop: 2, lineHeight: 1.3 }}>
            {opts.farmName ? 'Integrated Farm Management System' : 'Farm management reporting'}
          </div>
          {codeLine && (
            <div style={{ fontSize: 'var(--fs-2xs)', opacity: 0.9, marginTop: 3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{codeLine}</div>
          )}
        </div>
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <div style={{ fontSize: 'var(--fs-2xs)', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', opacity: 0.8 }}>Reference</div>
          <div style={{ fontSize: 'var(--fs-xs)', fontWeight: 800, fontFamily: 'monospace', marginTop: 2 }}>{header.reportNo}</div>
        </div>
      </div>

      <div style={{ padding: 12 }}>
        {/* Document-type banner. */}
        <div style={{
          background: accentCss, color: inkOnAccent, borderRadius: 6, padding: '7px 10px', textAlign: 'center',
          fontSize: 'var(--fs-sm)', fontWeight: 800, letterSpacing: '0.14em', textTransform: 'uppercase', marginBottom: 10,
        }}>{report.title}</div>

        {/* Metadata panels. auto-fit collapses these to one column on a phone. */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8, marginBottom: 12 }}>
          <PreviewPanel title="Report details" rows={[['No.', header.reportNo], ['Period', header.periodText], ['Entries', header.entriesText]]} />
          <PreviewPanel title="Scope & source" rows={[['Scope', header.scopeText], ['Source', header.sourceText]]} />
          <PreviewPanel title="Status">
            <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 2 }}>
              <span style={{
                border: `1px solid ${accentCss}`, color: accentCss, borderRadius: 6, padding: '4px 10px',
                fontSize: 'var(--fs-2xs)', fontWeight: 800, letterSpacing: '0.1em',
              }}>UNAUDITED</span>
            </div>
          </PreviewPanel>
        </div>

        {/* Headline figures — the same server-formatted strings the PDF sets
            large above the table. */}
        {report.headline && report.headline.length > 0 && (
          <>
            <PreviewSectionBar label="Headline figures" accent={accent} />
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(132px, 1fr))', gap: 8, marginBottom: 12 }}>
              {report.headline.slice(0, 4).map((figure, i) => (
                <div key={i} style={{
                  background: 'var(--card-hover)', border: '1px solid var(--border-subtle)', borderRadius: 8,
                  borderTop: `3px solid ${accentCss}`, padding: '8px 10px', minWidth: 0,
                }}>
                  <div style={{ ...eyebrowStyle, fontSize: 'var(--fs-2xs)' }}>{figure.label}</div>
                  <div style={{ fontSize: 'var(--fs-xl)', fontWeight: 800, color: 'var(--text-primary)', marginTop: 3, lineHeight: 1.15, overflowWrap: 'anywhere' }}>{figure.value}</div>
                  {figure.caption && (
                    <div style={{ fontSize: 'var(--fs-2xs)', color: 'var(--text-dim)', marginTop: 3, lineHeight: 1.35 }}>{figure.caption}</div>
                  )}
                </div>
              ))}
            </div>
          </>
        )}

        {/* Itemised detail. The table scrolls inside this container — a wide
            report must never widen the screen on a phone. */}
        <PreviewSectionBar label="Itemised detail" accent={accent} />
        <div style={{ overflowX: 'auto', border: '1px solid var(--border-subtle)', borderRadius: 8, marginBottom: 12 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--fs-xs)' }}>
            <thead>
              <tr>
                {report.columns.map((column, j) => (
                  <th key={column} style={{
                    background: accentCss, color: inkOnAccent, padding: '7px 9px', whiteSpace: 'nowrap',
                    textAlign: columnAlignFor(report, j), fontSize: 'var(--fs-2xs)', fontWeight: 700,
                    letterSpacing: '0.06em', textTransform: 'uppercase',
                  }}>{column}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shownRows.map((row, i) => (
                <tr key={i} style={{ background: i % 2 === 1 ? 'var(--card-hover)' : 'transparent' }}>
                  {row.map((cell, j) => (
                    <td key={j} style={{
                      padding: '7px 9px', whiteSpace: 'nowrap', color: 'var(--text-primary)',
                      borderTop: i === 0 ? 'none' : '1px solid var(--border-subtle)',
                      textAlign: columnAlignFor(report, j),
                      fontVariantNumeric: 'tabular-nums',
                    }}>{formatCell(cell, report.columnFormats?.[j], opts)}</td>
                  ))}
                </tr>
              ))}
              {report.rows.length === 0 && (
                <tr><td colSpan={report.columns.length} style={{ padding: '12px 9px', color: 'var(--text-muted)', fontStyle: 'italic' }}>No records in this period.</td></tr>
              )}
            </tbody>
            {/* Totals row. Same reason as PreviewSectionBar: the PDF's dark
                band is wrong on a dark theme, so on screen it is the
                spreadsheet convention instead — an accent rule above a tinted
                band, in bold primary ink. */}
            {showTotals && (
              <tfoot>
                <tr>
                  {report.totals!.map((cell, j) => (
                    <td key={j} style={{
                      padding: '8px 9px', background: `rgba(${accent.join(',')},0.12)`,
                      borderTop: `2px solid ${accentCss}`, color: 'var(--text-primary)',
                      fontWeight: 800, whiteSpace: 'nowrap', textAlign: columnAlignFor(report, j),
                      fontVariantNumeric: 'tabular-nums',
                    }}>{formatTotalsCell(cell, report.columnFormats?.[j], opts)}</td>
                  ))}
                </tr>
              </tfoot>
            )}
          </table>
          {report.rows.length > PREVIEW_ROW_CAP && (
            <div style={{ padding: '7px 9px', fontSize: 'var(--fs-2xs)', color: 'var(--text-muted)', borderTop: '1px solid var(--border-subtle)' }}>
              Showing {PREVIEW_ROW_CAP} of {report.rows.length} rows — the export carries the full set.
            </div>
          )}
        </div>

        {/* Basis + notes as the document's accent-ruled callout. */}
        {(report.basis || (report.notes && report.notes.length > 0)) && (
          <div style={{
            background: 'var(--card-hover)', border: '1px solid var(--border-subtle)',
            borderLeft: `3px solid ${accentCss}`, borderRadius: 8, padding: '9px 11px', marginBottom: 10,
          }}>
            <div style={{ ...eyebrowStyle, marginBottom: 5 }}>Notes &amp; basis of preparation</div>
            {report.basis && (
              <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-secondary)', lineHeight: 1.5, marginBottom: report.notes?.length ? 6 : 0 }}>{report.basis}</div>
            )}
            {(report.notes ?? []).map((note, i) => (
              <div key={i} style={{ display: 'flex', gap: 6, fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', lineHeight: 1.5, marginBottom: 3 }}>
                <span aria-hidden="true" style={{ color: accentCss, fontWeight: 800 }}>•</span>
                <span>{note}</span>
              </div>
            ))}
          </div>
        )}

        {/* Raw returned fields, collapsed — see the dataFields comment above. */}
        {dataFields.length > 0 && (
          <details style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 8 }}>
            {/* Native disclosure marker kept deliberately — it is the only
                affordance saying this row expands. */}
            <summary style={{ ...eyebrowStyle, cursor: 'pointer' }}>
              Data fields returned ({dataFields.length})
            </summary>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
              {dataFields.map((entry) => (
                <span key={entry.label} className="chip" style={{ fontSize: 'var(--fs-2xs)' }}>{entry.label}: {entry.value}</span>
              ))}
            </div>
          </details>
        )}
      </div>
    </div>
  );
}
