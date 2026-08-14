"use client";
import React, { useState, useEffect, useCallback } from "react";
import { useNav, TopNav } from "./navigation";
import { apiClient } from "@/lib/request";
import { Plus, Search, X, RefreshCw, Download, Lock } from "./icons";
import { CsvImportModal } from "./csv-import";
import { DataTable, ColDef } from "./data-table";

// ── Real-data wiring (issue #236) ───────────────────────────────────────────
// This screen used to render entirely from hardcoded mock arrays (stock
// items, purchases, variances, feed mixes). Those are gone. Real endpoints
// (issue #235, merged):
//   GET  /api/inventory/items                — merged item+lots stock list
//   GET  /api/purchases, POST /api/purchases  — purchase history + record
//   PATCH /api/inventory/lots/[id]            — reason-required qty adjust
//   GET  /api/inventory/items/[id]/usage-history — receipt history for an item
//   GET  /api/inventory/variance              — staleness-based variance flag
// There is no feed-mix backend anywhere on this branch — the Feed Mix tab
// below is an honest "not available" state, not wired to anything fake.

/* ── API row shapes (exactly as the routes above return them) ── */
interface ApiLot {
  id: string;
  itemId: string;
  lotNo: string;
  qtyOnHand: number;
  unitCostCents: number;
  expiryDate: string | null;
  receivedDate: string;
}
interface ApiInventoryItem {
  id: string;
  name: string;
  category: string;
  unit: string;
  lowStockThreshold: number;
  qtyOnHand: number; // sum of this item's lots' qtyOnHand, computed server-side
  lots: ApiLot[];
  status: "ok" | "low" | "expiring";
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
interface ApiVarianceRow {
  lotId: string;
  itemId: string;
  itemName: string;
  lotNo: string;
  qtyOnHand: number;
  lastReconciledAt: string;
  daysSinceReconciliation: number;
  flagged: boolean;
}

const catEmoji: Record<string, string> = {
  Feed: "🌾", Vaccine: "💉", Medicine: "🧪", Seed: "🌱",
};

function fmtDate(d?: string | null): string | undefined {
  if (!d) return undefined;
  return d.slice(0, 10);
}

function avgUnitCostCents(item: ApiInventoryItem): number {
  const totalQty = item.lots.reduce((s, l) => s + l.qtyOnHand, 0);
  if (totalQty <= 0) return item.lots[0]?.unitCostCents ?? 0;
  const totalCost = item.lots.reduce((s, l) => s + l.unitCostCents * l.qtyOnHand, 0);
  return Math.round(totalCost / totalQty);
}

function nearestExpiry(item: ApiInventoryItem): string | null {
  const dates = item.lots.map(l => l.expiryDate).filter((d): d is string => !!d).sort();
  return dates[0] ?? null;
}

/* Purchases have no `status` column — the real fields are totalCostCents vs
 * amountPaidCents. That's the honest replacement for the mock's
 * "delivered"/"pending" chip. */
function paymentStatus(p: ApiPurchase): "paid" | "partial" | "unpaid" {
  if (p.totalCostCents > 0 && p.amountPaidCents >= p.totalCostCents) return "paid";
  if (p.amountPaidCents > 0) return "partial";
  return "unpaid";
}

/* ── Record Purchase sheet — real POST /api/purchases. Used from both the
 * Purchases tab (blank) and the item detail screen (prefilled). ── */
function RecordPurchaseSheet({ tenantId, itemNames, prefill, onCreated, onClose }: {
  tenantId: string;
  itemNames: string[];
  prefill?: { itemName?: string; unit?: string; category?: string };
  onCreated: () => void;
  onClose: () => void;
}) {
  const [supplier, setSupplier] = useState("");
  const [itemName, setItemName] = useState(prefill?.itemName ?? "");
  const [category, setCategory] = useState(prefill?.category ?? "");
  const [unit, setUnit] = useState(prefill?.unit ?? "");
  const [quantity, setQuantity] = useState("");
  const [unitCost, setUnitCost] = useState("");
  const [lowStockThreshold, setLowStockThreshold] = useState("");
  const [lotNo, setLotNo] = useState("");
  const [expiryDate, setExpiryDate] = useState("");
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
      lowStockThreshold: lowStockThreshold ? Math.trunc(Number(lowStockThreshold)) : undefined,
      quantity: Math.trunc(qty),
      unitCostCents: Math.round(cost * 100),
      paymentMethod: paymentMethod.trim() || undefined,
      amountPaidCents: amountPaid ? Math.round(Number(amountPaid) * 100) : undefined,
      lotNo: lotNo.trim() || undefined,
      expiryDate: expiryDate || undefined,
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
          <div style={{ fontWeight: 700, fontSize: 16 }}>Record Purchase</div>
          <button className="btn-icon" onClick={onClose}><X size={16} /></button>
        </div>

        <div style={{ marginBottom: 12 }}>
          <label style={{ fontSize: 11, fontWeight: 700, color: "var(--text-secondary)", display: "block", marginBottom: 5 }}>Supplier *</label>
          <input className="farm-input" placeholder="e.g. Unga Ltd" value={supplier} onChange={e => setSupplier(e.target.value)} />
        </div>
        <div style={{ marginBottom: 12 }}>
          <label style={{ fontSize: 11, fontWeight: 700, color: "var(--text-secondary)", display: "block", marginBottom: 5 }}>Item *</label>
          <input className="farm-input" list="inv-item-names" placeholder="e.g. Broiler Starter Mash" value={itemName} onChange={e => setItemName(e.target.value)} />
          <datalist id="inv-item-names">
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
            <label style={{ fontSize: 11, fontWeight: 700, color: "var(--text-secondary)", display: "block", marginBottom: 5 }}>Lot No.</label>
            <input className="farm-input" placeholder="auto if blank" value={lotNo} onChange={e => setLotNo(e.target.value)} />
          </div>
          <div>
            <label style={{ fontSize: 11, fontWeight: 700, color: "var(--text-secondary)", display: "block", marginBottom: 5 }}>Expiry Date</label>
            <input className="farm-input" type="date" value={expiryDate} onChange={e => setExpiryDate(e.target.value)} />
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
        <div style={{ marginBottom: 12 }}>
          <label style={{ fontSize: 11, fontWeight: 700, color: "var(--text-secondary)", display: "block", marginBottom: 5 }}>Reorder threshold (new items only)</label>
          <input className="farm-input" type="number" placeholder="e.g. 500" value={lowStockThreshold} onChange={e => setLowStockThreshold(e.target.value)} />
        </div>

        {error && <div style={{ fontSize: 11, color: "var(--status-critical)", marginBottom: 10 }}>{error}</div>}
        <button className="btn-primary" style={{ width: "100%", justifyContent: "center" }} disabled={saving} onClick={save}>
          {saving ? "Saving…" : "Record Purchase"}
        </button>
      </div>
    </div>
  );
}

