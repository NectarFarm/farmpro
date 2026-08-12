"use client";
import React, { useState } from "react";
import { useNav, TopNav } from "./navigation";
import { Check, X, ChevronDown, ChevronUp, Eye, EyeOff, Edit2, RefreshCw } from "./icons";

/* ── Module and label definitions ── */
interface ModuleConfig {
  id: string;
  defaultLabel: string;
  icon: string;
  enabled: boolean;
  customLabel?: string;
  description: string;
}

const DEFAULT_MODULES: ModuleConfig[] = [
  { id: "dashboard", defaultLabel: "Dashboard", icon: "🏠", enabled: true, description: "Main farm overview screen" },
  { id: "crops", defaultLabel: "Farm / Batches", icon: "🌿", enabled: true, description: "Enterprise batches and livestock/crop management" },
  { id: "tasks", defaultLabel: "Tasks", icon: "✅", enabled: true, description: "Daily task assignment and completion" },
  { id: "inventory", defaultLabel: "Inventory / Stock", icon: "📦", enabled: true, description: "Feed, supplies, and stock management" },
  { id: "finance", defaultLabel: "Finance", icon: "💰", enabled: true, description: "P&L, expenses, sales and GL accounts" },
  { id: "people", defaultLabel: "People / HR", icon: "👥", enabled: true, description: "Employee management and payroll" },
  { id: "governance", defaultLabel: "Governance", icon: "🛡️", enabled: true, description: "Approvals, roles and audit log" },
  { id: "reports", defaultLabel: "Reports", icon: "📊", enabled: true, description: "Analytics, exports and auditor links" },
  { id: "weather", defaultLabel: "Weather & IoT", icon: "🌤️", enabled: true, description: "Forecast, sensors and farm advisories" },
  { id: "ai-chat", defaultLabel: "AI Assistant", icon: "🤖", enabled: true, description: "AI-powered farm advisor chatbot" },
];

interface FarmBranding {
  farmCode: string;
  farmName: string;
  accentColor: string;
  logoEmoji: string;
  dashboardGreeting: string;
  currencySymbol: string;
  weightUnit: string;
}

const DEFAULT_BRANDINGS: FarmBranding[] = [
  {
    farmCode: "FRM-KMU-001", farmName: "Nakuru Main Farm",
    accentColor: "#4ade80", logoEmoji: "🌾",
    dashboardGreeting: "Good morning, James!",
    currencySymbol: "KSh", weightUnit: "kg",
  },
  {
    farmCode: "FRM-KMU-002", farmName: "Eldoret Satellite Farm",
    accentColor: "#60a5fa", logoEmoji: "🐐",
    dashboardGreeting: "Good morning!",
    currencySymbol: "KSh", weightUnit: "kg",
  },
];

const ACCENT_OPTIONS = [
  "#4ade80", "#60a5fa", "#f59e0b", "#a855f7", "#22d3ee", "#f87171", "#fb923c", "#34d399",
];

