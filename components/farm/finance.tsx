"use client";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useNav, TopNav } from "./navigation";
import { apiClient } from "@/lib/request";
import { Plus, Search, X, Download, Lock } from "./icons";
import { DataTable, ColDef } from "./data-table";
import type { ReportPayload } from "@/lib/report-types";
import { periodDateRange, BUDGET_PERIODS, type BudgetPeriod } from "@/lib/period-range";

// ── Real-data wiring (issue #240) ───────────────────────────────────────────
// This screen used to render entirely from hardcoded mock data (a sales
// list, a purchases/expenses list, a GL entries list, a batch P&L list, and
// a payroll rows list). All those mock constants are gone. Real endpoints
// used below:
//   GET/POST /api/data/sales                      — Sales tab (issue #239)
//   GET/POST /api/purchases                        — Purchases/Expenses tab
//                                                     (issue #235; no PATCH
//                                                     exists, so there is no
//                                                     edit-purchase UI here —
//                                                     never existed on this
//                                                     screen either)
//   GET /api/batches + GET /api/batches/[id]/cost-breakdown
//                                                   — Batch P&L (Overview),
//                                                     composed client-side;
//                                                     no aggregate backend
//                                                     endpoint exists (see
//                                                     note near the batch P&L
//                                                     column definitions)
//   GET /api/gl/accounts + GET /api/gl/trial-balance
//                                                   — GL Accounts tab
//   GET /api/reports/pl                             — Budget Overview's
//                                                     Revenue/Expenses/Net,
//                                                     date-filtered by the
//                                                     Month/Quarter/YTD
//                                                     toggle (issue #299;
//                                                     see lib/period-range.ts
//                                                     for the from/to math).
//                                                     Reuses the Reports
//                                                     backend (issue #263)
//                                                     rather than forking its
//                                                     sales/purchases
//                                                     date-range query — its
//                                                     `meta.periodRevenue` /
//                                                     `periodExpense` are
//                                                     already unit-normalized
//                                                     (both whole currency
//                                                     units), which sidesteps
//                                                     the trial-balance unit
//                                                     mismatch noted below for
//                                                     this card specifically.
//   GET /api/inventory/items                        — resolves a purchase's
//                                                     itemId to a name/category
//                                                     for display (purchases
//                                                     rows only carry itemId)
//
// Payroll: no payroll backend exists anywhere in this app (out of scope per
// #247/#248) — the Payroll tab below is an honest "not available yet" state,
// same treatment as components/farm/worker.tsx's WorkerPayScreen.
//
// ── Known backend data bug found while wiring (flagged, not fixed here) ────
// `sales.amount` is posted to the ledger as a plain whole-currency-unit
// number (e.g. 36000 means KSh 36,000 — see lib/finance.ts's postSaleJournal
// and db/schemas/finance.ts's comment), while `purchases.totalCostCents` is
// posted in cents (e.g. 15000 means KSh 150 — see lib/inventory.ts's
// recordPurchase). Both post into the SAME chart of accounts (Sales Revenue
// vs Purchases Expense), so GET /api/gl/trial-balance's REVENUE-class and
// EXPENSE-class balances are in different units for any tenant that has both
// real sales and real purchases recorded. The GL Accounts tab below displays
// the trial balance exactly as the backend returns it (no invented conversion
// factor applied here — guessing which side is "wrong" from the frontend
// would just hide the bug). Recommend a fast-follow backend issue to
// normalize units at the posting layer (lib/finance.ts) before this reaches
// production with real multi-hundred-thousand-shilling figures.
// (Budget Overview's Revenue/Expenses/Net, below, do NOT have this bug: they
// come from GET /api/reports/pl's `meta.periodRevenue`/`periodExpense`, which
// already converts purchases cents -> whole units — see lib/reports.ts.)

/* ── API row shapes (exactly as the routes above return them) ── */
interface ApiSale {
  id: string;
  batchId: string | null;
  item: string;
  amount: number;
  method: string;
  status: string;
  soldAt: string;
  createdAt: string;
}
interface ApiPurchase {
  id: string;
  supplier: string;
  itemId: string;
  quantity: number;
  unitCostCents: number;
  totalCostCents: number;
  paymentMethod: string;
  amountPaidCents: number;
  createdAt: string;
}
interface ApiInventoryItemLite {
  id: string;
  name: string;
  category: string;
}
interface ApiBatchLite {
  id: string;
  code: string;
  name: string;
  status: string;
  acquisitionCostCents: number;
}
interface CostBreakdownCategory {
  key: string;
  label: string;
  amountCents: number;
  tracked: boolean;
  reason?: string;
}
interface ApiCostBreakdown {
  batchId: string;
  code: string;
  totalTrackedCents: number;
  categories: CostBreakdownCategory[];
}
interface ApiAccount {
  id: string;
  code: string;
  name: string;
  class: string;
  normalBalance: string;
}
interface TrialBalanceRow {
  accountId: string;
  code: string;
  name: string;
  class: string;
  normalBalance: string;
  debit: number;
  credit: number;
  balance: number;
}
interface ApiTrialBalance {
  rows: TrialBalanceRow[];
  totalDebits: number;
  totalCredits: number;
  balanced: boolean;
}