/* Column definitions (outside component to keep stable refs) */
const STOCK_COLS: ColDef<Record<string, unknown>>[] = [
  {
    key: "name", header: "Item", sortable: true, minWidth: 140,
    summary: () => <span style={{ fontWeight: 700, fontSize: 11, color: "var(--text-muted)" }}>TOTALS</span>,
    render: (r) => (
      <div>
        <div style={{ fontWeight: 600, fontSize: 12 }}>
          {(catEmoji[(r.category as string)] ?? "")} {r.name as string}
        </div>
        <div style={{ fontSize: 9, color: "var(--text-dim)" }}>
          {(r.lotCount as number) === 1 ? (r.singleLotNo as string) : `${r.lotCount as number} lots`}
        </div>
      </div>
    ),
  },
  {
    key: "qtyOnHand", header: "Qty", sortable: true, align: "right", minWidth: 70,
    summary: "sum",
    render: (r) => (
      <span style={{ fontWeight: 700, color: r.status === "low" ? "var(--status-warning)" : "var(--text-primary)" }}>
        {(r.qtyOnHand as number).toLocaleString()}{r.unit as string}
      </span>
    ),
  },
  {
    key: "lowStockThreshold", header: "Reorder", sortable: true, align: "right", minWidth: 72,
    summary: "sum",
    render: (r) => <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{(r.lowStockThreshold as number).toLocaleString()}{r.unit as string}</span>,
  },
  {
    key: "avgCost", header: "Cost/u", sortable: true, align: "right", minWidth: 68,
    summary: "avg",
    render: (r) => <span style={{ fontSize: 11 }}>KSh {((r.avgCost as number) / 100).toLocaleString()}</span>,
  },
  {
    key: "status", header: "Status", align: "center", minWidth: 72,
    summary: "count",
    render: (r) => (
      <span className={`chip ${r.status === "ok" ? "chip-ok" : r.status === "low" ? "chip-warning" : "chip-critical"}`} style={{ fontSize: 9 }}>
        {r.status === "ok" ? "OK" : r.status === "low" ? "LOW" : "EXPIRING"}
      </span>
    ),
  },
];

