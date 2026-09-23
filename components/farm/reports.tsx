'use client';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNav, TopNav } from './navigation';
import { useToast } from './ui-shared';
import { apiClient } from '@/lib/request';
import type { ReportPayload } from '@/lib/report-types';
import { periodDateRange } from '@/lib/period-range';
import { downloadReportCsv, downloadReportPdf, type ExportOptions } from '@/lib/report-export';
import { ReportDocumentPreview } from './report-document';
import {
  FileText, Download, ChevronLeft,
  DollarSign, BarChart3, ClipboardList, Syringe, Wheat, Users, PieChart, Scale, Layers,
  type LucideIcon,
} from './icons';
import { cn } from '@/lib/utils';
import { PageHeader } from '@/components/ui-kit/page-header';
import { Badge } from '@/components/ui-kit/badge';
import { Button } from '@/components/ui-kit/button';
import { EmptyState } from '@/components/ui-kit/empty-state';

// ── Restyle pass (ui/governance-reference-redesign, package F) ─────────────
// Ports src/components/reports/reports-page.tsx's picker+document layout:
// a report catalogue on the left, the report as a designed "document" (paper
// panel, masthead, sections, totals) as the hero on the right, export
// actions attached to that document. Mobile: picker -> full-screen document
// -> sticky export bar. No data call, endpoint, report type or export format
// below changed — only the layout around the already-real ReportDocumentPreview.

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
  { id: 'production', name: 'Production Summary', desc: 'What you harvested and collected', icon: BarChart3, color: 'var(--accent-blue)' },
  { id: 'mortality', name: 'Mortality Report', desc: 'Deaths by batch, cause, date', icon: ClipboardList, color: 'var(--status-warning)' },
  { id: 'vaccination', name: 'Vaccination / Treatment Log', desc: 'Treatments filed, animals treated', icon: Syringe, color: 'var(--accent-purple)' },
  { id: 'feed', name: 'Feed Consumption', desc: 'Feed per batch, FCR analysis', icon: Wheat, color: 'var(--accent-cyan)' },
  { id: 'labour', name: 'Labour & Task Cost', desc: 'Hours per batch — not recorded yet', icon: Users, color: 'var(--accent-amber)' },
  { id: 'batch-pl', name: 'Batch P&L', desc: 'Per-batch economics & margin', icon: PieChart, color: 'var(--primary-green)' },
  { id: 'fcr', name: 'FCR & Efficiency', desc: 'Feed conversion by species', icon: Scale, color: 'var(--accent-blue)' },
  // forms-audit slice, item 7: GET /api/reports/dimension-pl has existed
  // since dimensions-on-gl with no way into it from Reports at all —
  // Reporting dimensions' own "P&L by dimension" button opened this exact
  // picker with nothing selected, a dead end for the report the whole
  // screen exists to set up.
  { id: 'dimension-pl', name: 'P&L by Dimension', desc: 'Revenue & expense, rolled up by farm, unit, batch or enterprise', icon: Layers, color: 'var(--accent-purple)' },
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
  'dimension-pl': '/api/reports/dimension-pl',
};

