// ============================================================
// dashboard.tsx — Role-aware dashboard + Notifications + NotificationSettings
// Data flow (issue #228 rewire, primary grid rebuilt in #296 — replaces the
// old all-mock version):
//   The primary KPI grid (Active Batches / Pending Approvals / Livestock
//   Units / Crop Batches) and the Revenue card (real revenue, margin, a
//   working Month/Quarter/Year toggle, and a real day-bucketed trend) are
//   real data from GET /api/dashboard/kpis (issue #296 — see that route's
//   header for the field-by-field writeup and the Margin % formula
//   decision). Product price strip, today's-tasks strip and the notification
//   bell/badge/list are real data from GET /api/products/current-prices,
//   GET /api/tasks?due=today and GET/PATCH /api/notifications respectively
//   (see fetch effects below).
//   The secondary Livestock/Crop enterprise summary CARDS further down (with
//   per-group emoji/label) are still BATCHES_DATA-driven mock UI — there is
//   no route that returns that per-group breakdown (only aggregate counts,
//   which the primary grid now uses for real) and rebuilding those cards is
//   not this issue's scope.
//   QuickActions navigate to relevant screens.
//   FarmSwitcherSheet switches activeFarm (multi-farm, issue #219) → all screens re-filter.
//   The greeting line and the primary KPI grid's lead tile now read the
//   tenant's real GET /api/settings branding (dashboardGreeting/accentColor/
//   logoEmoji, persisted since #255) instead of hardcoded values — issue
//   #310. Falls back to the original hardcoded strings/color until the fetch
//   resolves or if it fails, so there's no blank/broken state either way.
// ============================================================
"use client";
import React, { useState, useEffect, useCallback } from "react";
import { useNav, TopNav } from "./navigation";
import { BATCHES_DATA, ENTERPRISE_REGISTRY } from "./data";
import {
  AlertTriangle, CheckCircle2, Package, ChevronRight, Bell,
  Clock, X, Check, Settings, Info, Leaf, Activity,
} from "./icons";
import { apiClient } from "@/lib/request";

// ── Real backend shapes (issue #228, revisited #292, #296) ──────────────────
// KPI fields computed from tables that exist on this branch
// (tasks/notifications/products/batches/sales/approval_requests).
// `activeBatches`, `mortalityPct`, `revenue`, `pendingApprovals`,
// `livestockUnitsCount`/`livestockUnitsQty`, `cropBatchGroupsCount`,
// `periodRevenue`, `marginPct` and `revenueTrend` are all real now — see
// GET /api/dashboard/kpis's header comment for exactly how each is computed
// and, for `marginPct`, why it's a "revenue vs. tracked acquisition cost"
// approximation rather than a full accounting margin. `avgFCR` still comes
// back `null` — there is no feed-intake/weight-gain data source anywhere in
// this app yet — and is rendered as an explicit "not yet tracked" note
// rather than a fabricated number.
type Period = "month" | "quarter" | "year";
interface RevenueTrendPoint { date: string; amount: number }
interface KpiData {
  activeTasksCount: number;
  overdueTasksCount: number;
  unreadNotifications: number;
  productCount: number;
  activeBatches: number;
  mortalityPct: number | null;
  avgFCR: number | null;
  revenue: number;
  pendingApprovals: number;
  livestockUnitsCount: number;
  livestockUnitsQty: number;
  cropBatchGroupsCount: number;
  period: Period;
  periodRevenue: number;
  marginPct: number | null;
  revenueTrend: RevenueTrendPoint[];
}
// Tenant branding (issue #255/#256 — persisted via tenant_settings, editable
// in ui-customise.tsx). Trimmed to the fields this screen actually applies:
// dashboardGreeting replaces the old hardcoded "Good morning," line, and
// accentColor drives the primary KPI grid's lead tile so a tenant's branding
// shows up somewhere real beyond the settings screen itself (issue #310).
interface DashboardSettings { accentColor: string; logoEmoji: string; dashboardGreeting: string }
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

type DashboardRole = "owner" | "manager" | "worker" | "vet" | "auditor" | "super_admin";

