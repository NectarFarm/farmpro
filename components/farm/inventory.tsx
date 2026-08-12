"use client";
import React, { useState } from "react";
import { useNav, TopNav } from "./navigation";
import { Plus, AlertTriangle, Package, ChevronRight, Filter, Search, Edit2, Beaker, Syringe, X, ChevronUp, ChevronDown, RefreshCw, Download } from "./icons";
import { CsvImportModal } from "./csv-import";
import { DataTable, ColDef } from "./data-table";
const STOCK_ITEMS = [
  { id: "F001", name: "Broiler Starter Mash", cat: "Feed", unit: "kg", qty: 1240, reorder: 500, cost: 48, expiry: null, lot: "LOT-2026-045", status: "ok" },
  { id: "F002", name: "Layer Mash Premium", cat: "Feed", unit: "kg", qty: 320, reorder: 500, cost: 52, expiry: null, lot: "LOT-2026-046", status: "low" },
  { id: "F003", name: "Pig Finisher", cat: "Feed", unit: "kg", qty: 890, reorder: 300, cost: 58, expiry: null, lot: "LOT-2026-047", status: "ok" },
  { id: "M001", name: "Newcastle Vaccine", cat: "Vaccine", unit: "doses", qty: 2000, reorder: 500, cost: 2.5, expiry: "2026-12-31", lot: "VAC-2026-012", status: "ok" },
  { id: "M002", name: "Oxymav B – Antibiotic", cat: "Medicine", unit: "g", qty: 1500, reorder: 200, cost: 15, expiry: "2026-09-15", lot: "MED-2026-033", status: "expiring" },
  { id: "M003", name: "Coccidiostat", cat: "Medicine", unit: "kg", qty: 8, reorder: 5, cost: 450, expiry: "2027-01-10", lot: "MED-2026-034", status: "ok" },
  { id: "S001", name: "Maize Seed H614D", cat: "Seed", unit: "kg", qty: 150, reorder: 50, cost: 320, expiry: null, lot: "SEED-2026-002", status: "ok" },
];

const PURCHASES = [
  { date: "2026-08-08", item: "Broiler Starter Mash", qty: "2,000kg", supplier: "Unga Ltd", total: 96000, status: "delivered" },
  { date: "2026-08-05", item: "Newcastle Vaccine", qty: "5,000 doses", supplier: "Kenchic", total: 12500, status: "delivered" },
  { date: "2026-08-01", item: "Layer Mash Premium", qty: "1,000kg", supplier: "Bidco", total: 52000, status: "delivered" },
  { date: "2026-07-28", item: "Oxymav B", qty: "5kg", supplier: "Agrovet", total: 75000, status: "pending" },
];

const VARIANCES = [
  { item: "Layer Mash Premium", expected: 500, actual: 320, gap: -180, flagged: true },
  { item: "Broiler Starter Mash", expected: 1260, actual: 1240, gap: -20, flagged: false },
];

const FEED_MIXES = [
  { name: "Broiler Starter Mix", ingredients: ["Maize 60%", "Soya 30%", "Premix 10%"], cost: 48 },
  { name: "Layer Balance Mix", ingredients: ["Maize 55%", "Soya 25%", "Lime 10%", "Premix 10%"], cost: 46 },
];

const catColors: Record<string, string> = {
  Feed: "var(--primary-green)", Vaccine: "var(--accent-purple)",
  Medicine: "var(--accent-blue)", Seed: "var(--accent-amber)",
};
const catEmoji: Record<string, string> = {
  Feed: "🌾", Vaccine: "💉", Medicine: "🧪", Seed: "🌱",
};

type StockItem = typeof STOCK_ITEMS[number];
type VarianceRow = typeof VARIANCES[number];

