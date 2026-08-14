// ============================================================
// dashboard.tsx — Role-aware dashboard + Notifications + NotificationSettings
// Data flow (issue #228 rewire — replaces the old all-mock version):
//   KPI strip, product price strip, today's-tasks strip and the notification
//   bell/badge/list are now real data from GET /api/dashboard/kpis,
//   GET /api/products/current-prices, GET /api/tasks?due=today and
//   GET/PATCH /api/notifications respectively (see fetch effects below).
//   Batch/enterprise summary cards and the farm switcher below them are still
//   BATCHES_DATA-driven mock UI — there is no `batches` table yet
//   (Epic: Crops & Batches hasn't landed) and this issue didn't scope
//   rebuilding that screen, only the KPI/price/task/notification/weather
//   surfaces called out in issue #228.
//   QuickActions navigate to relevant screens.
//   FarmSwitcherSheet switches activeFarm (multi-farm, issue #219) → all screens re-filter.
// ============================================================
"use client";
import React, { useState, useEffect, useCallback } from "react";
import { useNav, TopNav } from "./navigation";
import { BATCHES_DATA, ENTERPRISE_REGISTRY } from "./data";
import {
  AlertTriangle, CheckCircle2, Package, ChevronRight, Bell,
  Clock, X, Check, Settings, Info,
} from "./icons";
import { apiClient } from "@/lib/request";

// ── Real backend shapes (issue #228) ────────────────────────────────────────
// KPI fields that are real today, computed from tables that exist on this
// branch (tasks/notifications/products). `activeBatches`/`mortalityPct`/
// `avgFCR`/`revenue` come back `null` from the API — no `batches`/`sales`
// table exists yet (Epic: Crops & Batches / Epic: Finance) — and are never
// rendered as fabricated numbers, only as an explicit "not yet tracked" note.
interface KpiData {
  activeTasksCount: number;
  overdueTasksCount: number;
  unreadNotifications: number;
  productCount: number;
  activeBatches: number | null;
  mortalityPct: number | null;
  avgFCR: number | null;
  revenue: number | null;
}
interface PriceRow { id: string; type: string; name: string; currentPrice: number }
interface TaskRow { id: string; title: string; dueAt: string | null; status: string }
interface NotificationRow {
  id: string;
  sourceType: string;
  sourceId: string | null;
  title: string;
  message: string;
  read: boolean;
  createdAt: string | null;
}

/* ── Farm Switcher Sheet ──
 * Multi-farm is a first-class feature (issue #219): an owner/manager with several
 * farms under their tenant switches between them here, and every screen re-filters
 * to the selected farm (or the "All Farms" aggregate view). Farms come from the
 * real GET /api/farms when the backend is wired, else the mock set.
 */
