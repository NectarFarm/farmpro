"use client";
import React, { useState } from "react";
import { useNav, TopNav } from "./navigation";
import { Plus, Search, X } from "./icons";
import { DataTable, ColDef, usePersistedView } from "./data-table";

const SALES = [
  { id: "SL-001", date: "2026-08-10", item: "Tray eggs (30) × 120", batch: "LAY-08", amount: 36000, method: "Mpesa", status: "paid" },
  { id: "SL-002", date: "2026-08-09", item: "Broilers × 80 birds",  batch: "BRO-21", amount: 128000, method: "Cash",  status: "paid" },
  { id: "SL-003", date: "2026-08-07", item: "Pork × 45kg",           batch: "PIG-03", amount: 27000,  method: "Bank",  status: "paid" },
  { id: "SL-004", date: "2026-08-05", item: "Tray eggs × 80",        batch: "LAY-08", amount: 24000,  method: "Mpesa", status: "paid" },
  { id: "SL-005", date: "2026-08-03", item: "Tilapia × 30kg",        batch: "FIS-02", amount: 9000,   method: "Cash",  status: "pending" },
];

const PURCHASES_FIN = [
  { id: "PU-001", date: "2026-08-08", item: "Broiler Starter Mash 2T", supplier: "Unga Ltd",     amount: 96000,  cat: "Feed" },
  { id: "PU-002", date: "2026-08-05", item: "Newcastle Vaccine",        supplier: "Kenchic",      amount: 12500,  cat: "Vet" },
  { id: "PU-003", date: "2026-08-01", item: "Piglet stock × 20",        supplier: "Farmer John",  amount: 60000,  cat: "Stock" },
  { id: "PU-004", date: "2026-07-28", item: "Oxymav B Antibiotic",      supplier: "Agrovet",      amount: 75000,  cat: "Vet" },
];

const GL_ENTRIES = [
  { code: "4001", account: "Egg Sales",        type: "Revenue",   debit: 0,      credit: 84000,  date: "Aug 2026" },
  { code: "4002", account: "Broiler Sales",    type: "Revenue",   debit: 0,      credit: 128000, date: "Aug 2026" },
  { code: "4003", account: "Pork Sales",       type: "Revenue",   debit: 0,      credit: 27000,  date: "Aug 2026" },
  { code: "5001", account: "Feed Costs",       type: "Expense",   debit: 96000,  credit: 0,      date: "Aug 2026" },
  { code: "5002", account: "Veterinary",       type: "Expense",   debit: 87500,  credit: 0,      date: "Aug 2026" },
  { code: "5003", account: "Stock Purchases",  type: "Expense",   debit: 60000,  credit: 0,      date: "Aug 2026" },
  { code: "6001", account: "Salaries",         type: "Expense",   debit: 42000,  credit: 0,      date: "Aug 2026" },
  { code: "6002", account: "Utilities",        type: "Expense",   debit: 12000,  credit: 0,      date: "Aug 2026" },
  { code: "1001", account: "Cash/Bank",        type: "Asset",     debit: 239000, credit: 0,      date: "Aug 2026" },
  { code: "2001", account: "Creditors",        type: "Liability", debit: 0,      credit: 75000,  date: "Aug 2026" },
];

const BATCH_PL = [
  { id: "BRO-22", name: "Broilers Oct Run",  revenue: 178400, cost: 145200, margin: 33200, pct: 18.6, status: "ACTIVE" },
  { id: "BRO-21", name: "Broilers Sep Run",  revenue: 320000, cost: 238000, margin: 82000, pct: 25.6, status: "CLOSED" },
  { id: "LAY-08", name: "Layers Batch 8",    revenue: 84000,  cost: 47500,  margin: 36500, pct: 43.5, status: "ACTIVE" },
  { id: "PIG-03", name: "Pig Fatteners Q3",  revenue: 180000, cost: 152000, margin: 28000, pct: 15.6, status: "CLOSED" },
];

