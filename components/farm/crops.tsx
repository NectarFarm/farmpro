"use client";
import React, { useState, useEffect } from "react";
import { useNav, TopNav } from "./navigation";
import { FARMS_DATA, BATCHES_DATA, ENTERPRISE_REGISTRY, type Batch } from "./data";
import { Plus, ChevronRight, Activity, X, Check, Calendar, MapPin, Users, Download, Upload, ArrowRight } from "./icons";

function genCode(prefix: string, farmCode: string, n: number) {
  const fc = farmCode.split("-")[1] ?? "XXX";
  return `${prefix}-${fc}-${String(n).padStart(3, "0")}`;
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
function LivestockBatchCard({ batch, navigate }: { batch: Batch; navigate: (id: "batch-detail", p: Record<string,string>) => void }) {
  const cfg = ENTERPRISE_REGISTRY.find(e => e.subtype === batch.enterprise)!;
  const mort = batch.initialQty > 0 ? (((batch.initialQty - batch.qty) / batch.initialQty) * 100).toFixed(1) : "0.0";
  return (
    <button onClick={() => navigate("batch-detail", { code: batch.code })} className="farm-card" style={{ padding: 14, textAlign: "left", width: "100%", cursor: "pointer", borderLeft: `3px solid ${cfg.type === "crop" ? "rgba(251,191,36,0.6)" : "rgba(74,222,128,0.5)"}` }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span style={{ fontSize: 24 }}>{cfg.emoji}</span>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text-primary)" }}>{batch.label}</div>
            <div style={{ fontSize: 10, color: "var(--text-muted)", fontFamily: "monospace" }}>{batch.code} · {batch.unitCode}</div>
          </div>
        </div>
        <span className={`chip ${batch.status === "ACTIVE" ? "chip-ok" : batch.status === "QUARANTINE" ? "chip-critical" : "chip-info"}`} style={{ fontSize: 9 }}>{batch.status}</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6, marginTop: 6 }}>
        <div style={{ background: "var(--surface)", borderRadius: 8, padding: "6px 8px", textAlign: "center" }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text-primary)" }}>{batch.qty.toLocaleString()}</div>
          <div style={{ fontSize: 9, color: "var(--text-muted)", fontWeight: 600 }}>{cfg.type === "crop" ? "Plots/Ha" : "Head"}</div>
        </div>
        <div style={{ background: "var(--surface)", borderRadius: 8, padding: "6px 8px", textAlign: "center" }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text-primary)" }}>{batch.stage}</div>
          <div style={{ fontSize: 9, color: "var(--text-muted)", fontWeight: 600 }}>Stage</div>
        </div>
        <div style={{ background: "var(--surface)", borderRadius: 8, padding: "6px 8px", textAlign: "center" }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: Number(mort) > 3 ? "var(--status-critical)" : "var(--status-ok)" }}>{cfg.type === "crop" ? "75%" : `${mort}%`}</div>
          <div style={{ fontSize: 9, color: "var(--text-muted)", fontWeight: 600 }}>{cfg.type === "crop" ? "Growth" : "Mort."}</div>
        </div>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8, fontSize: 10, color: "var(--text-muted)" }}>
        <span>Start: <span style={{ color: "var(--text-secondary)", fontWeight: 600 }}>{batch.startDate}</span></span>
        {batch.harvestDate && <span>Harvest: <span style={{ color: "var(--accent-amber)", fontWeight: 600 }}>{batch.harvestDate}</span></span>}
        {batch.endDate && !batch.harvestDate && <span>End: <span style={{ color: "var(--accent-amber)", fontWeight: 600 }}>{batch.endDate}</span></span>}
      </div>
    </button>
  );
}

