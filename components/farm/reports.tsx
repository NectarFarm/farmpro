'use client';
import React, { useCallback, useEffect, useState } from 'react';
import { useNav, TopNav } from './navigation';
import { apiClient } from '@/lib/request';
import type { ReportPayload } from '@/lib/report-types';
import {
  columnAlignFor, documentHeader, downloadReportCsv, downloadReportPdf, formatCell,
  formatTotalsCell, hasTotalsRow, initialsFor, parseAccentColor, presentableMeta,
  textColorFor, HEADER_META_KEYS, type ExportOptions,
} from '@/lib/report-export';
import {
  FileText, Download, AlertTriangle,
  DollarSign, BarChart3, ClipboardList, Syringe, Wheat, Users, PieChart, Scale,
  type LucideIcon,
} from './icons';

// ── Real-data wiring (issue #263) ───────────────────────────────────────────
// Seven of the eight report types below now have real backing endpoints:
//   pl / batch-pl       -> GET /api/reports/pl, GET /api/reports/batch-pl
//                           (composed from the real GL trial balance +
//                           batches/cost-breakdown, see lib/reports.ts)
//   mortality / feed    -> GET /api/reports/mortality, GET /api/reports/feed-consumption
//   production          -> GET /api/reports/production  (records type='production'
//                          — the worker portal's Collect form files these)
//   vaccination         -> GET /api/reports/vaccination (records type='health'
//                          — the Health & Vaccine form files these)
//   fcr                 -> GET /api/reports/fcr         (feeding records ÷
//                          weight-sample records; batches with fewer than two
//                          samples show "—", never an invented ratio)
// The ONLY remaining gap is `labour`: payroll COST exists (payslips), but no
// hours-worked record type does, so cost cannot be attributed per batch/task
// (see NOT_AVAILABLE_REASONS). It keeps the honest "not available yet" state
// — never a fake or empty export.
//
// Export: each endpoint returns `{ title, meta, columns, rows, headline?,
// notes?, totals? }` (lib/report-types.ts); lib/report-export.ts builds CSV
// and PDF from that one shape client-side with no per-report-type export
// code. Exports receive tenant identity/formatting options (farm name,
// accent colour, currency/weight units) fetched below.
const REPORT_TYPES: { id: string; name: string; desc: string; icon: LucideIcon; color: string }[] = [
  { id: 'pl', name: 'P&L Summary', desc: 'Revenue vs expenses by period', icon: DollarSign, color: 'var(--status-ok)' },
  { id: 'production', name: 'Production Summary', desc: 'Eggs, meat, products collected', icon: BarChart3, color: 'var(--accent-blue)' },
  { id: 'mortality', name: 'Mortality Report', desc: 'Deaths by batch, cause, date', icon: ClipboardList, color: 'var(--status-warning)' },
  { id: 'vaccination', name: 'Vaccination / Treatment Log', desc: 'Treatments filed, birds treated', icon: Syringe, color: 'var(--accent-purple)' },
  { id: 'feed', name: 'Feed Consumption', desc: 'Feed per batch, FCR analysis', icon: Wheat, color: 'var(--accent-cyan)' },
  { id: 'labour', name: 'Labour & Task Cost', desc: 'Hours, payroll, task completion', icon: Users, color: 'var(--accent-amber)' },
  { id: 'batch-pl', name: 'Batch P&L', desc: 'Per-batch economics & margin', icon: PieChart, color: 'var(--primary-green)' },
  { id: 'fcr', name: 'FCR & Efficiency', desc: 'Feed conversion by species', icon: Scale, color: 'var(--accent-blue)' },
];

// Report types with a real /api/reports/* endpoint behind them.
const REPORT_ENDPOINTS: Record<string, string> = {
  pl: '/api/reports/pl',
  'batch-pl': '/api/reports/batch-pl',
  mortality: '/api/reports/mortality',
  feed: '/api/reports/feed-consumption',
  production: '/api/reports/production',
  vaccination: '/api/reports/vaccination',
  fcr: '/api/reports/fcr',
};

// The ONE honestly-blocked report type left (#376 Gap 3): payroll cost has a
// real source (payslips), but hours worked do not exist as a record type, so
// cost cannot be split per batch or per task. Names what's actually missing
// instead of claiming tables don't exist.
const NOT_AVAILABLE_REASONS: Record<string, string> = {
  labour: 'Payroll totals already exist in the system (payslips), but there is no hours-worked record yet, so labour cost cannot be split per batch or per task.',
};

type ExportRecord = { name: string; generated: string; format: 'PDF' | 'CSV' };

function fmtTimestamp(d: Date): string {
  return d.toISOString().slice(0, 16).replace('T', ' ');
}

// Shape returned by GET/POST /api/auditor-link (issue #313).
type AuditorLink = { token: string; expiresAt: string };

