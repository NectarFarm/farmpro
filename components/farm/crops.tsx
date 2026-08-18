"use client";
import React, { useState, useEffect, useCallback } from "react";
import { useNav, TopNav } from "./navigation";
import { ENTERPRISE_REGISTRY } from "./data";
import { apiClient } from "@/lib/request";
import { Plus, X, Check, Upload, Lock } from "./icons";

// ── Real-data wiring (issue #232) ───────────────────────────────────────────
// This screen used to render entirely from the batches mock array exported by
// components/farm/data.ts. That import is gone from this file — every batch
// and unit shown here now comes from the real backend built in #231/#232:
//   GET/POST /api/batches, GET/PATCH /api/batches/[id],
//   GET /api/batches/[id]/cost-breakdown, GET/POST /api/units (new).
// `ENTERPRISE_REGISTRY` stays imported deliberately: it's UI config (process
// names/emoji/labels/prefixes), not persisted state — there is no
// enterprise-config table or route, and inventing one is out of scope here.

function genCode(prefix: string, farmCode: string, n: number) {
  const fc = farmCode.split("-")[1] ?? "XXX";
  return `${prefix}-${fc}-${String(n).padStart(3, "0")}`;
}

/* A batch row exactly as GET/POST /api/batches returns it. */
interface ApiBatch {
  id: string;
  tenantId: string;
  unitId: string;
  code: string;
  name: string;
  species: string;
  enterprise: string;
  stage: string;
  status: string;
  initialQty: number;
  currentQty: number;
  acquisitionCostCents: number;
  startDate: string | null;
  endDate: string | null;
  harvestDate: string | null;
  createdAt: string | null;
}

/* A production unit row exactly as GET/POST /api/units returns it. */
interface ApiUnit {
  id: string;
  tenantId: string;
  farmId: string;
  type: string;
  name: string;
  code: string;
  status: string;
}

/* The view-model this screen actually renders — a batch joined with its unit
 * and farm code, trimmed to the fields the cards below use. Not persisted
 * anywhere itself; it's derived client-side from the two fetches above. */
interface ViewBatch {
  id: string;
  code: string;
  label: string;
  enterprise: string;
  farmCode: string;
  unitId: string;
  unitCode: string;
  qty: number;
  initialQty: number;
  startDate: string;
  endDate?: string;
  harvestDate?: string;
  status: string;
  stage: string;
  costCents: number;
}

function fmtDate(d?: string | null): string | undefined {
  if (!d) return undefined;
  return d.slice(0, 10);
}

function toViewBatch(b: ApiBatch, units: ApiUnit[], farms: { id: string; code: string }[]): ViewBatch {
  const unit = units.find(u => u.id === b.unitId);
  const farm = unit ? farms.find(f => f.id === unit.farmId) : undefined;
  return {
    id: b.id,
    code: b.code,
    label: b.name,
    enterprise: b.enterprise,
    farmCode: farm?.code ?? "",
    unitId: b.unitId,
    unitCode: unit?.code ?? "",
    qty: b.currentQty,
    initialQty: b.initialQty,
    startDate: fmtDate(b.startDate) ?? "",
    endDate: fmtDate(b.endDate),
    harvestDate: fmtDate(b.harvestDate),
    status: b.status,
    stage: b.stage,
    costCents: b.acquisitionCostCents,
  };
}

/* ── Enterprise selector sheet ── */
function EnterpriseSelector({ onSelect, onClose }: { onSelect: (subtype: string) => void; onClose: () => void }) {
  const livestock = ENTERPRISE_REGISTRY.filter(e => e.type === "livestock");
  const crops = ENTERPRISE_REGISTRY.filter(e => e.type === "crop");
  return (
    <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.78)", display: "flex", alignItems: "flex-end", zIndex: 110 }} onClick={onClose}>
      <div style={{ background: "var(--surface)", borderRadius: "24px 24px 0 0", padding: 20, width: "100%", border: "1px solid var(--border-subtle)", maxHeight: "75%" }} onClick={e => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <div style={{ fontWeight: 700, fontSize: 16 }}>Enterprise Type</div>
          <button className="btn-icon" onClick={onClose}><X size={16} /></button>
        </div>
        <div style={{ overflowY: "auto", maxHeight: 380, scrollbarWidth: "none" }}>
          <div className="section-eyebrow" style={{ marginBottom: 8 }}>🐄 Livestock</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 14 }}>
            {livestock.map(e => (
              <button key={e.subtype} onClick={() => { onSelect(e.subtype); onClose(); }} style={{ padding: "10px 12px", borderRadius: 12, background: "var(--card)", border: "1px solid var(--border-subtle)", textAlign: "left", cursor: "pointer" }}>
                <div style={{ fontSize: 22, marginBottom: 4 }}>{e.emoji}</div>
                <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-primary)" }}>{e.label}</div>
                <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 1 }}>{e.unitName}-based</div>
              </button>
            ))}
          </div>
          <div className="section-eyebrow" style={{ marginBottom: 8 }}>🌱 Crops & Produce</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            {crops.map(e => (
              <button key={e.subtype} onClick={() => { onSelect(e.subtype); onClose(); }} style={{ padding: "10px 12px", borderRadius: 12, background: "var(--card)", border: "1px solid var(--border-subtle)", textAlign: "left", cursor: "pointer" }}>
                <div style={{ fontSize: 22, marginBottom: 4 }}>{e.emoji}</div>
                <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-primary)" }}>{e.label}</div>
                <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 1 }}>{e.unitName}-based</div>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Enterprise card (livestock) ── */
function LivestockBatchCard({ batch, navigate }: { batch: ViewBatch; navigate: (id: "batch-detail", p: Record<string,string>) => void }) {
  const cfg = ENTERPRISE_REGISTRY.find(e => e.subtype === batch.enterprise);
  const mort = batch.initialQty > 0 ? (((batch.initialQty - batch.qty) / batch.initialQty) * 100).toFixed(1) : "0.0";
  return (
    <button onClick={() => navigate("batch-detail", { id: batch.id, code: batch.code })} className="farm-card" style={{ padding: 14, textAlign: "left", width: "100%", cursor: "pointer", borderLeft: `3px solid ${cfg?.type === "crop" ? "rgba(251,191,36,0.6)" : "rgba(74,222,128,0.5)"}` }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span style={{ fontSize: 24 }}>{cfg?.emoji ?? "❓"}</span>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text-primary)" }}>{batch.label}</div>
            <div style={{ fontSize: 10, color: "var(--text-muted)", fontFamily: "monospace" }}>{batch.code} · {batch.unitCode || "no unit"}</div>
          </div>
        </div>
        <span className={`chip ${batch.status === "ACTIVE" ? "chip-ok" : batch.status === "QUARANTINE" ? "chip-critical" : "chip-info"}`} style={{ fontSize: 9 }}>{batch.status}</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6, marginTop: 6 }}>
        <div style={{ background: "var(--surface)", borderRadius: 8, padding: "6px 8px", textAlign: "center" }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text-primary)" }}>{batch.qty.toLocaleString()}</div>
          <div style={{ fontSize: 9, color: "var(--text-muted)", fontWeight: 600 }}>{cfg?.type === "crop" ? "Plots/Ha" : "Head"}</div>
        </div>
        <div style={{ background: "var(--surface)", borderRadius: 8, padding: "6px 8px", textAlign: "center" }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text-primary)" }}>{batch.stage || "—"}</div>
          <div style={{ fontSize: 9, color: "var(--text-muted)", fontWeight: 600 }}>Stage</div>
        </div>
        <div style={{ background: "var(--surface)", borderRadius: 8, padding: "6px 8px", textAlign: "center" }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: Number(mort) > 3 ? "var(--status-critical)" : "var(--status-ok)" }}>{cfg?.type === "crop" ? "—" : `${mort}%`}</div>
          <div style={{ fontSize: 9, color: "var(--text-muted)", fontWeight: 600 }}>{cfg?.type === "crop" ? "Growth" : "Mort."}</div>
        </div>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8, fontSize: 10, color: "var(--text-muted)" }}>
        <span>Start: <span style={{ color: "var(--text-secondary)", fontWeight: 600 }}>{batch.startDate || "—"}</span></span>
        {batch.harvestDate && <span>Harvest: <span style={{ color: "var(--accent-amber)", fontWeight: 600 }}>{batch.harvestDate}</span></span>}
        {batch.endDate && !batch.harvestDate && <span>End: <span style={{ color: "var(--accent-amber)", fontWeight: 600 }}>{batch.endDate}</span></span>}
      </div>
    </button>
  );
}