const VARIANCE_COLS: ColDef<Record<string, unknown>>[] = [
  {
    key: "itemName", header: "Item", sortable: true, minWidth: 140,
    summary: () => <span style={{ fontWeight: 700, fontSize: 11, color: "var(--text-muted)" }}>TOTALS</span>,
    render: (r) => (
      <div>
        <div style={{ fontWeight: 600, fontSize: 12 }}>{r.itemName as string}</div>
        <div style={{ fontSize: 9, color: "var(--text-dim)" }}>{r.lotNo as string}</div>
      </div>
    ),
  },
  { key: "qtyOnHand", header: "On Hand", sortable: true, align: "right", minWidth: 80, summary: "sum", render: (r) => <span style={{ fontSize: 12 }}>{(r.qtyOnHand as number).toLocaleString()}</span> },
  {
    key: "daysSinceReconciliation", header: "Stale (days)", sortable: true, align: "right", minWidth: 96,
    summary: "avg",
    render: (r) => <span style={{ fontWeight: 700, color: (r.flagged as boolean) ? "var(--status-critical)" : "var(--text-secondary)" }}>{r.daysSinceReconciliation as number}d</span>,
  },
  {
    key: "flagged", header: "Action", align: "center", minWidth: 68,
    summary: "count",
    render: (r) => r.flagged
      ? <span className="chip chip-critical" style={{ fontSize: 9 }}>RECOUNT</span>
      : <span className="chip chip-ok" style={{ fontSize: 9 }}>OK</span>,
  },
];

