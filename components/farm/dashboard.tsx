// ============================================================
// dashboard.tsx — Role-aware dashboard + Notifications + NotificationSettings
// Data flow:
//   DashboardScreen reads BATCHES_DATA filtered by activeFarm (from NavProvider)
//   Notification bell badge = NOTIFICATIONS_DATA.filter(!read).length
//   QuickActions navigate to relevant screens
//   activeFarm is the tenant farm code (farm switcher removed — issue #219)
// ============================================================
"use client";
import React, { useState } from "react";
import { useNav, TopNav } from "./navigation";
import { FARMS_DATA, BATCHES_DATA, ENTERPRISE_REGISTRY, NOTIFICATIONS_DATA, PRODUCTS_DATA, getCurrentPrice } from "./data";
import {
  TrendingUp, AlertTriangle, CheckCircle2, Leaf, CloudRain,
  Droplets, Activity, Package, Users, ChevronRight, Bell, ArrowUp,
  Clock, Building2, Settings,
} from "./icons";

const PROD_BARS = [
  { day: "Mon", v: 820 }, { day: "Tue", v: 855 }, { day: "Wed", v: 790 },
  { day: "Thu", v: 900 }, { day: "Fri", v: 870 }, { day: "Sat", v: 830 }, { day: "Sun", v: 760 },
];
const maxV = Math.max(...PROD_BARS.map((b) => b.v));

/* ── Farm switcher (removed — issue #219) ──
 * One tenant = one farm in the real schema, so "switch farm" does not apply and
 * the switcher UI has been removed. activeFarm is the tenant's farm code only.
 */