function fmtExpiry(iso: string): string {
  const d = new Date(iso);
  return d.toISOString().slice(0, 16).replace('T', ' ');
}

export function ReportsScreen() {
  const { tenantId, role, activeFarmId, farms } = useNav();
  const [dateFrom, setDateFrom] = useState('2026-08-01');
  const [dateTo, setDateTo] = useState('2026-08-31');
  const [selected, setSelected] = useState<string | null>(null);

  const [report, setReport] = useState<ReportPayload | null>(null);
  const [reportError, setReportError] = useState('');
  const [loading, setLoading] = useState(false);
  const [recentExports, setRecentExports] = useState<ExportRecord[]>([]);

  // Auditor / investor link (issue #313) — real backend: GET restores
  // whatever link is currently live for the tenant on mount, POST/DELETE
  // generate/revoke it. Owner-only on the server, so only bother calling it
  // client-side for an owner session too.
  const isOwner = role === 'owner';
  const [auditorLink, setAuditorLink] = useState<AuditorLink | null>(null);
  const [auditorBusy, setAuditorBusy] = useState(false);
  const [auditorError, setAuditorError] = useState('');
  const [copied, setCopied] = useState(false);

  // Tenant identity/formatting for exports and preview (#376 Gap 7): accent
  // colour, currency/weight units come from GET /api/settings; the active
  // farm's display name comes from the farms already in nav context. All
  // optional — exports degrade to app defaults when absent.
  const [exportOpts, setExportOpts] = useState<ExportOptions>({});
  const [orgName, setOrgName] = useState('');
  useEffect(() => {
    let cancelled = false;
    apiClient.get<{ accentColor?: string; currencySymbol?: string; weightUnit?: string; orgName?: string }>(`/api/settings?tenantId=${tenantId}`).then(res => {
      if (!cancelled && res.success) {
        setExportOpts(prev => ({
          ...prev,
          accentColor: res.data.accentColor || undefined,
          currencySymbol: res.data.currencySymbol || 'KSh',
          weightUnit: res.data.weightUnit || 'kg',
        }));
        setOrgName(res.data.orgName || '');
      }
    });
    return () => { cancelled = true; };
  }, [tenantId]);

  // Masthead identity. The issuer is the ACTIVE farm when one is selected and
  // the ORGANISATION (tenants.name, via GET /api/settings) when the scope is
  // all farms. This used to read `farms[0].name`, which named the wrong farm
  // whenever the active farm was not the first in the list, and named an
  // arbitrary single farm on an all-farms report (#376 Gap 7 review defect 3).
  const activeFarm = activeFarmId === 'ALL' ? undefined : farms.find(f => f.id === activeFarmId);
  const activeFarmName = activeFarm?.name;
  const fullExportOpts: ExportOptions = {
    ...exportOpts,
    farmName: activeFarmName || orgName || undefined,
    farmCode: activeFarm?.code,
    location: activeFarm?.location,
    preparedFor: role.charAt(0).toUpperCase() + role.slice(1).replace('_', ' '),
  };

  useEffect(() => {
    if (!isOwner) return;
    apiClient.get<{ link: AuditorLink | null }>('/api/auditor-link').then((res) => {
      if (res.success) setAuditorLink(res.data.link);
    });
  }, [isOwner]);

  function handleGenerateAuditorLink() {
    setAuditorBusy(true);
    setAuditorError('');
    apiClient.post<AuditorLink>('/api/auditor-link', {}).then((res) => {
      setAuditorBusy(false);
      if (res.success) { setAuditorLink(res.data); setCopied(false); }
      else setAuditorError(res.error || 'Failed to generate link.');
    });
  }

  function handleRevokeAuditorLink() {
    setAuditorBusy(true);
    setAuditorError('');
    apiClient.delete('/api/auditor-link').then((res) => {
      setAuditorBusy(false);
      if (res.success) setAuditorLink(null);
      else setAuditorError(res.error || 'Failed to revoke link.');
    });
  }

  function handleCopyAuditorLink() {
    if (!auditorLink) return;
    const url = `${window.location.origin}/auditor/${auditorLink.token}`;
    navigator.clipboard?.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  const reportType = selected ? REPORT_TYPES.find((r) => r.id === selected) ?? null : null;
  const endpoint = selected ? REPORT_ENDPOINTS[selected] : undefined;

  // farm-scoped-data task: all seven report endpoints accept an optional
  // farmId (lib/reports.ts's compute* functions) — re-generates when the
  // active farm changes, same as every other screen's fetch.
  const loadReport = useCallback(() => {
    if (!endpoint) { setReport(null); setReportError(''); return; }
    setLoading(true);
    const params = new URLSearchParams({ tenantId, from: dateFrom, to: dateTo, farmId: activeFarmId });
    apiClient.get<ReportPayload>(`${endpoint}?${params.toString()}`).then((res) => {
      setLoading(false);
      if (res.success) { setReport(res.data); setReportError(''); }
      else { setReport(null); setReportError(res.error || 'Failed to generate report.'); }
    });
  }, [endpoint, tenantId, dateFrom, dateTo, activeFarmId]);

  useEffect(() => { loadReport(); }, [loadReport]);

  function handleExportCsv() {
    if (!report || !reportType) return;
    const filename = `${reportType.id}-${dateFrom}_to_${dateTo}.csv`;
    downloadReportCsv(report, filename, fullExportOpts);
    setRecentExports((prev) => [{ name: `${reportType.name} – ${dateFrom} to ${dateTo}`, generated: fmtTimestamp(new Date()), format: 'CSV' as const }, ...prev].slice(0, 8));
  }

  async function handleExportPdf() {
    if (!report || !reportType) return;
    const filename = `${reportType.id}-${dateFrom}_to_${dateTo}.pdf`;
    await downloadReportPdf(report, filename, fullExportOpts);
    setRecentExports((prev) => [{ name: `${reportType.name} – ${dateFrom} to ${dateTo}`, generated: fmtTimestamp(new Date()), format: 'PDF' as const }, ...prev].slice(0, 8));
  }

  const isRealType = selected ? Boolean(REPORT_ENDPOINTS[selected]) : false;
  const canExport = isRealType && !!report && !loading;

  return (
    <div className="screen-content">
      <TopNav title="Reports" subtitle="Export & share" />
      <div className="px-screen" style={{ paddingTop: 14 }}>

        {/* Date range picker */}
        <div className="farm-card" style={{ padding: 14, marginBottom: 14 }}>
          <div className="section-eyebrow" style={{ marginBottom: 10 }}>Date Range</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <label style={{ fontSize: 'var(--fs-xs)', fontWeight: 700, color: 'var(--text-secondary)', display: 'block', marginBottom: 5 }}>From</label>
              <input className="farm-input" type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} style={{ fontSize: 'var(--fs-base)' }} />
            </div>
            <div>
              <label style={{ fontSize: 'var(--fs-xs)', fontWeight: 700, color: 'var(--text-secondary)', display: 'block', marginBottom: 5 }}>To</label>
              <input className="farm-input" type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} style={{ fontSize: 'var(--fs-base)' }} />
            </div>
          </div>
        </div>

        {/* Report type selector */}
        <div className="section-eyebrow" style={{ marginBottom: 10 }}>Select a Report</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 14 }}>
          {REPORT_TYPES.map((r) => {
            const isSel = selected === r.id;
            return (
              <button key={r.id} onClick={() => setSelected(isSel ? null : r.id)}
                style={{
                  padding: 12, borderRadius: 14, textAlign: 'left', cursor: 'pointer',
                  background: isSel ? 'rgba(74,222,128,0.12)' : 'var(--card)',
                  border: isSel ? '1px solid rgba(74,222,128,0.4)' : '1px solid var(--border-subtle)',
                  transition: 'all 0.15s ease',
                }}>
                <div style={{ marginBottom: 6, color: r.color }}><r.icon size={22} aria-hidden="true" /></div>
                <div style={{ fontSize: 'var(--fs-sm)', fontWeight: 700, color: isSel ? 'var(--text-primary)' : 'var(--text-secondary)', lineHeight: 1.2, marginBottom: 3 }}>{r.name}</div>
                <div style={{ fontSize: 'var(--fs-2xs)', color: 'var(--text-muted)', lineHeight: 1.4 }}>{r.desc}</div>
                {isSel && (
                  <div style={{ marginTop: 6, display: 'flex', gap: 4 }}>
                    <span className="chip chip-ok" style={{ fontSize: 'var(--fs-2xs)', padding: '1px 6px' }}>Selected</span>
                  </div>
                )}
              </button>
            );
          })}
        </div>

        {/* Not-available state — `labour` is the only report type left with no
            real data source (see NOT_AVAILABLE_REASONS). */}
        {selected && !isRealType && (
          <div className="farm-card" style={{ padding: 14, marginBottom: 16, border: '1px solid rgba(248,113,113,0.3)' }}>
            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
              <AlertTriangle size={18} color="var(--status-warning)" style={{ flexShrink: 0, marginTop: 2 }} />
              <div>
                <div style={{ fontSize: 'var(--fs-base)', fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>Not available yet</div>
                <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', lineHeight: 1.5 }}>
                  {NOT_AVAILABLE_REASONS[selected] ?? 'This report has no real data source on this branch yet.'}
                  {' '}No export is offered for it — a placeholder or empty file would misrepresent this as real data.
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Real report: loading / error / document preview + export */}
        {selected && isRealType && (
          <>
            {loading && (
              <div className="farm-card" style={{ padding: 14, marginBottom: 16, fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' }}>Generating report…</div>
            )}
            {!loading && reportError && (
              <div className="farm-card" style={{ padding: 14, marginBottom: 16, fontSize: 'var(--fs-sm)', color: 'var(--status-critical)' }}>{reportError}</div>
            )}
            {!loading && !reportError && report && (
              <ReportDocumentPreview report={report} opts={fullExportOpts} farmLabel={activeFarmName} />
            )}
          </>
        )}

        {/* Export buttons */}
        {canExport && (
          <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
            <button className="btn-primary" style={{ flex: 1, justifyContent: 'center' }} onClick={handleExportPdf}>
              <Download size={14} /> Export PDF
            </button>
            <button className="btn-secondary" style={{ flex: 1, justifyContent: 'center' }} onClick={handleExportCsv}>
              Export CSV
            </button>
          </div>
        )}

        {/* Auditor link */}
        <div className="farm-card" style={{ padding: 14, marginBottom: 14, border: '1px solid rgba(167,139,250,0.3)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <div style={{ fontSize: 'var(--fs-base)', fontWeight: 700, color: 'var(--text-primary)' }}>Auditor / Investor Access</div>
            <span className="chip chip-purple" style={{ fontSize: 'var(--fs-2xs)' }}>~8h link</span>
          </div>
          <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', marginBottom: 12, lineHeight: 1.5 }}>
            Generate a temporary read-only link for investors or auditors. Expires in ~8 hours. They can view KPIs and export reports but cannot modify any data.
          </div>
          {!isOwner && (
            <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' }}>Only an owner can generate or revoke this link.</div>
          )}
          {isOwner && (
            <>
              <button
                onClick={auditorLink ? handleRevokeAuditorLink : handleGenerateAuditorLink}
                disabled={auditorBusy}
                className="btn-secondary"
                style={{ width: '100%', justifyContent: 'center', opacity: auditorBusy ? 0.6 : 1 }}
              >
                {auditorBusy ? 'Working…' : auditorLink ? 'Revoke Link' : 'Generate Auditor Link'}
              </button>
              {auditorError && (
                <div style={{ marginTop: 8, fontSize: 'var(--fs-xs)', color: 'var(--status-critical)' }}>{auditorError}</div>
              )}
              {auditorLink && (
                <div style={{ marginTop: 10, padding: '10px 12px', background: 'rgba(167,139,250,0.06)', borderRadius: 10, border: '1px solid rgba(167,139,250,0.2)' }}>
                  <div style={{ fontSize: 'var(--fs-2xs)', color: 'var(--text-muted)', marginBottom: 4 }}>Temporary link (expires {fmtExpiry(auditorLink.expiresAt)}):</div>
                  <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--accent-purple)', fontFamily: 'monospace', wordBreak: 'break-all', padding: '6px 8px', background: 'rgba(167,139,250,0.08)', borderRadius: 6 }}>
                    {typeof window !== 'undefined' ? `${window.location.origin}/auditor/${auditorLink.token}` : `/auditor/${auditorLink.token}`}
                  </div>
                  <button
                    onClick={handleCopyAuditorLink}
                    style={{ marginTop: 8, padding: '6px 14px', borderRadius: 8, fontSize: 'var(--fs-xs)', fontWeight: 700, background: 'rgba(167,139,250,0.15)', border: '1px solid rgba(167,139,250,0.3)', color: 'var(--accent-purple)', cursor: 'pointer' }}
                  >
                    {copied ? 'Copied!' : 'Copy Link'}
                  </button>
                </div>
              )}
            </>
          )}
        </div>

        {/* Recent exports (real: this session's actual CSV/PDF downloads, not a mock) */}
        <div className="section-eyebrow" style={{ marginBottom: 10 }}>Recent Exports (this session)</div>
        <div className="farm-card" style={{ overflow: 'hidden', marginBottom: 24 }}>
          {recentExports.length === 0 && (
            <div style={{ padding: '14px', fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 8 }}>
              <FileText size={14} /> No exports yet this session — select a report above and export it.
            </div>
          )}
          {recentExports.map((r, i) => (
            <div key={i} style={{ padding: '12px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: i < recentExports.length - 1 ? '1px solid var(--border-subtle)' : 'none' }}>
              <div>
                <div style={{ fontSize: 'var(--fs-sm)', fontWeight: 600, color: 'var(--text-primary)' }}>{r.name}</div>
                <div style={{ fontSize: 'var(--fs-2xs)', color: 'var(--text-muted)', marginTop: 1 }}>{r.generated} · {r.format}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

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

function ReportDocumentPreview({ report, opts, farmLabel }: { report: ReportPayload; opts: ExportOptions; farmLabel?: string }) {
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