/* Column definitions (defined outside component to be stable refs) */
const STOCK_COLS: ColDef<Record<string, unknown>>[] = [
  {
    key: "name", header: "Item", sortable: true, minWidth: 140,
    summary: () => <span style={{ fontWeight: 700, fontSize: 11, color: "var(--text-muted)" }}>TOTALS</span>,
    render: (r) => (
      <div>
        <div style={{ fontWeight: 600, fontSize: 12 }}>
          {(catEmoji[(r.cat as string)] ?? "")} {r.name as string}
        </div>
        <div style={{ fontSize: 9, color: "var(--text-dim)" }}>{r.lot as string}</div>
      </div>
    ),
  },
  {
    key: "qty", header: "Qty", sortable: true, align: "right", minWidth: 70,
    summary: "sum",
    render: (r) => (
      <span style={{ fontWeight: 700, color: r.status === "low" ? "var(--status-warning)" : "var(--text-primary)" }}>
        {(r.qty as number).toLocaleString()}{r.unit === "kg" ? "kg" : ""}
      </span>
    ),
  },
  {
    key: "reorder", header: "Reorder", sortable: true, align: "right", minWidth: 72,
    summary: "sum",
    render: (r) => <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{(r.reorder as number).toLocaleString()}{r.unit === "kg" ? "kg" : ""}</span>,
  },
  {
    key: "cost", header: "Cost/u", sortable: true, align: "right", minWidth: 68,
    summary: "avg",
    render: (r) => <span style={{ fontSize: 11 }}>KSh {r.cost as number}</span>,
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
    key: "item", header: "Item", sortable: true, minWidth: 140,
    summary: () => <span style={{ fontWeight: 700, fontSize: 11, color: "var(--text-muted)" }}>TOTALS</span>,
    render: (r) => <span style={{ fontWeight: 600, fontSize: 12 }}>{r.item as string}</span>,
  },
  { key: "expected", header: "Expected", sortable: true, align: "right", minWidth: 80, summary: "sum", render: (r) => <span style={{ fontSize: 12 }}>{r.expected as number}kg</span> },
  { key: "actual",   header: "Actual",   sortable: true, align: "right", minWidth: 72, summary: "sum", render: (r) => <span style={{ fontSize: 12 }}>{r.actual as number}kg</span> },
  {
    key: "gap", header: "Gap", sortable: true, align: "right", minWidth: 72,
    summary: "sum",
    render: (r) => <span style={{ fontWeight: 700, color: (r.gap as number) < -50 ? "var(--status-critical)" : "var(--status-warning)" }}>{r.gap as number}kg</span>,
  },
  {
    key: "flagged", header: "Action", align: "center", minWidth: 68,
    summary: "count",
    render: (r) => r.flagged
      ? <span className="chip chip-critical" style={{ fontSize: 9 }}>REVIEW</span>
      : <span className="chip chip-ok" style={{ fontSize: 9 }}>OK</span>,
  },
];

export function InventoryScreen() {
  const { navigate } = useNav();
  const [tab, setTab] = useState<"stock" | "purchases" | "variance" | "feedmix">("stock");
  const [cat, setCat] = useState("All");
  const [stockSearch, setStockSearch] = useState("");
  const [showImport, setShowImport] = useState(false);
  const [stockItems, setStockItems] = useState(STOCK_ITEMS);
  const cats = ["All", "Feed", "Vaccine", "Medicine", "Seed"];
  const lowCount = stockItems.filter((i) => i.status === "low" || i.status === "expiring").length;

  function handleImportRows(rows: Record<string, string>[]) {
    const imported = rows.map((row, idx) => ({
      id: row.id || row.code || `INV-IMP-${Date.now()}-${idx}`,
      name: row.name || "Imported Item",
      cat: row.cat || row.category || "Feed",
      unit: row.unit || "kg",
      qty: row.qty ? parseFloat(row.qty) : 0,
      reorder: row.reorder ? parseFloat(row.reorder) : 0,
      cost: row.cost ? parseFloat(row.cost) : 0,
      expiry: row.expiry || null,
      lot: row.lot || `LOT-IMP-${idx}`,
      status: (row.qty && row.reorder && parseFloat(row.qty) < parseFloat(row.reorder) ? "low" : row.expiry ? "ok" : "ok") as "ok" | "low" | "expiring",
    }));
    setStockItems(prev => {
      const existingIds = new Set(prev.map(i => i.id));
      const newRows = imported.filter(r => !existingIds.has(r.id));
      const updated = prev.map(i => {
        const match = imported.find(r => r.id === i.id);
        return match ? { ...i, ...match } : i;
      });
      return [...updated, ...newRows];
    });
  }

  function exportStockCSV() {
    const headers = ["id", "name", "cat", "unit", "qty", "reorder", "cost", "expiry", "lot", "status"];
    const rows = stockItems.map(i => [i.id, i.name, i.cat, i.unit, i.qty, i.reorder, i.cost, i.expiry ?? "", i.lot, i.status]);
    const csv = [headers, ...rows].map(r => r.join(",")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = "inventory.csv";
    a.click();
  }

  function handleStockSort(field: string) { void field; }

  const filteredStock = stockItems
    .filter((i) => cat === "All" || i.cat === cat)
    .filter((i) => {
      if (!stockSearch.trim()) return true;
      const q = stockSearch.toLowerCase();
      return i.name.toLowerCase().includes(q) || i.cat.toLowerCase().includes(q) || i.lot.toLowerCase().includes(q);
    });

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
            <button className="btn-fab" style={{ width: 36, height: 36, borderRadius: 10 }} onClick={() => navigate("inventory-detail")}>
              <Plus size={16} />
            </button>
          </div>
        }
      />

      {/* Summary */}
      <div className="px-screen" style={{ paddingTop: 12 }}>
        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          {[
            { label: "Items", value: stockItems.length, color: "var(--primary-green)" },
            { label: "Low/Expiring", value: lowCount, color: lowCount > 0 ? "var(--status-warning)" : "var(--text-muted)" },
            { label: "Variances", value: VARIANCES.filter(v => v.flagged).length, color: "var(--status-critical)" },
            { label: "Lots", value: stockItems.length, color: "var(--accent-blue)" },
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

      {/* STOCK TAB */}
      {tab === "stock" && (
        <div className="px-screen">
          {/* Search */}
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
      {tab === "purchases" && (
        <div className="px-screen">
          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 20 }}>
            {PURCHASES.map((p, i) => (
              <div key={i} className="farm-card" style={{ padding: 14 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 13, color: "var(--text-primary)" }}>{p.item}</div>
                    <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 1 }}>{p.supplier} · {p.qty}</div>
                  </div>
                  <span className={`chip ${p.status === "delivered" ? "chip-ok" : "chip-warning"}`} style={{ fontSize: 9 }}>{p.status.toUpperCase()}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8 }}>
                  <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{p.date}</span>
                  <span style={{ fontSize: 14, fontWeight: 700, color: "var(--status-ok)" }}>KSh {p.total.toLocaleString()}</span>
                </div>
              </div>
            ))}
          </div>
          <button className="btn-primary" style={{ width: "100%", justifyContent: "center", marginBottom: 20 }}>
            <Plus size={16} /> Record Purchase
          </button>
        </div>
      )}

      {/* VARIANCE TAB */}
      {tab === "variance" && (
        <div className="px-screen">
          <div style={{ padding: "10px 14px", background: "rgba(251,191,36,0.08)", borderRadius: 12, marginBottom: 16, border: "1px solid rgba(251,191,36,0.25)" }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "var(--status-warning)", marginBottom: 4 }}>⚠ Variance Review</div>
            <div style={{ fontSize: 11, color: "var(--text-muted)" }}>Comparing expected stock vs worker closing counts. Gaps may indicate theft, waste, or recording error.</div>
          </div>
          <div style={{ marginBottom: 20 }}>
            <DataTable
              rows={VARIANCES as unknown as Record<string, unknown>[]}
              columns={VARIANCE_COLS}
              rowKey={(r) => r.item as string}
              defaultPageSize={20}
              pageSizes={[10, 20, 50]}
              bodyHeight={220}
              tableId="inventory-variance"
              emptyText="No variances recorded."
            />
          </div>
        </div>
      )}

      {/* FEED MIX TAB */}
      {tab === "feedmix" && (
        <div className="px-screen">
          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 16 }}>
            {FEED_MIXES.map((m) => (
              <div key={m.name} className="farm-card" style={{ padding: 14 }}>
                <div style={{ fontWeight: 700, fontSize: 14, color: "var(--text-primary)", marginBottom: 8 }}>🌾 {m.name}</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
                  {m.ingredients.map((ing) => (
                    <span key={ing} style={{ padding: "3px 10px", borderRadius: 100, background: "rgba(74,222,128,0.1)", border: "1px solid rgba(74,222,128,0.2)", fontSize: 11, color: "var(--text-secondary)" }}>{ing}</span>
                  ))}
                </div>
                <div style={{ fontSize: 12, color: "var(--text-muted)" }}>Cost/kg: <span style={{ fontWeight: 700, color: "var(--primary-green)" }}>KSh {m.cost}</span></div>
              </div>
            ))}
          </div>
          <button className="btn-primary" style={{ width: "100%", justifyContent: "center", marginBottom: 20 }}>
            <Plus size={16} /> Create Feed Mix
          </button>
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
    </div>
  );
}