export function InventoryScreen() {
  const { navigate, tenantId } = useNav();
  const [tab, setTab] = useState<"stock" | "purchases" | "variance" | "feedmix">("stock");
  const [cat, setCat] = useState("All");
  const [stockSearch, setStockSearch] = useState("");
  const [showImport, setShowImport] = useState(false);
  const [showRecordPurchase, setShowRecordPurchase] = useState(false);
  const [importing, setImporting] = useState(false);

  const [items, setItems] = useState<ApiInventoryItem[] | null>(null);
  const [purchases, setPurchases] = useState<ApiPurchase[] | null>(null);
  const [variance, setVariance] = useState<ApiVarianceRow[] | null>(null);

  const loadItems = useCallback(() => {
    apiClient.get<ApiInventoryItem[]>(`/api/inventory/items?tenantId=${tenantId}`).then(res => {
      if (res.success) setItems(res.data);
    });
  }, [tenantId]);
  const loadPurchases = useCallback(() => {
    apiClient.get<ApiPurchase[]>(`/api/purchases?tenantId=${tenantId}`).then(res => {
      if (res.success) setPurchases(res.data);
    });
  }, [tenantId]);
  const loadVariance = useCallback(() => {
    apiClient.get<ApiVarianceRow[]>(`/api/inventory/variance?tenantId=${tenantId}`).then(res => {
      if (res.success) setVariance(res.data);
    });
  }, [tenantId]);

  const loadAll = useCallback(() => {
    loadItems();
    loadPurchases();
    loadVariance();
  }, [loadItems, loadPurchases, loadVariance]);

  useEffect(() => { loadAll(); }, [loadAll]);

  const loading = items === null;
  const cats = ["All", ...Array.from(new Set((items ?? []).map(i => i.category).filter(Boolean)))];
  const lowCount = (items ?? []).filter((i) => i.status === "low" || i.status === "expiring").length;
  const totalLots = (items ?? []).reduce((s, i) => s + i.lots.length, 0);
  const flaggedVariances = (variance ?? []).filter(v => v.flagged).length;

  // The CSV template (components/farm/csv-import.tsx) has no supplier column,
  // so imported rows record purchases under a fixed "CSV Import" supplier —
  // real POST /api/purchases calls, not a silent no-op (issue #236 task 7).
  async function handleImportRows(rows: Record<string, string>[]) {
    setImporting(true);
    for (const row of rows) {
      const itemName = row.name?.trim();
      const unit = row.unit?.trim();
      const qty = Number(row.qty);
      if (!itemName || !unit || !Number.isFinite(qty) || qty <= 0) continue;
      const costPerUnit = Number(row.costPerUnit);
      await apiClient.post("/api/purchases", {
        tenantId,
        supplier: "CSV Import",
        itemName,
        category: row.category || undefined,
        unit,
        quantity: Math.trunc(qty),
        unitCostCents: Number.isFinite(costPerUnit) && costPerUnit > 0 ? Math.round(costPerUnit * 100) : 0,
        lowStockThreshold: row.reorder ? Math.trunc(Number(row.reorder)) : undefined,
        lotNo: row.lotNumber || undefined,
        expiryDate: row.expiryDate || undefined,
      });
    }
    setImporting(false);
    loadAll();
  }

  function exportStockCSV() {
    const headers = ["id", "name", "category", "unit", "qtyOnHand", "lowStockThreshold", "avgCostCents", "status"];
    const rows = (items ?? []).map(i => [i.id, i.name, i.category, i.unit, i.qtyOnHand, i.lowStockThreshold, avgUnitCostCents(i), i.status]);
    const csv = [headers, ...rows].map(r => r.join(",")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = "inventory.csv";
    a.click();
  }

  const filteredStock = (items ?? [])
    .filter((i) => cat === "All" || i.category === cat)
    .filter((i) => {
      if (!stockSearch.trim()) return true;
      const q = stockSearch.toLowerCase();
      return i.name.toLowerCase().includes(q) || i.category.toLowerCase().includes(q) || i.lots.some(l => l.lotNo.toLowerCase().includes(q));
    })
    .map((i) => ({
      ...i,
      avgCost: avgUnitCostCents(i),
      lotCount: i.lots.length,
      singleLotNo: i.lots[0]?.lotNo ?? "no lots",
    }));

  const itemNameById = new Map((items ?? []).map(i => [i.id, i.name] as const));

  return (
    <div className="screen-content">
      <TopNav title="Inventory" subtitle="Lots, stock & purchases" showSearch
        rightEl={
          <div style={{ display: "flex", gap: 6 }}>
            <button onClick={() => setShowImport(true)} style={{ width: 36, height: 36, borderRadius: 10, background: "var(--surface)", border: "1px solid var(--border-subtle)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }} title="Import inventory CSV">
              <RefreshCw size={13} color="var(--text-muted)" />
            </button>
            <button onClick={exportStockCSV} style={{ width: 36, height: 36, borderRadius: 10, background: "var(--surface)", border: "1px solid var(--border-subtle)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }} title="Export inventory CSV">
              <Download size={14} color="var(--text-muted)" />
            </button>
            <button className="btn-fab" style={{ width: 36, height: 36, borderRadius: 10 }} onClick={() => setShowRecordPurchase(true)}>
              <Plus size={16} />
            </button>
          </div>
        }
      />

      {/* Summary */}
      <div className="px-screen" style={{ paddingTop: 12 }}>
        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          {[
            { label: "Items", value: (items ?? []).length, color: "var(--primary-green)" },
            { label: "Low/Expiring", value: lowCount, color: lowCount > 0 ? "var(--status-warning)" : "var(--text-muted)" },
            { label: "Flagged", value: flaggedVariances, color: flaggedVariances > 0 ? "var(--status-critical)" : "var(--text-muted)" },
            { label: "Lots", value: totalLots, color: "var(--accent-blue)" },
          ].map((s) => (
            <div key={s.label} style={{ flex: 1, background: "var(--card)", borderRadius: 12, padding: "10px 8px", textAlign: "center", border: "1px solid var(--border-subtle)" }}>
              <div style={{ fontSize: 18, fontWeight: 700, color: s.color }}>{s.value}</div>
              <div style={{ fontSize: 9, color: "var(--text-muted)", fontWeight: 600, marginTop: 2 }}>{s.label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Tabs */}
      <div className="px-screen" style={{ display: "flex", gap: 4, marginBottom: 12 }}>
        {[["stock", "Stock"], ["purchases", "Purchases"], ["variance", "Variance"], ["feedmix", "Feed Mix"]].map(([id, label]) => (
          <button key={id} onClick={() => setTab(id as typeof tab)} style={{
            flex: 1, padding: "7px 4px", borderRadius: 10, fontSize: 11, fontWeight: 700, cursor: "pointer",
            background: tab === id ? "rgba(74,222,128,0.15)" : "var(--card)",
            border: tab === id ? "1px solid rgba(74,222,128,0.4)" : "1px solid var(--border-subtle)",
            color: tab === id ? "var(--primary-green)" : "var(--text-muted)",
          }}>{label}</button>
        ))}
      </div>

      {loading && <div className="px-screen"><div style={{ fontSize: 12, color: "var(--text-dim)", padding: "12px 0" }}>Loading inventory…</div></div>}

      {/* STOCK TAB */}
      {!loading && tab === "stock" && (
        <div className="px-screen">
          <div style={{ position: "relative", marginBottom: 10 }}>
            <Search size={14} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)", pointerEvents: "none" }} />
            <input className="farm-input" style={{ paddingLeft: 34, fontSize: 13 }} placeholder="Search item, category, lot…" value={stockSearch} onChange={e => setStockSearch(e.target.value)} />
            {stockSearch && <button onClick={() => setStockSearch("")} style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", padding: 0 }}><X size={14} /></button>}
          </div>
          <div className="chip-row" style={{ marginBottom: 12 }}>
            {cats.map((c) => (
              <button key={c} onClick={() => setCat(c)} className={`filter-chip ${cat === c ? "active" : ""}`}>{catEmoji[c] ?? ""} {c}</button>
            ))}
          </div>
          <div style={{ marginBottom: 20 }}>
            <DataTable
              rows={filteredStock as unknown as Record<string, unknown>[]}
              columns={STOCK_COLS}
              rowKey={(r) => r.id as string}
              onRowClick={(r) => navigate("inventory-detail", { id: r.id as string })}
              defaultPageSize={20}
              pageSizes={[10, 20, 50, 100]}
              bodyHeight={320}
              tableId="inventory-stock"
              emptyText="No items match your filter."
            />
          </div>
        </div>
      )}

      {/* PURCHASES TAB */}
      {!loading && tab === "purchases" && (
        <div className="px-screen">
          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 20 }}>
            {(purchases ?? []).length === 0 ? (
              <div style={{ padding: 24, textAlign: "center" }}>
                <div style={{ fontSize: 36, marginBottom: 8 }}>🧾</div>
                <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text-primary)", marginBottom: 4 }}>No purchases yet</div>
                <div style={{ fontSize: 12, color: "var(--text-muted)" }}>Record one below to bring stock in</div>
              </div>
            ) : (purchases ?? []).map((p) => {
              const status = paymentStatus(p);
              return (
                <div key={p.id} className="farm-card" style={{ padding: 14 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 }}>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 13, color: "var(--text-primary)" }}>{itemNameById.get(p.itemId) ?? p.itemId}</div>
                      <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 1 }}>{p.supplier} · {p.quantity.toLocaleString()}</div>
                    </div>
                    <span className={`chip ${status === "paid" ? "chip-ok" : status === "partial" ? "chip-warning" : "chip-critical"}`} style={{ fontSize: 9 }}>{status.toUpperCase()}</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8 }}>
                    <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{fmtDate(p.createdAt)}</span>
                    <span style={{ fontSize: 14, fontWeight: 700, color: "var(--status-ok)" }}>KSh {(p.totalCostCents / 100).toLocaleString()}</span>
                  </div>
                </div>
              );
            })}
          </div>
          <button className="btn-primary" style={{ width: "100%", justifyContent: "center", marginBottom: 20 }} onClick={() => setShowRecordPurchase(true)}>
            <Plus size={16} /> Record Purchase
          </button>
        </div>
      )}

      {/* VARIANCE TAB — staleness-based, not an expected-vs-actual gap (there is
          no physical-counts table on this branch; see lib/inventory.ts). */}
      {!loading && tab === "variance" && (
        <div className="px-screen">
          <div style={{ padding: "10px 14px", background: "rgba(251,191,36,0.08)", borderRadius: 12, marginBottom: 16, border: "1px solid rgba(251,191,36,0.25)" }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "var(--status-warning)", marginBottom: 4 }}>⚠ Reconciliation Review</div>
            <div style={{ fontSize: 11, color: "var(--text-muted)" }}>How long since each lot&apos;s on-hand figure was last confirmed (received or reason-adjusted). Lots stale past 30 days are flagged for a physical recount — there&apos;s no expected-vs-actual number to show without one.</div>
          </div>
          <div style={{ marginBottom: 20 }}>
            <DataTable
              rows={(variance ?? []) as unknown as Record<string, unknown>[]}
              columns={VARIANCE_COLS}
              rowKey={(r) => r.lotId as string}
              defaultPageSize={20}
              pageSizes={[10, 20, 50]}
              bodyHeight={220}
              tableId="inventory-variance"
              emptyText="No lots recorded."
            />
          </div>
        </div>
      )}

      {/* FEED MIX TAB — no feed-mix backend exists on this branch. Honest
          "not available" state per issue #236 task 4, not a silently broken form. */}
      {!loading && tab === "feedmix" && (
        <div className="px-screen">
          <div style={{ padding: 32, textAlign: "center" }}>
            <Lock size={28} color="var(--text-dim)" style={{ marginBottom: 10 }} />
            <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text-primary)", marginBottom: 4 }}>Feed Mix not available yet</div>
            <div style={{ fontSize: 12, color: "var(--text-muted)", maxWidth: 260, margin: "0 auto" }}>
              There is no feed-mix backend on this branch — no table, no route. This tab is disabled rather than wired to fake data.
            </div>
          </div>
        </div>
      )}

      {/* CSV Import Modal */}
      {showImport && (
        <CsvImportModal
          entity="inventory"
          onClose={() => setShowImport(false)}
          onImport={handleImportRows}
        />
      )}
      {importing && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 200 }}>
          <div style={{ background: "var(--surface)", borderRadius: 12, padding: "14px 20px", fontSize: 12, color: "var(--text-primary)" }}>Importing…</div>
        </div>
      )}
      {showRecordPurchase && (
        <RecordPurchaseSheet
          tenantId={tenantId}
          itemNames={(items ?? []).map(i => i.name)}
          onCreated={loadAll}
          onClose={() => setShowRecordPurchase(false)}
        />
      )}
    </div>
  );
}