/* ── Add Unit sheet (issue #232) — the "Add Unit" button used to do nothing;
 * this is the real POST /api/units it now drives. Minimal fields: the table
 * only has farmId/type/name/code/status, no capacity/GPS/etc. */
function AddUnitSheet({ farms, tenantId, onCreated, onClose }: {
  farms: { id: string; code: string; name: string }[];
  tenantId: string;
  onCreated: () => void;
  onClose: () => void;
}) {
  const [farmId, setFarmId] = useState(farms[0]?.id ?? "");
  const [type, setType] = useState("");
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    if (!farmId || !type.trim() || !name.trim()) {
      setError("Farm, type, and name are required.");
      return;
    }
    setSaving(true);
    setError("");
    const res = await apiClient.post("/api/units", { tenantId, farmId, type: type.trim(), name: name.trim() });
    setSaving(false);
    if (res.success) {
      onCreated();
      onClose();
    } else {
      setError(res.error || "Failed to create unit.");
    }
  }

  return (
    <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.78)", display: "flex", alignItems: "flex-end", zIndex: 110 }} onClick={onClose}>
      <div style={{ background: "var(--surface)", borderRadius: "24px 24px 0 0", padding: 20, width: "100%", border: "1px solid var(--border-subtle)" }} onClick={e => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <div style={{ fontWeight: 700, fontSize: 16 }}>Add Production Unit</div>
          <button className="btn-icon" onClick={onClose}><X size={16} /></button>
        </div>
        <div style={{ marginBottom: 12 }}>
          <label style={{ fontSize: 11, fontWeight: 700, color: "var(--text-secondary)", display: "block", marginBottom: 5 }}>Farm</label>
          <select className="farm-input" value={farmId} onChange={e => setFarmId(e.target.value)}>
            {farms.map(f => <option key={f.id} value={f.id}>{f.name} ({f.code})</option>)}
          </select>
        </div>
        <div style={{ marginBottom: 12 }}>
          <label style={{ fontSize: 11, fontWeight: 700, color: "var(--text-secondary)", display: "block", marginBottom: 5 }}>Unit Type</label>
          <input className="farm-input" placeholder="e.g. House, Pen, Field" value={type} onChange={e => setType(e.target.value)} />
        </div>
        <div style={{ marginBottom: 12 }}>
          <label style={{ fontSize: 11, fontWeight: 700, color: "var(--text-secondary)", display: "block", marginBottom: 5 }}>Unit Name</label>
          <input className="farm-input" placeholder="e.g. House A02" value={name} onChange={e => setName(e.target.value)} />
        </div>
        {error && <div style={{ fontSize: 11, color: "var(--status-critical)", marginBottom: 10 }}>{error}</div>}
        <button className="btn-primary" style={{ width: "100%", justifyContent: "center" }} disabled={saving} onClick={save}>
          {saving ? "Saving…" : "Create Unit"}
        </button>
      </div>
    </div>
  );
}