export function UICustomiseScreen() {
  const [tab, setTab] = useState<"modules" | "labels" | "branding">("modules");
  const [modules, setModules] = useState<ModuleConfig[]>(DEFAULT_MODULES);
  const [brandings, setBrandings] = useState<FarmBranding[]>(DEFAULT_BRANDINGS);
  const [selectedFarm, setSelectedFarm] = useState("FRM-KMU-001");
  const [editingModule, setEditingModule] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState("");
  const [saved, setSaved] = useState(false);

  const branding = brandings.find((b) => b.farmCode === selectedFarm)!;

  function toggleModule(id: string) {
    setModules((ms) => ms.map((m) => m.id === id ? { ...m, enabled: !m.enabled } : m));
  }

  function saveLabel(id: string) {
    setModules((ms) => ms.map((m) => m.id === id ? { ...m, customLabel: editLabel || undefined } : m));
    setEditingModule(null);
  }

  function updateBranding(key: keyof FarmBranding, value: string) {
    setBrandings((bs) => bs.map((b) => b.farmCode === selectedFarm ? { ...b, [key]: value } : b));
  }

  function handleSave() {
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <div className="screen-content">
      <TopNav title="UI Customise" subtitle="Modules, labels & branding" />

      <div className="px-screen" style={{ paddingTop: 12 }}>
        {/* Farm selector */}
        <div style={{ marginBottom: 14 }}>
          <label style={{ fontSize: 11, fontWeight: 700, color: "var(--text-secondary)", display: "block", marginBottom: 5 }}>Customising Farm</label>
          <select
            className="farm-input"
            value={selectedFarm}
            onChange={(e) => setSelectedFarm(e.target.value)}
          >
            {DEFAULT_BRANDINGS.map((b) => (
              <option key={b.farmCode} value={b.farmCode}>{b.farmName}</option>
            ))}
          </select>
        </div>

        {/* Tabs */}
        <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
          {[["modules", "Modules"], ["labels", "Labels"], ["branding", "Branding"]].map(([id, label]) => (
            <button
              key={id}
              onClick={() => setTab(id as typeof tab)}
              style={{
                flex: 1, padding: "8px", borderRadius: 10, fontSize: 11, fontWeight: 700, cursor: "pointer",
                background: tab === id ? "rgba(74,222,128,0.15)" : "var(--card)",
                border: tab === id ? "1px solid rgba(74,222,128,0.4)" : "1px solid var(--border-subtle)",
                color: tab === id ? "var(--primary-green)" : "var(--text-muted)",
              }}
            >
              {label}
            </button>
          ))}
        </div>

        {/* ── MODULES TAB ── */}
        {tab === "modules" && (
          <div style={{ paddingBottom: 80 }}>
            <div style={{ padding: "10px 14px", background: "rgba(168,85,247,0.08)", borderRadius: 12, marginBottom: 14, border: "1px solid rgba(168,85,247,0.2)", fontSize: 11, color: "var(--text-muted)", lineHeight: 1.5 }}>
              Toggle which modules are visible in the app for this farm. Disabled modules are hidden from all users on this farm.
            </div>
            {modules.map((m) => (
              <div
                key={m.id}
                style={{
                  marginBottom: 8, padding: "12px 14px", borderRadius: 12,
                  background: m.enabled ? "var(--card)" : "rgba(255,255,255,0.02)",
                  border: m.enabled ? "1px solid var(--border-subtle)" : "1px solid rgba(255,255,255,0.05)",
                  display: "flex", justifyContent: "space-between", alignItems: "center",
                }}
              >
                <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                  <span style={{ fontSize: 20, opacity: m.enabled ? 1 : 0.4 }}>{m.icon}</span>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: m.enabled ? "var(--text-primary)" : "var(--text-muted)" }}>
                      {m.customLabel ?? m.defaultLabel}
                    </div>
                    <div style={{ fontSize: 10, color: "var(--text-dim)", marginTop: 1 }}>{m.description}</div>
                  </div>
                </div>
                <button
                  onClick={() => toggleModule(m.id)}
                  style={{
                    width: 44, height: 24, borderRadius: 100, cursor: "pointer", border: "none",
                    background: m.enabled ? "var(--primary-green)" : "var(--border-subtle)",
                    position: "relative", flexShrink: 0, transition: "background 0.2s",
                  }}
                >
                  <div style={{
                    position: "absolute", top: 2, left: m.enabled ? 22 : 2,
                    width: 20, height: 20, borderRadius: "50%", background: "white",
                    transition: "left 0.15s",
                  }} />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* ── LABELS TAB ── */}
        {tab === "labels" && (
          <div style={{ paddingBottom: 80 }}>
            <div style={{ padding: "10px 14px", background: "rgba(96,165,250,0.08)", borderRadius: 12, marginBottom: 14, border: "1px solid rgba(96,165,250,0.2)", fontSize: 11, color: "var(--text-muted)", lineHeight: 1.5 }}>
              Rename module labels to match your farm's terminology. Leave blank to use the default label.
            </div>
            {modules.map((m) => (
              <div key={m.id} style={{ marginBottom: 10 }}>
                {editingModule === m.id ? (
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <span style={{ fontSize: 18, flexShrink: 0 }}>{m.icon}</span>
                    <input
                      className="farm-input"
                      style={{ flex: 1 }}
                      value={editLabel}
                      onChange={(e) => setEditLabel(e.target.value)}
                      placeholder={m.defaultLabel}
                      autoFocus
                    />
                    <button onClick={() => saveLabel(m.id)} style={{ padding: "8px 12px", borderRadius: 8, background: "rgba(74,222,128,0.15)", border: "1px solid rgba(74,222,128,0.35)", color: "var(--status-ok)", cursor: "pointer", fontWeight: 700, fontSize: 12, display: "flex", alignItems: "center", gap: 4 }}>
                      <Check size={12} /> Save
                    </button>
                    <button onClick={() => setEditingModule(null)} style={{ padding: "8px", borderRadius: 8, background: "var(--card)", border: "1px solid var(--border-subtle)", color: "var(--text-muted)", cursor: "pointer" }}>
                      <X size={12} />
                    </button>
                  </div>
                ) : (
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 14px", background: "var(--card)", borderRadius: 12, border: "1px solid var(--border-subtle)" }}>
                    <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                      <span style={{ fontSize: 18 }}>{m.icon}</span>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text-primary)" }}>
                          {m.customLabel ?? m.defaultLabel}
                          {m.customLabel && (
                            <span style={{ fontSize: 10, color: "var(--accent-amber)", marginLeft: 6, fontWeight: 600 }}>Custom</span>
                          )}
                        </div>
                        {m.customLabel && (
                          <div style={{ fontSize: 10, color: "var(--text-dim)", marginTop: 1 }}>Default: {m.defaultLabel}</div>
                        )}
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 6 }}>
                      {m.customLabel && (
                        <button
                          onClick={() => setModules((ms) => ms.map((x) => x.id === m.id ? { ...x, customLabel: undefined } : x))}
                          style={{ padding: "5px 8px", borderRadius: 8, background: "var(--surface)", border: "1px solid var(--border-subtle)", color: "var(--text-muted)", cursor: "pointer", fontSize: 10 }}
                        >
                          <RefreshCw size={10} />
                        </button>
                      )}
                      <button
                        onClick={() => { setEditingModule(m.id); setEditLabel(m.customLabel ?? ""); }}
                        style={{ padding: "5px 10px", borderRadius: 8, background: "var(--surface)", border: "1px solid var(--border-subtle)", color: "var(--text-muted)", cursor: "pointer", fontSize: 11, display: "flex", alignItems: "center", gap: 4 }}
                      >
                        <Edit2 size={11} /> Edit
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* ── BRANDING TAB ── */}
        {tab === "branding" && (
          <div style={{ paddingBottom: 80 }}>
            {/* Preview card */}
            <div style={{
              marginBottom: 16, padding: 16, borderRadius: 16,
              background: `linear-gradient(135deg, ${branding.accentColor}22, ${branding.accentColor}08)`,
              border: `1px solid ${branding.accentColor}40`,
            }}>
              <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 6 }}>
                <span style={{ fontSize: 28 }}>{branding.logoEmoji}</span>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 800, color: "var(--text-primary)" }}>{branding.farmName}</div>
                  <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{branding.dashboardGreeting}</div>
                </div>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <span style={{ fontSize: 12, fontWeight: 700, padding: "3px 10px", borderRadius: 100, background: branding.accentColor + "33", color: branding.accentColor, border: `1px solid ${branding.accentColor}60` }}>
                  Live Preview
                </span>
                <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{branding.currencySymbol} · {branding.weightUnit}</span>
              </div>
            </div>

            {/* Fields */}
            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 11, fontWeight: 700, color: "var(--text-secondary)", display: "block", marginBottom: 5 }}>Dashboard Greeting</label>
              <input className="farm-input" value={branding.dashboardGreeting} onChange={(e) => updateBranding("dashboardGreeting", e.target.value)} />
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
              <div>
                <label style={{ fontSize: 11, fontWeight: 700, color: "var(--text-secondary)", display: "block", marginBottom: 5 }}>Currency Symbol</label>
                <select className="farm-input" value={branding.currencySymbol} onChange={(e) => updateBranding("currencySymbol", e.target.value)}>
                  {["KSh", "UGX", "TZS", "USD", "EUR", "ZAR", "NGN"].map((c) => <option key={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label style={{ fontSize: 11, fontWeight: 700, color: "var(--text-secondary)", display: "block", marginBottom: 5 }}>Weight Unit</label>
                <select className="farm-input" value={branding.weightUnit} onChange={(e) => updateBranding("weightUnit", e.target.value)}>
                  {["kg", "lbs", "tonnes"].map((u) => <option key={u}>{u}</option>)}
                </select>
              </div>
            </div>

            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 11, fontWeight: 700, color: "var(--text-secondary)", display: "block", marginBottom: 5 }}>Farm Logo Emoji</label>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {["🌾", "🐔", "🐄", "🐷", "🐐", "🌽", "🥦", "🍎", "🐠", "🌿", "🏡", "⚡"].map((e) => (
                  <button
                    key={e}
                    onClick={() => updateBranding("logoEmoji", e)}
                    style={{
                      width: 38, height: 38, borderRadius: 10, fontSize: 20, cursor: "pointer",
                      background: branding.logoEmoji === e ? "rgba(74,222,128,0.15)" : "var(--card)",
                      border: branding.logoEmoji === e ? "1px solid rgba(74,222,128,0.4)" : "1px solid var(--border-subtle)",
                    }}
                  >
                    {e}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ marginBottom: 20 }}>
              <label style={{ fontSize: 11, fontWeight: 700, color: "var(--text-secondary)", display: "block", marginBottom: 8 }}>Accent Colour</label>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {ACCENT_OPTIONS.map((c) => (
                  <button
                    key={c}
                    onClick={() => updateBranding("accentColor", c)}
                    style={{
                      width: 32, height: 32, borderRadius: "50%", background: c, border: branding.accentColor === c ? "3px solid white" : "2px solid transparent",
                      outline: branding.accentColor === c ? `2px solid ${c}` : "none", cursor: "pointer",
                    }}
                  />
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Save button */}
        <div style={{ position: "sticky", bottom: 80, paddingBottom: 12 }}>
          <button
            className="btn-primary"
            style={{ width: "100%", justifyContent: "center" }}
            onClick={handleSave}
          >
            {saved ? <><Check size={14} /> Saved!</> : <>Save Customisation</>}
          </button>
        </div>
      </div>
    </div>
  );
}