/* ── Dashboard Screen ── */
export function DashboardScreen() {
  const { navigate, role, activeFarm } = useNav();
  const [period, setPeriod] = useState<"month" | "quarter" | "year">("month");

  const farm = FARMS_DATA.find(f => f.code === activeFarm) ?? FARMS_DATA[0];
  const farmBatches = BATCHES_DATA.filter(b => b.farmCode === activeFarm);
  const activeBatches = farmBatches.filter(b => b.status === "ACTIVE").length;

  // Enterprise summary cards
  const enterpriseMap = new Map<string, { count: number; qty: number; emoji: string; label: string; type: string }>();
  farmBatches.filter(b => b.status === "ACTIVE").forEach(b => {
    const cfg = ENTERPRISE_REGISTRY.find(e => e.subtype === b.enterprise);
    if (!cfg) return;
    const existing = enterpriseMap.get(b.enterprise);
    if (existing) { existing.count++; existing.qty += b.qty; }
    else enterpriseMap.set(b.enterprise, { count: 1, qty: b.qty, emoji: cfg.emoji, label: cfg.label, type: cfg.type });
  });
  const enterprises = [...enterpriseMap.entries()];
  const livestock = enterprises.filter(([, v]) => v.type === "livestock");
  const crops = enterprises.filter(([, v]) => v.type === "crop");

  const revenue = period === "month" ? "KSh 184,200" : period === "quarter" ? "KSh 542,800" : "KSh 2.1M";
  const margin = period === "month" ? "34%" : period === "quarter" ? "31%" : "33%";
  const unread = NOTIFICATIONS_DATA.filter(n => !n.read).length;
  const pendingApprovals = 2;

  // Quick actions vary by role
  const quickActions = [
    { label: "Add Task", screen: "tasks" as const, emoji: "✅", roles: ["owner","manager"] },
    { label: "Record Sale", screen: "finance" as const, emoji: "💰", roles: ["owner"] },
    { label: "Add Stock", screen: "inventory" as const, emoji: "📦", roles: ["owner","manager"] },
    { label: "AI Chat", screen: "ai-chat" as const, emoji: "🤖", roles: ["owner","manager","worker"] },
    { label: "Approvals", screen: "governance" as const, emoji: "🛡️", roles: ["owner"] },
    { label: "People", screen: "people" as const, emoji: "👥", roles: ["owner","manager"] },
  ].filter(a => a.roles.includes(role));

  return (
    <div className="screen-content px-screen" style={{ paddingTop: 16 }}>
      {/* Greeting + bell */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 12, color: "var(--text-muted)" }}>Good morning,</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: "var(--text-primary)", lineHeight: 1.2 }}>James Kamau 🌾</div>
          <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2, textTransform: "capitalize" }}>
            {role === "owner" ? "Farm Owner" : role === "manager" ? "Farm Manager" : role === "worker" ? "Farm Worker" : role === "super_admin" ? "Platform Admin" : "Staff"}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button onClick={() => navigate("notifications")} style={{ position: "relative", background: "var(--card)", border: "1px solid var(--border-subtle)", borderRadius: 12, width: 40, height: 40, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
            <Bell size={17} />
            {unread > 0 && <span style={{ position: "absolute", top: 6, right: 6, width: 10, height: 10, borderRadius: "50%", background: "var(--status-critical)", fontSize: 7, fontWeight: 700, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center" }}>{unread}</span>}
          </button>
          <button onClick={() => navigate("settings")} style={{ background: "var(--card)", border: "1px solid var(--border-subtle)", borderRadius: 12, width: 40, height: 40, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
            <Settings size={16} color="var(--text-muted)" />
          </button>
        </div>
      </div>

      {/* Farm badge — display only (one tenant = one farm; switcher removed, issue #219) */}
      {(role === "owner" || role === "manager") && (
        <div style={{ marginBottom: 14, display: "flex", alignItems: "center", gap: 8, padding: "9px 12px", background: "var(--card)", border: "1px solid rgba(74,222,128,0.25)", borderRadius: 12, width: "100%" }}>
          <span style={{ fontSize: 18 }}>🌾</span>
          <div style={{ flex: 1, textAlign: "left" }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-primary)" }}>{farm?.name ?? "This Farm"}</div>
            <div style={{ fontSize: 10, color: "var(--text-muted)" }}>{farm?.code} · {farm?.location}</div>
          </div>
        </div>
      )}

      {/* Active alert strip */}
      {NOTIFICATIONS_DATA.filter(n => !n.read && n.type === "alert").slice(0, 1).map(a => (
        <button key={a.id} onClick={() => navigate("notifications")}
          style={{ width: "100%", marginBottom: 14, padding: "10px 12px", background: "rgba(248,113,113,0.07)", border: "1px solid rgba(248,113,113,0.3)", borderRadius: 12, display: "flex", alignItems: "center", gap: 8, cursor: "pointer", textAlign: "left" }}>
          <AlertTriangle size={14} color="var(--status-critical)" style={{ flexShrink: 0 }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "var(--status-critical)" }}>{a.title}</div>
            <div style={{ fontSize: 11, color: "var(--text-secondary)", marginTop: 1 }}>{a.body}</div>
          </div>
          <ChevronRight size={12} color="var(--text-muted)" />
        </button>
      ))}

      {/* KPI strip */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 14 }}>
        {[
          { label: "Active Batches", value: activeBatches, icon: Leaf, color: "var(--primary-green)", delta: "+2", action: "crops" as const },
          { label: "Pending Approvals", value: pendingApprovals, icon: CheckCircle2, color: "var(--status-warning)", delta: "→ Review", action: "governance" as const },
          { label: "Livestock Units", value: livestock.length, icon: Activity, color: "var(--accent-blue)", delta: `${livestock.reduce((s,[,v])=>s+v.qty,0)}`, action: "crops" as const },
          { label: "Crop Batches", value: crops.length, icon: Package, color: "var(--accent-amber)", delta: `${crops.length} active`, action: "crops" as const },
        ].map((k) => {
          const Icon = k.icon;
          return (
            <button key={k.label} className="farm-card" style={{ padding: 12, textAlign: "left", cursor: "pointer", width: "100%" }} onClick={() => navigate(k.action)}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 }}>
                <Icon size={16} color={k.color} />
                <span style={{ fontSize: 9, color: "var(--text-muted)", fontWeight: 600 }}>{k.delta}</span>
              </div>
              <div style={{ fontSize: 22, fontWeight: 700, color: k.color }}>{k.value}</div>
              <div className="kpi-label" style={{ marginTop: 2 }}>{k.label}</div>
            </button>
          );
        })}
      </div>

      {/* Revenue chart — owner/manager only */}
      {(role === "owner" || role === "manager") && (
        <button onClick={() => navigate("finance")} className="farm-card farm-card-active" style={{ padding: 14, marginBottom: 14, width: "100%", textAlign: "left", cursor: "pointer" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <div className="section-eyebrow">Revenue</div>
            <div style={{ display: "flex", gap: 3 }}>
              {(["month","quarter","year"] as const).map(p => (
                <button key={p} onClick={e => { e.stopPropagation(); setPeriod(p); }}
                  style={{ padding: "2px 8px", borderRadius: 100, fontSize: 9, fontWeight: 700, cursor: "pointer",
                    background: period === p ? "rgba(74,222,128,0.2)" : "transparent",
                    border: period === p ? "1px solid rgba(74,222,128,0.4)" : "1px solid transparent",
                    color: period === p ? "var(--primary-green)" : "var(--text-muted)", textTransform: "capitalize" }}>{p}</button>
              ))}
            </div>
          </div>
          <div style={{ display: "flex", gap: 20, alignItems: "flex-end", marginBottom: 12 }}>
            <div><div className="kpi-value">{revenue}</div><div className="kpi-label" style={{ marginTop: 2 }}>Revenue</div></div>
            <div><div style={{ fontSize: 22, fontWeight: 700, color: "var(--status-ok)" }}>{margin}</div><div className="kpi-label" style={{ marginTop: 2 }}>Margin</div></div>
          </div>
          <div style={{ display: "flex", gap: 3, alignItems: "flex-end", height: 44 }}>
            {PROD_BARS.map((b, i) => (
              <div key={b.day} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
                <div style={{ width: "100%", borderRadius: 3, height: Math.round((b.v / maxV) * 36), background: i === 6 ? "var(--gradient-primary)" : "rgba(74,222,128,0.22)", transition: "height 0.3s" }} />
                <div style={{ fontSize: 8, color: "var(--text-dim)", fontWeight: 600 }}>{b.day[0]}</div>
              </div>
            ))}
          </div>
        </button>
      )}

      {/* Product prices strip — owner only */}
      {role === "owner" && (
        <div style={{ marginBottom: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
            <div className="section-eyebrow">📦 Current Product Prices</div>
            <button onClick={() => navigate("finance")} style={{ fontSize: 11, color: "var(--primary-green)", fontWeight: 600, background: "none", border: "none", cursor: "pointer" }}>Manage ›</button>
          </div>
          <div style={{ display: "flex", gap: 8, overflowX: "auto", scrollbarWidth: "none", paddingBottom: 4 }}>
            {PRODUCTS_DATA.filter(p => p.farmCode === "FRM-KMU-001").map(p => {
              const price = getCurrentPrice(p);
              return price ? (
                <button key={p.id} onClick={() => navigate("finance")}
                  style={{ flexShrink: 0, padding: "9px 12px", background: "var(--card)", border: "1px solid var(--border-subtle)", borderRadius: 12, textAlign: "left", cursor: "pointer", minWidth: 90 }}>
                  <div style={{ fontSize: 18, marginBottom: 4 }}>{p.emoji}</div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-primary)" }}>KSh {price.price}</div>
                  <div style={{ fontSize: 9, color: "var(--text-muted)", marginTop: 1 }}>/{price.unit}</div>
                </button>
              ) : null;
            })}
          </div>
        </div>
      )}

      {/* Livestock enterprise cards */}
      {livestock.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
            <div className="section-eyebrow">🐄 Livestock</div>
            <button onClick={() => navigate("crops")} style={{ fontSize: 11, color: "var(--primary-green)", fontWeight: 600, background: "none", border: "none", cursor: "pointer" }}>View all ›</button>
          </div>
          <div style={{ display: "flex", gap: 8, overflowX: "auto", scrollbarWidth: "none", paddingBottom: 4 }}>
            {livestock.map(([key, v]) => (
              <button key={key} onClick={() => navigate("crops")} style={{ flexShrink: 0, minWidth: 100, padding: "10px 12px", background: "var(--card)", border: "1px solid var(--border-subtle)", borderRadius: 14, textAlign: "left", cursor: "pointer" }}>
                <div style={{ fontSize: 24, marginBottom: 4 }}>{v.emoji}</div>
                <div style={{ fontWeight: 700, fontSize: 12 }}>{v.label}</div>
                <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 1 }}>{v.count} batch{v.count > 1 ? "es" : ""}</div>
                <div style={{ fontSize: 10, color: "var(--primary-green)", fontWeight: 700, marginTop: 1 }}>{v.qty.toLocaleString()} units</div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Crop cards */}
      {crops.length > 0 && (
        <div style={{ marginBottom: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
            <div className="section-eyebrow">🌱 Crops & Produce</div>
            <button onClick={() => navigate("crops")} style={{ fontSize: 11, color: "var(--primary-green)", fontWeight: 600, background: "none", border: "none", cursor: "pointer" }}>View all ›</button>
          </div>
          <div style={{ display: "flex", gap: 8, overflowX: "auto", scrollbarWidth: "none", paddingBottom: 4 }}>
            {crops.map(([key, v]) => (
              <button key={key} onClick={() => navigate("crops")} style={{ flexShrink: 0, minWidth: 90, padding: "10px 12px", background: "var(--card)", border: "1px solid var(--border-subtle)", borderRadius: 14, textAlign: "left", cursor: "pointer" }}>
                <div style={{ fontSize: 24, marginBottom: 4 }}>{v.emoji}</div>
                <div style={{ fontWeight: 700, fontSize: 12 }}>{v.label}</div>
                <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 1 }}>{v.count} plot{v.count > 1 ? "s" : ""}</div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Today's tasks */}
      <div style={{ marginBottom: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
          <div className="section-eyebrow">Tasks Today</div>
          <button onClick={() => navigate("tasks")} style={{ fontSize: 11, color: "var(--primary-green)", fontWeight: 600, background: "none", border: "none", cursor: "pointer" }}>All tasks ›</button>
        </div>
        <div className="farm-card" style={{ overflow: "hidden" }}>
          {[
            { code: "TSK-KMU-0081", title: "Egg Collection – Pen B01", due: "07:30", done: false, overdue: false },
            { code: "TSK-KMU-0082", title: "BRO Feeding – House A01", due: "08:00", done: false, overdue: true },
            { code: "TSK-KMU-0083", title: "Milking – Morning Round", due: "06:00", done: true, overdue: false },
          ].map((t, i) => (
            <button key={t.code} onClick={() => navigate("tasks")}
              style={{ width: "100%", padding: "11px 14px", display: "flex", alignItems: "center", gap: 10, borderBottom: i < 2 ? "1px solid var(--border-subtle)" : "none", background: "none", border: i < 2 ? "none" : "none", borderTop: "none", borderLeft: "none", borderRight: "none", borderBottomColor: i < 2 ? "var(--border-subtle)" : "transparent", cursor: "pointer", textAlign: "left" }}>
              <div style={{ width: 20, height: 20, borderRadius: "50%",
                background: t.done ? "rgba(74,222,128,0.2)" : t.overdue ? "rgba(248,113,113,0.15)" : "var(--card)",
                border: `1px solid ${t.done ? "var(--primary-green)" : t.overdue ? "var(--status-critical)" : "var(--border-subtle)"}`,
                display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                {t.done && <CheckCircle2 size={12} color="var(--primary-green)" />}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: t.done ? "var(--text-muted)" : t.overdue ? "var(--status-critical)" : "var(--text-primary)", textDecoration: t.done ? "line-through" : "none" }}>{t.title}</div>
                <div style={{ fontSize: 10, color: "var(--text-dim)", fontFamily: "monospace" }}>{t.code}</div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 3 }}>
                <Clock size={10} color={t.overdue ? "var(--status-critical)" : "var(--text-muted)"} />
                <span style={{ fontSize: 10, color: t.overdue ? "var(--status-critical)" : "var(--text-muted)" }}>{t.due}</span>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Weather mini */}
      <button onClick={() => navigate("weather")} className="farm-card" style={{ padding: 14, width: "100%", textAlign: "left", marginBottom: 14, cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <div className="section-eyebrow" style={{ marginBottom: 4 }}>⛅ {farm?.location}</div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
            <span style={{ fontSize: 32, fontWeight: 200 }}>24°C</span>
            <span style={{ fontSize: 12, color: "var(--text-muted)" }}>Partly Cloudy</span>
          </div>
          <div style={{ display: "flex", gap: 10, marginTop: 6, fontSize: 11, color: "var(--text-muted)" }}>
            <span style={{ display: "flex", alignItems: "center", gap: 3 }}><Droplets size={11} color="var(--accent-blue)" />68%</span>
            <span style={{ display: "flex", alignItems: "center", gap: 3 }}><CloudRain size={11} color="var(--accent-blue)" />Rain Sat</span>
          </div>
        </div>
        <ChevronRight size={16} color="var(--text-dim)" />
      </button>

      {/* Quick actions */}
      <div style={{ marginBottom: 20 }}>
        <div className="section-eyebrow" style={{ marginBottom: 8 }}>Quick Actions</div>
        <div style={{ display: "grid", gridTemplateColumns: `repeat(${Math.min(quickActions.length, 4)}, 1fr)`, gap: 6 }}>
          {quickActions.map(a => (
            <button key={a.label} onClick={() => navigate(a.screen)}
              style={{ padding: "12px 4px", borderRadius: 12, background: "var(--card)", border: "1px solid var(--border-subtle)", cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: 5 }}>
              <span style={{ fontSize: 20 }}>{a.emoji}</span>
              <span style={{ fontSize: 9, fontWeight: 700, color: "var(--text-muted)", textAlign: "center", lineHeight: 1.3 }}>{a.label}</span>
            </button>
          ))}
        </div>
      </div>

    </div>
  );
}

/* ── Notifications Screen ── */
export function NotificationsScreen() {
  const { goBack, navigate } = useNav();
  const [notifs, setNotifs] = useState(NOTIFICATIONS_DATA);

  const typeIcon: Record<string, string> = { weather: "⛅", approval: "✅", task: "📋", alert: "⚠️", system: "🔔" };
  const typeColor: Record<string, string> = { weather: "var(--accent-blue)", approval: "var(--status-warning)", task: "var(--primary-green)", alert: "var(--status-critical)", system: "var(--text-muted)" };

  function markAllRead() {
    setNotifs(ns => ns.map(n => ({ ...n, read: true })));
  }

  function handleNotifTap(n: typeof notifs[0]) {
    setNotifs(ns => ns.map(x => x.id === n.id ? { ...x, read: true } : x));
    // Deep link based on source
    if (n.type === "approval" && n.sourceCode?.startsWith("APR")) navigate("governance");
    else if (n.type === "task" && n.sourceCode?.startsWith("TSK")) navigate("tasks");
    else if (n.type === "weather") navigate("weather");
    else if (n.type === "alert") navigate("inventory");
  }

  const unread = notifs.filter(n => !n.read).length;

  return (
    <div className="screen-content">
      <TopNav
        title="Notifications"
        showBack
        rightEl={
          <div style={{ display: "flex", gap: 8 }}>
            {unread > 0 && (
              <button onClick={markAllRead}
                style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)", background: "none", border: "none", cursor: "pointer" }}>
                Mark all read
              </button>
            )}
            <button onClick={() => navigate("notification-settings")}
              style={{ fontSize: 11, fontWeight: 700, color: "var(--primary-green)", background: "none", border: "none", cursor: "pointer" }}>
              Settings
            </button>
          </div>
        }
      />
      <div className="px-screen" style={{ paddingTop: 14 }}>
        {unread > 0 && (
          <div style={{ padding: "8px 12px", background: "rgba(74,222,128,0.06)", border: "1px solid rgba(74,222,128,0.15)", borderRadius: 10, fontSize: 11, color: "var(--primary-green)", marginBottom: 14, fontWeight: 600 }}>
            {unread} unread notification{unread > 1 ? "s" : ""}
          </div>
        )}
        {["Today", "Earlier"].map(group => {
          const items = group === "Today" ? notifs.slice(0, 4) : notifs.slice(4);
          if (!items.length) return null;
          return (
            <div key={group} style={{ marginBottom: 16 }}>
              <div className="section-eyebrow" style={{ marginBottom: 8 }}>{group}</div>
              {items.map((n) => (
                <button key={n.id} onClick={() => handleNotifTap(n)}
                  style={{ width: "100%", padding: 14, marginBottom: 8, borderRadius: 14, textAlign: "left", cursor: "pointer",
                    background: n.read ? "var(--card)" : "rgba(74,222,128,0.05)",
                    border: `1px solid ${n.read ? "var(--border-subtle)" : "rgba(74,222,128,0.2)"}` }}>
                  <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                    <div style={{ width: 32, height: 32, borderRadius: 10, background: `${typeColor[n.type]}15`, border: `1px solid ${typeColor[n.type]}30`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, fontSize: 16 }}>
                      {typeIcon[n.type]}
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                        <div style={{ fontSize: 13, fontWeight: n.read ? 500 : 700, color: "var(--text-primary)", lineHeight: 1.3, flex: 1 }}>{n.title}</div>
                        {!n.read && <div style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--primary-green)", flexShrink: 0, marginLeft: 8, marginTop: 4 }} />}
                      </div>
                      <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 3, lineHeight: 1.4 }}>{n.body}</div>
                      <div style={{ display: "flex", gap: 8, marginTop: 5, alignItems: "center" }}>
                        <span style={{ fontSize: 10, color: "var(--text-dim)" }}>{n.time}</span>
                        {n.farmCode && <span style={{ fontSize: 9, padding: "1px 6px", background: "rgba(74,222,128,0.08)", border: "1px solid rgba(74,222,128,0.15)", borderRadius: 100, color: "var(--primary-green)", fontWeight: 600 }}>{n.farmCode}</span>}
                        {n.sourceCode && <span style={{ fontSize: 9, color: "var(--text-dim)", fontFamily: "monospace" }}>{n.sourceCode}</span>}
                      </div>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          );
        })}
        <div style={{ paddingBottom: 80 }} />
      </div>
    </div>
  );
}

/* ── Notification Settings Screen ── */
const NOTIF_TYPES = [
  { id: "weather", label: "🌦️ Weather Alerts", desc: "Rainfall, temperature extremes, storms" },
  { id: "approval", label: "✅ Approval Requests", desc: "Worker submissions needing your review" },
  { id: "task", label: "📋 Task Reminders", desc: "Overdue tasks and upcoming deadlines" },
  { id: "alert", label: "⚠️ Stock & Farm Alerts", desc: "Low stock, health alerts, anomalies" },
  { id: "system", label: "🔔 System", desc: "Payroll reminders, subscription, updates" },
];

export function NotificationSettingsScreen() {
  const { goBack } = useNav();
  const [enabled, setEnabled] = useState<Record<string, boolean>>({ weather: true, approval: true, task: true, alert: true, system: false });
  const [sms, setSms] = useState<Record<string, boolean>>({ weather: false, approval: true, task: false, alert: true, system: false });
  const [quietStart, setQuietStart] = useState("22:00");
  const [quietEnd, setQuietEnd] = useState("06:00");
  const [quietEnabled, setQuietEnabled] = useState(true);

  return (
    <div className="screen-content">
      <TopNav title="Notification Settings" showBack subtitle="Per-type controls & SMS" />
      <div className="px-screen" style={{ paddingTop: 14 }}>
        <div style={{ marginBottom: 14 }}>
          <div className="section-eyebrow" style={{ marginBottom: 8 }}>Notification Types</div>
          <div className="farm-card" style={{ overflow: "hidden" }}>
            {NOTIF_TYPES.map((t, i) => (
              <div key={t.id} style={{ padding: "13px 14px", borderBottom: i < NOTIF_TYPES.length - 1 ? "1px solid var(--border-subtle)" : "none" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)" }}>{t.label}</div>
                    <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 1 }}>{t.desc}</div>
                  </div>
                  <button onClick={() => setEnabled(e => ({ ...e, [t.id]: !e[t.id] }))}
                    style={{ width: 44, height: 24, borderRadius: 100, border: "none", cursor: "pointer", flexShrink: 0, marginLeft: 10,
                      background: enabled[t.id] ? "var(--primary-green)" : "rgba(255,255,255,0.1)", position: "relative" }}>
                    <div style={{ width: 18, height: 18, borderRadius: "50%", background: "#fff", position: "absolute", top: 3, left: enabled[t.id] ? 23 : 3, transition: "left 0.2s" }} />
                  </button>
                </div>
                {enabled[t.id] && (
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 11, color: "var(--text-muted)" }}>SMS also</span>
                    <button onClick={() => setSms(s => ({ ...s, [t.id]: !s[t.id] }))}
                      style={{ width: 36, height: 20, borderRadius: 100, border: "none", cursor: "pointer",
                        background: sms[t.id] ? "rgba(96,165,250,0.6)" : "rgba(255,255,255,0.08)", position: "relative" }}>
                      <div style={{ width: 14, height: 14, borderRadius: "50%", background: "#fff", position: "absolute", top: 3, left: sms[t.id] ? 19 : 3, transition: "left 0.2s" }} />
                    </button>
                    <span style={{ fontSize: 10, color: sms[t.id] ? "var(--accent-blue)" : "var(--text-dim)", fontWeight: 600 }}>{sms[t.id] ? "ON" : "OFF"}</span>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        <div style={{ marginBottom: 16 }}>
          <div className="section-eyebrow" style={{ marginBottom: 8 }}>Quiet Hours</div>
          <div className="farm-card" style={{ padding: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)" }}>Enable Quiet Hours</div>
                <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 1 }}>Silence non-critical notifications overnight</div>
              </div>
              <button onClick={() => setQuietEnabled(q => !q)}
                style={{ width: 44, height: 24, borderRadius: 100, border: "none", cursor: "pointer", flexShrink: 0,
                  background: quietEnabled ? "var(--primary-green)" : "rgba(255,255,255,0.1)", position: "relative" }}>
                <div style={{ width: 18, height: 18, borderRadius: "50%", background: "#fff", position: "absolute", top: 3, left: quietEnabled ? 23 : 3, transition: "left 0.2s" }} />
              </button>
            </div>
            {quietEnabled && (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <div>
                  <label style={{ fontSize: 11, fontWeight: 700, color: "var(--text-secondary)", display: "block", marginBottom: 5 }}>From</label>
                  <input className="farm-input" type="time" value={quietStart} onChange={e => setQuietStart(e.target.value)} />
                </div>
                <div>
                  <label style={{ fontSize: 11, fontWeight: 700, color: "var(--text-secondary)", display: "block", marginBottom: 5 }}>Until</label>
                  <input className="farm-input" type="time" value={quietEnd} onChange={e => setQuietEnd(e.target.value)} />
                </div>
              </div>
            )}
          </div>
        </div>
        <div style={{ paddingBottom: 80 }} />
      </div>
    </div>
  );
}