export function CropsScreen() {
  const { navigate, activeFarm, farms } = useNav();
  const [tab, setTab] = useState<"livestock" | "crops" | "units">("livestock");
  const [filter, setFilter] = useState("All");
  const [farmFilter, setFarmFilter] = useState(activeFarm === "ALL" ? "All" : activeFarm);
  const [showEnterpriseSelector, setShowEnterpriseSelector] = useState(false);

  // Keep the in-screen farm filter in sync with the shell's active farm so that
  // switching farms re-scopes this screen too (issue #219). In the "All Farms"
  // aggregate view the chips below take over instead.
  useEffect(() => {
    if (activeFarm !== "ALL") setFarmFilter(activeFarm)
  }, [activeFarm])

  const farmBatches = farmFilter === "All" ? BATCHES_DATA : BATCHES_DATA.filter(b => b.farmCode === farmFilter);
  const livestockBatches = farmBatches.filter(b => ENTERPRISE_REGISTRY.find(e => e.subtype === b.enterprise)?.type === "livestock");
  const cropBatches = farmBatches.filter(b => ENTERPRISE_REGISTRY.find(e => e.subtype === b.enterprise)?.type === "crop");
  const displayed = (tab === "livestock" ? livestockBatches : cropBatches).filter(b => filter === "All" || b.status === filter);

  const filters = ["All", "ACTIVE", "QUARANTINE", "CLOSED", "HARVESTED"];

  return (
    <div className="screen-content">
      <TopNav title="Farm" subtitle="Enterprises & batches" showSearch
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
            { label: "Total Cost", value: `KSh ${(farmBatches.reduce((s,b)=>s+b.cost,0)/1000).toFixed(0)}K`, color: "var(--text-secondary)" },
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
        <div className="chip-row" style={{ marginBottom: 10 }}>
          {filters.map(f => (
            <button key={f} onClick={() => setFilter(f)} className={`filter-chip ${filter === f ? "active" : ""}`}>{f}</button>
          ))}
        </div>
      </div>

      {/* LIVESTOCK / CROPS batch cards */}
      {(tab === "livestock" || tab === "crops") && (
        <div className="px-screen">
          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 16 }}>
            {displayed.length === 0 ? (
              <div style={{ padding: 24, textAlign: "center" }}>
                <div style={{ fontSize: 36, marginBottom: 8 }}>{tab === "livestock" ? "🐄" : "🌱"}</div>
                <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text-primary)", marginBottom: 4 }}>No {tab} batches</div>
                <div style={{ fontSize: 12, color: "var(--text-muted)" }}>Tap + to add your first enterprise</div>
              </div>
            ) : displayed.map(b => (
              <LivestockBatchCard key={b.code} batch={b} navigate={navigate} />
            ))}
          </div>
        </div>
      )}

      {/* UNITS heatmap */}
      {tab === "units" && (
        <div className="px-screen">
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 16 }}>
            {[
              { code: "HSE-KMU-A01", name: "House A01", type: "Broiler House", capacity: 1000, pop: 920, status: "ACTIVE" },
              { code: "PEN-KMU-B01", name: "Pen B01", type: "Layer Pen", capacity: 500, pop: 490, status: "ACTIVE" },
              { code: "STY-KMU-P01", name: "Sty P01", type: "Pig Sty", capacity: 80, pop: 62, status: "ACTIVE" },
              { code: "PAD-KMU-D01", name: "Paddock D01", type: "Dairy Paddock", capacity: 20, pop: 12, status: "ACTIVE" },
              { code: "FLD-KMU-F01", name: "Field F01", type: "Maize Field", capacity: 3, pop: 2, status: "ACTIVE" },
              { code: "PLT-KMU-F02", name: "Plot F02", type: "Kitchen Garden", capacity: 1, pop: 1, status: "ACTIVE" },
            ].filter(u => farmFilter === "All" || u.code.includes("KMU")).map(u => {
              const pct = Math.round((u.pop / u.capacity) * 100);
              const cls = pct > 90 ? "density-crit" : pct > 70 ? "density-warn" : "density-ok";
              return (
                <div key={u.code} className={`farm-card ${cls}`} style={{ padding: 12 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-primary)" }}>{u.name}</div>
                    <span className={`chip ${u.status === "ACTIVE" ? "chip-ok" : "chip-warning"}`} style={{ fontSize: 8 }}>{u.status}</span>
                  </div>
                  <div style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 6 }}>{u.type}</div>
                  <div style={{ fontSize: 9, color: "var(--text-dim)", fontFamily: "monospace", marginBottom: 8 }}>{u.code}</div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, marginBottom: 4 }}>
                    <span>{u.pop}/{u.capacity}</span>
                    <span style={{ fontWeight: 700, color: pct > 90 ? "var(--status-critical)" : "var(--primary-green)" }}>{pct}%</span>
                  </div>
                  <div className="progress-track"><div className={`progress-fill ${pct > 90 ? "progress-fill-red" : pct > 70 ? "progress-fill-amber" : ""}`} style={{ width: `${pct}%` }} /></div>
                </div>
              );
            })}
          </div>
          <button className="btn-primary" style={{ width: "100%", justifyContent: "center", marginBottom: 16 }}>
            <Plus size={14} /> Add Unit
          </button>
        </div>
      )}

      {showEnterpriseSelector && <EnterpriseSelector onSelect={(s) => navigate("crop-schedule", { subtype: s })} onClose={() => setShowEnterpriseSelector(false)} />}
    </div>
  );
}