export function InventoryDetailScreen() {
  const { goBack, params } = useNav();
  const item = STOCK_ITEMS.find((i) => i.id === params.id) ?? STOCK_ITEMS[0];

  return (
    <div className="screen-content">
      <TopNav title={item.name} subtitle={`${item.lot} · ${item.cat}`} showBack />
      <div className="px-screen" style={{ paddingTop: 16 }}>
        <div className="farm-card" style={{ padding: 16, marginBottom: 16 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
            <div><div style={{ fontSize: 24, fontWeight: 700, color: "var(--primary-green)" }}>{item.qty.toLocaleString()}<span style={{ fontSize: 14 }}>{item.unit}</span></div><div style={{ fontSize: 10, color: "var(--text-muted)" }}>In Stock</div></div>
            <div><div style={{ fontSize: 24, fontWeight: 700, color: "var(--text-primary)" }}>KSh {item.cost}</div><div style={{ fontSize: 10, color: "var(--text-muted)" }}>Per {item.unit}</div></div>
          </div>
          <div className="progress-track" style={{ marginBottom: 8 }}>
            <div className={`progress-fill ${item.qty < item.reorder ? "progress-fill-red" : ""}`} style={{ width: `${Math.min((item.qty / (item.reorder * 3)) * 100, 100)}%` }} />
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "var(--text-muted)" }}>
            <span>Reorder at: {item.reorder}{item.unit}</span>
            <span>{item.expiry ? `Expires: ${item.expiry}` : "No expiry"}</span>
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 20 }}>
          <button className="btn-primary" style={{ justifyContent: "center", borderRadius: 12, padding: 12 }}>Record Purchase</button>
          <button className="btn-secondary" style={{ justifyContent: "center", borderRadius: 12, padding: 12 }}>Adjust Qty</button>
          <button className="btn-secondary" style={{ justifyContent: "center", borderRadius: 12, padding: 12 }}>Usage History</button>
          <button className="btn-secondary" style={{ justifyContent: "center", borderRadius: 12, padding: 12 }}>Edit Item</button>
        </div>
      </div>
    </div>
  );
}