const PAYROLL_ROWS = [
  { id: "PR-001", name: "John Kamau",    role: "Worker",  gross: 18000, net: 16200, status: "pending" },
  { id: "PR-002", name: "Sarah Mwangi", role: "Worker",  gross: 18000, net: 16200, status: "pending" },
  { id: "PR-003", name: "Peter Njoroge",role: "Manager", gross: 45000, net: 40500, status: "pending" },
  { id: "PR-004", name: "Ann Wambui",   role: "Worker",  gross: 15000, net: 13500, status: "paid" },
];

/* ── Column definitions ─────────────────────────────────────────────────── */

const BATCH_PL_COLS: ColDef<Record<string, unknown>>[] = [
  {
    key: "name", header: "Batch", sortable: true, minWidth: 140,
    summary: () => <span style={{ fontWeight: 700, fontSize: 11, color: "var(--text-muted)" }}>TOTALS</span>,
    render: (r) => (
      <div>
        <div style={{ fontWeight: 600, fontSize: 12 }}>{r.name as string}</div>
        <div style={{ fontSize: 10, color: "var(--text-muted)", fontFamily: "monospace" }}>{r.id as string}</div>
      </div>
    ),
  },
  {
    key: "revenue", header: "Revenue", sortable: true, align: "right", minWidth: 80,
    summary: "sum",
    render: (r) => <span style={{ fontSize: 12, fontWeight: 700, color: "var(--status-ok)" }}>KSh {((r.revenue as number)/1000).toFixed(0)}K</span>,
  },
  {
    key: "cost", header: "Cost", sortable: true, align: "right", minWidth: 72,
    summary: "sum",
    render: (r) => <span style={{ fontSize: 12, color: "var(--status-critical)" }}>KSh {((r.cost as number)/1000).toFixed(0)}K</span>,
  },
  {
    key: "margin", header: "Margin", sortable: true, align: "right", minWidth: 72,
    summary: "sum",
    render: (r) => <span style={{ fontSize: 12, fontWeight: 700, color: (r.margin as number) > 0 ? "var(--primary-green)" : "var(--status-critical)" }}>KSh {((r.margin as number)/1000).toFixed(0)}K</span>,
  },
  {
    key: "pct", header: "%", sortable: true, align: "right", minWidth: 50,
    summary: "avg",
    render: (r) => <span style={{ fontSize: 12, fontWeight: 700, color: (r.pct as number) > 20 ? "var(--status-ok)" : "var(--status-warning)" }}>{r.pct as number}%</span>,
  },
  {
    key: "status", header: "Status", align: "center", minWidth: 70,
    summary: "count",
    render: (r) => <span className={`chip ${r.status === "ACTIVE" ? "chip-ok" : "chip-info"}`} style={{ fontSize: 9 }}>{r.status as string}</span>,
  },
];

const SALES_COLS: ColDef<Record<string, unknown>>[] = [
  {
    key: "item", header: "Item", sortable: true, minWidth: 160,
    summary: () => <span style={{ fontWeight: 700, fontSize: 11, color: "var(--text-muted)" }}>TOTALS</span>,
    render: (r) => (
      <div>
        <div style={{ fontWeight: 600, fontSize: 12 }}>{r.item as string}</div>
        <div style={{ fontSize: 10, color: "var(--text-muted)" }}>{r.batch as string} · {r.method as string}</div>
      </div>
    ),
  },
  { key: "date", header: "Date", sortable: true, minWidth: 88, render: (r) => <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{r.date as string}</span> },
  {
    key: "amount", header: "Amount", sortable: true, align: "right", minWidth: 90,
    summary: "sum",
    render: (r) => <span style={{ fontSize: 13, fontWeight: 700, color: "var(--status-ok)" }}>KSh {(r.amount as number).toLocaleString()}</span>,
  },
  {
    key: "status", header: "Status", align: "center", minWidth: 70,
    summary: "count",
    render: (r) => <span className={`chip ${r.status === "paid" ? "chip-ok" : "chip-warning"}`} style={{ fontSize: 9 }}>{(r.status as string).toUpperCase()}</span>,
  },
];

