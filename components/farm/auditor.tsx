'use client';
import React, { useCallback, useEffect, useState } from 'react';
import { useNav, TopNav } from './navigation';
import { apiClient } from '@/lib/request';
import type { ReportPayload } from '@/lib/report-types';
import { downloadReportCsv, type ExportOptions } from '@/lib/report-export';
import { ReportDocumentPreview } from './report-document';
import { Eye, Download } from './icons';
import { cn } from '@/lib/utils';
import { PageHeader } from '@/components/ui-kit/page-header';
import { Badge } from '@/components/ui-kit/badge';
import { Button } from '@/components/ui-kit/button';
import { EmptyState } from '@/components/ui-kit/empty-state';

// ── Auditor read-only reports (vet/auditor screens task; restyled package F,
// ui/governance-reference-redesign) ─────────────────────────────────────────
// The auditor role was previously funneled straight to RoleNoticeScreen —
// this is their real home. Same 4 report types + endpoints as
// app/auditor/[token]/auditor-view.tsx (the token-authenticated version of
// this exact screen). Restyle pass: gives this screen the SAME document
// language as Reports (masthead/sections/totals via the shared
// ReportDocumentPreview, package F's report-document.tsx) instead of a bare
// HTML table — the lead's explicit instruction for this read-only view.
//
// Session-authenticated + tenant-scoped from the session (the difference
// from the token view) via GET /api/reports/pl|batch-pl|mortality|
// feed-consumption — those 4 routes are role-gated to
// owner/manager/super_admin/auditor (lib/reports.ts's REPORT_VIEWER_ROLES)
// and resolve tenantId from the session only. GET /api/settings is also
// readable by any authenticated tenant user (see its route header), so the
// same accent-colour/currency/farm-name masthead identity Reports uses is
// available here too — no new write capability introduced anywhere.
//
// Strictly read-only by construction: every call below is a GET, there is no
// form, button, or input anywhere on this screen that POSTs/PATCHes/DELETEs
// anything. CSV-only export (no PDF button here — parity with the token
// view, and jspdf isn't worth pulling into this bundle for a screen that
// isn't the primary Reports screen).
const REPORT_TYPES = [
  { id: 'pl', name: 'P&L Summary', desc: 'Revenue vs expenses', endpoint: '/api/reports/pl' },
  { id: 'batch-pl', name: 'Batch P&L', desc: 'Per-batch economics', endpoint: '/api/reports/batch-pl' },
  { id: 'mortality', name: 'Mortality', desc: 'Deaths by batch, cause', endpoint: '/api/reports/mortality' },
  { id: 'feed', name: 'Feed Consumption', desc: 'Feed per batch', endpoint: '/api/reports/feed-consumption' },
] as const;

type ReportTypeId = (typeof REPORT_TYPES)[number]['id'];

export function AuditorReportsScreen() {
  const { tenantId, activeFarmId, farms } = useNav();
  const [selected, setSelected] = useState<ReportTypeId>('pl');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [report, setReport] = useState<ReportPayload | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  // Same masthead identity Reports uses — real, not invented (#376 Gap 7).
  const [exportOpts, setExportOpts] = useState<ExportOptions>({});
  const [orgName, setOrgName] = useState('');
  useEffect(() => {
    let cancelled = false;
    apiClient.get<{ accentColor?: string; currencySymbol?: string; weightUnit?: string; orgName?: string }>(`/api/settings?tenantId=${tenantId}`).then((res) => {
      if (!cancelled && res.success) {
        setExportOpts((prev) => ({
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

  const activeFarm = activeFarmId === 'ALL' ? undefined : farms.find((f) => f.id === activeFarmId);
  const fullExportOpts: ExportOptions = {
    ...exportOpts,
    farmName: activeFarm?.name || orgName || undefined,
    farmCode: activeFarm?.code,
    location: activeFarm?.location,
    preparedFor: 'Auditor',
  };

  const reportType = REPORT_TYPES.find((r) => r.id === selected)!;

  const load = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams({ farmId: activeFarmId });
    if (dateFrom) params.set('from', dateFrom);
    if (dateTo) params.set('to', dateTo);
    apiClient.get<ReportPayload>(`${reportType.endpoint}?${params.toString()}`).then((res) => {
      setLoading(false);
      if (res.success) { setReport(res.data); setError(''); }
      else { setReport(null); setError(res.error || 'Failed to load this report.'); }
    });
  }, [reportType.endpoint, activeFarmId, dateFrom, dateTo]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="screen-content">
      <TopNav title="" showBell={false} />
      <div className="px-screen pt-3 pb-10">
        <PageHeader
          kicker="Read-only"
          title="Reports"
          lede="You have read-only access to this tenant's reports. Nothing here can change any data."
          actions={<Badge variant="outline"><Eye size={12} className="mr-1" /> Auditor</Badge>}
        />

        <div className="mt-5 rounded-xl bg-surface p-4 shadow-(--shadow-border)">
          <div className="section-eyebrow" style={{ marginBottom: 10 }}>Date Range</div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label style={{ fontSize: 'var(--fs-xs)', fontWeight: 700, color: 'var(--text-secondary)', display: 'block', marginBottom: 5 }}>From</label>
              <input className="farm-input" type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} style={{ fontSize: 'var(--fs-base)' }} />
            </div>
            <div>
              <label style={{ fontSize: 'var(--fs-xs)', fontWeight: 700, color: 'var(--text-secondary)', display: 'block', marginBottom: 5 }}>To</label>
              <input className="farm-input" type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} style={{ fontSize: 'var(--fs-base)' }} />
            </div>
          </div>
        </div>

        <div className="mt-5 grid min-w-0 gap-4 lg:grid-cols-[minmax(0,16rem)_minmax(0,1fr)]">
          <nav className={cn('min-w-0 rounded-xl bg-surface p-2 shadow-(--shadow-border)', selected && 'hidden lg:block')}>
            {REPORT_TYPES.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => setSelected(r.id)}
                className={cn(
                  'flex w-full flex-col items-start rounded-lg px-3 py-2.5 text-left',
                  selected === r.id ? 'bg-primary-soft' : 'hover:bg-surface-2',
                )}
              >
                <span className="text-sm font-medium">{r.name}</span>
                <span className="text-xs text-muted">{r.desc}</span>
              </button>
            ))}
          </nav>

          <div className="min-w-0">
            {loading && <div className="rounded-xl bg-surface p-4 text-sm text-muted shadow-(--shadow-border)">Loading…</div>}
            {!loading && error && (
              <EmptyState icon={<Eye size={20} />} title="Could not load this report" body={error} />
            )}
            {!loading && !error && report && (
              <>
                <ReportDocumentPreview report={report} opts={fullExportOpts} farmLabel={activeFarm?.name} />
                <div className="flex gap-2 rounded-xl bg-surface p-2 shadow-(--shadow-raised) lg:static lg:shadow-(--shadow-border)" style={{ position: 'sticky', bottom: 80 }}>
                  <Button variant="secondary" className="flex-1 justify-center" onClick={() => downloadReportCsv(report, `${selected}.csv`, fullExportOpts)}>
                    <Download size={14} /> Export CSV
                  </Button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