export function CropsScreen() {
  const { navigate, activeFarm, farms, tenantId, currencySymbol } = useNav();
  const cur = currencySymbol || "KSh";
  const [tab, setTab] = useState<"livestock" | "crops" | "units">("livestock");
  const [filter, setFilter] = useState("All");
  const [farmFilter, setFarmFilter] = useState(activeFarm === "ALL" ? "All" : activeFarm);
  const [showEnterpriseSelector, setShowEnterpriseSelector] = useState(false);
  const [showAddUnit, setShowAddUnit] = useState(false);

  const [apiBatches, setApiBatches] = useState<ApiBatch[] | null>(null);
  const [apiUnits, setApiUnits] = useState<ApiUnit[] | null>(null);

  const loadUnits = useCallback(() => {
    apiClient.get<ApiUnit[]>(`/api/units?tenantId=${tenantId}`).then(res => {
      if (res.success) setApiUnits(res.data);
    });
  }, [tenantId]);

  useEffect(() => {
    let cancelled = false;
    apiClient.get<ApiBatch[]>(`/api/batches?tenantId=${tenantId}`).then(res => {
      if (!cancelled && res.success) setApiBatches(res.data);
    });
    apiClient.get<ApiUnit[]>(`/api/units?tenantId=${tenantId}`).then(res => {
      if (!cancelled && res.success) setApiUnits(res.data);
    });
    return () => { cancelled = true; };
  }, [tenantId]);

  // Keep the in-screen farm filter in sync with the shell's active farm so that
  // switching farms re-scopes this screen too (issue #219). In the "All Farms"
  // aggregate view the chips below take over instead.
  useEffect(() => {
    if (activeFarm !== "ALL") setFarmFilter(activeFarm)
  }, [activeFarm])

  const loading = apiBatches === null || apiUnits === null;
  const units = apiUnits ?? [];
  const allViewBatches = (apiBatches ?? []).map(b => toViewBatch(b, units, farms));

  const farmBatches = farmFilter === "All" ? allViewBatches : allViewBatches.filter(b => b.farmCode === farmFilter);
  const livestockBatches = farmBatches.filter(b => ENTERPRISE_REGISTRY.find(e => e.subtype === b.enterprise)?.type === "livestock");
  const cropBatches = farmBatches.filter(b => ENTERPRISE_REGISTRY.find(e => e.subtype === b.enterprise)?.type === "crop");
  const displayed = (tab === "livestock" ? livestockBatches : cropBatches).filter(b => filter === "All" || b.status === filter);

  const filters = ["All", "ACTIVE", "QUARANTINE", "CLOSED", "HARVESTED"];

  const farmUnits = units.filter(u => farmFilter === "All" || farms.find(f => f.id === u.farmId)?.code === farmFilter);

  return (
    <div className="screen-content">
      <TopNav title="Farm" subtitle="Enterprises & batches"
        rightEl={
          <div style={{ display: "flex", gap: 6 }}>
            <button className="btn-icon" style={{ width: 34, height: 34 }} title="Import CSV"><Upload size={14} /></button>
            <button className="btn-fab" style={{ width: 34, height: 34, borderRadius: 9 }} onClick={() => setShowEnterpriseSelector(true)}><Plus size={15} /></button>
          </div>
        }
      />

      {/* Farm filter — shown in the "All Farms" aggregate view (multi-farm owners, issue #219) */}
      {activeFarm === "ALL" && (
        <div className="px-screen" style={{ paddingTop: 8 }}>
          <div className="chip-row" style={{ marginBottom: 6 }}>
            <button onClick={() => setFarmFilter("All")} className={`filter-chip ${farmFilter === "All" ? "active" : ""}`}>All Farms</button>
            {farms.map(f => (
              <button key={f.code} onClick={() => setFarmFilter(f.code)} className={`filter-chip ${farmFilter === f.code ? "active" : ""}`}>{f.name}</button>
            ))}
          </div>
        </div>
      )}

      {/* Summary strip */}
      <div className="px-screen" style={{ paddingTop: 8 }}>
        <div style={{ display: "flex", gap: 6, overflowX: "auto", scrollbarWidth: "none", paddingBottom: 4, marginBottom: 10 }}>
          {[
            { label: "Livestock Batches", value: livestockBatches.filter(b=>b.status==="ACTIVE").length, color: "var(--primary-green)" },
            { label: "Crop Batches", value: cropBatches.filter(b=>b.status==="ACTIVE").length, color: "var(--accent-amber)" },
            { label: "Animals", value: livestockBatches.reduce((s,b)=>s+b.qty,0).toLocaleString(), color: "var(--accent-blue)" },
            { label: "Total Cost", value: `${cur} ${(farmBatches.reduce((s,b)=>s+b.costCents,0)/100000).toFixed(0)}K`, color: "var(--text-secondary)" },
          ].map(s => (
            <div key={s.label} style={{ flexShrink: 0, background: "var(--card)", border: "1px solid var(--border-subtle)", borderRadius: 10, padding: "8px 12px", textAlign: "center", minWidth: 80 }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: s.color }}>{s.value}</div>
              <div style={{ fontSize: 9, color: "var(--text-muted)", fontWeight: 600, marginTop: 1 }}>{s.label}</div>
            </div>
          ))}
        </div>

        {/* Type tabs */}
        <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
          {[["livestock","🐄 Livestock"],["crops","🌱 Crops"],["units","📍 Units"]].map(([id, label]) => (
            <button key={id} onClick={() => setTab(id as typeof tab)} style={{ flex: 1, padding: "8px 4px", borderRadius: 10, fontSize: 11, fontWeight: 700, cursor: "pointer", background: tab === id ? "rgba(74,222,128,0.15)" : "var(--card)", border: tab === id ? "1px solid rgba(74,222,128,0.4)" : "1px solid var(--border-subtle)", color: tab === id ? "var(--primary-green)" : "var(--text-muted)" }}>{label}</button>
          ))}
        </div>

        {/* Status filter */}
        {tab !== "units" && (
          <div className="chip-row" style={{ marginBottom: 10 }}>
            {filters.map(f => (
              <button key={f} onClick={() => setFilter(f)} className={`filter-chip ${filter === f ? "active" : ""}`}>{f}</button>
            ))}
          </div>
        )}
      </div>

      {loading && (
        <div className="px-screen"><div style={{ fontSize: 12, color: "var(--text-dim)", padding: "12px 0" }}>Loading batches…</div></div>
      )}

      {/* LIVESTOCK / CROPS batch cards */}
      {!loading && (tab === "livestock" || tab === "crops") && (
        <div className="px-screen">
          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 16 }}>
            {displayed.length === 0 ? (
              <div style={{ padding: 24, textAlign: "center" }}>
                <div style={{ fontSize: 36, marginBottom: 8 }}>{tab === "livestock" ? "🐄" : "🌱"}</div>
                <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text-primary)", marginBottom: 4 }}>No {tab} batches</div>
                <div style={{ fontSize: 12, color: "var(--text-muted)" }}>Tap + to add your first enterprise</div>
              </div>
            ) : displayed.map(b => (
              <LivestockBatchCard key={b.id} batch={b} navigate={navigate} />
            ))}
          </div>
        </div>
      )}

      {/* UNITS — real GET /api/units rows, no hardcoded heatmap array. There is
          no capacity/population column on production_units, so occupancy below
          is the honest thing we can compute: the sum of currentQty across this
          unit's non-closed batches, not a fabricated capacity percentage. */}
      {!loading && tab === "units" && (
        <div className="px-screen">
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 16 }}>
            {farmUnits.length === 0 ? (
              <div style={{ gridColumn: "1 / -1", padding: 24, textAlign: "center" }}>
                <div style={{ fontSize: 36, marginBottom: 8 }}>📍</div>
                <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text-primary)", marginBottom: 4 }}>No production units yet</div>
                <div style={{ fontSize: 12, color: "var(--text-muted)" }}>Tap Add Unit below to create one</div>
              </div>
            ) : farmUnits.map(u => {
              const unitBatches = allViewBatches.filter(b => b.unitId === u.id && b.status !== "CLOSED");
              const occupancy = unitBatches.reduce((s, b) => s + b.qty, 0);
              return (
                <div key={u.id} className="farm-card" style={{ padding: 12 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-primary)" }}>{u.name}</div>
                    <span className={`chip ${u.status === "ACTIVE" ? "chip-ok" : "chip-warning"}`} style={{ fontSize: 8 }}>{u.status}</span>
                  </div>
                  <div style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 6, textTransform: "capitalize" }}>{u.type}</div>
                  <div style={{ fontSize: 9, color: "var(--text-dim)", fontFamily: "monospace", marginBottom: 8 }}>{u.code}</div>
                  <div style={{ fontSize: 11 }}>
                    {unitBatches.length > 0
                      ? <span><strong style={{ color: "var(--text-primary)" }}>{occupancy.toLocaleString()}</strong> across {unitBatches.length} batch{unitBatches.length === 1 ? "" : "es"}</span>
                      : <span style={{ color: "var(--text-dim)" }}>No active batch assigned</span>}
                  </div>
                </div>
              );
            })}
          </div>
          <button className="btn-primary" style={{ width: "100%", justifyContent: "center", marginBottom: 16 }} onClick={() => setShowAddUnit(true)}>
            <Plus size={14} /> Add Unit
          </button>
        </div>
      )}

      {showEnterpriseSelector && <EnterpriseSelector onSelect={(s) => navigate("crop-schedule", { subtype: s })} onClose={() => setShowEnterpriseSelector(false)} />}
      {showAddUnit && <AddUnitSheet farms={farms} tenantId={tenantId} onCreated={loadUnits} onClose={() => setShowAddUnit(false)} />}
    </div>
  );
}