function OperationalDashboard({
  role, userName, farmName, farmMeta, kpis, tasksToday, notifs, period, setPeriod, navigate, settings,
}: {
  role: DashboardRole; userName?: string; farmName: string; farmMeta: string; kpis: KpiData | null;
  tasksToday: TaskRow[] | null; notifs: NotificationRow[] | null; period: Period;
  setPeriod: (period: Period) => void; navigate: (screen: any) => void;
  settings: DashboardSettings | null;
}) {
  const today = new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
  const scheduled = tasksToday?.length ?? 0;
  const completed = tasksToday?.filter(t => t.status === "DONE").length ?? 0;
  const inProgress = tasksToday?.filter(t => t.status === "IN_PROGRESS").length ?? 0;
  const delayed = tasksToday?.filter(t => t.status !== "DONE" && t.dueAt && new Date(t.dueAt) < new Date()).length ?? 0;
  const attention = [
    kpis?.overdueTasksCount ? { title: `${kpis.overdueTasksCount} overdue task${kpis.overdueTasksCount === 1 ? "" : "s"}`, detail: "Scheduled work needs intervention.", action: "tasks" } : null,
    kpis?.pendingApprovals ? { title: `${kpis.pendingApprovals} pending approval${kpis.pendingApprovals === 1 ? "" : "s"}`, detail: "A decision is required to keep work moving.", action: "governance" } : null,
    kpis?.unreadNotifications ? { title: `${kpis.unreadNotifications} unread notification${kpis.unreadNotifications === 1 ? "" : "s"}`, detail: "Review the latest operational updates.", action: "notifications" } : null,
  ].filter(Boolean) as { title: string; detail: string; action: any }[];
  const recent = (notifs ?? []).slice(0, 4);
  const isManager = role === "manager";

  return (
    <div className="screen-content px-screen" style={{ paddingTop: 24 }}>
      <header style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "flex-start", marginBottom: 24 }}>
        <div>
          <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 4 }}>{isManager ? "Today’s operations" : "Executive overview"}</div>
          <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 4 }}>{settings?.dashboardGreeting ?? "Good morning,"} {userName ?? ""}</div>
          <h1 style={{ margin: 0, fontSize: 26, lineHeight: 1.15, color: "var(--text-primary)" }}><span aria-hidden="true">{settings?.logoEmoji ?? "🌾"}</span> {farmName}</h1>
          <div style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 5 }}>{today} · {farmMeta}</div>
        </div>
        <button className="btn-icon" onClick={() => navigate("notifications")} title="Notifications"><Bell size={17} /></button>
      </header>

      {attention.length > 0 && (
        <section style={{ marginBottom: 28 }}>
          <h2 className="section-title" style={{ margin: "0 0 10px" }}>Attention required</h2>
          <div className="farm-card" style={{ overflow: "hidden" }}>
            {attention.map((item, index) => (
              <button key={item.title} onClick={() => navigate(item.action)} style={{ width: "100%", display: "flex", alignItems: "center", gap: 12, padding: "13px 14px", background: "transparent", border: "none", borderBottom: index < attention.length - 1 ? "1px solid var(--border-subtle)" : "none", cursor: "pointer", textAlign: "left" }}>
                <AlertTriangle size={17} color="var(--status-warning)" />
                <span style={{ flex: 1 }}><span style={{ display: "block", fontSize: 14, fontWeight: 650, color: "var(--text-primary)" }}>{item.title}</span><span style={{ display: "block", fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>{item.detail}</span></span>
                <ChevronRight size={16} color="var(--text-dim)" />
              </button>
            ))}
          </div>
        </section>
      )}

      {isManager ? (
        <>
          <section style={{ marginBottom: 28 }}>
            <h2 className="section-title" style={{ margin: "0 0 10px" }}>Today</h2>
            <div className="farm-card" style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", padding: "14px 0" }}>
              {[['Scheduled', scheduled], ['Completed', completed], ['In progress', inProgress], ['Delayed', delayed]].map(([label, value], i) => <div key={label as string} style={{ textAlign: "center", borderLeft: i ? "1px solid var(--border-subtle)" : "none" }}><div style={{ fontSize: 24, fontWeight: 700 }}>{value as number}</div><div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 3 }}>{label as string}</div></div>)}
            </div>
          </section>
          <section style={{ marginBottom: 28 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 10 }}><h2 className="section-title" style={{ margin: 0 }}>Today’s work</h2><button onClick={() => navigate("tasks")} style={{ background: "none", border: "none", color: "var(--primary-green)", cursor: "pointer", fontSize: 13, fontWeight: 600 }}>Open tasks</button></div>
            <div className="farm-card" style={{ overflow: "hidden" }}>
              {tasksToday === null ? <div style={{ padding: 14, fontSize: 13, color: "var(--text-muted)" }}>Loading scheduled work…</div> : tasksToday.length === 0 ? <div style={{ padding: 16, fontSize: 13, color: "var(--text-muted)" }}>No tasks are scheduled for today.</div> : tasksToday.map((task, index) => <button key={task.id} onClick={() => navigate("tasks")} style={{ width: "100%", padding: "13px 14px", display: "grid", gridTemplateColumns: "1fr auto", gap: 12, background: "transparent", border: "none", borderBottom: index < tasksToday.length - 1 ? "1px solid var(--border-subtle)" : "none", textAlign: "left", cursor: "pointer" }}><span><span style={{ display: "block", fontSize: 14, fontWeight: 650 }}>{task.title}</span><span style={{ display: "block", fontSize: 12, color: "var(--text-muted)", marginTop: 3 }}>{task.dueAt ? new Date(task.dueAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "No scheduled time"}</span></span><span className={`chip ${task.status === "DONE" ? "chip-ok" : "chip-warning"}`}>{task.status.replace(/_/g, " ")}</span></button>)}
            </div>
          </section>
        </>
      ) : (
        <>
          <section style={{ marginBottom: 28 }}>
            <h2 className="section-title" style={{ margin: "0 0 10px" }}>Farm performance</h2>
            <div className="farm-card" style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr 1fr", padding: "16px 0" }}>
              <div style={{ paddingLeft: 16 }}><div className="kpi-value" style={{ color: settings?.accentColor ?? "var(--primary-green)" }}>{kpis ? `KSh ${kpis.periodRevenue.toLocaleString()}` : "—"}</div><div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>Revenue this {period}</div></div>
              <button onClick={() => navigate("crops")} style={{ background: "none", border: "none", borderLeft: "1px solid var(--border-subtle)", textAlign: "left", paddingLeft: 16, cursor: "pointer" }}><div style={{ fontSize: 24, fontWeight: 700 }}>{kpis?.activeBatches ?? "—"}</div><div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>Active batches</div></button>
              <button onClick={() => navigate("tasks")} style={{ background: "none", border: "none", borderLeft: "1px solid var(--border-subtle)", textAlign: "left", paddingLeft: 16, cursor: "pointer" }}><div style={{ fontSize: 24, fontWeight: 700 }}>{kpis?.activeTasksCount ?? "—"}</div><div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>Open tasks</div></button>
            </div>
            <div style={{ display: "flex", gap: 6, marginTop: 10 }}>{(["month", "quarter", "year"] as const).map(p => <button key={p} onClick={() => setPeriod(p)} className={`filter-chip ${period === p ? "active" : ""}`} style={{ textTransform: "capitalize" }}>{p}</button>)}</div>
          </section>
          <section style={{ marginBottom: 28 }}>
            <h2 className="section-title" style={{ margin: "0 0 10px" }}>Operational snapshot</h2>
            <div className="farm-card" style={{ overflow: "hidden" }}>
              {[["Fields & crops", kpis?.cropBatchGroupsCount, "crops"], ["Inventory items tracked", kpis?.productCount, "inventory"], ["Pending approvals", kpis?.pendingApprovals, "governance"]].map(([label, value, screen], index) => <button key={label as string} onClick={() => navigate(screen as any)} style={{ width: "100%", padding: "13px 14px", background: "transparent", border: "none", borderBottom: index < 2 ? "1px solid var(--border-subtle)" : "none", display: "flex", justifyContent: "space-between", cursor: "pointer", color: "var(--text-primary)", fontSize: 14 }}><span>{label as string}</span><span style={{ fontWeight: 700 }}>{value as number ?? "—"}</span></button>)}
            </div>
          </section>
        </>
      )}

      <section style={{ paddingBottom: 28 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 10 }}><h2 className="section-title" style={{ margin: 0 }}>Recent activity</h2><button onClick={() => navigate("notifications")} style={{ background: "none", border: "none", color: "var(--primary-green)", cursor: "pointer", fontSize: 13, fontWeight: 600 }}>View all</button></div>
        <div className="farm-card" style={{ overflow: "hidden" }}>
          {recent.length === 0 ? <div style={{ padding: 16, fontSize: 13, color: "var(--text-muted)" }}>No recent operational updates.</div> : recent.map((note, index) => <button key={note.id} onClick={() => navigate("notifications")} style={{ width: "100%", padding: "13px 14px", textAlign: "left", background: "transparent", border: "none", borderBottom: index < recent.length - 1 ? "1px solid var(--border-subtle)" : "none", cursor: "pointer" }}><div style={{ fontSize: 14, fontWeight: 600 }}>{note.title}</div><div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 3 }}>{note.message || "Open notification"}</div></button>)}
        </div>
      </section>
    </div>
  );
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
export function DashboardScreen({ userName }: { userName?: string }) {
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

  // ── Real data fetches (issue #228, #296) ──
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
  // Revenue card's Month/Quarter/Year toggle (issue #296) — drives
  // GET /api/dashboard/kpis's `period` param, which re-scopes periodRevenue/
  // marginPct/revenueTrend server-side. Kept in its own effect (below) so
  // flipping the toggle doesn't re-fetch prices/tasks/notifications too.
  const [period, setPeriod] = useState<Period>("month");
  // Tenant branding (issue #310) — `null` until loaded; every field below
  // falls back to the same hardcoded defaults this screen shipped with, so
  // an unfetched/failed load never regresses to blank UI.
  const [settings, setSettings] = useState<DashboardSettings | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiClient.get<Partial<DashboardSettings>>(`/api/settings?tenantId=${tenantId}`).then(res => {
      if (!cancelled && res.success) {
        setSettings({
          accentColor: res.data.accentColor || "var(--primary-green)",
          logoEmoji: res.data.logoEmoji || "🌾",
          dashboardGreeting: res.data.dashboardGreeting || "Good morning,",
        });
      }
    });
    return () => { cancelled = true; };
  }, [tenantId]);

  useEffect(() => {
    let cancelled = false;
    apiClient.get<KpiData>(`/api/dashboard/kpis?tenantId=${tenantId}&period=${period}`).then(res => {
      if (cancelled) return;
      if (res.success) setKpis(res.data);
      else setKpisFailed(true);
    });
    return () => { cancelled = true; };
  }, [tenantId, period]);

  useEffect(() => {
    let cancelled = false;
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
  const maxTrend = Math.max(1, ...(kpis?.revenueTrend.map(p => p.amount) ?? [0]));

  // Quick actions vary by role
  const quickActions = [
    { label: "Add Task", screen: "tasks" as const, emoji: "✅", roles: ["owner","manager"] },
    { label: "Record Sale", screen: "finance" as const, emoji: "💰", roles: ["owner"] },
    { label: "Add Stock", screen: "inventory" as const, emoji: "📦", roles: ["owner","manager"] },
    { label: "AI Chat", screen: "ai-chat" as const, emoji: "🤖", roles: ["owner","manager","worker"] },
    { label: "Approvals", screen: "governance" as const, emoji: "🛡️", roles: ["owner"] },
    { label: "People", screen: "people" as const, emoji: "👥", roles: ["owner","manager"] },
  ].filter(a => a.roles.includes(role));

  return <OperationalDashboard
    role={role}
    userName={userName}
    farmName={activeFarm === "ALL" ? "All farms" : farm?.name ?? "Farm overview"}
    farmMeta={activeFarm === "ALL" ? `${farms.length} farms · synced` : `${farm?.location ?? ""} · synced`}
    kpis={kpis}
    tasksToday={tasksToday}
    notifs={notifs}
    period={period}
    setPeriod={setPeriod}
    navigate={navigate}
    settings={settings}
  />;
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