/* ── Per-lot adjust control — real PATCH /api/inventory/lots/[id], reason
 * required (the endpoint 400s without one). ── */
function LotRow({ lot, tenantId, onSaved }: { lot: ApiLot; tenantId: string; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [qty, setQty] = useState(String(lot.qtyOnHand));
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    const newQty = Number(qty);
    if (!Number.isFinite(newQty) || newQty < 0) { setError("Enter a valid quantity."); return; }
    if (!reason.trim()) { setError("A reason is required for this adjustment."); return; }
    setSaving(true);
    setError("");
    const res = await apiClient.patch(`/api/inventory/lots/${lot.id}?tenantId=${tenantId}`, {
      qtyOnHand: Math.trunc(newQty),
      reason: reason.trim(),
    });
    setSaving(false);
    if (res.success) {
      setOpen(false);
      setReason("");
      onSaved();
    } else {
      setError(res.error || "Failed to adjust quantity.");
    }
  }

  return (
    <div style={{ padding: "10px 0", borderBottom: "1px solid var(--border-subtle)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-primary)" }}>{lot.lotNo}</div>
          <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 1 }}>
            Received {fmtDate(lot.receivedDate) ?? "—"}{lot.expiryDate ? ` · Expires ${fmtDate(lot.expiryDate)}` : ""}
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text-primary)" }}>{lot.qtyOnHand.toLocaleString()}</div>
          <button onClick={() => setOpen(o => !o)} style={{ fontSize: 10, fontWeight: 700, color: "var(--primary-green)", background: "none", border: "none", cursor: "pointer", padding: 0, marginTop: 2 }}>
            {open ? "Cancel" : "Adjust"}
          </button>
        </div>
      </div>
      {open && (
        <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 8 }}>
          <div>
            <label style={{ fontSize: 10, fontWeight: 700, color: "var(--text-muted)", display: "block", marginBottom: 4 }}>New Quantity</label>
            <input className="farm-input" style={{ fontSize: 12 }} type="number" value={qty} onChange={e => setQty(e.target.value)} />
          </div>
          <div>
            <label style={{ fontSize: 10, fontWeight: 700, color: "var(--text-muted)", display: "block", marginBottom: 4 }}>Reason * (required, goes to the audit trail)</label>
            <input className="farm-input" style={{ fontSize: 12 }} placeholder="e.g. physical recount, spoilage, theft" value={reason} onChange={e => setReason(e.target.value)} />
          </div>
          {error && <div style={{ fontSize: 11, color: "var(--status-critical)" }}>{error}</div>}
          <button onClick={save} className="btn-primary" style={{ justifyContent: "center", fontSize: 12, padding: 9 }} disabled={saving || !reason.trim()}>
            {saving ? "Saving…" : "Save Adjustment"}
          </button>
        </div>
      )}
    </div>
  );
}