/* ── Batch Detail ── */
export function BatchDetailScreen() {
  const { goBack, params, navigate, farms, tenantId, currencySymbol } = useNav();
  const cur = currencySymbol || "KSh";
  const batchId = params.id;
  const batchCode = params.code;

  const [batch, setBatch] = useState<ApiBatch | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [units, setUnits] = useState<ApiUnit[]>([]);
  const [costBreakdown, setCostBreakdown] = useState<{
    categories: { key: string; label: string; amountCents: number; tracked: boolean; reason?: string }[];
    totalTrackedCents: number;
    // Revenue/Gross Margin (issue #300) — real sales.batchId-scoped revenue,
    // added back now that a real `sales` table exists (issue #239).
    revenue: { amountCents: number; tracked: boolean; reason?: string };
    grossMarginPct: number | null;
  } | null>(null);

  const [costTab, setCostTab] = useState<"breakdown" | "processes">("breakdown");
  const [showTransferForm, setShowTransferForm] = useState(false);
  const [transferUnitId, setTransferUnitId] = useState("");
  const [transferSaving, setTransferSaving] = useState(false);
  const [transferError, setTransferError] = useState("");

  const [showAdvanceForm, setShowAdvanceForm] = useState(false);
  const [nextStage, setNextStage] = useState("");
  const [advanceSaving, setAdvanceSaving] = useState(false);

  const loadBatch = useCallback(async () => {
    // Deep links only carry a `code` (e.g. a bookmark) — resolve it to an id
    // via the list endpoint since GET /api/batches/[id] takes an id, not a
    // code. The normal in-app path (CropsScreen -> batch-detail) already
    // passes `id`, so this list fetch is skipped there.
    let id: string | undefined = batchId;
    if (!id && batchCode) {
      const listRes = await apiClient.get<ApiBatch[]>(`/api/batches?tenantId=${tenantId}`);
      if (listRes.success) {
        const match = listRes.data.find(b => b.code === batchCode);
        id = match?.id;
      }
    }
    if (!id) { setNotFound(true); return; }
    const res = await apiClient.get<ApiBatch>(`/api/batches/${id}?tenantId=${tenantId}`);
    if (res.success) setBatch(res.data);
    else setNotFound(true);
  }, [batchId, batchCode, tenantId]);

  useEffect(() => { loadBatch(); }, [loadBatch]);

  useEffect(() => {
    apiClient.get<ApiUnit[]>(`/api/units?tenantId=${tenantId}`).then(res => {
      if (res.success) setUnits(res.data);
    });
  }, [tenantId]);

  useEffect(() => {
    if (!batch) return;
    apiClient.get<typeof costBreakdown>(`/api/batches/${batch.id}/cost-breakdown?tenantId=${tenantId}`).then(res => {
      if (res.success) setCostBreakdown(res.data);
    });
  }, [batch?.id, tenantId]);

  if (notFound) {
    return (
      <div className="screen-content">
        <TopNav title="Batch" showBack />
        <div className="px-screen" style={{ paddingTop: 40, textAlign: "center" }}>
          <div style={{ fontSize: 13, color: "var(--text-muted)" }}>Batch not found.</div>
        </div>
      </div>
    );
  }

  if (!batch) {
    return (
      <div className="screen-content">
        <TopNav title="Batch" showBack />
        <div className="px-screen" style={{ paddingTop: 40, textAlign: "center" }}>
          <div style={{ fontSize: 12, color: "var(--text-dim)" }}>Loading batch…</div>
        </div>
      </div>
    );
  }

  const cfg = ENTERPRISE_REGISTRY.find(e => e.subtype === batch.enterprise);
  const unit = units.find(u => u.id === batch.unitId);
  const farm = unit ? farms.find(f => f.id === unit.farmId) : undefined;
  const mort = batch.initialQty > 0 ? (((batch.initialQty - batch.currentQty) / batch.initialQty) * 100).toFixed(1) : "0.0";
  const costKsh = batch.acquisitionCostCents / 100;

  const transferCandidates = units.filter(u => u.id !== batch.unitId && (!unit || u.farmId === unit.farmId));

  async function saveTransfer() {
    if (!transferUnitId) return;
    setTransferSaving(true);
    setTransferError("");
    const res = await apiClient.patch(`/api/batches/${batch!.id}?tenantId=${tenantId}`, { unitId: transferUnitId });
    setTransferSaving(false);
    if (res.success) {
      setShowTransferForm(false);
      setTransferUnitId("");
      loadBatch();
    } else {
      setTransferError(res.error || "Failed to move batch.");
    }
  }

  async function saveAdvance() {
    if (!nextStage.trim()) return;
    setAdvanceSaving(true);
    const res = await apiClient.patch(`/api/batches/${batch!.id}?tenantId=${tenantId}`, { stage: nextStage.trim() });
    setAdvanceSaving(false);
    if (res.success) {
      setShowAdvanceForm(false);
      setNextStage("");
      loadBatch();
    }
  }

  return (
    <div className="screen-content">
      <TopNav title={batch.name} subtitle={`${batch.code} · ${unit?.code ?? "no unit"}`} showBack />
      <div className="px-screen" style={{ paddingTop: 14 }}>

        {/* Hero */}
        <div className="farm-card farm-card-active" style={{ padding: 16, marginBottom: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <span style={{ fontSize: 32 }}>{cfg?.emoji}</span>
              <div>
                <span className={`chip ${batch.status === "ACTIVE" ? "chip-ok" : batch.status === "QUARANTINE" ? "chip-critical" : "chip-info"}`}>{batch.status}</span>
                <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>
                  Stage: <span style={{ color: "var(--primary-green)", fontWeight: 700 }}>{batch.stage || "—"}</span>
                  {/* Species (issue #301): moved out of the 3rd stat tile (which
                      now correctly shows the type-specific Area/FCR tile below)
                      rather than dropped — still useful context, just not in
                      that tile's position. */}
                  {batch.species && <span style={{ marginLeft: 8 }}>· Species: <span style={{ color: "var(--text-secondary)", fontWeight: 700 }}>{batch.species}</span></span>}
                </div>
              </div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 10, color: "var(--text-muted)" }}>Farm</div>
              <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-secondary)" }}>{farm?.name ?? "—"}</div>
            </div>
          </div>

          {/* KPIs */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 8 }}>
            {[
              { label: cfg?.type === "crop" ? "Plots" : "Head", value: batch.currentQty.toLocaleString() },
              { label: cfg?.type === "crop" ? "Growth" : "Mort. %", value: cfg?.type === "crop" ? "—" : `${mort}%` },
              // Type-specific 3rd tile (issue #301): the mock shows Area for
              // crop batches and FCR (feed conversion ratio) for livestock —
              // the wired version had silently replaced BOTH with a generic
              // "Species" field, losing FCR entirely with no acknowledgment.
              // Neither is trackable yet (no area column on `batches`, no
              // feed/weight data source for FCR) — same honest "—" placeholder
              // pattern already used for "Growth" above, not a silent drop.
              { label: cfg?.type === "crop" ? "Area" : "FCR", value: "—" },
              { label: `Cost ${cur}`, value: `${(costKsh/1000).toFixed(0)}K` },
            ].map(s => (
              <div key={s.label} style={{ background: "var(--surface)", borderRadius: 8, padding: "8px", textAlign: "center" }}>
                <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text-primary)" }}>{s.value}</div>
                <div style={{ fontSize: 9, color: "var(--text-muted)", fontWeight: 600, marginTop: 1 }}>{s.label}</div>
              </div>
            ))}
          </div>

          {/* Dates */}
          <div style={{ display: "flex", gap: 12, marginTop: 10, fontSize: 11, flexWrap: "wrap" }}>
            <span style={{ color: "var(--text-muted)" }}>Start: <span style={{ color: "var(--text-secondary)", fontWeight: 600 }}>{fmtDate(batch.startDate) ?? "—"}</span></span>
            {batch.harvestDate && <span style={{ color: "var(--text-muted)" }}>Harvest: <span style={{ color: "var(--accent-amber)", fontWeight: 600 }}>{fmtDate(batch.harvestDate)}</span></span>}
            {batch.endDate && <span style={{ color: "var(--text-muted)" }}>End: <span style={{ color: "var(--accent-amber)", fontWeight: 600 }}>{fmtDate(batch.endDate)}</span></span>}
          </div>
        </div>

        {/* Unit Transfer Section — real PATCH /api/batches/[id] { unitId }.
            There is no transfers/history table, so this moves the batch's
            current unit assignment immediately; it isn't a scheduled
            future-dated move with notes (the mock's date/notes fields had no
            backing table, so they aren't reproduced here). */}
        <div className="farm-card" style={{ padding: 14, marginBottom: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: showTransferForm ? 12 : 0 }}>
            <div>
              <div className="section-eyebrow" style={{ marginBottom: 2 }}>Unit Transfer</div>
              <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 4 }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: "var(--primary-green)" }}>{unit?.code ?? "no unit assigned"}</span>
              </div>
            </div>
            <button onClick={() => setShowTransferForm(f => !f)} style={{ fontSize: 11, fontWeight: 700, padding: "4px 12px", borderRadius: 8, background: "var(--surface)", border: "1px solid var(--border-subtle)", color: "var(--text-muted)", cursor: "pointer" }}>
              {showTransferForm ? "Cancel" : "Move Unit"}
            </button>
          </div>
          {showTransferForm && (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div>
                <label style={{ fontSize: 10, fontWeight: 700, color: "var(--text-muted)", display: "block", marginBottom: 4 }}>Destination Unit *</label>
                <select className="farm-input" style={{ fontSize: 12 }} value={transferUnitId} onChange={e => setTransferUnitId(e.target.value)}>
                  <option value="">Select a unit…</option>
                  {transferCandidates.map(u => <option key={u.id} value={u.id}>{u.name} ({u.code})</option>)}
                </select>
              </div>
              {transferError && <div style={{ fontSize: 11, color: "var(--status-critical)" }}>{transferError}</div>}
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => setShowTransferForm(false)} className="btn-secondary" style={{ flex: 1, justifyContent: "center", fontSize: 12, padding: 10 }}>Cancel</button>
                <button onClick={saveTransfer}
                  className="btn-primary" style={{ flex: 1, justifyContent: "center", fontSize: 12, padding: 10 }}
                  disabled={!transferUnitId || transferSaving}>
                  <Check size={13} /> {transferSaving ? "Moving…" : "Save Transfer"}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Processes tab */}
        <div className="farm-card" style={{ padding: 14, marginBottom: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <div className="section-eyebrow">Economics & Processes</div>
            <div style={{ display: "flex", gap: 4 }}>
              {(["breakdown","processes"] as const).map(t => (
                <button key={t} onClick={() => setCostTab(t)} style={{ padding: "2px 8px", borderRadius: 100, fontSize: 9, fontWeight: 700, cursor: "pointer", background: costTab === t ? "rgba(74,222,128,0.2)" : "transparent", border: costTab === t ? "1px solid rgba(74,222,128,0.4)" : "1px solid transparent", color: costTab === t ? "var(--primary-green)" : "var(--text-muted)", textTransform: "capitalize" }}>{t}</button>
              ))}
            </div>
          </div>

          {costTab === "breakdown" && (
            !costBreakdown ? (
              <div style={{ fontSize: 12, color: "var(--text-dim)" }}>Loading cost breakdown…</div>
            ) : (
              <>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 12 }}>
                  <div style={{ background: "var(--surface)", borderRadius: 8, padding: "8px 10px" }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: "var(--status-critical)" }}>{cur} {(costBreakdown.totalTrackedCents/100).toLocaleString()}</div>
                    <div style={{ fontSize: 9, color: "var(--text-muted)", fontWeight: 600, marginTop: 1 }}>Total Tracked Cost</div>
                  </div>
                  {/* Revenue (issue #300): real sales.batchId-scoped revenue,
                      converted from `sales.amount` (whole KSh) to cents server-
                      side so it's directly comparable to the cost figures here
                      (see app/api/batches/[id]/cost-breakdown/route.ts — issue
                      #290 fixed this exact unit mismatch elsewhere (the GL
                      posting layer); this endpoint converts explicitly
                      instead of relying on that). An honest "0" (not a fabricated
                      number) when the batch has no recorded sales yet. */}
                  <div style={{ background: "var(--surface)", borderRadius: 8, padding: "8px 10px" }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: costBreakdown.revenue.tracked ? "var(--status-ok)" : "var(--text-dim)" }}>{cur} {(costBreakdown.revenue.amountCents/100).toLocaleString()}</div>
                    <div style={{ fontSize: 9, color: "var(--text-muted)", fontWeight: 600, marginTop: 1 }}>Revenue</div>
                  </div>
                  <div style={{ background: "var(--surface)", borderRadius: 8, padding: "8px 10px" }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: "var(--accent-amber)" }}>{batch.currentQty > 0 ? `${cur} ${Math.round(costBreakdown.totalTrackedCents/100/batch.currentQty)}/unit` : "—"}</div>
                    <div style={{ fontSize: 9, color: "var(--text-muted)", fontWeight: 600, marginTop: 1 }}>Break-even (tracked cost only)</div>
                  </div>
                  {/* Gross Margin (issue #300): tracked-cost-only margin (same
                      caveat as Break-even above — feed/health/labour/overhead
                      aren't tracked yet). Honest "—" (not a fabricated "0%")
                      when there's no revenue to compute a margin against. */}
                  <div style={{ background: "var(--surface)", borderRadius: 8, padding: "8px 10px" }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: costBreakdown.grossMarginPct !== null ? "var(--primary-green)" : "var(--text-dim)" }}>{costBreakdown.grossMarginPct !== null ? `${costBreakdown.grossMarginPct}%` : "—"}</div>
                    <div style={{ fontSize: 9, color: "var(--text-muted)", fontWeight: 600, marginTop: 1 }}>Gross Margin</div>
                  </div>
                </div>
                {costBreakdown.categories.map(c => (
                  <div key={c.key} style={{ marginBottom: 8 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3, fontSize: 11 }}>
                      <span style={{ color: "var(--text-secondary)", fontWeight: 600 }}>{c.label}</span>
                      {c.tracked ? (
                        <span style={{ color: "var(--text-primary)", fontWeight: 700 }}>{cur} {(c.amountCents/100).toLocaleString()}</span>
                      ) : (
                        <span style={{ color: "var(--text-dim)", fontStyle: "italic" }} title={c.reason}>not tracked</span>
                      )}
                    </div>
                    <div className="progress-track"><div className="progress-fill" style={{ width: c.tracked && costBreakdown.totalTrackedCents > 0 ? `${(c.amountCents/costBreakdown.totalTrackedCents)*100}%` : "0%", background: c.tracked ? "var(--primary-green)" : "var(--border-subtle)" }} /></div>
                  </div>
                ))}
                {!costBreakdown.revenue.tracked && (
                  <div style={{ fontSize: 10, color: "var(--text-dim)", marginTop: 4 }}>No sales recorded yet for this batch — Revenue/Gross Margin above are showing an honest zero, not a fabricated estimate.</div>
                )}
              </>
            )
          )}

          {costTab === "processes" && (
            <div>
              {cfg?.processes.map((p, i, arr) => (
                <div key={p.code} style={{ padding: "10px 0", borderBottom: i < arr.length - 1 ? "1px solid var(--border-subtle)" : "none", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-primary)" }}>{p.name}</div>
                    <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 1 }}>{p.code} · {p.frequency}</div>
                  </div>
                  <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                    {p.requiresApproval && <span className="chip chip-warning" style={{ fontSize: 8 }}>Approval</span>}
                    <button onClick={() => navigate("process-config", {
                      batchCode: batch.code, processCode: p.code, enterprise: batch.enterprise,
                      startDate: fmtDate(batch.startDate) ?? "", endDate: fmtDate(batch.endDate) ?? "", harvestDate: fmtDate(batch.harvestDate) ?? "",
                    })} style={{ fontSize: 10, fontWeight: 700, padding: "4px 10px", borderRadius: 8, background: "rgba(74,222,128,0.1)", border: "1px solid rgba(74,222,128,0.3)", color: "var(--primary-green)", cursor: "pointer" }}>Configure</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Advance Stage inline form — real PATCH /api/batches/[id] { stage } */}
        {showAdvanceForm && (
          <div className="farm-card" style={{ padding: 14, marginBottom: 14 }}>
            <div className="section-eyebrow" style={{ marginBottom: 8 }}>Advance Stage</div>
            <input className="farm-input" style={{ fontSize: 12, marginBottom: 10 }} placeholder="e.g. Grower, Finisher, Peak Lay…" value={nextStage} onChange={e => setNextStage(e.target.value)} />
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => setShowAdvanceForm(false)} className="btn-secondary" style={{ flex: 1, justifyContent: "center", fontSize: 12, padding: 10 }}>Cancel</button>
              <button onClick={saveAdvance} className="btn-primary" style={{ flex: 1, justifyContent: "center", fontSize: 12, padding: 10 }} disabled={!nextStage.trim() || advanceSaving}>
                {advanceSaving ? "Saving…" : "Save Stage"}
              </button>
            </div>
          </div>
        )}

        {/* Actions */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 14 }}>
          {/* "Record Sale"/"Record Harvest" (issue #232 task 6): no sales or
              production/harvest-log table exists yet (Epic: Finance hasn't
              landed) — disabled with a clear reason rather than a silent
              no-op button. */}
          <button className="btn-primary" style={{ justifyContent: "center", borderRadius: 12, padding: 12, fontSize: 12, opacity: 0.5, cursor: "not-allowed" }} disabled title="Not available yet — sales/harvest tracking isn't built">
            <Lock size={12} /> Record {cfg?.harvestUnit ? "Sale" : "Harvest"}
          </button>
          <button className="btn-secondary" style={{ justifyContent: "center", borderRadius: 12, padding: 12, fontSize: 12 }} onClick={() => setShowAdvanceForm(f => !f)}>
            Advance Stage
          </button>
          <button className="btn-secondary" style={{ justifyContent: "center", borderRadius: 12, padding: 12, fontSize: 12 }} onClick={() => navigate("tasks", { batch: batch.code })}>
            📋 All Batch Tasks
          </button>
          <button className="btn-secondary" style={{ justifyContent: "center", borderRadius: 12, padding: 12, fontSize: 12, opacity: 0.5, cursor: "not-allowed" }} disabled title="Not available yet">
            Edit Batch
          </button>
        </div>

        {/* Per-unit task shortcuts */}
        {unit?.code && (
          <div style={{ marginBottom: 14 }}>
            <div className="section-eyebrow" style={{ marginBottom: 8 }}>Tasks by Unit</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              <button
                onClick={() => navigate("tasks", { batch: batch.code, unit: unit.code })}
                style={{ flex: 1, padding: "10px 12px", borderRadius: 12, fontSize: 12, fontWeight: 700, cursor: "pointer", background: "rgba(96,165,250,0.08)", border: "1px solid rgba(96,165,250,0.3)", color: "var(--accent-cyan)", display: "flex", alignItems: "center", justifyContent: "center", gap: 5 }}>
                🏠 {unit.code}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Batch / Enterprise Creation Wizard ── */
export function CropScheduleScreen() {
  const { goBack, navigate, params, farms, tenantId, currencySymbol } = useNav();
  const cur = currencySymbol || "KSh";
  const subtype = params.subtype ?? "broiler";
  const cfg = ENTERPRISE_REGISTRY.find(e => e.subtype === subtype) ?? ENTERPRISE_REGISTRY[0];
  const isCrop = cfg.type === "crop";
  const [step, setStep] = useState(1);
  const totalSteps = 4;
  const steps = ["Basic Info", cfg.unitName, "Schedule", "Processes"];

  // Step 1 — batch basics
  const [batchName, setBatchName] = useState(`${cfg.label} Batch – ${new Date().toLocaleString("en-GB", { month: "short", year: "numeric" })}`);
  const [farmId, setFarmId] = useState(farms[0]?.id ?? "");
  const [initialQty, setInitialQty] = useState("");
  const [species, setSpecies] = useState("");

  // Step 2 — the production unit this batch lives in (single-unit only, see
  // note on `createBatch` below re: split-delivery/multi-unit).
  const [unitName, setUnitName] = useState("");

  // Step 3 — schedule + real acquisition cost
  const [startDate, setStartDate] = useState("");
  const [endOrHarvestDate, setEndOrHarvestDate] = useState("");
  const [initialCost, setInitialCost] = useState("");

  // ── Real code previews (not hardcoded): the server generates codes as
  // `<prefix>-<farm-segment>-<seq>` where seq = count of existing codes with
  // that prefix+segment plus one (see lib/codes.ts / POST /api/units and
  // /api/batches). Mirror that here against the real farm code and the real
  // existing rows, so the preview matches what will actually be created —
  // previously this was a hardcoded `genCode(prefix, "KMU", 24/7)` that
  // showed a code (e.g. BRO-XXX-024) that never matched the saved one
  // (e.g. BRO-NAKURU-002).
  const [existingBatches, setExistingBatches] = useState<ApiBatch[]>([]);
  const [existingUnits, setExistingUnits] = useState<ApiUnit[]>([]);
  useEffect(() => {
    apiClient.get<ApiBatch[]>(`/api/batches?tenantId=${tenantId}`).then(res => {
      if (res.success) setExistingBatches(res.data);
    });
    apiClient.get<ApiUnit[]>(`/api/units?tenantId=${tenantId}`).then(res => {
      if (res.success) setExistingUnits(res.data);
    });
  }, [tenantId]);

  const selectedFarm = farms.find(f => f.id === farmId) ?? farms[0];
  const farmCode = selectedFarm?.code ?? "FRM-XXX-000";
  const segment = farmCode.split("-")[1] ?? "XXX";
  const batchSeq = existingBatches.filter(b => b.code.startsWith(`${cfg.batchPrefix}-${segment}-`)).length + 1;
  const unitSeq = existingUnits.filter(u => u.code.startsWith(`${cfg.unitPrefix}-${segment}-`)).length + 1;
  const autoCode = genCode(cfg.batchPrefix, farmCode, batchSeq);
  const unitCodePreview = genCode(cfg.unitPrefix, farmCode, unitSeq);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // ── Create flow (issue #232 task 7) ────────────────────────────────────
  // "Crop schedule create (single unit) → POST /api/units then POST
  // /api/batches." This UI only ever creates one unit + one batch per
  // wizard run — there is no multi-unit "split delivery" step here to begin
  // with, so that part of the task is a non-issue rather than something
  // explicitly descoped: nothing needed removing.
  async function createBatch() {
    if (!farmId) { setError("Select a farm first."); return; }
    if (!unitName.trim()) { setError(`${cfg.unitName} name is required.`); return; }
    if (!batchName.trim()) { setError("Batch name is required."); return; }

    setSaving(true);
    setError("");

    const unitRes = await apiClient.post<{ id: string; code: string }>("/api/units", {
      tenantId, farmId, type: cfg.unitName.toLowerCase(), name: unitName.trim(), enterprise: subtype,
    });
    if (!unitRes.success) {
      setSaving(false);
      setError(unitRes.error || "Failed to create the production unit.");
      return;
    }

    const costCents = initialCost ? Math.round(Number(initialCost) * 100) : 0;
    const batchRes = await apiClient.post<{ id: string; code: string }>("/api/batches", {
      tenantId,
      unitId: unitRes.data.id,
      name: batchName.trim(),
      enterprise: subtype,
      species: species.trim(),
      initialQty: initialQty ? Math.trunc(Number(initialQty)) : 0,
      acquisitionCostCents: Number.isFinite(costCents) ? costCents : 0,
      startDate: startDate || undefined,
      ...(isCrop ? { harvestDate: endOrHarvestDate || undefined } : { endDate: endOrHarvestDate || undefined }),
    });
    setSaving(false);
    if (!batchRes.success) {
      setError(batchRes.error || "Failed to create the batch.");
      return;
    }
    navigate("batch-detail", { id: batchRes.data.id, code: batchRes.data.code });
  }

  return (
    <div className="screen-content">
      <TopNav title={`New ${cfg.label} Batch`} subtitle={`Auto-code: ${autoCode}`} showBack />
      <div className="px-screen" style={{ paddingTop: 14 }}>

        {/* Step indicator */}
        <div className="step-track" style={{ marginBottom: 20 }}>
          {steps.map((s, i) => (
            <React.Fragment key={s}>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
                <div className={`step-node ${i + 1 < step ? "done" : i + 1 === step ? "active" : "pending"}`}>{i + 1 < step ? "✓" : i + 1}</div>
                <div style={{ fontSize: 9, fontWeight: 700, color: i + 1 === step ? "var(--primary-green)" : "var(--text-dim)", whiteSpace: "nowrap" }}>{s}</div>
              </div>
              {i < steps.length - 1 && <div className={`step-line ${i + 1 < step ? "done" : ""}`} />}
            </React.Fragment>
          ))}
        </div>

        {/* Enterprise header */}
        <div style={{ padding: "10px 14px", background: "rgba(74,222,128,0.06)", borderRadius: 12, marginBottom: 14, display: "flex", gap: 10, alignItems: "center", border: "1px solid rgba(74,222,128,0.2)" }}>
          <span style={{ fontSize: 28 }}>{cfg.emoji}</span>
          <div>
            <div style={{ fontWeight: 700, fontSize: 14, color: "var(--text-primary)" }}>{cfg.label}</div>
            <div style={{ fontSize: 11, color: "var(--text-muted)" }}>Unit: {cfg.unitName} · Batch code preview: <span style={{ fontFamily: "monospace", color: "var(--primary-green)", fontWeight: 700 }}>{autoCode}</span></div>
          </div>
        </div>

        {step === 1 && (
          <div>
            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 11, fontWeight: 700, color: "var(--text-secondary)", display: "block", marginBottom: 5 }}>Batch Name</label>
              <input className="farm-input" value={batchName} onChange={e => setBatchName(e.target.value)} />
            </div>
            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 11, fontWeight: 700, color: "var(--text-secondary)", display: "block", marginBottom: 5 }}>Farm</label>
              <select className="farm-input" value={farmId} onChange={e => setFarmId(e.target.value)}>
                {farms.map(f => <option key={f.id} value={f.id}>{f.name} ({f.code})</option>)}
              </select>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
              <div>
                <label style={{ fontSize: 11, fontWeight: 700, color: "var(--text-secondary)", display: "block", marginBottom: 5 }}>{isCrop ? "Area (acres)" : "Initial Count"}</label>
                <input className="farm-input" type="number" placeholder={isCrop ? "0.00" : "0"} value={initialQty} onChange={e => setInitialQty(e.target.value)} />
              </div>
              <div>
                <label style={{ fontSize: 11, fontWeight: 700, color: "var(--text-secondary)", display: "block", marginBottom: 5 }}>{isCrop ? "Crop Variety" : "Species / Breed"}</label>
                <input className="farm-input" placeholder={isCrop ? "e.g. H614D" : "e.g. Cobb 500"} value={species} onChange={e => setSpecies(e.target.value)} />
              </div>
            </div>
          </div>
        )}

        {step === 2 && (
          <div>
            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 11, fontWeight: 700, color: "var(--text-secondary)", display: "block", marginBottom: 5 }}>{cfg.unitName} Code (auto-generated on save)</label>
              <input className="farm-input" value={unitCodePreview} disabled style={{ fontFamily: "monospace", color: "var(--primary-green)", fontWeight: 700, opacity: 0.7 }} />
            </div>
            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 11, fontWeight: 700, color: "var(--text-secondary)", display: "block", marginBottom: 5 }}>{cfg.unitName} Name</label>
              <input className="farm-input" placeholder={`e.g. ${cfg.unitName} A01`} value={unitName} onChange={e => setUnitName(e.target.value)} />
            </div>
            <div style={{ fontSize: 11, color: "var(--text-dim)" }}>
              Capacity/GPS aren&apos;t tracked yet — the units table doesn&apos;t have those columns.
            </div>
          </div>
        )}

        {step === 3 && (
          <div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
              <div>
                <label style={{ fontSize: 11, fontWeight: 700, color: "var(--text-secondary)", display: "block", marginBottom: 5 }}>Start Date</label>
                <input className="farm-input" type="date" value={startDate} onChange={e => setStartDate(e.target.value)} />
              </div>
              <div>
                <label style={{ fontSize: 11, fontWeight: 700, color: "var(--text-secondary)", display: "block", marginBottom: 5 }}>{isCrop ? "Harvest Date" : "Expected End"}</label>
                <input className="farm-input" type="date" value={endOrHarvestDate} onChange={e => setEndOrHarvestDate(e.target.value)} />
              </div>
            </div>
            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 11, fontWeight: 700, color: "var(--text-secondary)", display: "block", marginBottom: 5 }}>Initial Input Cost ({cur})</label>
              <input className="farm-input" type="number" placeholder="0" value={initialCost} onChange={e => setInitialCost(e.target.value)} />
            </div>
            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 11, fontWeight: 700, color: "var(--text-secondary)", display: "block", marginBottom: 5 }}>Assign Employee(s)</label>
              <select className="farm-input" multiple disabled style={{ height: 90, fontSize: 12, opacity: 0.5 }}>
                <option>Not available yet — no worker assignment on batches</option>
              </select>
            </div>
          </div>
        )}

        {step === 4 && (
          <div>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 12, lineHeight: 1.5 }}>
              Process schedules aren&apos;t backed by a real table yet — shown for reference only, not saved.
            </div>
            <div className="farm-card" style={{ overflow: "hidden", marginBottom: 14, opacity: 0.6 }}>
              {cfg.processes.map((p, i, arr) => (
                <div key={p.code} style={{ padding: "11px 14px", display: "flex", alignItems: "center", gap: 10, borderBottom: i < arr.length - 1 ? "1px solid var(--border-subtle)" : "none" }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)" }}>{p.name}</div>
                    <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 1 }}>{p.code} · {p.frequency}</div>
                  </div>
                  <span className={`chip ${p.requiresApproval ? "chip-warning" : "chip-ok"}`} style={{ fontSize: 8 }}>{p.requiresApproval ? "Approval On" : "Auto"}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {error && <div style={{ fontSize: 12, color: "var(--status-critical)", marginBottom: 10 }}>{error}</div>}

        <div style={{ display: "flex", gap: 8, marginTop: 8, marginBottom: 20 }}>
          {step > 1 && <button className="btn-secondary" style={{ flex: 1, justifyContent: "center", borderRadius: 12 }} onClick={() => setStep(step - 1)} disabled={saving}>Back</button>}
          <button className="btn-primary" style={{ flex: 2, justifyContent: "center", borderRadius: 12 }} disabled={saving} onClick={() => step < totalSteps ? setStep(step + 1) : createBatch()}>
            {saving ? "Creating…" : step === totalSteps ? `Create ${cfg.label} Batch` : "Continue"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Process Config ──
 * Decorative — there is no processes/process-config table or route yet
 * (same "no backing store" note as step 4 of the creation wizard above), so
 * this screen has nothing real to save. It used to look up the batches mock
 * array by code for display context; now it reads the same context straight
 * from the nav params BatchDetailScreen passes in (enterprise/dates), so it needs no
 * mock import and no extra fetch for what is, today, a read-only reference
 * view. */
export function ProcessConfigScreen() {
  const { goBack, params } = useNav();
  const { batchCode, processCode, enterprise, startDate, endDate, harvestDate } = params;
  const cfg = ENTERPRISE_REGISTRY.find(e => e.subtype === enterprise);
  const proc = cfg?.processes.find(p => p.code === processCode) ?? cfg?.processes[0];

  return (
    <div className="screen-content">
      <TopNav title={proc?.name ?? "Process Config"} subtitle={`${batchCode ?? ""}`} showBack />
      <div className="px-screen" style={{ paddingTop: 14 }}>
        <div style={{ padding: "10px 14px", background: "rgba(74,222,128,0.06)", borderRadius: 12, marginBottom: 14, border: "1px solid rgba(74,222,128,0.2)", display: "flex", gap: 8, alignItems: "center" }}>
          <span style={{ fontSize: 20 }}>{cfg?.emoji}</span>
          <div>
            <div style={{ fontWeight: 700, fontSize: 13 }}>{proc?.name}</div>
            <div style={{ fontSize: 10, color: "var(--text-muted)" }}>{proc?.code} · {proc?.frequency} · Batch: {batchCode}</div>
          </div>
        </div>

        <div style={{ marginBottom: 12 }}>
          <label style={{ fontSize: 11, fontWeight: 700, color: "var(--text-secondary)", display: "block", marginBottom: 5 }}>Assigned Worker</label>
          <select className="farm-input" disabled style={{ opacity: 0.5 }}>
            <option>Not available yet — no worker assignment on processes</option>
          </select>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
          <div>
            <label style={{ fontSize: 11, fontWeight: 700, color: "var(--text-secondary)", display: "block", marginBottom: 5 }}>Start Date</label>
            <input className="farm-input" type="date" defaultValue={startDate || ""} disabled style={{ opacity: 0.7 }} />
          </div>
          <div>
            <label style={{ fontSize: 11, fontWeight: 700, color: "var(--text-secondary)", display: "block", marginBottom: 5 }}>End Date</label>
            <input className="farm-input" type="date" defaultValue={endDate || harvestDate || ""} disabled style={{ opacity: 0.7 }} />
          </div>
        </div>
        <div style={{ marginBottom: 12 }}>
          <label style={{ fontSize: 11, fontWeight: 700, color: "var(--text-secondary)", display: "block", marginBottom: 5 }}>Frequency</label>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            {["daily","twice-daily","weekly","on-demand"].map(f => (
              <button key={f} disabled style={{ padding: "9px", borderRadius: 10, fontSize: 11, fontWeight: 600, background: f === proc?.frequency ? "rgba(74,222,128,0.15)" : "var(--card)", border: f === proc?.frequency ? "1px solid rgba(74,222,128,0.4)" : "1px solid var(--border-subtle)", color: f === proc?.frequency ? "var(--primary-green)" : "var(--text-muted)", cursor: "not-allowed", textTransform: "capitalize", opacity: 0.7 }}>{f}</button>
            ))}
          </div>
        </div>
        <div className="farm-card" style={{ padding: 12, marginBottom: 14, opacity: 0.7 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text-primary)" }}>Requires Owner Approval</div>
              <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>Owner must sign off on each submission</div>
            </div>
            <div style={{ width: 44, height: 24, borderRadius: 100, background: proc?.requiresApproval ? "var(--gradient-primary)" : "rgba(255,255,255,0.1)", position: "relative" }}>
              <div style={{ width: 18, height: 18, borderRadius: "50%", background: "#fff", position: "absolute", top: 3, left: proc?.requiresApproval ? 23 : 3, boxShadow: "0 1px 4px rgba(0,0,0,0.3)" }} />
            </div>
          </div>
        </div>
        <div style={{ fontSize: 11, color: "var(--text-dim)", marginBottom: 12, textAlign: "center" }}>
          Reference view only — there is no processes table to save this to yet.
        </div>
        <button className="btn-secondary" style={{ width: "100%", justifyContent: "center", marginBottom: 20 }} onClick={goBack}>Back</button>
      </div>
    </div>
  );
}
