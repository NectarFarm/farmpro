"use client";
import React, { useState } from "react";
import { useNav, TopNav } from "./navigation";
import { Building2, Users, Activity, Shield, Settings, ChevronRight, Plus, Check, X, AlertTriangle, TrendingUp, Globe, BarChart3, Eye, Trash2, RefreshCw, Lock } from "./icons";

const FARMS = [
  { id: "F001", name: "Kamau Family Farms", owner: "James Kamau", plan: "Pro", users: 5, animals: 4820, batches: 12, status: "active", revenue: 184200 },
  { id: "F002", name: "Rift Valley Poultry", owner: "Mary Wanjiku", plan: "Basic", users: 3, animals: 2100, batches: 6, status: "active", revenue: 88000 },
  { id: "F003", name: "Nakuru AgriFarm", owner: "Mwangi & Sons", plan: "Pro", users: 8, animals: 9800, batches: 22, status: "active", revenue: 520000 },
  { id: "F004", name: "Eldoret Layers Ltd", owner: "Peter Rono", plan: "Basic", users: 2, animals: 1400, batches: 3, status: "suspended", revenue: 0 },
  { id: "F005", name: "Kiambu Organic Farm", owner: "Ann Njeri", plan: "Trial", users: 1, animals: 350, batches: 2, status: "trial", revenue: 12000 },
];

const AUDIT_LOG = [
  { action: "Farm onboarded", target: "Kiambu Organic Farm", admin: "Super Admin", time: "2026-08-10 14:00", type: "create" },
  { action: "Farm suspended", target: "Eldoret Layers Ltd", admin: "Super Admin", time: "2026-08-09 10:30", type: "suspend" },
  { action: "Owner password reset", target: "Mary Wanjiku (RVP)", admin: "Super Admin", time: "2026-08-08 09:00", type: "security" },
  { action: "Plan upgraded", target: "Nakuru AgriFarm → Pro", admin: "Super Admin", time: "2026-08-07 16:00", type: "billing" },
];

const PLATFORM_HEALTH = [
  { metric: "API P95 latency", value: "218ms", ok: true },
  { metric: "Database connections", value: "12/100", ok: true },
  { metric: "Error rate (1h)", value: "0.08%", ok: true },
  { metric: "Active sessions", value: "34", ok: true },
  { metric: "Pending sync jobs", value: "127", ok: true },
  { metric: "Storage used", value: "2.4GB / 100GB", ok: true },
];