const PURCHASES_COLS: ColDef<Record<string, unknown>>[] = [
  {
    key: "item", header: "Item", sortable: true, minWidth: 160,
    summary: () => <span style={{ fontWeight: 700, fontSize: 11, color: "var(--text-muted)" }}>TOTALS</span>,
    render: (r) => (
      <div>
        <div style={{ fontWeight: 600, fontSize: 12 }}>{r.item as string}</div>
        <div style={{ fontSize: 10, color: "var(--text-muted)" }}>{r.date as string}</div>
      </div>
    ),
  },
  { key: "supplier", header: "Supplier", sortable: true, minWidth: 100, render: (r) => <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{r.supplier as string}</span> },
  {
    key: "cat", header: "Category", align: "center", minWidth: 80,
    summary: "count",
    render: (r) => <span className={`chip ${r.cat === "Feed" ? "chip-ok" : r.cat === "Vet" ? "chip-purple" : "chip-info"}`} style={{ fontSize: 9 }}>{r.cat as string}</span>,
  },
  {
    key: "amount", header: "Amount", sortable: true, align: "right", minWidth: 90,
    summary: "sum",
    render: (r) => <span style={{ fontWeight: 700, color: "var(--status-critical)", fontSize: 12 }}>KSh {(r.amount as number).toLocaleString()}</span>,
  },
];

const GL_COLS: ColDef<Record<string, unknown>>[] = [
  {
    key: "code", header: "Code", sortable: true, minWidth: 56,
    summary: () => <span style={{ fontWeight: 700, fontSize: 11, color: "var(--text-muted)" }}>TOTALS</span>,
    render: (r) => <span style={{ fontFamily: "monospace", fontSize: 12, color: "var(--accent-blue)" }}>{r.code as string}</span>,
  },
  { key: "account", header: "Account", sortable: true, minWidth: 130, render: (r) => <span style={{ fontWeight: 600, fontSize: 12 }}>{r.account as string}</span> },
  {
    key: "type", header: "Type", sortable: true, align: "center", minWidth: 80,
    render: (r) => {
      const t = r.type as string;
      const cls = t === "Revenue" ? "chip-ok" : t === "Expense" ? "chip-critical" : t === "Asset" ? "chip-info" : "chip-warning";
      return <span className={`chip ${cls}`} style={{ fontSize: 9 }}>{t}</span>;
    },
  },
  {
    key: "debit", header: "Debit", sortable: true, align: "right", minWidth: 90,
    summary: "sum",
    render: (r) => (r.debit as number) > 0
      ? <span style={{ fontSize: 12, fontWeight: 700, color: "var(--status-critical)" }}>KSh {(r.debit as number).toLocaleString()}</span>
      : <span style={{ color: "var(--text-dim)" }}>—</span>,
  },
  {
    key: "credit", header: "Credit", sortable: true, align: "right", minWidth: 90,
    summary: "sum",
    render: (r) => (r.credit as number) > 0
      ? <span style={{ fontSize: 12, fontWeight: 700, color: "var(--status-ok)" }}>KSh {(r.credit as number).toLocaleString()}</span>
      : <span style={{ color: "var(--text-dim)" }}>—</span>,
  },
  { key: "date", header: "Period", minWidth: 80, render: (r) => <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{r.date as string}</span> },
];

