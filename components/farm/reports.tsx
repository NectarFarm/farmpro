"use client";
import React, { useCallback, useEffect, useState } from "react";
import { useNav, TopNav } from "./navigation";
import { apiClient } from "@/lib/request";
import type { ReportPayload } from "@/lib/report-types";
import { downloadReportCsv, downloadReportPdf } from "@/lib/report-export";
import { FileText, Download, AlertTriangle } from "./icons";

// ── Real-data wiring (issue #263) ───────────────────────────────────────────
// Of the mock's 8 report types below, only 4 have any real backing data on
// this branch (per the issue's branch-correction note):
//   pl / batch-pl       -> GET /api/reports/pl, GET /api/reports/batch-pl
//                           (composed from the real GL trial balance +
//                           batches/cost-breakdown, see lib/reports.ts)
//   mortality / feed    -> GET /api/reports/mortality, GET /api/reports/feed-consumption
//                           (derived from the real `records` table)
// The remaining 4 (`production`, `vaccination`, `labour`, `fcr`) have no real
// data source anywhere on this branch: no eggs/products-collected table, no
// health-log table, no payroll, no weight-tracking granularity (same "no
// source table exists" reasoning app/api/batches/[id]/cost-breakdown/route.ts
// already applies to feed/health/labour/overhead cost categories). Per the
// issue's direct product decision, these show an honest "not available yet"
// state — never a fake or empty export.
//
// Export: each real report endpoint returns `{ title, meta, columns, rows }`
// (lib/report-types.ts); lib/report-export.ts builds CSV and PDF (via
// jspdf/jspdf-autotable, added as real deps this issue) from that one shape
// client-side — no per-report-type export code.
const REPORT_TYPES = [
  { id: "pl", name: "P&L Summary", desc: "Revenue vs expenses by period", icon: "💰", color: "var(--status-ok)" },
  { id: "production", name: "Production Summary", desc: "Eggs, meat, products collected", icon: "📊", color: "var(--accent-blue)" },
  { id: "mortality", name: "Mortality Report", desc: "Deaths by batch, cause, date", icon: "📋", color: "var(--status-warning)" },
  { id: "vaccination", name: "Vaccination / Treatment Log", desc: "Health records, withdrawal windows", icon: "💉", color: "var(--accent-purple)" },
  { id: "feed", name: "Feed Consumption", desc: "Feed per batch, FCR analysis", icon: "🌾", color: "var(--accent-cyan)" },
  { id: "labour", name: "Labour & Task Cost", desc: "Hours, payroll, task completion", icon: "👥", color: "var(--accent-amber)" },
  { id: "batch-pl", name: "Batch P&L", desc: "Per-batch economics & margin", icon: "🐔", color: "var(--primary-green)" },
  { id: "fcr", name: "FCR & Efficiency", desc: "Feed conversion by species", icon: "⚖️", color: "var(--accent-blue)" },
];

// Report types with a real /api/reports/* endpoint behind them.
const REPORT_ENDPOINTS: Record<string, string> = {
  pl: "/api/reports/pl",
  "batch-pl": "/api/reports/batch-pl",
  mortality: "/api/reports/mortality",
  feed: "/api/reports/feed-consumption",
};

// Why each of the other 4 has no real data source yet — shown verbatim in
// the "not available yet" card so this reads as an honest status, not a
// generic placeholder.
const NOT_AVAILABLE_REASONS: Record<string, string> = {
  production: "No eggs/meat/products-collected table exists yet on this branch — there is nothing to report on.",
  vaccination: "No health-log table exists yet — vaccination/treatment records are not captured anywhere.",
  labour: "No payroll or hours-worked table exists yet — labour cost has no real data source.",
  fcr: "No weight-tracking granularity exists yet — feed-conversion ratio cannot be computed from real data.",
};

type ExportRecord = { name: string; generated: string; format: "PDF" | "CSV" };

function fmtTimestamp(d: Date): string {
  return d.toISOString().slice(0, 16).replace("T", " ");
}