export function AdminDashboardScreen() {
  const { navigate } = useNav();
  const total = FARMS.length;
  const active = FARMS.filter(f => f.status === "active").length;
  const totalAnimals = FARMS.reduce((s, f) => s + f.animals, 0);
  const totalRevenue = FARMS.reduce((s, f) => s + f.revenue, 0);

  return (
    <div className="screen-content px-screen" style={{ paddingTop: 16 }}>
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 12, color: "var(--text-muted)" }}>Platform Admin</div>
        <div style={{ fontSize: 20, fontWeight: 700 }}>IFMS Overview</div>
      </div>

      {/* Platform KPIs */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 16 }}>
        {[
          { label: "Total Farms", value: total, sub: `${active} active`, color: "var(--primary-green)" },
          { label: "Farmers", value: FARMS.reduce((s, f) => s + f.users, 0), sub: "active users", color: "var(--accent-blue)" },
          { label: "Total Animals", value: totalAnimals.toLocaleString(), sub: "across all farms", color: "var(--accent-amber)" },
          { label: "Monthly Revenue", value: `KSh ${(totalRevenue / 1000).toFixed(0)}K`, sub: "platform-wide", color: "var(--status-ok)" },
        ].map((k) => (
          <div key={k.label} className="farm-card" style={{ padding: 14 }}>
            <div style={{ fontSize: 22, fontWeight: 700, color: k.color }}>{k.value}</div>
            <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-primary)", marginTop: 2 }}>{k.label}</div>
            <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 1 }}>{k.sub}</div>
          </div>
        ))}
      </div>

      {/* Plan distribution */}
      <div className="farm-card" style={{ padding: 14, marginBottom: 14 }}>
        <div className="section-eyebrow" style={{ marginBottom: 10 }}>Plan Distribution</div>
        <div style={{ display: "flex", gap: 10 }}>
          {[["Pro", 2, "var(--primary-green)"], ["Basic", 2, "var(--accent-blue)"], ["Trial", 1, "var(--accent-amber)"]].map(([label, count, color]) => (
            <div key={label as string} style={{ flex: 1, textAlign: "center" }}>
              <div style={{ fontSize: 22, fontWeight: 700, color: color as string }}>{count as number}</div>
              <div style={{ fontSize: 10, color: "var(--text-muted)", fontWeight: 600 }}>{label as string}</div>
              <div className="progress-track" style={{ marginTop: 4 }}>
                <div className="progress-fill" style={{ width: `${((count as number) / total) * 100}%`, background: color as string }} />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Quick actions */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 14 }}>
        <button className="btn-primary" style={{ justifyContent: "center", padding: 12, borderRadius: 12, fontSize: 12 }} onClick={() => navigate("admin-farms")}>
          <Plus size={14} /> Onboard Farm
        </button>
        <button className="btn-secondary" style={{ justifyContent: "center", padding: 12, borderRadius: 12, fontSize: 12 }}>
          <BarChart3 size={14} /> Platform Stats
        </button>
      </div>

      {/* Platform health */}
      <div className="section-eyebrow" style={{ marginBottom: 8 }}>System Health</div>
      <div className="farm-card" style={{ overflow: "hidden", marginBottom: 14 }}>
        {PLATFORM_HEALTH.map((h, i) => (
          <div key={h.metric} style={{ padding: "10px 14px", display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: i < PLATFORM_HEALTH.length - 1 ? "1px solid var(--border-subtle)" : "none" }}>
            <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>{h.metric}</span>
            <span style={{ fontSize: 12, fontWeight: 700, color: h.ok ? "var(--status-ok)" : "var(--status-critical)" }}>{h.value}</span>
          </div>
        ))}
      </div>

      {/* Recent audit */}
      <div className="section-eyebrow" style={{ marginBottom: 8 }}>Recent Actions</div>
      <div className="farm-card" style={{ overflow: "hidden", marginBottom: 20 }}>
        {AUDIT_LOG.slice(0, 3).map((entry, i) => (
          <div key={i} style={{ padding: "11px 14px", display: "flex", gap: 10, alignItems: "flex-start", borderBottom: i < 2 ? "1px solid var(--border-subtle)" : "none" }}>
            <div style={{
              width: 28, height: 28, borderRadius: 8, flexShrink: 0,
              background: entry.type === "create" ? "rgba(74,222,128,0.12)" : entry.type === "suspend" ? "rgba(248,113,113,0.1)" : "rgba(96,165,250,0.1)",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              {entry.type === "create" ? <Plus size={13} color="var(--status-ok)" /> : entry.type === "suspend" ? <Lock size={13} color="var(--status-critical)" /> : <Shield size={13} color="var(--accent-blue)" />}
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-primary)" }}>{entry.action}</div>
              <div style={{ fontSize: 10, color: "var(--text-muted)" }}>{entry.target} · {entry.time}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function AdminFarmsScreen() {
  const [filter, setFilter] = useState("All");
  const [showOnboard, setShowOnboard] = useState(false);
  const filtered = filter === "All" ? FARMS : FARMS.filter(f => f.status === filter || (filter === "Pro" && f.plan === "Pro") || (filter === "Basic" && f.plan === "Basic"));

  return (
    <div className="screen-content">
      <TopNav title="Farms" subtitle={`${FARMS.length} registered`}
        rightEl={<button className="btn-fab" style={{ width: 36, height: 36, borderRadius: 10 }} onClick={() => setShowOnboard(true)}><Plus size={16} /></button>}
      />

      <div className="px-screen" style={{ paddingTop: 12 }}>
        <div className="chip-row" style={{ marginBottom: 12 }}>
          {["All","active","suspended","trial","Pro","Basic"].map((f) => (
            <button key={f} onClick={() => setFilter(f)} className={`filter-chip ${filter === f ? "active" : ""}`} style={{ textTransform: "capitalize" }}>{f}</button>
          ))}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 80 }}>
          {filtered.map((farm) => (
            <div key={farm.id} className="farm-card" style={{ padding: 14 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text-primary)" }}>{farm.name}</div>
                  <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 1 }}>{farm.owner}</div>
                </div>
                <div style={{ display: "flex", gap: 4 }}>
                  <span className={`chip ${farm.plan === "Pro" ? "chip-ok" : farm.plan === "Basic" ? "chip-info" : "chip-warning"}`} style={{ fontSize: 9 }}>{farm.plan}</span>
                  <span className={`chip ${farm.status === "active" ? "chip-ok" : farm.status === "suspended" ? "chip-critical" : "chip-warning"}`} style={{ fontSize: 9 }}>{farm.status.toUpperCase()}</span>
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 6, marginBottom: 10 }}>
                {[["Users", farm.users], ["Batches", farm.batches], ["Animals", farm.animals.toLocaleString()], ["Revenue", `${(farm.revenue / 1000).toFixed(0)}K`]].map(([k, v]) => (
                  <div key={k as string} style={{ textAlign: "center" }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text-primary)" }}>{v as string | number}</div>
                    <div style={{ fontSize: 9, color: "var(--text-muted)", fontWeight: 600 }}>{k as string}</div>
                  </div>
                ))}
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                <button style={{ flex: 1, padding: "7px", borderRadius: 8, fontSize: 11, fontWeight: 600, background: "var(--surface)", border: "1px solid var(--border-subtle)", color: "var(--text-secondary)", cursor: "pointer" }}>View</button>
                {farm.status === "active" ? (
                  <button style={{ flex: 1, padding: "7px", borderRadius: 8, fontSize: 11, fontWeight: 600, background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.25)", color: "var(--status-critical)", cursor: "pointer" }}>Suspend</button>
                ) : farm.status === "suspended" ? (
                  <button style={{ flex: 1, padding: "7px", borderRadius: 8, fontSize: 11, fontWeight: 600, background: "rgba(74,222,128,0.08)", border: "1px solid rgba(74,222,128,0.25)", color: "var(--status-ok)", cursor: "pointer" }}>Reactivate</button>
                ) : null}
                <button style={{ padding: "7px 10px", borderRadius: 8, fontSize: 11, background: "var(--surface)", border: "1px solid var(--border-subtle)", color: "var(--text-muted)", cursor: "pointer" }}>⚙</button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Onboard modal */}
      {showOnboard && (
        <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.75)", display: "flex", alignItems: "flex-end", zIndex: 100 }} onClick={() => setShowOnboard(false)}>
          <div style={{ background: "var(--surface)", borderRadius: "24px 24px 0 0", padding: 20, width: "100%", border: "1px solid var(--border-subtle)" }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 14 }}>
              <div style={{ fontWeight: 700, fontSize: 16 }}>Onboard New Farm</div>
              <button className="btn-icon" onClick={() => setShowOnboard(false)}><X size={16} /></button>
            </div>
            {[["Farm Name","text","e.g. Nakuru Poultry Ltd"],["Owner Full Name","text","e.g. James Mwangi"],["Owner Email","email","owner@farm.com"],["Owner Phone","tel","+254-7xx"],["Temp Password","password","Min 8 chars"]].map(([l, t, p]) => (
              <div key={l as string} style={{ marginBottom: 10 }}>
                <label style={{ fontSize: 11, fontWeight: 700, color: "var(--text-secondary)", display: "block", marginBottom: 5 }}>{l as string}</label>
                <input className="farm-input" type={t as string} placeholder={p as string} />
              </div>
            ))}
            <div style={{ marginBottom: 14 }}>
              <label style={{ fontSize: 11, fontWeight: 700, color: "var(--text-secondary)", display: "block", marginBottom: 5 }}>Plan</label>
              <select className="farm-input"><option>Trial (14 days)</option><option>Basic</option><option>Pro</option></select>
            </div>
            <button className="btn-primary" style={{ width: "100%", justifyContent: "center" }} onClick={() => setShowOnboard(false)}>
              <Plus size={14} /> Onboard Farm
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function AdminSettingsScreen() {
  return (
    <div className="screen-content px-screen" style={{ paddingTop: 16 }}>
      <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 14 }}>Platform Config</div>

      <div className="section-eyebrow" style={{ marginBottom: 8 }}>Branding</div>
      <div className="farm-card" style={{ padding: 14, marginBottom: 14 }}>
        {[["App Name","IFMS – Integrated Farm"],["Tagline","Smarter farming, bigger yields"],["Support Email","support@ifms.app"]].map(([k, v]) => (
          <div key={k as string} style={{ marginBottom: 10 }}>
            <label style={{ fontSize: 11, fontWeight: 700, color: "var(--text-secondary)", display: "block", marginBottom: 4 }}>{k as string}</label>
            <input className="farm-input" defaultValue={v as string} style={{ fontSize: 13 }} />
          </div>
        ))}
      </div>

      <div className="section-eyebrow" style={{ marginBottom: 8 }}>Plan Features</div>
      <div className="farm-card" style={{ overflow: "hidden", marginBottom: 14 }}>
        {[
          { plan: "Trial", features: ["Basic farm management", "5 batches", "1 user"], color: "var(--accent-amber)" },
          { plan: "Basic", features: ["Unlimited batches", "5 users", "Reports", "Inventory"], color: "var(--accent-blue)" },
          { plan: "Pro", features: ["Everything in Basic", "Payroll", "GL Accounts", "Multi-farm", "API access"], color: "var(--primary-green)" },
        ].map((p, i, arr) => (
          <div key={p.plan} style={{ padding: "12px 14px", borderBottom: i < arr.length - 1 ? "1px solid var(--border-subtle)" : "none" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
              <span style={{ fontWeight: 700, fontSize: 13, color: p.color }}>{p.plan}</span>
              <button style={{ fontSize: 10, fontWeight: 700, padding: "3px 10px", borderRadius: 100, background: "var(--surface)", border: "1px solid var(--border-subtle)", color: "var(--text-muted)", cursor: "pointer" }}>Edit Features</button>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
              {p.features.map((f) => <span key={f} style={{ fontSize: 10, padding: "2px 7px", background: "rgba(255,255,255,0.05)", borderRadius: 100, color: "var(--text-secondary)" }}>{f}</span>)}
            </div>
          </div>
        ))}
      </div>

      <button className="btn-primary" style={{ width: "100%", justifyContent: "center", marginBottom: 20 }}>Save Platform Config</button>
    </div>
  );
}
