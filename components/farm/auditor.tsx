'use client';
import React, { useCallback, useEffect, useState } from 'react';
import { useNav, TopNav } from './navigation';
import { apiClient } from '@/lib/request';
import type { ReportPayload } from '@/lib/report-types';
import { downloadReportCsv } from '@/lib/report-export';
import { Eye } from './icons';

// ── Auditor read-only reports (vet/auditor screens task) ────────────────────
// The auditor role was previously funneled straight to RoleNoticeScreen —
// this is their real home. Same 4 report types + endpoints as
// app/auditor/[token]/auditor-view.tsx (the token-authenticated version of
// this exact screen) rather than the mock's other 4 report types that have
// no real data source anywhere. Reused deliberately: same REPORT_TYPES list,
// same CSV-only export (no PDF button here — parity with the token view, and
// jspdf isn't worth pulling into this bundle for a screen that isn't the
// primary Reports screen).
//
// Session-authenticated + tenant-scoped from the session (the difference
// from the token view) via GET /api/reports/pl|batch-pl|mortality|
// feed-consumption — those 4 routes are now role-gated to
// owner/manager/super_admin/auditor (lib/reports.ts's REPORT_VIEWER_ROLES)
// and resolve tenantId from the session only, never a query param, so an
// auditor can never read another tenant's numbers by editing the URL.
//
// Strictly read-only by construction: every call below is a GET, there is no
// form, button, or input anywhere on this screen that POSTs/PATCHes/DELETEs
// anything. The four report routes themselves export no write verb at all.
const REPORT_TYPES = [
  { id: 'pl', name: 'P&L Summary', endpoint: '/api/reports/pl' },
  { id: 'batch-pl', name: 'Batch P&L', endpoint: '/api/reports/batch-pl' },
  { id: 'mortality', name: 'Mortality Report', endpoint: '/api/reports/mortality' },
  { id: 'feed', name: 'Feed Consumption', endpoint: '/api/reports/feed-consumption' },
] as const;

type ReportTypeId = (typeof REPORT_TYPES)[number]['id'];

export function AuditorReportsScreen() {
  const { activeFarmId } = useNav();
  const [selected, setSelected] = useState<ReportTypeId>('pl');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [report, setReport] = useState<ReportPayload | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

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
      <TopNav title="Reports" subtitle="Read-only auditor access" />
      <div className="px-screen" style={{ paddingTop: 12, paddingBottom: 40 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 14px', background: 'rgba(96,165,250,0.08)', border: '1px solid rgba(96,165,250,0.2)', borderRadius: 12, marginBottom: 14 }}>
          <Eye size={14} color="var(--accent-blue)" />
          <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>You have read-only access to this tenant&apos;s reports. Nothing here can change any data.</span>
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
          {REPORT_TYPES.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => setSelected(r.id)}
              className={selected === r.id ? 'chip chip-ok' : 'chip'}
              style={{ cursor: 'pointer', border: 'none', fontSize: 'var(--fs-sm)', padding: '6px 12px' }}
            >
              {r.name}
            </button>
          ))}
        </div>

        <div className="farm-card" style={{ padding: 14, marginBottom: 14 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
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

        <div className="farm-card" style={{ padding: 14 }}>
          {loading && <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' }}>Loading…</div>}
          {!loading && error && (
            <div style={{ fontSize: 'var(--fs-base)', color: 'var(--status-critical)', fontWeight: 600 }}>{error}</div>
          )}
          {!loading && !error && report && (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <div style={{ fontSize: 'var(--fs-md)', fontWeight: 700 }}>{report.title}</div>
                <span className="chip" style={{ fontSize: 'var(--fs-2xs)' }}>{report.rows.length} row{report.rows.length === 1 ? '' : 's'}</span>
              </div>
              <div style={{ overflowX: 'auto', marginBottom: 12, border: '1px solid var(--border-subtle)', borderRadius: 10 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--fs-xs)' }}>
                  <thead>
                    <tr>
                      {report.columns.map((c) => (
                        <th key={c} style={{ textAlign: 'left', padding: '6px 8px', color: 'var(--text-muted)', borderBottom: '1px solid var(--border-subtle)', whiteSpace: 'nowrap' }}>{c}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {report.rows.map((row, i) => (
                      <tr key={i}>
                        {row.map((cell, j) => (
                          <td key={j} style={{ padding: '6px 8px', borderBottom: '1px solid var(--border-subtle)', whiteSpace: 'nowrap' }}>{String(cell)}</td>
                        ))}
                      </tr>
                    ))}
                    {report.rows.length === 0 && (
                      <tr><td colSpan={report.columns.length} style={{ padding: '10px 8px', color: 'var(--text-muted)' }}>No records in this range.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
              <button className="btn-secondary" onClick={() => downloadReportCsv(report, `${selected}.csv`)}>
                Export CSV
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