/* ── Batch Detail ── */
export function BatchDetailScreen() {
  const { goBack, params, navigate, farms } = useNav();
  const bCode = params.code ?? "BRO-KMU-022";
  const batch = BATCHES_DATA.find(b => b.code === bCode) ?? BATCHES_DATA[0];
  const cfg = ENTERPRISE_REGISTRY.find(e => e.subtype === batch.enterprise)!;
  const mort = batch.initialQty > 0 ? (((batch.initialQty - batch.qty) / batch.initialQty) * 100).toFixed(1) : "0.0";
  const [costTab, setCostTab] = useState<"breakdown" | "processes">("breakdown");
  const [showTransferForm, setShowTransferForm] = useState(false);
  const [transferDate, setTransferDate] = useState(batch.transferDate ?? "");
  const [transferUnit, setTransferUnit] = useState(batch.transferToUnitCode ?? "");
  const [transferNotes, setTransferNotes] = useState(batch.transferNotes ?? "");
  const [transferSaved, setTransferSaved] = useState(!!batch.transferDate);

  const costs = [
    { label: "Feed/Inputs", amount: Math.round(batch.cost * 0.43), pct: 43, color: "var(--primary-green)" },
    { label: "Stock/Seed", amount: Math.round(batch.cost * 0.29), pct: 29, color: "var(--accent-blue)" },
    { label: "Health/Agro", amount: Math.round(batch.cost * 0.10), pct: 10, color: "var(--accent-purple)" },
    { label: "Labour", amount: Math.round(batch.cost * 0.09), pct: 9, color: "var(--accent-amber)" },
    { label: "Overhead", amount: Math.round(batch.cost * 0.09), pct: 9, color: "var(--text-muted)" },
  ];

  return (
    <div className="screen-content">
      <TopNav title={batch.label} subtitle={`${batch.code} · ${batch.unitCode}`} showBack />
      <div className="px-screen" style={{ paddingTop: 14 }}>

        {/* Hero */}
        <div className="farm-card farm-card-active" style={{ padding: 16, marginBottom: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <span style={{ fontSize: 32 }}>{cfg?.emoji}</span>
              <div>
                <span className={`chip ${batch.status === "ACTIVE" ? "chip-ok" : batch.status === "QUARANTINE" ? "chip-critical" : "chip-info"}`}>{batch.status}</span>
                <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>Stage: <span style={{ color: "var(--primary-green)", fontWeight: 700 }}>{batch.stage}</span></div>
              </div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 10, color: "var(--text-muted)" }}>Farm</div>
              <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-secondary)" }}>{farms.find(f => f.code === batch.farmCode)?.name}</div>
            </div>
          </div>

          {/* KPIs */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 8 }}>
            {[
              { label: cfg?.type === "crop" ? "Plots" : "Head", value: batch.qty.toLocaleString() },
              { label: cfg?.type === "crop" ? "Growth" : "Mort. %", value: cfg?.type === "crop" ? "75%" : `${mort}%` },
              { label: cfg?.type === "crop" ? "Area" : "FCR", value: cfg?.type === "crop" ? "2 ha" : "2.18" },
              { label: "Cost KSh", value: `${(batch.cost/1000).toFixed(0)}K` },
            ].map(s => (
              <div key={s.label} style={{ background: "var(--surface)", borderRadius: 8, padding: "8px", textAlign: "center" }}>
                <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text-primary)" }}>{s.value}</div>
                <div style={{ fontSize: 9, color: "var(--text-muted)", fontWeight: 600, marginTop: 1 }}>{s.label}</div>
              </div>
            ))}
          </div>

          {/* Dates */}
          <div style={{ display: "flex", gap: 12, marginTop: 10, fontSize: 11, flexWrap: "wrap" }}>
            <span style={{ color: "var(--text-muted)" }}>Start: <span style={{ color: "var(--text-secondary)", fontWeight: 600 }}>{batch.startDate}</span></span>
            {batch.harvestDate && <span style={{ color: "var(--text-muted)" }}>Harvest: <span style={{ color: "var(--accent-amber)", fontWeight: 600 }}>{batch.harvestDate}</span></span>}
            {batch.endDate && <span style={{ color: "var(--text-muted)" }}>End: <span style={{ color: "var(--accent-amber)", fontWeight: 600 }}>{batch.endDate}</span></span>}
          </div>
        </div>

        {/* Unit Transfer Section */}
        <div className="farm-card" style={{ padding: 14, marginBottom: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: transferSaved || showTransferForm ? 12 : 0 }}>
            <div>
              <div className="section-eyebrow" style={{ marginBottom: 2 }}>Unit Transfer</div>
              {transferSaved && (
                <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 4 }}>
                  <span style={{ fontSize: 11, fontWeight: 600, color: "var(--text-secondary)" }}>{batch.unitCode}</span>
                  <ArrowRight size={12} color="var(--primary-green)" />
                  <span style={{ fontSize: 11, fontWeight: 700, color: "var(--primary-green)" }}>{transferUnit}</span>
                  <span style={{ fontSize: 10, color: "var(--text-muted)", marginLeft: 4 }}>from {transferDate}</span>
                </div>
              )}
            </div>
            <button onClick={() => setShowTransferForm(f => !f)} style={{ fontSize: 11, fontWeight: 700, padding: "4px 12px", borderRadius: 8, background: transferSaved ? "rgba(74,222,128,0.1)" : "var(--surface)", border: "1px solid var(--border-subtle)", color: transferSaved ? "var(--primary-green)" : "var(--text-muted)", cursor: "pointer" }}>
              {transferSaved ? "Edit" : "Set Transfer"}
            </button>
          </div>
          {showTransferForm && (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                <div>
                  <label style={{ fontSize: 10, fontWeight: 700, color: "var(--text-muted)", display: "block", marginBottom: 4 }}>Transfer Date *</label>
                  <input type="date" className="farm-input" style={{ fontSize: 12 }} value={transferDate} onChange={e => setTransferDate(e.target.value)} />
                </div>
                <div>
                  <label style={{ fontSize: 10, fontWeight: 700, color: "var(--text-muted)", display: "block", marginBottom: 4 }}>Destination Unit *</label>
                  <input type="text" className="farm-input" style={{ fontSize: 12 }} placeholder={`e.g. ${cfg?.unitPrefix ?? "UNT"}-KMU-X02`} value={transferUnit} onChange={e => setTransferUnit(e.target.value)} />
                </div>
              </div>
              <div>
                <label style={{ fontSize: 10, fontWeight: 700, color: "var(--text-muted)", display: "block", marginBottom: 4 }}>Transfer Notes</label>
                <input type="text" className="farm-input" style={{ fontSize: 12 }} placeholder="Reason for transfer…" value={transferNotes} onChange={e => setTransferNotes(e.target.value)} />
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => setShowTransferForm(false)} className="btn-secondary" style={{ flex: 1, justifyContent: "center", fontSize: 12, padding: 10 }}>Cancel</button>
                <button onClick={() => { if (transferDate && transferUnit) { setTransferSaved(true); setShowTransferForm(false); } }}
                  className="btn-primary" style={{ flex: 1, justifyContent: "center", fontSize: 12, padding: 10 }}
                  disabled={!transferDate || !transferUnit}>
                  <Check size={13} /> Save Transfer
                </button>
              </div>
            </div>
          )}
          {!transferSaved && !showTransferForm && (
            <div style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 4 }}>No unit transfer scheduled yet.</div>
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
            <>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 12 }}>
                {[
                  { label: "Total Cost", value: `KSh ${batch.cost.toLocaleString()}`, color: "var(--status-critical)" },
                  { label: "Revenue", value: `KSh ${(batch.cost * 1.22).toLocaleString().split(".")[0]}`, color: "var(--status-ok)" },
                  { label: "Break-even", value: `KSh ${Math.round(batch.cost / Math.max(batch.qty, 1))}/unit`, color: "var(--accent-amber)" },
                  { label: "Gross Margin", value: "22.8%", color: "var(--primary-green)" },
                ].map(s => (
                  <div key={s.label} style={{ background: "var(--surface)", borderRadius: 8, padding: "8px 10px" }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: s.color }}>{s.value}</div>
                    <div style={{ fontSize: 9, color: "var(--text-muted)", fontWeight: 600, marginTop: 1 }}>{s.label}</div>
                  </div>
                ))}
              </div>
              {costs.map(c => (
                <div key={c.label} style={{ marginBottom: 8 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3, fontSize: 11 }}>
                    <span style={{ color: "var(--text-secondary)", fontWeight: 600 }}>{c.label}</span>
                    <span style={{ color: "var(--text-primary)", fontWeight: 700 }}>KSh {c.amount.toLocaleString()} ({c.pct}%)</span>
                  </div>
                  <div className="progress-track"><div className="progress-fill" style={{ width: `${c.pct}%`, background: c.color }} /></div>
                </div>
              ))}
            </>
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
                    <button onClick={() => navigate("process-config", { batchCode: batch.code, processCode: p.code })} style={{ fontSize: 10, fontWeight: 700, padding: "4px 10px", borderRadius: 8, background: "rgba(74,222,128,0.1)", border: "1px solid rgba(74,222,128,0.3)", color: "var(--primary-green)", cursor: "pointer" }}>Configure</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Actions */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 14 }}>
          <button className="btn-primary" style={{ justifyContent: "center", borderRadius: 12, padding: 12, fontSize: 12 }}>Record {cfg?.harvestUnit ? "Sale" : "Harvest"}</button>
          <button className="btn-secondary" style={{ justifyContent: "center", borderRadius: 12, padding: 12, fontSize: 12 }}>Advance Stage</button>
          <button className="btn-secondary" style={{ justifyContent: "center", borderRadius: 12, padding: 12, fontSize: 12 }} onClick={() => navigate("tasks", { batch: batch.code })}>
            📋 All Batch Tasks
          </button>
          <button className="btn-secondary" style={{ justifyContent: "center", borderRadius: 12, padding: 12, fontSize: 12 }}>Edit Batch</button>
        </div>

        {/* Per-unit task shortcuts */}
        {(batch.unitCode || (transferSaved && transferUnit)) && (
          <div style={{ marginBottom: 14 }}>
            <div className="section-eyebrow" style={{ marginBottom: 8 }}>Tasks by Unit</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {batch.unitCode && (
                <button
                  onClick={() => navigate("tasks", { batch: batch.code, unit: batch.unitCode! })}
                  style={{ flex: 1, padding: "10px 12px", borderRadius: 12, fontSize: 12, fontWeight: 700, cursor: "pointer", background: "rgba(96,165,250,0.08)", border: "1px solid rgba(96,165,250,0.3)", color: "var(--accent-cyan)", display: "flex", alignItems: "center", justifyContent: "center", gap: 5 }}>
                  🏠 {batch.unitCode}
                </button>
              )}
              {transferSaved && transferUnit && (
                <button
                  onClick={() => navigate("tasks", { batch: batch.code, unit: transferUnit })}
                  style={{ flex: 1, padding: "10px 12px", borderRadius: 12, fontSize: 12, fontWeight: 700, cursor: "pointer", background: "rgba(74,222,128,0.08)", border: "1px solid rgba(74,222,128,0.3)", color: "var(--primary-green)", display: "flex", alignItems: "center", justifyContent: "center", gap: 5 }}>
                  🏠 {transferUnit}
                </button>
              )}
            </div>
          </div>
        )}

        {/* Recent activity */}
        <div className="section-eyebrow" style={{ marginBottom: 8 }}>Recent Activity</div>
        <div className="farm-card" style={{ marginBottom: 20, overflow: "hidden" }}>
          {[
            { text: `${cfg?.processes[0]?.name ?? "Feeding"}: completed`, who: "John K.", time: "08:14", code: "ACT-001" },
            { text: "Health check: all normal", who: "Dr. Ken O.", time: "Yesterday", code: "ACT-002" },
            { text: "Physical count: variance noted", who: "Ann W.", time: "2d ago", code: "ACT-003" },
          ].map((a, i, arr) => (
            <div key={a.code} style={{ padding: "11px 14px", borderBottom: i < arr.length - 1 ? "1px solid var(--border-subtle)" : "none", display: "flex", gap: 10, alignItems: "flex-start" }}>
              <div style={{ width: 26, height: 26, background: "var(--surface)", borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <Activity size={12} color="var(--text-muted)" />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-primary)" }}>{a.text}</div>
                <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 1 }}>{a.code} · {a.who} · {a.time}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ── Batch / Enterprise Creation Wizard ── */
export function CropScheduleScreen() {
  const { goBack, params, farms } = useNav();
  const subtype = params.subtype ?? "broiler";
  const cfg = ENTERPRISE_REGISTRY.find(e => e.subtype === subtype) ?? ENTERPRISE_REGISTRY[0];
  const isCrop = cfg.type === "crop";
  const [step, setStep] = useState(1);
  const totalSteps = 4;
  const steps = ["Basic Info", cfg.unitName, "Schedule", "Processes"];
  const autoCode = genCode(cfg.batchPrefix, "KMU", 24);
  const unitCode = genCode(cfg.unitPrefix, "KMU", 7);

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
            <div style={{ fontSize: 11, color: "var(--text-muted)" }}>Unit: {cfg.unitName} · Batch code: <span style={{ fontFamily: "monospace", color: "var(--primary-green)", fontWeight: 700 }}>{autoCode}</span></div>
          </div>
        </div>

        {step === 1 && (
          <div>
            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 11, fontWeight: 700, color: "var(--text-secondary)", display: "block", marginBottom: 5 }}>Batch Name</label>
              <input className="farm-input" defaultValue={`${cfg.label} Batch – ${new Date().toLocaleString("en-GB", { month: "short", year: "numeric" })}`} />
            </div>
            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 11, fontWeight: 700, color: "var(--text-secondary)", display: "block", marginBottom: 5 }}>Farm</label>
              <select className="farm-input">
                {farms.map(f => <option key={f.code} value={f.code}>{f.name} ({f.code})</option>)}
              </select>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
              <div>
                <label style={{ fontSize: 11, fontWeight: 700, color: "var(--text-secondary)", display: "block", marginBottom: 5 }}>{isCrop ? "Area (acres)" : "Initial Count"}</label>
                <input className="farm-input" type="number" placeholder={isCrop ? "0.00" : "0"} />
              </div>
              <div>
                <label style={{ fontSize: 11, fontWeight: 700, color: "var(--text-secondary)", display: "block", marginBottom: 5 }}>{isCrop ? "Crop Variety" : "Species / Breed"}</label>
                <input className="farm-input" placeholder={isCrop ? "e.g. H614D" : "e.g. Cobb 500"} />
              </div>
            </div>
          </div>
        )}

        {step === 2 && (
          <div>
            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 11, fontWeight: 700, color: "var(--text-secondary)", display: "block", marginBottom: 5 }}>{cfg.unitName} Code (auto-generated)</label>
              <input className="farm-input" defaultValue={unitCode} style={{ fontFamily: "monospace", color: "var(--primary-green)", fontWeight: 700 }} />
            </div>
            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 11, fontWeight: 700, color: "var(--text-secondary)", display: "block", marginBottom: 5 }}>{cfg.unitName} Name</label>
              <input className="farm-input" placeholder={`e.g. ${cfg.unitName} A01`} />
            </div>
            {!isCrop && (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
                <div>
                  <label style={{ fontSize: 11, fontWeight: 700, color: "var(--text-secondary)", display: "block", marginBottom: 5 }}>Capacity</label>
                  <input className="farm-input" type="number" placeholder="0" />
                </div>
                <div>
                  <label style={{ fontSize: 11, fontWeight: 700, color: "var(--text-secondary)", display: "block", marginBottom: 5 }}>GPS / Location</label>
                  <input className="farm-input" placeholder="Optional" />
                </div>
              </div>
            )}
            {isCrop && (
              <div style={{ marginBottom: 12 }}>
                <label style={{ fontSize: 11, fontWeight: 700, color: "var(--text-secondary)", display: "block", marginBottom: 5 }}>Field Size (acres)</label>
                <input className="farm-input" type="number" placeholder="0.00" />
              </div>
            )}
          </div>
        )}

        {step === 3 && (
          <div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
              <div>
                <label style={{ fontSize: 11, fontWeight: 700, color: "var(--text-secondary)", display: "block", marginBottom: 5 }}>Start Date</label>
                <input className="farm-input" type="date" />
              </div>
              <div>
                <label style={{ fontSize: 11, fontWeight: 700, color: "var(--text-secondary)", display: "block", marginBottom: 5 }}>{isCrop ? "Harvest Date" : "Expected End"}</label>
                <input className="farm-input" type="date" />
              </div>
            </div>
            {isCrop && (
              <div style={{ marginBottom: 12 }}>
                <label style={{ fontSize: 11, fontWeight: 700, color: "var(--text-secondary)", display: "block", marginBottom: 5 }}>Expected Yield ({cfg.harvestUnit})</label>
                <input className="farm-input" type="number" placeholder="0" />
              </div>
            )}
            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 11, fontWeight: 700, color: "var(--text-secondary)", display: "block", marginBottom: 5 }}>Initial Input Cost (KSh)</label>
              <input className="farm-input" type="number" placeholder="0" />
            </div>
            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 11, fontWeight: 700, color: "var(--text-secondary)", display: "block", marginBottom: 5 }}>Assign Employee(s)</label>
              <select className="farm-input" multiple style={{ height: 90, fontSize: 12 }}>
                <option>EMP-KMU-002 – John Kamau (Worker)</option>
                <option>EMP-KMU-003 – Sarah Mwangi (Worker)</option>
                <option>EMP-KMU-005 – Dr. Ken Oduya (Vet)</option>
              </select>
            </div>
          </div>
        )}

        {step === 4 && (
          <div>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 12, lineHeight: 1.5 }}>
              Configure which processes are active and whether each requires owner approval. Workers are notified at the scheduled time.
            </div>
            <div className="farm-card" style={{ overflow: "hidden", marginBottom: 14 }}>
              {cfg.processes.map((p, i, arr) => (
                <div key={p.code} style={{ padding: "11px 14px", display: "flex", alignItems: "center", gap: 10, borderBottom: i < arr.length - 1 ? "1px solid var(--border-subtle)" : "none" }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)" }}>{p.name}</div>
                    <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 1 }}>{p.code} · {p.frequency}</div>
                  </div>
                  <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                    <span className={`chip ${p.requiresApproval ? "chip-warning" : "chip-ok"}`} style={{ fontSize: 8 }}>{p.requiresApproval ? "Approval On" : "Auto"}</span>
                    <div style={{ width: 38, height: 22, borderRadius: 100, background: "var(--gradient-primary)", position: "relative", cursor: "pointer" }}>
                      <div style={{ width: 16, height: 16, borderRadius: "50%", background: "#fff", position: "absolute", top: 3, left: 19, boxShadow: "0 1px 4px rgba(0,0,0,0.3)" }} />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div style={{ display: "flex", gap: 8, marginTop: 8, marginBottom: 20 }}>
          {step > 1 && <button className="btn-secondary" style={{ flex: 1, justifyContent: "center", borderRadius: 12 }} onClick={() => setStep(step - 1)}>Back</button>}
          <button className="btn-primary" style={{ flex: 2, justifyContent: "center", borderRadius: 12 }} onClick={() => step < totalSteps ? setStep(step + 1) : goBack()}>
            {step === totalSteps ? `Create ${cfg.label} Batch` : "Continue"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Process Config ── */
export function ProcessConfigScreen() {
  const { goBack, params } = useNav();
  const { batchCode, processCode } = params;
  const batch = BATCHES_DATA.find(b => b.code === batchCode) ?? BATCHES_DATA[0];
  const cfg = ENTERPRISE_REGISTRY.find(e => e.subtype === batch.enterprise);
  const proc = cfg?.processes.find(p => p.code === processCode) ?? cfg?.processes[0];

  return (
    <div className="screen-content">
      <TopNav title={proc?.name ?? "Process Config"} subtitle={`${batch.code} · ${batchCode}`} showBack />
      <div className="px-screen" style={{ paddingTop: 14 }}>
        <div style={{ padding: "10px 14px", background: "rgba(74,222,128,0.06)", borderRadius: 12, marginBottom: 14, border: "1px solid rgba(74,222,128,0.2)", display: "flex", gap: 8, alignItems: "center" }}>
          <span style={{ fontSize: 20 }}>{cfg?.emoji}</span>
          <div>
            <div style={{ fontWeight: 700, fontSize: 13 }}>{proc?.name}</div>
            <div style={{ fontSize: 10, color: "var(--text-muted)" }}>{proc?.code} · {proc?.frequency} · Batch: {batch.code}</div>
          </div>
        </div>

        <div style={{ marginBottom: 12 }}>
          <label style={{ fontSize: 11, fontWeight: 700, color: "var(--text-secondary)", display: "block", marginBottom: 5 }}>Assigned Worker</label>
          <select className="farm-input">
            <option>EMP-KMU-002 – John Kamau</option>
            <option>EMP-KMU-003 – Sarah Mwangi</option>
          </select>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
          <div>
            <label style={{ fontSize: 11, fontWeight: 700, color: "var(--text-secondary)", display: "block", marginBottom: 5 }}>Start Date</label>
            <input className="farm-input" type="date" defaultValue={batch.startDate} />
          </div>
          <div>
            <label style={{ fontSize: 11, fontWeight: 700, color: "var(--text-secondary)", display: "block", marginBottom: 5 }}>End Date</label>
            <input className="farm-input" type="date" defaultValue={batch.endDate ?? batch.harvestDate ?? ""} />
          </div>
        </div>
        <div style={{ marginBottom: 12 }}>
          <label style={{ fontSize: 11, fontWeight: 700, color: "var(--text-secondary)", display: "block", marginBottom: 5 }}>Frequency</label>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            {["daily","twice-daily","weekly","on-demand"].map(f => (
              <button key={f} style={{ padding: "9px", borderRadius: 10, fontSize: 11, fontWeight: 600, background: f === proc?.frequency ? "rgba(74,222,128,0.15)" : "var(--card)", border: f === proc?.frequency ? "1px solid rgba(74,222,128,0.4)" : "1px solid var(--border-subtle)", color: f === proc?.frequency ? "var(--primary-green)" : "var(--text-muted)", cursor: "pointer", textTransform: "capitalize" }}>{f}</button>
            ))}
          </div>
        </div>
        <div style={{ marginBottom: 12 }}>
          <label style={{ fontSize: 11, fontWeight: 700, color: "var(--text-secondary)", display: "block", marginBottom: 5 }}>Due Time</label>
          <input className="farm-input" type="time" defaultValue="07:30" />
        </div>
        <div style={{ marginBottom: 12 }}>
          <label style={{ fontSize: 11, fontWeight: 700, color: "var(--text-secondary)", display: "block", marginBottom: 5 }}>Location / Where</label>
          <input className="farm-input" placeholder={`e.g. ${cfg?.unitName} A01`} />
        </div>
        <div className="farm-card" style={{ padding: 12, marginBottom: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text-primary)" }}>Requires Owner Approval</div>
              <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>Owner must sign off on each submission</div>
            </div>
            <div style={{ width: 44, height: 24, borderRadius: 100, background: proc?.requiresApproval ? "var(--gradient-primary)" : "rgba(255,255,255,0.1)", position: "relative", cursor: "pointer" }}>
              <div style={{ width: 18, height: 18, borderRadius: "50%", background: "#fff", position: "absolute", top: 3, left: proc?.requiresApproval ? 23 : 3, boxShadow: "0 1px 4px rgba(0,0,0,0.3)" }} />
            </div>
          </div>
        </div>
        <button className="btn-primary" style={{ width: "100%", justifyContent: "center", marginBottom: 20 }} onClick={goBack}>Save Configuration</button>
      </div>
    </div>
  );
}
