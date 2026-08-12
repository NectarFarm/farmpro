"use client";
import React, { useState } from "react";
import { useNav, TopNav } from "./navigation";
import { FileText, Download, Calendar, TrendingUp, BarChart3, Receipt, ChevronRight, Eye, Plus } from "./icons";

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

const RECENT_REPORTS = [
  { name: "P&L Summary – Jul 2026", generated: "2026-08-01", size: "142KB", format: "PDF" },
  { name: "Mortality Report – Q2 2026", generated: "2026-07-01", size: "88KB", format: "PDF" },
  { name: "Production Summary – Jun 2026", generated: "2026-07-01", size: "216KB", format: "CSV" },
];

export function ReportsScreen() {
  const [dateFrom, setDateFrom] = useState("2026-08-01");
  const [dateTo, setDateTo] = useState("2026-08-31");
  const [selected, setSelected] = useState<string[]>([]);
  const [showAuditor, setShowAuditor] = useState(false);

  const toggleReport = (id: string) => {
    setSelected((prev) => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

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
          <div className="chip-row" style={{ marginTop: 10 }}>
            {["This Month","Last Month","Q3 2026","YTD"].map((p) => (
              <button key={p} className="filter-chip">{p}</button>
            ))}
          </div>
        </div>

        {/* Report type selector */}
        <div className="section-eyebrow" style={{ marginBottom: 10 }}>Select Reports</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 14 }}>
          {REPORT_TYPES.map((r) => {
            const isSel = selected.includes(r.id);
            return (
              <button key={r.id} onClick={() => toggleReport(r.id)}
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

        {/* Export buttons */}
        {selected.length > 0 && (
          <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
            <button className="btn-primary" style={{ flex: 1, justifyContent: "center" }}>
              <Download size={14} /> Export PDF ({selected.length})
            </button>
            <button className="btn-secondary" style={{ flex: 1, justifyContent: "center" }}>
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

        {/* Recent exports */}
        <div className="section-eyebrow" style={{ marginBottom: 10 }}>Recent Exports</div>
        <div className="farm-card" style={{ overflow: "hidden", marginBottom: 24 }}>
          {RECENT_REPORTS.map((r, i) => (
            <div key={r.name} style={{ padding: "12px 14px", display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: i < RECENT_REPORTS.length - 1 ? "1px solid var(--border-subtle)" : "none" }}>
              <div>
                <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-primary)" }}>{r.name}</div>
                <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 1 }}>{r.generated} · {r.size} · {r.format}</div>
              </div>
              <button style={{ padding: "6px 12px", borderRadius: 8, fontSize: 11, fontWeight: 600, background: "var(--card)", border: "1px solid var(--border-subtle)", color: "var(--text-secondary)", cursor: "pointer", display: "flex", alignItems: "center", gap: 4 }}>
                <Download size={12} /> Re-download
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