// The four built-in system dimensions (db/schemas/dimensions.ts's seed) —
// the level a dimension-pl report groups by. Not fetched from GET
// /api/dimensions: that register also holds a tenant's own archived/custom
// dimensions, and this picker is deliberately scoped to the ones every
// tenant actually has, matching what the audit asked for by name.
const DIMENSION_LEVEL_OPTIONS: { code: string; label: string }[] = [
  { code: 'FARM', label: 'Farm' },
  { code: 'UNIT', label: 'Unit' },
  { code: 'BATCH', label: 'Batch' },
  { code: 'ENTERPRISE', label: 'Enterprise' },
];

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
  const { tenantId, role, activeFarmId, farms, params } = useNav();
  const { showToast } = useToast();
  /* The default report window is the CURRENT month, computed at mount.
   *
   * It used to be a hardcoded '2026-08-01' → '2026-08-31' — the last surviving
   * piece of the old static mock's "August 2026" period (lib/period-range.ts's
   * header documents that same fixed label being removed from Finance). Nothing
   * ever reset it, so months later a farmer tapping a report type and hitting
   * Export got a real, correctly-computed P&L or mortality report for a period
   * they never chose, labelled and filed under that period's dates as if it
   * were current. Wrong data is obvious; right data for the wrong month is not.
   *
   * Uses the same periodDateRange() helper Finance's period toggle already
   * uses, so "this month" means the same thing on both screens. `to` is today,
   * not month-end: a report cannot cover days that haven't happened. */
  const initialRange = useMemo(() => periodDateRange('month'), []);
  const [dateFrom, setDateFrom] = useState(initialRange.from);
  const [dateTo, setDateTo] = useState(initialRange.to);
  // forms-audit slice, item 7: a deep link (Reporting dimensions' "P&L by
  // dimension" button) can land straight on a report pre-selected, instead
  // of the plain picker every other entry point opens to.
  const [selected, setSelected] = useState<string | null>(() => params.report ?? null);
  const [dimensionCode, setDimensionCode] = useState(() => params.dimension || 'FARM');

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
      if (res.success) { setAuditorLink(res.data); setCopied(false); showToast('Auditor link is live for about 8 hours.', 'success'); }
      else { setAuditorError(res.error || 'Could not generate the link.'); showToast(res.error || 'Could not generate the link.', 'error'); }
    });
  }

  function handleRevokeAuditorLink() {
    setAuditorBusy(true);
    setAuditorError('');
    apiClient.delete('/api/auditor-link').then((res) => {
      setAuditorBusy(false);
      if (res.success) { setAuditorLink(null); showToast('Auditor link revoked.', 'success'); }
      else { setAuditorError(res.error || 'Could not revoke the link.'); showToast(res.error || 'Could not revoke the link.', 'error'); }
    });
  }

  function handleCopyAuditorLink() {
    if (!auditorLink) return;
    const url = `${window.location.origin}/auditor/${auditorLink.token}`;
    navigator.clipboard?.writeText(url).then(() => {
      setCopied(true);
      showToast('Link copied.', 'success');
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
    const qs = new URLSearchParams({ tenantId, from: dateFrom, to: dateTo, farmId: activeFarmId });
    // dimension-pl (item 7) takes a dimension code instead of a farm filter
    // — the dimension level IS the grouping, so `farmId` above is simply
    // unused by that one endpoint rather than conflicting with it.
    if (selected === 'dimension-pl') qs.set('dimension', dimensionCode);
    apiClient.get<ReportPayload>(`${endpoint}?${qs.toString()}`).then((res) => {
      setLoading(false);
      if (res.success) { setReport(res.data); setReportError(''); }
      else { setReport(null); setReportError(res.error || 'Failed to generate report.'); }
    });
  }, [endpoint, tenantId, dateFrom, dateTo, activeFarmId, selected, dimensionCode]);

  useEffect(() => { loadReport(); }, [loadReport]);

  function handleExportCsv() {
    if (!report || !reportType) return;
    const filename = `${reportType.id}-${dateFrom}_to_${dateTo}.csv`;
    downloadReportCsv(report, filename, { ...fullExportOpts, status: 'Generated' });
    setRecentExports((prev) => [{ name: `${reportType.name} – ${dateFrom} to ${dateTo}`, generated: fmtTimestamp(new Date()), format: 'CSV' as const }, ...prev].slice(0, 8));
    showToast('CSV downloaded.', 'success');
  }

  async function handleExportPdf() {
    if (!report || !reportType) return;
    const filename = `${reportType.id}-${dateFrom}_to_${dateTo}.pdf`;
    await downloadReportPdf(report, filename, { ...fullExportOpts, status: 'Generated' });
    setRecentExports((prev) => [{ name: `${reportType.name} – ${dateFrom} to ${dateTo}`, generated: fmtTimestamp(new Date()), format: 'PDF' as const }, ...prev].slice(0, 8));
    showToast('PDF downloaded.', 'success');
  }

  const isRealType = selected ? Boolean(REPORT_ENDPOINTS[selected]) : false;
  const canExport = isRealType && !!report && !loading;

  return (
    <div className="screen-content">
      <TopNav title="" />
      <div className="px-screen pt-3 pb-10">
        <PageHeader
          kicker="Company"
          title="Reports"
          lede="Official packs from the same ledger as Finance. Export and share a read-only link."
        />

        {/* Date range picker */}
        <div className="mt-5 rounded-xl bg-surface p-4 shadow-(--shadow-border)">
          <div className="section-eyebrow" style={{ marginBottom: 10 }}>Date Range</div>
          <div className="grid grid-cols-2 gap-3">
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

        {/* Picker (catalogue) + document (hero), reference's two-pane shape.
            Mobile: only one pane shows at a time — picker until a report is
            selected, then the document full-screen with a back link. */}
        <div className="mt-5 grid min-w-0 gap-4 lg:grid-cols-[minmax(0,18rem)_minmax(0,1fr)]">
          <nav className={cn('min-w-0 rounded-xl bg-surface p-2 shadow-(--shadow-border)', selected && 'hidden lg:block')}>
            {REPORT_TYPES.map((r) => {
              const isSel = selected === r.id;
              // owner-roast finding #7: 'labour' used to be selectable exactly
              // like every real report — tapping it just moved `selected` to a
              // dead end that only THEN told you it doesn't work. A report with
              // no real endpoint (REPORT_ENDPOINTS) is now a dead door you can
              // see is closed, not one that opens onto disappointment.
              const isUnavailable = !REPORT_ENDPOINTS[r.id];
              return (
                <button key={r.id}
                  type="button"
                  disabled={isUnavailable}
                  aria-disabled={isUnavailable}
                  onClick={() => { if (!isUnavailable) setSelected(isSel ? null : r.id); }}
                  className={cn(
                    'flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left',
                    isUnavailable ? 'cursor-not-allowed opacity-55' : isSel ? 'bg-primary-soft' : 'hover:bg-surface-2',
                  )}
                >
                  <span className="icon-tile sm shrink-0" style={{ background: `color-mix(in srgb, ${r.color} 16%, var(--card))`, color: r.color }}>
                    <r.icon size={16} aria-hidden="true" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-1.5">
                      <span className="text-sm font-medium">{r.name}</span>
                      {isUnavailable && <Badge variant="warning">Not available</Badge>}
                      {isSel && !isUnavailable && <Badge variant="success">Selected</Badge>}
                    </span>
                    <span className="mt-0.5 block text-xs text-muted">{r.desc}</span>
                    {isUnavailable && NOT_AVAILABLE_REASONS[r.id] && (
                      <span className="mt-1 block text-xs text-subtle">{NOT_AVAILABLE_REASONS[r.id]}</span>
                    )}
                  </span>
                </button>
              );
            })}
          </nav>

          <div className={cn('min-w-0', !selected && 'hidden lg:block')}>
            {!selected && (
              <EmptyState icon={<FileText size={20} />} title="Pick a report" body="Choose a report on the left to see it rendered as a document you can export or share." />
            )}
            {selected && isRealType && (
              <>
                <button type="button" onClick={() => setSelected(null)} className="mb-3 inline-flex items-center gap-1 text-sm text-muted lg:hidden">
                  <ChevronLeft size={14} /> All reports
                </button>
                {/* forms-audit slice, item 7: the dimension selector the
                    audit asked for by name (farm / unit / batch /
                    enterprise) — the report re-generates the moment it
                    changes, same as the date range above. */}
                {selected === 'dimension-pl' && (
                  <div className="mb-4 rounded-xl bg-surface p-3 shadow-(--shadow-border)">
                    <div className="mb-2 text-xs font-semibold text-muted">Group by</div>
                    <div className="flex flex-wrap gap-2">
                      {DIMENSION_LEVEL_OPTIONS.map((opt) => (
                        <button
                          key={opt.code} type="button" onClick={() => setDimensionCode(opt.code)}
                          className={cn(
                            'min-h-11 rounded-full px-3.5 text-sm font-medium',
                            dimensionCode === opt.code ? 'bg-primary text-primary-fg' : 'bg-surface-2 text-muted',
                          )}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {loading && (
                  <div className="rounded-xl bg-surface p-4 text-sm text-muted shadow-(--shadow-border)">Generating report…</div>
                )}
                {!loading && reportError && (
                  <div className="rounded-xl bg-surface p-4 text-sm text-danger shadow-(--shadow-border)">{reportError}</div>
                )}
                {!loading && !reportError && report && (
                  <>
                    <ReportDocumentPreview report={report} opts={fullExportOpts} farmLabel={activeFarmName} />
                    {/* Export actions attached to the document; sticky above
                        the mobile bottom tab bar (matches ui-customise.tsx's
                        sticky save-bar convention: bottom: 80 clears it and
                        its safe-area inset). */}
                    {canExport && (
                      <div className="flex gap-2 rounded-xl bg-surface p-2 shadow-(--shadow-raised) lg:static lg:shadow-(--shadow-border)" style={{ position: 'sticky', bottom: 80 }}>
                        <Button className="flex-1 justify-center" onClick={handleExportPdf}><Download size={14} /> Export PDF</Button>
                        <Button variant="secondary" className="flex-1 justify-center" onClick={handleExportCsv}>Export CSV</Button>
                      </div>
                    )}
                  </>
                )}
              </>
            )}
          </div>
        </div>

        {/* Auditor link */}
        <div className="farm-card" style={{ padding: 14, marginBottom: 14, border: '1px solid rgba(var(--purple-rgb),0.3)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <div style={{ fontSize: 'var(--fs-base)', fontWeight: 700, color: 'var(--text-primary)' }}>Secure read-only share</div>
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
                {auditorBusy ? 'Working…' : auditorLink ? 'Revoke Link' : 'Generate Secure Link'}
              </button>
              {auditorError && (
                <div style={{ marginTop: 8, fontSize: 'var(--fs-xs)', color: 'var(--status-critical)' }}>{auditorError}</div>
              )}
              {auditorLink && (
                <div style={{ marginTop: 10, padding: '10px 12px', background: 'rgba(var(--purple-rgb),0.06)', borderRadius: 10, border: '1px solid rgba(var(--purple-rgb),0.2)' }}>
                  <div style={{ fontSize: 'var(--fs-2xs)', color: 'var(--text-muted)', marginBottom: 4 }}>Temporary link (expires {fmtExpiry(auditorLink.expiresAt)}):</div>
                  <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--accent-purple)', fontFamily: 'monospace', wordBreak: 'break-all', padding: '6px 8px', background: 'rgba(var(--purple-rgb),0.08)', borderRadius: 6 }}>
                    {typeof window !== 'undefined' ? `${window.location.origin}/auditor/${auditorLink.token}` : `/auditor/${auditorLink.token}`}
                  </div>
                  <button
                    onClick={handleCopyAuditorLink}
                    style={{ marginTop: 8, padding: '6px 14px', borderRadius: 8, fontSize: 'var(--fs-xs)', fontWeight: 700, background: 'rgba(var(--purple-rgb),0.15)', border: '1px solid rgba(var(--purple-rgb),0.3)', color: 'var(--accent-purple)', cursor: 'pointer' }}
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