function fmtDate(d?: string | null): string {
  return d ? d.slice(0, 10) : "—";
}

const catChipClass = (cat: string) =>
  cat === "Feed" ? "chip-ok" : ["Vet", "Vaccine", "Medicine"].includes(cat) ? "chip-purple" : "chip-info";

/* ── Record Sale sheet — real POST /api/data/sales ── */
function RecordSaleSheet({ tenantId, batches, onCreated, onClose }: {
  tenantId: string;
  batches: ApiBatchLite[];
  onCreated: () => void;
  onClose: () => void;
}) {
  const [item, setItem] = useState("");
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("");
  const [status, setStatus] = useState<"paid" | "pending">("paid");
  const [batchId, setBatchId] = useState("");
  const [soldAt, setSoldAt] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    const amt = Number(amount);
    if (!item.trim()) { setError("Item is required."); return; }
    if (!Number.isFinite(amt) || amt <= 0) { setError("Amount must be a positive number."); return; }

    setSaving(true);
    setError("");
    const res = await apiClient.post("/api/data/sales", {
      tenantId,
      item: item.trim(),
      amount: Math.trunc(amt),
      method: method.trim() || undefined,
      status,
      batchId: batchId || undefined,
      soldAt: soldAt || undefined,
    });
    setSaving(false);
    if (res.success) {
      onCreated();
      onClose();
    } else {
      setError(res.error || "Failed to record sale.");
    }
  }

  return (
    <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.78)", display: "flex", alignItems: "flex-end", zIndex: 110 }} onClick={onClose}>
      <div style={{ background: "var(--surface)", borderRadius: "24px 24px 0 0", padding: 20, width: "100%", border: "1px solid var(--border-subtle)", maxHeight: "85%", overflowY: "auto" }} onClick={e => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <div style={{ fontWeight: 700, fontSize: 16 }}>Record Sale</div>
          <button className="btn-icon" onClick={onClose}><X size={16} /></button>
        </div>

        <div style={{ marginBottom: 12 }}>
          <label style={{ fontSize: 11, fontWeight: 700, color: "var(--text-secondary)", display: "block", marginBottom: 5 }}>Item *</label>
          <input className="farm-input" placeholder="e.g. Tray eggs (30) × 120" value={item} onChange={e => setItem(e.target.value)} />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
          <div>
            <label style={{ fontSize: 11, fontWeight: 700, color: "var(--text-secondary)", display: "block", marginBottom: 5 }}>Amount (KSh) *</label>
            <input className="farm-input" type="number" placeholder="0" value={amount} onChange={e => setAmount(e.target.value)} />
          </div>
          <div>
            <label style={{ fontSize: 11, fontWeight: 700, color: "var(--text-secondary)", display: "block", marginBottom: 5 }}>Method</label>
            <input className="farm-input" placeholder="e.g. Mpesa" value={method} onChange={e => setMethod(e.target.value)} />
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
          <div>
            <label style={{ fontSize: 11, fontWeight: 700, color: "var(--text-secondary)", display: "block", marginBottom: 5 }}>Batch (optional)</label>
            <select className="farm-input" value={batchId} onChange={e => setBatchId(e.target.value)}>
              <option value="">No batch (general sale)</option>
              {batches.map(b => <option key={b.id} value={b.id}>{b.code} — {b.name}</option>)}
            </select>
          </div>
          <div>
            <label style={{ fontSize: 11, fontWeight: 700, color: "var(--text-secondary)", display: "block", marginBottom: 5 }}>Sold on</label>
            <input className="farm-input" type="date" value={soldAt} onChange={e => setSoldAt(e.target.value)} />
          </div>
        </div>
        <div style={{ marginBottom: 12 }}>
          <label style={{ fontSize: 11, fontWeight: 700, color: "var(--text-secondary)", display: "block", marginBottom: 5 }}>Status</label>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            {(["paid", "pending"] as const).map(s => (
              <button key={s} onClick={() => setStatus(s)} style={{
                padding: "9px 8px", borderRadius: 10, fontSize: 11, fontWeight: 700, cursor: "pointer",
                background: status === s ? "rgba(74,222,128,0.1)" : "var(--card)",
                border: status === s ? "1px solid rgba(74,222,128,0.3)" : "1px solid var(--border-subtle)",
                color: status === s ? "var(--primary-green)" : "var(--text-muted)",
              }}>{s.toUpperCase()}</button>
            ))}
          </div>
        </div>

        {error && <div style={{ fontSize: 11, color: "var(--status-critical)", marginBottom: 10 }}>{error}</div>}
        <button className="btn-primary" style={{ width: "100%", justifyContent: "center" }} disabled={saving} onClick={save}>
          {saving ? "Saving…" : "Record Sale"}
        </button>
      </div>
    </div>
  );
}

