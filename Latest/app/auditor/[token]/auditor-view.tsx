'use client';
import React, { useCallback, useEffect, useState } from 'react';
import { apiClient } from '@/lib/request';
import type { ReportPayload } from '@/lib/report-types';
import { downloadReportCsv } from '@/lib/report-export';

// Read-only report viewer for a live auditor_links token (issue #313) — the
// same 4 real report types components/farm/reports.tsx's REPORT_ENDPOINTS
// exposes, fetched from the token-gated
// GET /api/auditor/[token]/reports/[type] route instead of the session-gated
// GET /api/reports/*. No write UI of any kind lives on this page — there is
// nothing here to wire to a mutating endpoint even if someone tried.
const REPORT_TYPES = [
  { id: 'pl', name: 'P&L Summary' },
  { id: 'batch-pl', name: 'Batch P&L' },
  { id: 'mortality', name: 'Mortality Report' },
  { id: 'feed', name: 'Feed Consumption' },
] as const;

type ReportTypeId = (typeof REPORT_TYPES)[number]['id'];

export function AuditorReportsView({ token }: { token: string }) {
  const [selected, setSelected] = useState<ReportTypeId>('pl');
  const [report, setReport] = useState<ReportPayload | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    apiClient.get<ReportPayload>(`/api/auditor/${encodeURIComponent(token)}/reports/${selected}`).then((res) => {
      setLoading(false);
      if (res.success) { setReport(res.data); setError(''); }
      else { setReport(null); setError(res.error || 'This link is invalid, expired, or has been revoked.'); }
    });
  }, [token, selected]);

  useEffect(() => { load(); }, [load]);

  return (
    <div style={{ minHeight: '100vh', background: 'var(--background)', color: 'var(--text-primary)' }}>
      <div style={{ maxWidth: 760, margin: '0 auto', padding: '28px 16px 40px' }}>
        <div style={{ marginBottom: 4, fontSize: 11, fontWeight: 700, letterSpacing: 0.5, color: 'var(--accent-purple)', textTransform: 'uppercase' }}>
          Auditor / Investor Access
        </div>
        <div style={{ fontSize: 20, fontWeight: 800, marginBottom: 6 }}>Read-only Reports</div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 20, lineHeight: 1.5 }}>
          You have temporary, read-only access to this farm&apos;s reports. Nothing on this page can modify any data.
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
          {REPORT_TYPES.map((r) => (
            <button
              key={r.id}
              onClick={() => setSelected(r.id)}
              className={selected === r.id ? 'chip chip-ok' : 'chip'}
              style={{ cursor: 'pointer', border: 'none', fontSize: 12, padding: '6px 12px' }}
            >
              {r.name}
            </button>
          ))}
        </div>

        <div className="farm-card" style={{ padding: 14 }}>
          {loading && <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Loading…</div>}
          {!loading && error && (
            <div style={{ fontSize: 13, color: 'var(--status-critical)', fontWeight: 600 }}>{error}</div>
          )}
          {!loading && !error && report && (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <div style={{ fontSize: 14, fontWeight: 700 }}>{report.title}</div>
                <span className="chip" style={{ fontSize: 9 }}>{report.rows.length} row{report.rows.length === 1 ? '' : 's'}</span>
              </div>
              <div style={{ overflowX: 'auto', marginBottom: 12, border: '1px solid var(--border-subtle)', borderRadius: 10 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
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