export function InventoryDetailScreen() {
  const { params, tenantId } = useNav();
  const id = params.id;
  const [items, setItems] = useState<ApiInventoryItem[] | null>(null);
  const [showRecordPurchase, setShowRecordPurchase] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState<ApiPurchase[] | null>(null);

  const load = useCallback(() => {
    apiClient.get<ApiInventoryItem[]>(`/api/inventory/items?tenantId=${tenantId}`).then(res => {
      if (res.success) setItems(res.data);
    });
  }, [tenantId]);

  useEffect(() => { load(); }, [load]);

  function loadHistory() {
    if (!id) return;
    setShowHistory(h => {
      const next = !h;
      if (next && history === null) {
        apiClient.get<ApiPurchase[]>(`/api/inventory/items/${id}/usage-history?tenantId=${tenantId}`).then(res => {
          if (res.success) setHistory(res.data);
        });
      }
      return next;
    });
  }

  if (items === null) {
    return (
      <div className="screen-content">
        <TopNav title="Item" showBack />
        <div className="px-screen" style={{ paddingTop: 40, textAlign: "center" }}>
          <div style={{ fontSize: 12, color: "var(--text-dim)" }}>Loading item…</div>
        </div>
      </div>
    );
  }

  const item = items.find(i => i.id === id);
  if (!item) {
    return (
      <div className="screen-content">
        <TopNav title="Item" showBack />
        <div className="px-screen" style={{ paddingTop: 40, textAlign: "center" }}>
          <div style={{ fontSize: 13, color: "var(--text-muted)" }}>Item not found.</div>
        </div>
      </div>
    );
  }

  const cost = avgUnitCostCents(item);
  const expiry = nearestExpiry(item);
  const isLow = item.qtyOnHand < item.lowStockThreshold;

  return (
    <div className="screen-content">
      <TopNav title={item.name} subtitle={`${item.category || "Uncategorised"} · ${item.lots.length} lot${item.lots.length === 1 ? "" : "s"}`} showBack />
      <div className="px-screen" style={{ paddingTop: 16 }}>
        <div className="farm-card" style={{ padding: 16, marginBottom: 16 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
            <div><div style={{ fontSize: 24, fontWeight: 700, color: "var(--primary-green)" }}>{item.qtyOnHand.toLocaleString()}<span style={{ fontSize: 14 }}>{item.unit}</span></div><div style={{ fontSize: 10, color: "var(--text-muted)" }}>In Stock</div></div>
            <div><div style={{ fontSize: 24, fontWeight: 700, color: "var(--text-primary)" }}>KSh {(cost / 100).toLocaleString()}</div><div style={{ fontSize: 10, color: "var(--text-muted)" }}>Avg per {item.unit}</div></div>
          </div>
          <div className="progress-track" style={{ marginBottom: 8 }}>
            <div className={`progress-fill ${isLow ? "progress-fill-red" : ""}`} style={{ width: `${item.lowStockThreshold > 0 ? Math.min((item.qtyOnHand / (item.lowStockThreshold * 3)) * 100, 100) : 100}%` }} />
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "var(--text-muted)" }}>
            <span>Reorder at: {item.lowStockThreshold.toLocaleString()}{item.unit}</span>
            <span>{expiry ? `Nearest expiry: ${fmtDate(expiry)}` : "No expiry tracked"}</span>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 20 }}>
          <button className="btn-primary" style={{ justifyContent: "center", borderRadius: 12, padding: 12 }} onClick={() => setShowRecordPurchase(true)}>Record Purchase</button>
          <button className="btn-secondary" style={{ justifyContent: "center", borderRadius: 12, padding: 12 }} onClick={loadHistory}>{showHistory ? "Hide History" : "Usage History"}</button>
          <button className="btn-secondary" style={{ justifyContent: "center", borderRadius: 12, padding: 12, opacity: 0.5, cursor: "not-allowed", gridColumn: "1 / -1" }} disabled title="Not available yet — no PATCH /api/inventory/items/[id] route exists">
            <Lock size={12} /> Edit Item
          </button>
        </div>

        {/* Lots — the merged qty above is the sum of these; adjustments are
            per-lot because PATCH /api/inventory/lots/[id] takes a lot id. */}
        <div className="farm-card" style={{ padding: 14, marginBottom: 16 }}>
          <div className="section-eyebrow" style={{ marginBottom: 4 }}>Lots</div>
          {item.lots.length === 0 ? (
            <div style={{ fontSize: 12, color: "var(--text-dim)", padding: "10px 0" }}>No lots recorded for this item.</div>
          ) : item.lots.map(lot => (
            <LotRow key={lot.id} lot={lot} tenantId={tenantId} onSaved={load} />
          ))}
        </div>

        {/* Usage History — really the item's purchase/receipt history (see
            app/api/inventory/items/[id]/usage-history/route.ts: there is no
            consumption/feeding ledger on this branch to derive usage-out
            from, so this honestly shows when stock came IN). */}
        {showHistory && (
          <div className="farm-card" style={{ padding: 14, marginBottom: 20 }}>
            <div className="section-eyebrow" style={{ marginBottom: 8 }}>Usage History (receipts)</div>
            {history === null ? (
              <div style={{ fontSize: 12, color: "var(--text-dim)" }}>Loading…</div>
            ) : history.length === 0 ? (
              <div style={{ fontSize: 12, color: "var(--text-dim)" }}>No purchase history for this item yet.</div>
            ) : history.map(p => (
              <div key={p.id} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid var(--border-subtle)", fontSize: 11 }}>
                <div>
                  <div style={{ fontWeight: 600, color: "var(--text-primary)" }}>{p.supplier}</div>
                  <div style={{ color: "var(--text-muted)" }}>{fmtDate(p.createdAt)}</div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontWeight: 700, color: "var(--text-primary)" }}>{p.quantity.toLocaleString()}{item.unit}</div>
                  <div style={{ color: "var(--text-muted)" }}>KSh {(p.totalCostCents / 100).toLocaleString()}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {showRecordPurchase && (
        <RecordPurchaseSheet
          tenantId={tenantId}
          itemNames={items.map(i => i.name)}
          prefill={{ itemName: item.name, unit: item.unit, category: item.category }}
          onCreated={load}
          onClose={() => setShowRecordPurchase(false)}
        />
      )}
    </div>
  );
}