/* ── Record Purchase/Expense sheet — real POST /api/purchases (same route
 * Inventory's Purchases tab uses; there is no expense-only concept in the
 * backend separate from a stock purchase). No edit/PATCH UI — GET/POST are
 * the only verbs the route supports. ── */
function RecordPurchaseSheet({ tenantId, itemNames, onCreated, onClose }: {
  tenantId: string;
  itemNames: string[];
  onCreated: () => void;
  onClose: () => void;
}) {
  const [supplier, setSupplier] = useState("");
  const [itemName, setItemName] = useState("");
  const [category, setCategory] = useState("");
  const [unit, setUnit] = useState("");
  const [quantity, setQuantity] = useState("");
  const [unitCost, setUnitCost] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("");
  const [amountPaid, setAmountPaid] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    const qty = Number(quantity);
    const cost = Number(unitCost);
    if (!supplier.trim() || !itemName.trim() || !unit.trim()) {
      setError("Supplier, item, and unit are required.");
      return;
    }
    if (!Number.isFinite(qty) || qty <= 0) { setError("Quantity must be a positive number."); return; }
    if (!Number.isFinite(cost) || cost < 0) { setError("Cost per unit must be a non-negative number."); return; }

    setSaving(true);
    setError("");
    const res = await apiClient.post("/api/purchases", {
      tenantId,
      supplier: supplier.trim(),
      itemName: itemName.trim(),
      category: category.trim() || undefined,
      unit: unit.trim(),
      quantity: Math.trunc(qty),
      unitCostCents: Math.round(cost * 100),
      paymentMethod: paymentMethod.trim() || undefined,
      amountPaidCents: amountPaid ? Math.round(Number(amountPaid) * 100) : undefined,
    });
    setSaving(false);
    if (res.success) {
      onCreated();
      onClose();
    } else {
      setError(res.error || "Failed to record purchase.");
    }
  }

  return (
    <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.78)", display: "flex", alignItems: "flex-end", zIndex: 110 }} onClick={onClose}>
      <div style={{ background: "var(--surface)", borderRadius: "24px 24px 0 0", padding: 20, width: "100%", border: "1px solid var(--border-subtle)", maxHeight: "85%", overflowY: "auto" }} onClick={e => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <div style={{ fontWeight: 700, fontSize: 16 }}>Record Purchase / Expense</div>
          <button className="btn-icon" onClick={onClose}><X size={16} /></button>
        </div>
        <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 14, lineHeight: 1.5 }}>
          This also brings the item into Inventory stock — there is no expense-only record separate from a purchase.
        </div>

        <div style={{ marginBottom: 12 }}>
          <label style={{ fontSize: 11, fontWeight: 700, color: "var(--text-secondary)", display: "block", marginBottom: 5 }}>Supplier *</label>
          <input className="farm-input" placeholder="e.g. Unga Ltd" value={supplier} onChange={e => setSupplier(e.target.value)} />
        </div>
        <div style={{ marginBottom: 12 }}>
          <label style={{ fontSize: 11, fontWeight: 700, color: "var(--text-secondary)", display: "block", marginBottom: 5 }}>Item *</label>
          <input className="farm-input" list="finance-item-names" placeholder="e.g. Broiler Starter Mash" value={itemName} onChange={e => setItemName(e.target.value)} />
          <datalist id="finance-item-names">
            {itemNames.map(n => <option key={n} value={n} />)}
          </datalist>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
          <div>
            <label style={{ fontSize: 11, fontWeight: 700, color: "var(--text-secondary)", display: "block", marginBottom: 5 }}>Category</label>
            <input className="farm-input" placeholder="e.g. Feed" value={category} onChange={e => setCategory(e.target.value)} />
          </div>
          <div>
            <label style={{ fontSize: 11, fontWeight: 700, color: "var(--text-secondary)", display: "block", marginBottom: 5 }}>Unit *</label>
            <input className="farm-input" placeholder="e.g. kg" value={unit} onChange={e => setUnit(e.target.value)} />
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
          <div>
            <label style={{ fontSize: 11, fontWeight: 700, color: "var(--text-secondary)", display: "block", marginBottom: 5 }}>Quantity *</label>
            <input className="farm-input" type="number" placeholder="0" value={quantity} onChange={e => setQuantity(e.target.value)} />
          </div>
          <div>
            <label style={{ fontSize: 11, fontWeight: 700, color: "var(--text-secondary)", display: "block", marginBottom: 5 }}>Cost/unit (KSh) *</label>
            <input className="farm-input" type="number" placeholder="0" value={unitCost} onChange={e => setUnitCost(e.target.value)} />
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
          <div>
            <label style={{ fontSize: 11, fontWeight: 700, color: "var(--text-secondary)", display: "block", marginBottom: 5 }}>Payment Method</label>
            <input className="farm-input" placeholder="e.g. M-Pesa" value={paymentMethod} onChange={e => setPaymentMethod(e.target.value)} />
          </div>
          <div>
            <label style={{ fontSize: 11, fontWeight: 700, color: "var(--text-secondary)", display: "block", marginBottom: 5 }}>Amount Paid (KSh)</label>
            <input className="farm-input" type="number" placeholder="0 if unpaid" value={amountPaid} onChange={e => setAmountPaid(e.target.value)} />
          </div>
        </div>

        {error && <div style={{ fontSize: 11, color: "var(--status-critical)", marginBottom: 10 }}>{error}</div>}
        <button className="btn-primary" style={{ width: "100%", justifyContent: "center" }} disabled={saving} onClick={save}>
          {saving ? "Saving…" : "Record Purchase"}
        </button>
      </div>
    </div>
  );
}