export function ReportsScreen() {
  const { tenantId } = useNav();
  const [dateFrom, setDateFrom] = useState("2026-08-01");
  const [dateTo, setDateTo] = useState("2026-08-31");
  const [selected, setSelected] = useState<string | null>(null);
  const [showAuditor, setShowAuditor] = useState(false);

  const [report, setReport] = useState<ReportPayload | null>(null);
  const [reportError, setReportError] = useState("");
  const [loading, setLoading] = useState(false);
  const [recentExports, setRecentExports] = useState<ExportRecord[]>([]);

  const reportType = selected ? REPORT_TYPES.find((r) => r.id === selected) ?? null : null;
  const endpoint = selected ? REPORT_ENDPOINTS[selected] : undefined;

  const loadReport = useCallback(() => {
    if (!endpoint) { setReport(null); setReportError(""); return; }
    setLoading(true);
    const params = new URLSearchParams({ tenantId, from: dateFrom, to: dateTo });
    apiClient.get<ReportPayload>(`${endpoint}?${params.toString()}`).then((res) => {
      setLoading(false);
      if (res.success) { setReport(res.data); setReportError(""); }
      else { setReport(null); setReportError(res.error || "Failed to generate report."); }
    });
  }, [endpoint, tenantId, dateFrom, dateTo]);

  useEffect(() => { loadReport(); }, [loadReport]);

  function handleExportCsv() {
    if (!report || !reportType) return;
    const filename = `${reportType.id}-${dateFrom}_to_${dateTo}.csv`;
    downloadReportCsv(report, filename);
    setRecentExports((prev) => [{ name: `${reportType.name} – ${dateFrom} to ${dateTo}`, generated: fmtTimestamp(new Date()), format: "CSV" as const }, ...prev].slice(0, 8));
  }

  async function handleExportPdf() {
    if (!report || !reportType) return;
    const filename = `${reportType.id}-${dateFrom}_to_${dateTo}.pdf`;
    await downloadReportPdf(report, filename);
    setRecentExports((prev) => [{ name: `${reportType.name} – ${dateFrom} to ${dateTo}`, generated: fmtTimestamp(new Date()), format: "PDF" as const }, ...prev].slice(0, 8));
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
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div>
              <label style={{ fontSize: 11, fontWeight: 700, color: "var(--text-secondary)", display: "block", marginBottom: 5 }}>From</label>
              <input className="farm-input" type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} style={{ fontSize: 13 }} />
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 700, color: "var(--text-secondary)", display: "block", marginBottom: 5 }}>To</label>
              <input className="farm-input" type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} style={{ fontSize: 13 }} />
            </div>
          </div>
        </div>

        {/* Report type selector */}
        <div className="section-eyebrow" style={{ marginBottom: 10 }}>Select a Report</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 14 }}>
          {REPORT_TYPES.map((r) => {
            const isSel = selected === r.id;
            return (
              <button key={r.id} onClick={() => setSelected(isSel ? null : r.id)}
                style={{
                  padding: 12, borderRadius: 14, textAlign: "left", cursor: "pointer",
                  background: isSel ? "rgba(74,222,128,0.12)" : "var(--card)",
                  border: isSel ? "1px solid rgba(74,222,128,0.4)" : "1px solid var(--border-subtle)",
                  transition: "all 0.15s ease",
                }}>
                <div style={{ fontSize: 20, marginBottom: 6 }}>{r.icon}</div>
                <div style={{ fontSize: 12, fontWeight: 700, color: isSel ? "var(--text-primary)" : "var(--text-secondary)", lineHeight: 1.2, marginBottom: 3 }}>{r.name}</div>
                <div style={{ fontSize: 10, color: "var(--text-muted)", lineHeight: 1.4 }}>{r.desc}</div>
                {isSel && (
                  <div style={{ marginTop: 6, display: "flex", gap: 4 }}>
                    <span className="chip chip-ok" style={{ fontSize: 8, padding: "1px 6px" }}>Selected</span>
                  </div>
                )}
              </button>
            );
          })}
        </div>

        {/* Not-available state for the 3(+1) report types with no real data source */}
        {selected && !isRealType && (
          <div className="farm-card" style={{ padding: 14, marginBottom: 16, border: "1px solid rgba(248,113,113,0.3)" }}>
            <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
              <AlertTriangle size={18} color="var(--status-warning)" style={{ flexShrink: 0, marginTop: 2 }} />
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text-primary)", marginBottom: 4 }}>Not available yet</div>
                <div style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5 }}>
                  {NOT_AVAILABLE_REASONS[selected] ?? "This report has no real data source on this branch yet."}
                  {" "}No export is offered for it — a placeholder or empty file would misrepresent this as real data.
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Real report: loading / error / preview + export */}
        {selected && isRealType && (
          <div className="farm-card" style={{ padding: 14, marginBottom: 16 }}>
            {loading && (
              <div style={{ fontSize: 12, color: "var(--text-muted)" }}>Generating report…</div>
            )}
            {!loading && reportError && (
              <div style={{ fontSize: 12, color: "var(--status-critical)" }}>{reportError}</div>
            )}
            {!loading && !reportError && report && (
              <>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text-primary)" }}>{report.title}</div>
                  <span className="chip" style={{ fontSize: 9 }}>{report.rows.length} row{report.rows.length === 1 ? "" : "s"}</span>
                </div>

                {/* Summary meta chips (skips internal-only keys and empty values) */}
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
                  {Object.entries(report.meta)
                    .filter(([k, v]) => typeof v !== "string" && typeof v === "number" && !/tenantId/i.test(k))
                    .map(([k, v]) => (
                      <span key={k} className="chip" style={{ fontSize: 10 }}>
                        {k}: {typeof v === "number" ? v.toLocaleString() : String(v)}
                      </span>
                    ))}
                </div>

                {/* Row preview (first 8 rows; export carries the full set) */}
                <div style={{ overflowX: "auto", marginBottom: 12, border: "1px solid var(--border-subtle)", borderRadius: 10 }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                    <thead>
                      <tr>
                        {report.columns.map((c) => (
                          <th key={c} style={{ textAlign: "left", padding: "6px 8px", color: "var(--text-muted)", borderBottom: "1px solid var(--border-subtle)", whiteSpace: "nowrap" }}>{c}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {report.rows.slice(0, 8).map((row, i) => (
                        <tr key={i}>
                          {row.map((cell, j) => (
                            <td key={j} style={{ padding: "6px 8px", borderBottom: i < Math.min(report.rows.length, 8) - 1 ? "1px solid var(--border-subtle)" : "none", whiteSpace: "nowrap" }}>{String(cell)}</td>
                          ))}
                        </tr>
                      ))}
                      {report.rows.length === 0 && (
                        <tr><td colSpan={report.columns.length} style={{ padding: "10px 8px", color: "var(--text-muted)" }}>No records in this date range.</td></tr>
                      )}
                    </tbody>
                  </table>
                  {report.rows.length > 8 && (
                    <div style={{ padding: "6px 8px", fontSize: 10, color: "var(--text-muted)" }}>Showing 8 of {report.rows.length} rows — export for the full set.</div>
                  )}
                </div>
              </>
            )}
          </div>
        )}

        {/* Export buttons */}
        {canExport && (
          <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
            <button className="btn-primary" style={{ flex: 1, justifyContent: "center" }} onClick={handleExportPdf}>
              <Download size={14} /> Export PDF
            </button>
            <button className="btn-secondary" style={{ flex: 1, justifyContent: "center" }} onClick={handleExportCsv}>
              Export CSV
            </button>
          </div>
        )}

        {/* Auditor link */}
        <div className="farm-card" style={{ padding: 14, marginBottom: 14, border: "1px solid rgba(167,139,250,0.3)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text-primary)" }}>Auditor / Investor Access</div>
            <span className="chip chip-purple" style={{ fontSize: 9 }}>~8h link</span>
          </div>
          <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 12, lineHeight: 1.5 }}>
            Generate a temporary read-only link for investors or auditors. Expires in ~8 hours. They can view KPIs and export reports but cannot modify any data.
          </div>
          <button onClick={() => setShowAuditor(!showAuditor)} className="btn-secondary" style={{ width: "100%", justifyContent: "center" }}>
            {showAuditor ? "Revoke Link" : "Generate Auditor Link"}
          </button>
          {showAuditor && (
            <div style={{ marginTop: 10, padding: "10px 12px", background: "rgba(167,139,250,0.06)", borderRadius: 10, border: "1px solid rgba(167,139,250,0.2)" }}>
              <div style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 4 }}>Temporary link (expires Aug 11 · 22:00):</div>
              <div style={{ fontSize: 11, color: "var(--accent-purple)", fontFamily: "monospace", wordBreak: "break-all", padding: "6px 8px", background: "rgba(167,139,250,0.08)", borderRadius: 6 }}>
                https://farm.app/audit/a7f3d2c9...
              </div>
              <button style={{ marginTop: 8, padding: "6px 14px", borderRadius: 8, fontSize: 11, fontWeight: 700, background: "rgba(167,139,250,0.15)", border: "1px solid rgba(167,139,250,0.3)", color: "var(--accent-purple)", cursor: "pointer" }}>Copy Link</button>
            </div>
          )}
        </div>

        {/* Recent exports (real: this session's actual CSV/PDF downloads, not a mock) */}
        <div className="section-eyebrow" style={{ marginBottom: 10 }}>Recent Exports (this session)</div>
        <div className="farm-card" style={{ overflow: "hidden", marginBottom: 24 }}>
          {recentExports.length === 0 && (
            <div style={{ padding: "14px", fontSize: 12, color: "var(--text-muted)", display: "flex", alignItems: "center", gap: 8 }}>
              <FileText size={14} /> No exports yet this session — select a report above and export it.
            </div>
          )}
          {recentExports.map((r, i) => (
            <div key={i} style={{ padding: "12px 14px", display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: i < recentExports.length - 1 ? "1px solid var(--border-subtle)" : "none" }}>
              <div>
                <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-primary)" }}>{r.name}</div>
                <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 1 }}>{r.generated} · {r.format}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