const PAYROLL_COLS: ColDef<Record<string, unknown>>[] = [
  {
    key: "name", header: "Employee", sortable: true, minWidth: 140,
    summary: () => <span style={{ fontWeight: 700, fontSize: 11, color: "var(--text-muted)" }}>TOTALS</span>,
    render: (r) => (
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <div style={{ width: 28, height: 28, borderRadius: "50%", background: "rgba(74,222,128,0.15)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, fontSize: 11, fontWeight: 700, color: "var(--primary-green)" }}>
          {(r.name as string).split(" ").map(n => n[0]).join("")}
        </div>
        <div>
          <div style={{ fontSize: 12, fontWeight: 600 }}>{r.name as string}</div>
          <div style={{ fontSize: 10, color: "var(--text-muted)" }}>{r.role as string}</div>
        </div>
      </div>
    ),
  },
  {
    key: "gross", header: "Gross", sortable: true, align: "right", minWidth: 90,
    summary: "sum",
    render: (r) => <span style={{ fontSize: 12 }}>KSh {(r.gross as number).toLocaleString()}</span>,
  },
  {
    key: "net", header: "Net Pay", sortable: true, align: "right", minWidth: 90,
    summary: "sum",
    render: (r) => <span style={{ fontSize: 12, fontWeight: 700, color: "var(--status-ok)" }}>KSh {(r.net as number).toLocaleString()}</span>,
  },
  {
    key: "status", header: "Status", align: "center", minWidth: 70,
    summary: "count",
    render: (r) => <span className={`chip ${r.status === "paid" ? "chip-ok" : "chip-warning"}`} style={{ fontSize: 9 }}>{(r.status as string).toUpperCase()}</span>,
  },
];

/* ── Screen ─────────────────────────────────────────────────────────────── */

export function FinanceScreen() {
  const { navigate } = useNav();
  const [tab, setTab] = useState<"overview" | "sales" | "purchases" | "gl" | "payroll">("overview");
  const [period, setPeriod] = useState<"month" | "quarter" | "ytd">("month");
  const [glSearch, setGlSearch] = useState("");
  const [salesSearch, setSalesSearch] = useState("");

  const totalRevenue = SALES.reduce((s, x) => s + x.amount, 0);
  const totalExpenses = PURCHASES_FIN.reduce((s, x) => s + x.amount, 0);
  const margin = totalRevenue - totalExpenses;

  const filteredGL = GL_ENTRIES.filter((g) => {
    if (!glSearch.trim()) return true;
    const q = glSearch.toLowerCase();
    return g.account.toLowerCase().includes(q) || g.code.includes(q) || g.type.toLowerCase().includes(q);
  });

  const filteredSales = SALES.filter((s) => {
    if (!salesSearch.trim()) return true;
    const q = salesSearch.toLowerCase();
    return s.item.toLowerCase().includes(q) || s.batch.toLowerCase().includes(q) || s.method.toLowerCase().includes(q);
  });

  return (
    <div className="screen-content">
      <TopNav title="Finance" subtitle="Sales, purchases & GL"
        rightEl={
          <button className="btn-fab" style={{ width: 36, height: 36, borderRadius: 10 }}>
            <Plus size={16} />
          </button>
        }
      />

      {/* Tabs */}
      <div className="px-screen" style={{ paddingTop: 12 }}>
        <div className="chip-row" style={{ marginBottom: 14 }}>
          {([["overview","Overview"],["sales","Sales"],["purchases","Expenses"],["gl","GL Accounts"],["payroll","Payroll"]] as [string,string][]).map(([id, label]) => (
            <button key={id} onClick={() => setTab(id as typeof tab)} className={`filter-chip ${tab === id ? "active" : ""}`}>{label}</button>
          ))}
        </div>
      </div>

      {/* ── OVERVIEW ── */}
      {tab === "overview" && (
        <div className="px-screen">
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 4, marginBottom: 12 }}>
            {(["month","quarter","ytd"] as const).map((p) => (
              <button key={p} onClick={() => setPeriod(p)} style={{
                padding: "4px 10px", borderRadius: 100, fontSize: 10, fontWeight: 700, cursor: "pointer",
                background: period === p ? "rgba(74,222,128,0.2)" : "transparent",
                border: period === p ? "1px solid rgba(74,222,128,0.4)" : "1px solid transparent",
                color: period === p ? "var(--primary-green)" : "var(--text-muted)",
              }}>{p.toUpperCase()}</button>
            ))}
          </div>

          <div className="farm-card farm-card-active" style={{ padding: 18, marginBottom: 14 }}>
            <div className="section-eyebrow" style={{ marginBottom: 10 }}>Budget Overview — {period === "month" ? "August 2026" : period === "quarter" ? "Q3 2026" : "YTD 2026"}</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
              <div>
                <div style={{ fontSize: 18, fontWeight: 700, color: "var(--status-ok)" }}>KSh {(totalRevenue/1000).toFixed(0)}K</div>
                <div style={{ fontSize: 10, color: "var(--text-muted)", fontWeight: 600 }}>Revenue</div>
              </div>
              <div>
                <div style={{ fontSize: 18, fontWeight: 700, color: "var(--status-critical)" }}>KSh {(totalExpenses/1000).toFixed(0)}K</div>
                <div style={{ fontSize: 10, color: "var(--text-muted)", fontWeight: 600 }}>Expenses</div>
              </div>
              <div>
                <div style={{ fontSize: 18, fontWeight: 700, color: margin > 0 ? "var(--primary-green)" : "var(--status-critical)" }}>
                  {margin > 0 ? "+" : ""}KSh {(margin/1000).toFixed(0)}K
                </div>
                <div style={{ fontSize: 10, color: "var(--text-muted)", fontWeight: 600 }}>Net</div>
              </div>
            </div>
            <div className="progress-track" style={{ marginTop: 14 }}>
              <div className="progress-fill" style={{ width: `${Math.min((totalRevenue/(totalRevenue+totalExpenses))*100,100)}%` }} />
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6, fontSize: 10, color: "var(--text-muted)" }}>
              <span>Revenue {Math.round((totalRevenue/(totalRevenue+totalExpenses))*100)}%</span>
              <span>Expenses {Math.round((totalExpenses/(totalRevenue+totalExpenses))*100)}%</span>
            </div>
          </div>

          <div className="section-eyebrow" style={{ marginBottom: 10 }}>Batch P&amp;L</div>
          <DataTable
            rows={BATCH_PL as unknown as Record<string, unknown>[]}
            columns={BATCH_PL_COLS}
            rowKey={(r) => r.id as string}
            onRowClick={(r) => navigate("batch-detail", { id: r.id as string })}
            defaultPageSize={10}
            pageSizes={[10, 20, 50]}
            bodyHeight={220}
            tableId="finance-batchpl"
            emptyText="No batch P&L data."
          />
          <div style={{ marginBottom: 20 }} />
        </div>
      )}

      {/* ── SALES ── */}
      {tab === "sales" && (
        <div className="px-screen">
          <div style={{ position: "relative", marginBottom: 12 }}>
            <Search size={14} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)", pointerEvents: "none" }} />
            <input className="farm-input" style={{ paddingLeft: 34, fontSize: 13 }} placeholder="Search item, batch, method…" value={salesSearch} onChange={e => setSalesSearch(e.target.value)} />
            {salesSearch && <button onClick={() => setSalesSearch("")} style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", padding: 0 }}><X size={14} /></button>}
          </div>
          <DataTable
            rows={filteredSales as unknown as Record<string, unknown>[]}
            columns={SALES_COLS}
            rowKey={(r) => r.id as string}
            defaultPageSize={20}
            pageSizes={[10, 20, 50, 100]}
            bodyHeight={320}
            tableId="finance-sales"
            emptyText="No sales records found."
          />
          <button className="btn-primary" style={{ width: "100%", justifyContent: "center", marginTop: 12, marginBottom: 20 }}>
            <Plus size={16} /> Record Sale
          </button>
        </div>
      )}

      {/* ── PURCHASES / EXPENSES ── */}
      {tab === "purchases" && (
        <div className="px-screen">
          <DataTable
            rows={PURCHASES_FIN as unknown as Record<string, unknown>[]}
            columns={PURCHASES_COLS}
            rowKey={(r) => r.id as string}
            defaultPageSize={20}
            pageSizes={[10, 20, 50, 100]}
            bodyHeight={320}
            tableId="finance-purchases"
            emptyText="No expense records found."
          />
          <div style={{ marginBottom: 20 }} />
        </div>
      )}

      {/* ── GL ACCOUNTS ── */}
      {tab === "gl" && (
        <div className="px-screen">
          <div style={{ padding: "10px 14px", background: "rgba(96,165,250,0.08)", borderRadius: 12, marginBottom: 14, border: "1px solid rgba(96,165,250,0.2)" }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "var(--accent-blue)", marginBottom: 2 }}>General Ledger — August 2026</div>
            <div style={{ display: "flex", gap: 16, marginTop: 6 }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 700, color: "var(--status-ok)" }}>KSh {GL_ENTRIES.reduce((s, g) => s + g.credit, 0).toLocaleString()}</div>
                <div style={{ fontSize: 10, color: "var(--text-muted)" }}>Total Credits</div>
              </div>
              <div>
                <div style={{ fontSize: 14, fontWeight: 700, color: "var(--status-critical)" }}>KSh {GL_ENTRIES.reduce((s, g) => s + g.debit, 0).toLocaleString()}</div>
                <div style={{ fontSize: 10, color: "var(--text-muted)" }}>Total Debits</div>
              </div>
            </div>
          </div>

          <div style={{ position: "relative", marginBottom: 14 }}>
            <Search size={14} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)", pointerEvents: "none" }} />
            <input className="farm-input" style={{ paddingLeft: 34, fontSize: 13 }} placeholder="Search account, code, type…" value={glSearch} onChange={e => setGlSearch(e.target.value)} />
            {glSearch && <button onClick={() => setGlSearch("")} style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", padding: 0 }}><X size={14} /></button>}
          </div>

          <DataTable
            rows={filteredGL as unknown as Record<string, unknown>[]}
            columns={GL_COLS}
            rowKey={(r) => r.code as string}
            defaultPageSize={20}
            pageSizes={[10, 20, 50]}
            bodyHeight={340}
            tableId="finance-gl"
            emptyText="No GL entries match your search."
          />

          <button className="btn-secondary" style={{ width: "100%", justifyContent: "center", marginTop: 12, marginBottom: 20 }}>
            Export GL to CSV
          </button>
        </div>
      )}

      {/* ── PAYROLL ── */}
      {tab === "payroll" && (
        <div className="px-screen">
          <div className="farm-card farm-card-active" style={{ padding: 16, marginBottom: 14 }}>
            <div className="section-eyebrow" style={{ marginBottom: 10 }}>August 2026 Payroll</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
              {[{ l: "Gross", v: "KSh 126K", c: "var(--text-primary)" }, { l: "Deductions", v: "KSh 14K", c: "var(--status-warning)" }, { l: "Net Pay", v: "KSh 112K", c: "var(--status-ok)" }].map((s) => (
                <div key={s.l}><div style={{ fontSize: 16, fontWeight: 700, color: s.c }}>{s.v}</div><div style={{ fontSize: 10, color: "var(--text-muted)" }}>{s.l}</div></div>
              ))}
            </div>
          </div>

          <DataTable
            rows={PAYROLL_ROWS as unknown as Record<string, unknown>[]}
            columns={PAYROLL_COLS}
            rowKey={(r) => r.id as string}
            defaultPageSize={20}
            pageSizes={[10, 20, 50, 100]}
            bodyHeight={240}
            tableId="finance-payroll"
            emptyText="No payroll data."
          />

          <button className="btn-primary" style={{ width: "100%", justifyContent: "center", marginTop: 12, marginBottom: 20 }}>
            Run Payroll
          </button>
        </div>
      )}
    </div>
  );
}