/* ── Column definitions ─────────────────────────────────────────────────── */

// Batch P&L (Overview tab): composed client-side from GET /api/batches +
// each batch's GET /api/batches/[id]/cost-breakdown — there is no aggregate
// "batch P&L" backend endpoint. Fine at this farm's scale (a handful of
// batches); if the batch count grows large this per-batch loop should become
// a real aggregate endpoint (flagged in the PR as a follow-on).
const BATCH_PNL_COLS: ColDef<Record<string, unknown>>[] = [
  {
    key: "name", header: "Batch", sortable: true, minWidth: 140,
    summary: () => <span style={{ fontWeight: 700, fontSize: 11, color: "var(--text-muted)" }}>TOTALS</span>,
    render: (r) => (
      <div>
        <div style={{ fontWeight: 600, fontSize: 12 }}>{r.name as string}</div>
        <div style={{ fontSize: 10, color: "var(--text-muted)", fontFamily: "monospace" }}>{r.code as string}</div>
      </div>
    ),
  },
  {
    key: "revenue", header: "Revenue", sortable: true, align: "right", minWidth: 80,
    summary: "sum",
    render: (r) => <span style={{ fontSize: 12, fontWeight: 700, color: "var(--status-ok)" }}>KSh {(r.revenue as number).toLocaleString()}</span>,
  },
  {
    key: "cost", header: "Cost", sortable: true, align: "right", minWidth: 72,
    summary: "sum",
    render: (r) => <span style={{ fontSize: 12, color: "var(--status-critical)" }}>KSh {(r.cost as number).toLocaleString()}</span>,
  },
  {
    key: "margin", header: "Margin", sortable: true, align: "right", minWidth: 72,
    summary: "sum",
    render: (r) => <span style={{ fontSize: 12, fontWeight: 700, color: (r.margin as number) > 0 ? "var(--primary-green)" : "var(--status-critical)" }}>KSh {(r.margin as number).toLocaleString()}</span>,
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
        <div style={{ fontSize: 10, color: "var(--text-muted)" }}>{(r.batchLabel as string) || "—"} · {(r.method as string) || "—"}</div>
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

const GL_COLS: ColDef<Record<string, unknown>>[] = [
  {
    key: "code", header: "Code", sortable: true, minWidth: 56,
    summary: () => <span style={{ fontWeight: 700, fontSize: 11, color: "var(--text-muted)" }}>TOTALS</span>,
    render: (r) => <span style={{ fontFamily: "monospace", fontSize: 12, color: "var(--accent-blue)" }}>{r.code as string}</span>,
  },
  { key: "name", header: "Account", sortable: true, minWidth: 130, render: (r) => <span style={{ fontWeight: 600, fontSize: 12 }}>{r.name as string}</span> },
  {
    key: "class", header: "Type", sortable: true, align: "center", minWidth: 80,
    render: (r) => {
      const t = r.class as string;
      const cls = t === "REVENUE" ? "chip-ok" : t === "EXPENSE" ? "chip-critical" : t === "ASSET" ? "chip-info" : "chip-warning";
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
  {
    key: "balance", header: "Balance", sortable: true, align: "right", minWidth: 90,
    summary: "sum",
    render: (r) => <span style={{ fontSize: 12, fontWeight: 700 }}>KSh {(r.balance as number).toLocaleString()}</span>,
  },
];

/* ── Screen ─────────────────────────────────────────────────────────────── */

export function FinanceScreen() {
  const { navigate, tenantId } = useNav();
  const [tab, setTab] = useState<"overview" | "sales" | "purchases" | "gl" | "payroll">("overview");
  const [period, setPeriod] = useState<BudgetPeriod>("month");
  const [glSearch, setGlSearch] = useState("");
  const [salesSearch, setSalesSearch] = useState("");
  const [showRecordSale, setShowRecordSale] = useState(false);
  const [showRecordPurchase, setShowRecordPurchase] = useState(false);

  const [sales, setSales] = useState<ApiSale[] | null>(null);
  const [salesError, setSalesError] = useState("");
  const [purchases, setPurchases] = useState<ApiPurchase[] | null>(null);
  const [purchasesError, setPurchasesError] = useState("");
  const [items, setItems] = useState<ApiInventoryItemLite[]>([]);
  const [batches, setBatches] = useState<ApiBatchLite[] | null>(null);
  const [batchesError, setBatchesError] = useState("");
  const [costBreakdowns, setCostBreakdowns] = useState<Map<string, ApiCostBreakdown>>(new Map());
  const [accounts, setAccounts] = useState<ApiAccount[]>([]);
  const [trialBalance, setTrialBalance] = useState<ApiTrialBalance | null>(null);
  const [glError, setGlError] = useState("");
  const [budgetReport, setBudgetReport] = useState<ReportPayload | null>(null);
  const [budgetError, setBudgetError] = useState("");

  const loadSales = useCallback(() => {
    apiClient.get<ApiSale[]>(`/api/data/sales?tenantId=${tenantId}`).then((res) => {
      if (res.success) { setSales(res.data); setSalesError(""); }
      else setSalesError(res.error || "Failed to load sales.");
    });
  }, [tenantId]);

  const loadPurchases = useCallback(() => {
    apiClient.get<ApiPurchase[]>(`/api/purchases?tenantId=${tenantId}`).then((res) => {
      if (res.success) { setPurchases(res.data); setPurchasesError(""); }
      else setPurchasesError(res.error || "Failed to load purchases.");
    });
  }, [tenantId]);

  const loadBatches = useCallback(() => {
    apiClient.get<ApiBatchLite[]>(`/api/batches?tenantId=${tenantId}`).then((res) => {
      if (res.success) { setBatches(res.data); setBatchesError(""); }
      else setBatchesError(res.error || "Failed to load batches.");
    });
  }, [tenantId]);

  const loadGL = useCallback(() => {
    apiClient.get<ApiAccount[]>("/api/gl/accounts").then((res) => {
      if (res.success) setAccounts(res.data);
    });
    apiClient.get<ApiTrialBalance>(`/api/gl/trial-balance?tenantId=${tenantId}`).then((res) => {
      if (res.success) { setTrialBalance(res.data); setGlError(""); }
      else setGlError(res.error || "Failed to load trial balance.");
    });
  }, [tenantId]);

  // Budget Overview (issue #299): Month/Quarter/YTD toggle refetches
  // GET /api/reports/pl with that period's from/to (lib/period-range.ts),
  // instead of the all-time trial balance — see the file-top comment.
  const loadBudget = useCallback(() => {
    const { from, to } = periodDateRange(period);
    const params = new URLSearchParams({ tenantId, from, to });
    apiClient.get<ReportPayload>(`/api/reports/pl?${params.toString()}`).then((res) => {
      if (res.success) { setBudgetReport(res.data); setBudgetError(""); }
      else setBudgetError(res.error || "Failed to load budget overview.");
    });
  }, [tenantId, period]);

  useEffect(() => { loadSales(); }, [loadSales]);
  useEffect(() => { loadPurchases(); }, [loadPurchases]);
  useEffect(() => { loadBatches(); }, [loadBatches]);
  useEffect(() => { loadGL(); }, [loadGL]);
  useEffect(() => { loadBudget(); }, [loadBudget]);
  useEffect(() => {
    apiClient.get<ApiInventoryItemLite[]>(`/api/inventory/items?tenantId=${tenantId}`).then((res) => {
      if (res.success) setItems(res.data);
    });
  }, [tenantId]);

  // Batch P&L (task 3): fetch each batch's real cost-breakdown once the
  // batch list has loaded. Fine to loop client-side at this scale; a real
  // aggregate endpoint would be worth a follow-on issue if the batch count
  // grows large.
  useEffect(() => {
    if (!batches || batches.length === 0) { setCostBreakdowns(new Map()); return; }
    let cancelled = false;
    Promise.all(
      batches.map((b) => apiClient.get<ApiCostBreakdown>(`/api/batches/${b.id}/cost-breakdown?tenantId=${tenantId}`))
    ).then((results) => {
      if (cancelled) return;
      const map = new Map<string, ApiCostBreakdown>();
      results.forEach((res, i) => { if (res.success) map.set(batches[i].id, res.data); });
      setCostBreakdowns(map);
    });
    return () => { cancelled = true; };
  }, [batches, tenantId]);

  const itemNameById = useMemo(() => new Map(items.map((i) => [i.id, i.name] as const)), [items]);
  const itemCategoryById = useMemo(() => new Map(items.map((i) => [i.id, i.category] as const)), [items]);
  const batchLabelById = useMemo(() => new Map((batches ?? []).map((b) => [b.id, b.code] as const)), [batches]);

  const salesRows = useMemo(() => (sales ?? []).map((s) => ({
    id: s.id,
    item: s.item,
    date: fmtDate(s.soldAt),
    batchLabel: s.batchId ? batchLabelById.get(s.batchId) ?? s.batchId : "",
    method: s.method,
    amount: s.amount,
    status: s.status,
  })), [sales, batchLabelById]);

  const filteredSales = salesRows.filter((s) => {
    if (!salesSearch.trim()) return true;
    const q = salesSearch.toLowerCase();
    return s.item.toLowerCase().includes(q) || s.batchLabel.toLowerCase().includes(q) || (s.method || "").toLowerCase().includes(q);
  });

  // Batch P&L rows: revenue = this batch's real sales summed; cost = the
  // batch's real cost-breakdown total (currently just acquisitionCostCents —
  // see app/api/batches/[id]/cost-breakdown/route.ts for why feed/health/
  // labour/overhead are 0/untracked today).
  const salesByBatch = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of sales ?? []) {
      if (!s.batchId) continue;
      m.set(s.batchId, (m.get(s.batchId) ?? 0) + s.amount);
    }
    return m;
  }, [sales]);

  const batchPLRows = useMemo(() => (batches ?? []).map((b) => {
    const breakdown = costBreakdowns.get(b.id);
    const costCents = breakdown?.totalTrackedCents ?? b.acquisitionCostCents ?? 0;
    const cost = Math.round(costCents / 100);
    const revenue = salesByBatch.get(b.id) ?? 0;
    const margin = revenue - cost;
    const pct = revenue > 0 ? Math.round((margin / revenue) * 1000) / 10 : 0;
    return { id: b.id, code: b.code, name: b.name, revenue, cost, margin, pct, status: b.status };
  }), [batches, costBreakdowns, salesByBatch]);

  // Budget Overview (issue #299): real revenue/expense totals for the
  // selected Month/Quarter/YTD period, from GET /api/reports/pl's
  // period-filtered meta (see loadBudget above and lib/reports.ts's
  // computePlReport) — not the all-time trial balance.
  const periodLabel = useMemo(() => periodDateRange(period).label, [period]);
  const totalRevenue = Number(budgetReport?.meta.periodRevenue ?? 0);
  const totalExpenses = Number(budgetReport?.meta.periodExpense ?? 0);
  const margin = totalRevenue - totalExpenses;
  const budgetTotal = totalRevenue + totalExpenses;

  const glRows = useMemo(() => (trialBalance?.rows ?? []), [trialBalance]);
  const filteredGL = glRows.filter((g) => {
    if (!glSearch.trim()) return true;
    const q = glSearch.toLowerCase();
    return g.name.toLowerCase().includes(q) || g.code.includes(q) || g.class.toLowerCase().includes(q);
  });

  function exportGLCsv() {
    const headers = ["code", "account", "type", "normalBalance", "debit", "credit", "balance"];
    const rows = glRows.map((g) => [g.code, g.name, g.class, g.normalBalance, g.debit, g.credit, g.balance]);
    const csv = [headers, ...rows].map((r) => r.join(",")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = "gl-trial-balance.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <div className="screen-content">
      <TopNav title="Finance" subtitle="Sales, purchases & GL"
        rightEl={
          <button className="btn-fab" style={{ width: 36, height: 36, borderRadius: 10 }}
            onClick={() => { if (tab === "sales") setShowRecordSale(true); else if (tab === "purchases") setShowRecordPurchase(true); }}>
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
          {/* Month/Quarter/YTD toggle (issue #299) — restored from the
              original design (commit 80ab7db); re-fetches GET
              /api/reports/pl scoped to the selected period (loadBudget
              above) rather than always showing all-time totals. */}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 4, marginBottom: 12 }}>
            {BUDGET_PERIODS.map((p) => (
              <button key={p} onClick={() => setPeriod(p)} style={{
                padding: "4px 10px", borderRadius: 100, fontSize: 10, fontWeight: 700, cursor: "pointer",
                background: period === p ? "rgba(74,222,128,0.2)" : "transparent",
                border: period === p ? "1px solid rgba(74,222,128,0.4)" : "1px solid transparent",
                color: period === p ? "var(--primary-green)" : "var(--text-muted)",
              }}>{p.toUpperCase()}</button>
            ))}
          </div>

          <div className="farm-card farm-card-active" style={{ padding: 18, marginBottom: 14 }}>
            <div className="section-eyebrow" style={{ marginBottom: 10 }}>Budget Overview — {periodLabel}</div>
            {budgetError && <div style={{ fontSize: 12, color: "var(--status-critical)", marginBottom: 10 }}>{budgetError}</div>}
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
              <div className="progress-fill" style={{ width: `${budgetTotal > 0 ? Math.min((totalRevenue/budgetTotal)*100,100) : 0}%` }} />
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6, fontSize: 10, color: "var(--text-muted)" }}>
              <span>Revenue {budgetTotal > 0 ? Math.round((totalRevenue/budgetTotal)*100) : 0}%</span>
              <span>Expenses {budgetTotal > 0 ? Math.round((totalExpenses/budgetTotal)*100) : 0}%</span>
            </div>
          </div>

          <div className="section-eyebrow" style={{ marginBottom: 10 }}>Batch P&amp;L</div>
          {batchesError && <div style={{ fontSize: 12, color: "var(--status-critical)", marginBottom: 10 }}>{batchesError}</div>}
          {batches === null && !batchesError && (
            <div style={{ textAlign: "center", padding: "20px 0", color: "var(--text-dim)", fontSize: 13 }}>Loading batch P&amp;L…</div>
          )}
          {batches !== null && (
            <DataTable
              rows={batchPLRows as unknown as Record<string, unknown>[]}
              columns={BATCH_PNL_COLS}
              rowKey={(r) => r.id as string}
              onRowClick={(r) => navigate("batch-detail", { id: r.id as string, code: r.code as string })}
              defaultPageSize={10}
              pageSizes={[10, 20, 50]}
              bodyHeight={220}
              tableId="finance-batchpl"
              emptyText="No batch P&L data."
            />
          )}
          <div style={{ marginBottom: 20 }} />
        </div>
      )}

      {/* ── Sales ── */}
      {tab === "sales" && (
        <div className="px-screen">
          <div style={{ position: "relative", marginBottom: 12 }}>
            <Search size={14} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)", pointerEvents: "none" }} />
            <input className="farm-input" style={{ paddingLeft: 34, fontSize: 13 }} placeholder="Search item, batch, method…" value={salesSearch} onChange={e => setSalesSearch(e.target.value)} />
            {salesSearch && <button onClick={() => setSalesSearch("")} style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", padding: 0 }}><X size={14} /></button>}
          </div>
          {salesError && <div style={{ fontSize: 12, color: "var(--status-critical)", marginBottom: 10 }}>{salesError}</div>}
          {sales === null && !salesError ? (
            <div style={{ textAlign: "center", padding: "28px 0", color: "var(--text-dim)", fontSize: 13 }}>Loading sales…</div>
          ) : (
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
          )}
          <button className="btn-primary" style={{ width: "100%", justifyContent: "center", marginTop: 12, marginBottom: 20 }} onClick={() => setShowRecordSale(true)}>
            <Plus size={16} /> Record Sale
          </button>
        </div>
      )}

      {/* ── PURCHASES / EXPENSES ── */}
      {tab === "purchases" && (
        <div className="px-screen">
          {purchasesError && <div style={{ fontSize: 12, color: "var(--status-critical)", marginBottom: 10 }}>{purchasesError}</div>}
          {purchases === null && !purchasesError ? (
            <div style={{ textAlign: "center", padding: "28px 0", color: "var(--text-dim)", fontSize: 13 }}>Loading purchases…</div>
          ) : (purchases ?? []).length === 0 ? (
            <div style={{ padding: 24, textAlign: "center" }}>
              <div style={{ fontSize: 36, marginBottom: 8 }}>🧾</div>
              <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text-primary)", marginBottom: 4 }}>No expenses yet</div>
              <div style={{ fontSize: 12, color: "var(--text-muted)" }}>Record one below.</div>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 12 }}>
              {(purchases ?? []).map((p) => (
                <div key={p.id} className="farm-card" style={{ padding: 14 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 }}>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 13, color: "var(--text-primary)" }}>{itemNameById.get(p.itemId) ?? p.itemId}</div>
                      <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 1 }}>{p.supplier} · {fmtDate(p.createdAt)}</div>
                    </div>
                    {itemCategoryById.get(p.itemId) && (
                      <span className={`chip ${catChipClass(itemCategoryById.get(p.itemId) as string)}`} style={{ fontSize: 9 }}>{itemCategoryById.get(p.itemId)}</span>
                    )}
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8 }}>
                    <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{p.quantity.toLocaleString()} units</span>
                    <span style={{ fontSize: 14, fontWeight: 700, color: "var(--status-critical)" }}>KSh {(p.totalCostCents / 100).toLocaleString()}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
          <button className="btn-primary" style={{ width: "100%", justifyContent: "center", marginBottom: 20 }} onClick={() => setShowRecordPurchase(true)}>
            <Plus size={16} /> Record Purchase
          </button>
        </div>
      )}

      {/* ── GL ACCOUNTS ── */}
      {tab === "gl" && (
        <div className="px-screen">
          <div style={{ padding: "10px 14px", background: "rgba(96,165,250,0.08)", borderRadius: 12, marginBottom: 14, border: "1px solid rgba(96,165,250,0.2)" }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "var(--accent-blue)", marginBottom: 2 }}>General Ledger — {accounts.length} accounts</div>
            <div style={{ display: "flex", gap: 16, marginTop: 6 }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 700, color: "var(--status-ok)" }}>KSh {(trialBalance?.totalCredits ?? 0).toLocaleString()}</div>
                <div style={{ fontSize: 10, color: "var(--text-muted)" }}>Total Credits</div>
              </div>
              <div>
                <div style={{ fontSize: 14, fontWeight: 700, color: "var(--status-critical)" }}>KSh {(trialBalance?.totalDebits ?? 0).toLocaleString()}</div>
                <div style={{ fontSize: 10, color: "var(--text-muted)" }}>Total Debits</div>
              </div>
              <div>
                <div style={{ fontSize: 14, fontWeight: 700, color: trialBalance?.balanced ? "var(--status-ok)" : "var(--status-critical)" }}>
                  {trialBalance ? (trialBalance.balanced ? "Balanced" : "Out of balance") : "—"}
                </div>
                <div style={{ fontSize: 10, color: "var(--text-muted)" }}>Status</div>
              </div>
            </div>
          </div>

          {glError && <div style={{ fontSize: 12, color: "var(--status-critical)", marginBottom: 10 }}>{glError}</div>}

          <div style={{ position: "relative", marginBottom: 14 }}>
            <Search size={14} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)", pointerEvents: "none" }} />
            <input className="farm-input" style={{ paddingLeft: 34, fontSize: 13 }} placeholder="Search account, code, type…" value={glSearch} onChange={e => setGlSearch(e.target.value)} />
            {glSearch && <button onClick={() => setGlSearch("")} style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", padding: 0 }}><X size={14} /></button>}
          </div>

          {trialBalance === null && !glError ? (
            <div style={{ textAlign: "center", padding: "28px 0", color: "var(--text-dim)", fontSize: 13 }}>Loading trial balance…</div>
          ) : (
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
          )}

          <button className="btn-secondary" style={{ width: "100%", justifyContent: "center", marginTop: 12, marginBottom: 20 }} onClick={exportGLCsv} disabled={glRows.length === 0}>
            <Download size={14} /> Export GL to CSV
          </button>
        </div>
      )}

      {/* ── PAYROLL ── */}
      {tab === "payroll" && (
        <div className="px-screen">
          <div className="farm-card" style={{ padding: 28, textAlign: "center", marginTop: 8 }}>
            <Lock size={28} color="var(--text-dim)" style={{ marginBottom: 10 }} />
            <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text-primary)", marginBottom: 6 }}>Not available yet</div>
            <div style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5 }}>
              Payroll isn&apos;t tracked in the system yet — there is no real pay data to show. This screen will connect to a real payroll module once one is built.
            </div>
          </div>
        </div>
      )}

      {showRecordSale && (
        <RecordSaleSheet
          tenantId={tenantId}
          batches={batches ?? []}
          onCreated={() => { loadSales(); loadGL(); }}
          onClose={() => setShowRecordSale(false)}
        />
      )}
      {showRecordPurchase && (
        <RecordPurchaseSheet
          tenantId={tenantId}
          itemNames={items.map((i) => i.name)}
          onCreated={() => { loadPurchases(); loadGL(); }}
          onClose={() => setShowRecordPurchase(false)}
        />
      )}
    </div>
  );
}