function FarmSwitcherSheet({ onClose }: { onClose: () => void }) {
  const { activeFarm, setActiveFarm, farms } = useNav()
  return (
    <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.75)", display: "flex", alignItems: "flex-end", zIndex: 100 }} onClick={onClose}>
      <div style={{ background: "var(--surface)", borderRadius: "24px 24px 0 0", padding: 20, width: "100%", border: "1px solid var(--border-subtle)", maxHeight: "60%" }} onClick={e => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <div style={{ fontWeight: 700, fontSize: 16 }}>Switch Farm</div>
          <button className="btn-icon" onClick={onClose}><X size={16} /></button>
        </div>
        <button onClick={() => { setActiveFarm("ALL"); onClose() }}
          style={{ width: "100%", padding: "12px 14px", marginBottom: 10, borderRadius: 14, textAlign: "left", cursor: "pointer",
            background: activeFarm === "ALL" ? "rgba(74,222,128,0.12)" : "var(--card)",
            border: activeFarm === "ALL" ? "1px solid rgba(74,222,128,0.4)" : "1px solid var(--border-subtle)",
            display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 36, height: 36, borderRadius: 12, background: "rgba(74,222,128,0.15)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>🌐</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: 13, color: "var(--text-primary)" }}>All Farms</div>
            <div style={{ fontSize: 11, color: "var(--text-muted)" }}>Aggregated view · {farms.length} farms</div>
          </div>
          {activeFarm === "ALL" && <Check size={16} color="var(--primary-green)" />}
        </button>
        {farms.map(farm => (
          <button key={farm.code} onClick={() => { setActiveFarm(farm.code); onClose() }}
            style={{ width: "100%", padding: "12px 14px", marginBottom: 10, borderRadius: 14, textAlign: "left", cursor: "pointer",
              background: activeFarm === farm.code ? "rgba(74,222,128,0.12)" : "var(--card)",
              border: activeFarm === farm.code ? "1px solid rgba(74,222,128,0.4)" : "1px solid var(--border-subtle)",
              display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 36, height: 36, borderRadius: 12, background: "rgba(74,222,128,0.1)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>🌾</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700, fontSize: 13, color: "var(--text-primary)" }}>{farm.name}</div>
              <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{farm.code} · {farm.location}</div>
            </div>
            {activeFarm === farm.code && <Check size={16} color="var(--primary-green)" />}
          </button>
        ))}
      </div>
    </div>
  )
}


/* ── Dashboard Screen ── */
export function DashboardScreen() {
  const { navigate, role, activeFarm, farms, tenantId } = useNav();
  const [showFarmSwitcher, setShowFarmSwitcher] = useState(false);

  const farm = activeFarm === "ALL" ? null : farms.find(f => f.code === activeFarm) ?? farms[0];
  const farmBatches = activeFarm === "ALL" ? BATCHES_DATA : BATCHES_DATA.filter(b => b.farmCode === activeFarm);

  // Enterprise summary cards — still BATCHES_DATA-driven mock UI. No `batches`
  // table exists yet (Epic: Crops & Batches hasn't landed); this issue only
  // scoped the KPI/price/task/notification/weather surfaces below, not a
  // rebuild of this section.
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

  // ── Real data fetches (issue #228) ──
  // Each of these hits a real endpoint scoped to the session's tenant (the
  // `tenantId` query param is only the standalone-mock-mode fallback — see
  // GET /api/dashboard/kpis and friends). `null` here means "still loading",
  // never "no data" — an empty real response is `{ ...counts: 0 }` or `[]`,
  // which the render below treats as a genuine, honest empty state.
  const [kpis, setKpis] = useState<KpiData | null>(null);
  const [kpisFailed, setKpisFailed] = useState(false);
  const [prices, setPrices] = useState<PriceRow[] | null>(null);
  const [tasksToday, setTasksToday] = useState<TaskRow[] | null>(null);
  const [notifs, setNotifs] = useState<NotificationRow[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiClient.get<KpiData>(`/api/dashboard/kpis?tenantId=${tenantId}`).then(res => {
      if (cancelled) return;
      if (res.success) setKpis(res.data);
      else setKpisFailed(true);
    });
    apiClient.get<PriceRow[]>(`/api/products/current-prices?tenantId=${tenantId}`).then(res => {
      if (!cancelled && res.success) setPrices(res.data);
    });
    apiClient.get<TaskRow[]>(`/api/tasks?tenantId=${tenantId}&due=today`).then(res => {
      if (!cancelled && res.success) setTasksToday(res.data);
    });
    apiClient.get<NotificationRow[]>(`/api/notifications?tenantId=${tenantId}`).then(res => {
      if (!cancelled && res.success) setNotifs(res.data);
    });
    return () => { cancelled = true; };
  }, [tenantId]);

  const unread = notifs?.filter(n => !n.read).length ?? 0;

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

      {/* Farm badge / switcher — owners & managers with 2+ farms switch here (issue #219) */}
      {(role === "owner" || role === "manager") && (
        <button onClick={() => setShowFarmSwitcher(true)} style={{ marginBottom: 14, display: "flex", alignItems: "center", gap: 8, padding: "9px 12px", background: "var(--card)", border: "1px solid rgba(74,222,128,0.25)", borderRadius: 12, cursor: "pointer", width: "100%" }}>
          <span style={{ fontSize: 18 }}>🌾</span>
          <div style={{ flex: 1, textAlign: "left" }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-primary)" }}>{activeFarm === "ALL" ? "All Farms" : farm?.name ?? "Select Farm"}</div>
            <div style={{ fontSize: 10, color: "var(--text-muted)" }}>{activeFarm === "ALL" ? `${farms.length} farms · aggregated` : `${farm?.code} · ${farm?.location}`}</div>
          </div>
          <div style={{ fontSize: 10, color: "var(--primary-green)", fontWeight: 700 }}>Switch ›</div>
        </button>
      )}

      {/* Active alert strip — sourced from real notifications (sourceType "alert").
          No `alerts` table exists yet (#227's TODO), so this list is always
          empty today; the strip simply doesn't render rather than showing a
          fabricated warning. */}
      {(notifs ?? []).filter(n => !n.read && n.sourceType === "alert").slice(0, 1).map(a => (
        <button key={a.id} onClick={() => navigate("notifications")}
          style={{ width: "100%", marginBottom: 14, padding: "10px 12px", background: "rgba(248,113,113,0.07)", border: "1px solid rgba(248,113,113,0.3)", borderRadius: 12, display: "flex", alignItems: "center", gap: 8, cursor: "pointer", textAlign: "left" }}>
          <AlertTriangle size={14} color="var(--status-critical)" style={{ flexShrink: 0 }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "var(--status-critical)" }}>{a.title}</div>
            <div style={{ fontSize: 11, color: "var(--text-secondary)", marginTop: 1 }}>{a.message}</div>
          </div>
          <ChevronRight size={12} color="var(--text-muted)" />
        </button>
      ))}

      {/* KPI strip — real numbers from GET /api/dashboard/kpis (issue #228).
          "Pending Approvals" is hidden entirely (Epic: Tasks & Governance's
          approvals table doesn't exist yet — issue #228 task 4), rather than
          shown with a fake count. */}
      {kpisFailed ? (
        <div className="farm-card" style={{ padding: 14, marginBottom: 14, textAlign: "center", color: "var(--text-muted)", fontSize: 12 }}>
          Couldn&apos;t load dashboard metrics.
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 }}>
          {[
            { label: "Active Tasks", value: kpis?.activeTasksCount, icon: CheckCircle2, color: "var(--primary-green)", action: "tasks" as const },
            { label: "Overdue Tasks", value: kpis?.overdueTasksCount, icon: AlertTriangle, color: (kpis?.overdueTasksCount ?? 0) > 0 ? "var(--status-critical)" : "var(--text-muted)", action: "tasks" as const },
            { label: "Unread Notifications", value: kpis?.unreadNotifications, icon: Bell, color: "var(--accent-blue)", action: "notifications" as const },
            { label: "Products Tracked", value: kpis?.productCount, icon: Package, color: "var(--accent-amber)", action: "finance" as const },
          ].map((k) => {
            const Icon = k.icon;
            return (
              <button key={k.label} className="farm-card" style={{ padding: 12, textAlign: "left", cursor: "pointer", width: "100%" }} onClick={() => navigate(k.action)}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 }}>
                  <Icon size={16} color={k.color} />
                </div>
                <div style={{ fontSize: 22, fontWeight: 700, color: k.color }}>{k.value ?? "–"}</div>
                <div className="kpi-label" style={{ marginTop: 2 }}>{k.label}</div>
              </button>
            );
          })}
        </div>
      )}

      {/* Pending-epic KPIs (issue #228): the reference dashboard also wants
          active-batch counts, mortality % and FCR, but no `batches` table
          exists yet (Epic: Crops & Batches). Named honestly instead of shown
          as fabricated tiles. */}
      <div style={{ marginBottom: 14, padding: "8px 12px", border: "1px dashed var(--border-subtle)", borderRadius: 12, fontSize: 10, color: "var(--text-dim)", display: "flex", alignItems: "center", gap: 6 }}>
        <Info size={12} color="var(--text-dim)" style={{ flexShrink: 0 }} />
        <span>Active batches, mortality % and FCR aren&apos;t tracked yet — pending Epic: Crops &amp; Batches.</span>
      </div>

      {/* Revenue — owner/manager only. No `sales` table exists yet
          (Epic: Finance), so there is no real revenue/margin figure to show;
          this is an honest "not available" card, not a fabricated chart. */}
      {(role === "owner" || role === "manager") && (
        <button onClick={() => navigate("finance")} className="farm-card" style={{ padding: 14, marginBottom: 14, width: "100%", textAlign: "left", cursor: "pointer", display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 36, height: 36, borderRadius: 10, background: "rgba(255,255,255,0.05)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <Info size={16} color="var(--text-muted)" />
          </div>
          <div style={{ flex: 1 }}>
            <div className="section-eyebrow">Revenue</div>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>Not available yet — pending Epic: Finance (no sales data recorded).</div>
          </div>
          <ChevronRight size={14} color="var(--text-dim)" />
        </button>
      )}

      {/* Product prices strip — owner only */}
      {role === "owner" && (
        <div style={{ marginBottom: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
            <div className="section-eyebrow">📦 Current Product Prices</div>
            <button onClick={() => navigate("finance")} style={{ fontSize: 11, color: "var(--primary-green)", fontWeight: 600, background: "none", border: "none", cursor: "pointer" }}>Manage ›</button>
          </div>
          {prices === null ? (
            <div style={{ fontSize: 11, color: "var(--text-dim)" }}>Loading prices…</div>
          ) : prices.length === 0 ? (
            <div className="farm-card" style={{ padding: 12, fontSize: 11, color: "var(--text-muted)" }}>No products priced yet.</div>
          ) : (
            <div style={{ display: "flex", gap: 8, overflowX: "auto", scrollbarWidth: "none", paddingBottom: 4 }}>
              {prices.map(p => (
                <button key={p.id} onClick={() => navigate("finance")}
                  style={{ flexShrink: 0, padding: "9px 12px", background: "var(--card)", border: "1px solid var(--border-subtle)", borderRadius: 12, textAlign: "left", cursor: "pointer", minWidth: 90 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-primary)" }}>{p.name}</div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "var(--primary-green)", marginTop: 3 }}>KSh {p.currentPrice.toLocaleString()}</div>
                  {/* No unit-of-measure column exists yet on `products` (Epic:
                      Crops & Batches) — "/unit" is a generic label, not a
                      fabricated specific unit like "tray" or "kg". */}
                  <div style={{ fontSize: 9, color: "var(--text-muted)", marginTop: 1 }}>/unit</div>
                </button>
              ))}
            </div>
          )}
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

      {/* Today's tasks — real rows from GET /api/tasks?due=today (issue #228) */}
      <div style={{ marginBottom: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
          <div className="section-eyebrow">Tasks Today</div>
          <button onClick={() => navigate("tasks")} style={{ fontSize: 11, color: "var(--primary-green)", fontWeight: 600, background: "none", border: "none", cursor: "pointer" }}>All tasks ›</button>
        </div>
        {tasksToday === null ? (
          <div className="farm-card" style={{ padding: 14, fontSize: 11, color: "var(--text-dim)" }}>Loading today&apos;s tasks…</div>
        ) : tasksToday.length === 0 ? (
          <div className="farm-card" style={{ padding: 14, fontSize: 12, color: "var(--text-muted)" }}>No tasks due today.</div>
        ) : (
          <div className="farm-card" style={{ overflow: "hidden" }}>
            {tasksToday.map((t, i) => {
              const done = t.status === "DONE" || t.status === "CANCELLED";
              const overdue = !done && t.dueAt !== null && new Date(t.dueAt) < new Date();
              const dueLabel = t.dueAt ? new Date(t.dueAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—";
              return (
                <button key={t.id} onClick={() => navigate("tasks")}
                  style={{ width: "100%", padding: "11px 14px", display: "flex", alignItems: "center", gap: 10, borderBottom: i < tasksToday.length - 1 ? "1px solid var(--border-subtle)" : "none", background: "none", border: "none", cursor: "pointer", textAlign: "left" }}>
                  <div style={{ width: 20, height: 20, borderRadius: "50%",
                    background: done ? "rgba(74,222,128,0.2)" : overdue ? "rgba(248,113,113,0.15)" : "var(--card)",
                    border: `1px solid ${done ? "var(--primary-green)" : overdue ? "var(--status-critical)" : "var(--border-subtle)"}`,
                    display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                    {done && <CheckCircle2 size={12} color="var(--primary-green)" />}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: done ? "var(--text-muted)" : overdue ? "var(--status-critical)" : "var(--text-primary)", textDecoration: done ? "line-through" : "none" }}>{t.title}</div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 3 }}>
                    <Clock size={10} color={overdue ? "var(--status-critical)" : "var(--text-muted)"} />
                    <span style={{ fontSize: 10, color: overdue ? "var(--status-critical)" : "var(--text-muted)" }}>{dueLabel}</span>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Weather mini — honest "not available" state (issue #228 task 5). The
          backend was intentionally not built in #227 (provider decision still
          pending) — no fake forecast. */}
      <button onClick={() => navigate("weather")} className="farm-card" style={{ padding: 14, width: "100%", textAlign: "left", marginBottom: 14, cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 36, height: 36, borderRadius: 10, background: "rgba(255,255,255,0.05)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <Info size={16} color="var(--text-muted)" />
          </div>
          <div>
            <div className="section-eyebrow" style={{ marginBottom: 4 }}>{farm?.location ?? "All farms"}</div>
            <div style={{ fontSize: 12, color: "var(--text-muted)" }}>Weather not available yet</div>
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

      {showFarmSwitcher && <FarmSwitcherSheet onClose={() => setShowFarmSwitcher(false)} />}
    </div>
  );
}

/* ── Notifications Screen ── */
export function NotificationsScreen() {
  const { navigate, tenantId } = useNav();
  const [notifs, setNotifs] = useState<NotificationRow[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiClient.get<NotificationRow[]>(`/api/notifications?tenantId=${tenantId}`).then(res => {
      if (!cancelled && res.success) setNotifs(res.data);
    });
    return () => { cancelled = true; };
  }, [tenantId]);

  // Only sourceTypes the backend actually produces today (issue #227/#228):
  // "task" (synced from overdue/due-today tasks) and "approval"/"alert"
  // (schema supports them, but no approvals/alerts table feeds them yet —
  // see app/api/notifications/route.ts). Falls back to a generic bell icon
  // for anything else rather than guessing.
  const typeIcon: Record<string, string> = { task: "📋", alert: "⚠️", approval: "✅" };
  const typeColor: Record<string, string> = { task: "var(--primary-green)", alert: "var(--status-critical)", approval: "var(--status-warning)" };

  const markRead = useCallback((id: string) => {
    setNotifs(ns => ns ? ns.map(n => n.id === id ? { ...n, read: true } : n) : ns);
    apiClient.patch(`/api/notifications/${id}?tenantId=${tenantId}`, { read: true });
  }, [tenantId]);

  function markAllRead() {
    const unreadIds = (notifs ?? []).filter(n => !n.read).map(n => n.id);
    setNotifs(ns => ns ? ns.map(n => ({ ...n, read: true })) : ns);
    unreadIds.forEach(id => apiClient.patch(`/api/notifications/${id}?tenantId=${tenantId}`, { read: true }));
  }

  function handleNotifTap(n: NotificationRow) {
    markRead(n.id);
    if (n.sourceType === "task") navigate("tasks");
    else if (n.sourceType === "approval") navigate("governance");
    else if (n.sourceType === "alert") navigate("inventory");
  }

  const unread = (notifs ?? []).filter(n => !n.read).length;

  function isToday(iso: string | null): boolean {
    if (!iso) return false;
    return new Date(iso).toDateString() === new Date().toDateString();
  }
  function formatWhen(iso: string | null): string {
    if (!iso) return "";
    return new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  }

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
        {notifs === null ? (
          <div style={{ fontSize: 12, color: "var(--text-dim)" }}>Loading notifications…</div>
        ) : notifs.length === 0 ? (
          <div className="farm-card" style={{ padding: 16, fontSize: 12, color: "var(--text-muted)", textAlign: "center" }}>
            No notifications yet.
          </div>
        ) : (
          ["Today", "Earlier"].map(group => {
            const items = notifs.filter(n => (group === "Today") === isToday(n.createdAt));
            if (!items.length) return null;
            return (
              <div key={group} style={{ marginBottom: 16 }}>
                <div className="section-eyebrow" style={{ marginBottom: 8 }}>{group}</div>
                {items.map((n) => {
                  const color = typeColor[n.sourceType] ?? "var(--text-muted)";
                  return (
                    <button key={n.id} onClick={() => handleNotifTap(n)}
                      style={{ width: "100%", padding: 14, marginBottom: 8, borderRadius: 14, textAlign: "left", cursor: "pointer",
                        background: n.read ? "var(--card)" : "rgba(74,222,128,0.05)",
                        border: `1px solid ${n.read ? "var(--border-subtle)" : "rgba(74,222,128,0.2)"}` }}>
                      <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                        <div style={{ width: 32, height: 32, borderRadius: 10, background: `${color}15`, border: `1px solid ${color}30`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, fontSize: 16 }}>
                          {typeIcon[n.sourceType] ?? "🔔"}
                        </div>
                        <div style={{ flex: 1 }}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                            <div style={{ fontSize: 13, fontWeight: n.read ? 500 : 700, color: "var(--text-primary)", lineHeight: 1.3, flex: 1 }}>{n.title}</div>
                            {!n.read && <div style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--primary-green)", flexShrink: 0, marginLeft: 8, marginTop: 4 }} />}
                          </div>
                          {n.message && <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 3, lineHeight: 1.4 }}>{n.message}</div>}
                          <div style={{ fontSize: 10, color: "var(--text-dim)", marginTop: 5 }}>{formatWhen(n.createdAt)}</div>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            );
          })
        )}
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
