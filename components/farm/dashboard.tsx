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
//   The old "secondary Livestock/Crop enterprise summary CARDS" were removed
//   (#376 Gap 4): they computed from the BATCHES_DATA mock array but were
//   never rendered anywhere — dead code sitting behind a stale "no batches
//   table exists yet" comment (the table AND GET /api/batches both exist).
//   Aggregate per-group counts come from GET /api/dashboard/kpis
//   (livestockUnitsCount / cropBatchGroupsCount); if dedicated per-enterprise
//   cards ever come back, source them from GET /api/batches?farmId=… grouped
//   client-side by `enterprise` — never from components/farm/data.ts mocks.
//   QuickActions navigate to relevant screens.
//   FarmSwitcherSheet switches activeFarmId (multi-farm, issue #219, made
//   real by the farm-scoped-data task) → the KPI fetch below re-runs with
//   `farmId=${activeFarmId}` and GET /api/dashboard/kpis re-scopes every
//   metric that has a real farm relationship (activeBatches, mortalityPct,
//   revenue/periodRevenue/marginPct/revenueTrend, pendingApprovals,
//   livestock/crop group counts, activeTasksCount/overdueTasksCount — see
//   that route's header for the field-by-field list). unreadNotifications
//   and productCount stay tenant-wide on every farm — no farm relationship
//   exists for either — and the response's `tenantWideMetrics` says so
//   explicitly rather than this screen quietly implying they're scoped too.
//   Not every screen re-filters yet: the product-price strip, today's-tasks
//   strip and notification feed below still fetch unscoped
//   (GET /api/products/current-prices, GET /api/tasks?due=today, GET
//   /api/notifications) — tasks.farmId exists as of this task but this
//   screen's "today" strip wasn't wired to it, and prices/notifications have
//   no farm relationship to filter by in the first place.
//   The greeting line and the primary KPI grid's lead tile now read the
//   tenant's real GET /api/settings branding (dashboardGreeting/accentColor/
//   logoEmoji, persisted since #255) instead of hardcoded values — issue
//   #310. Falls back to the original hardcoded strings/color until the fetch
//   resolves or if it fails, so there's no blank/broken state either way.
// ============================================================
"use client";
import React, { useState, useEffect, useCallback } from "react";
import { useNav, TopNav } from "./navigation";
// NOTE: no import from ./data — this screen renders real API data only.
// See the header note above for where per-group batch breakdowns come from.
import {
  AlertTriangle, CheckCircle2, Package, ChevronRight, Bell,
  Clock, X, Check, Settings, Info, Leaf, Activity, ChevronDown,
  Globe, Building2, CheckSquare, DollarSign, Bot, Shield, Users,
  ClipboardList, CloudSun, type LucideIcon,
} from "./icons";
import { apiClient } from "@/lib/request";
import { centsToMajor } from "@/lib/money";

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
interface RevenueTrendPoint { date: string; amountCents: number }
interface KpiData {
  activeTasksCount: number;
  overdueTasksCount: number;
  unreadNotifications: number;
  productCount: number;
  activeBatches: number;
  mortalityPct: number | null;
  avgFCR: number | null;
  revenueCents: number;
  pendingApprovals: number;
  livestockUnitsCount: number;
  livestockUnitsQty: number;
  cropBatchGroupsCount: number;
  period: Period;
  periodRevenueCents: number;
  marginPct: number | null;
  revenueTrend: RevenueTrendPoint[];
  // farm-scoped-data task: which farm this response was actually scoped to,
  // and which of the fields above never change with it (no farm
  // relationship exists — see GET /api/dashboard/kpis's header). Used below
  // to label tenant-wide tiles honestly instead of implying every number on
  // this screen follows the farm switcher.
  farmId?: string;
  tenantWideMetrics?: string[];
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

/* ── Revenue trend chart ──
 * GET /api/dashboard/kpis has returned a real day-bucketed revenueTrend
 * since issue #296, but nothing ever rendered it — the "Farm performance"
 * card showed only the single period total, so the same amount of real data
 * plotting the number's shape over time went completely unused. Single
 * series (no legend needed), one hue (the tenant's own accent colour, same
 * token the revenue number already uses), thin bars with rounded tops
 * anchored to a shared baseline, tap-to-reveal for the exact day instead of
 * a label crammed onto every bar. */
function RevenueTrendChart({ trend, color }: { trend: { date: string; amountCents: number }[] | null; color: string }) {
  const [activeIdx, setActiveIdx] = useState<number | null>(null);

  if (trend === null) {
    return <div style={{ height: 64, display: "flex", alignItems: "center", fontSize: 'var(--fs-xs)', color: "var(--text-dim)" }}>Loading trend…</div>;
  }
  if (trend.length < 2) {
    return null; // Not enough points for a trend to mean anything — no chart is better than a fake one.
  }

  const amounts = trend.map(p => centsToMajor(p.amountCents));
  const max = Math.max(1, ...amounts);
  const peakIdx = amounts.indexOf(Math.max(...amounts));
  const active = activeIdx ?? peakIdx;
  const fmtDate = (d: string) => new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

  return (
    <div>
      <div style={{ fontSize: 'var(--fs-xs)', fontWeight: 700, color: "var(--text-primary)", marginBottom: 4 }}>
        {fmtDate(trend[active].date)} · KSh {amounts[active].toLocaleString()}
      </div>
      <div
        role="img"
        aria-label={`Revenue trend from ${fmtDate(trend[0].date)} to ${fmtDate(trend[trend.length - 1].date)}, peaking at KSh ${amounts[peakIdx].toLocaleString()} on ${fmtDate(trend[peakIdx].date)}`}
        style={{ display: "flex", alignItems: "flex-end", gap: trend.length > 40 ? 1 : 2, height: 56 }}
      >
        {trend.map((p, i) => {
          const amount = amounts[i];
          const heightPct = Math.max(4, (amount / max) * 100);
          const isActive = i === active;
          return (
            <button
              key={p.date}
              onClick={() => setActiveIdx(i)}
              aria-hidden="true"
              tabIndex={-1}
              title={`${fmtDate(p.date)}: KSh ${amount.toLocaleString()}`}
              style={{
                flex: 1, minWidth: 2, height: `${heightPct}%`, borderRadius: "3px 3px 0 0", border: "none", padding: 0, cursor: "pointer",
                background: isActive ? color : `${color}55`,
                transition: "background 0.15s",
              }}
            />
          );
        })}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4, fontSize: 'var(--fs-2xs)', color: "var(--text-dim)" }}>
        <span>{fmtDate(trend[0].date)}</span>
        <span>{fmtDate(trend[trend.length - 1].date)}</span>
      </div>
    </div>
  );
}

function OperationalDashboard({
  role, userName, farmName, farmMeta, kpis, tasksToday, notifs, period, setPeriod, navigate, settings,
  onSwitchFarm, canSwitchFarm,
}: {
  role: DashboardRole; userName?: string; farmName: string; farmMeta: string; kpis: KpiData | null;
  tasksToday: TaskRow[] | null; notifs: NotificationRow[] | null; period: Period;
  setPeriod: (period: Period) => void; navigate: (screen: any) => void;
  settings: DashboardSettings | null;
  // Mobile has no sidebar (AppSidebar's "Farm" <select> is desktop-only, CSS
  // media-query gated) — this is what lets a mobile user with more than one
  // farm actually switch. Before this, FarmSwitcherSheet existed but nothing
  // ever rendered it or flipped the state that would: a real multi-farm
  // owner/manager on a phone had no way to reach a farm other than the first.
  onSwitchFarm?: () => void; canSwitchFarm?: boolean;
}) {
  const today = new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
  const scheduled = tasksToday?.length ?? 0;
  const completed = tasksToday?.filter(t => t.status === "DONE").length ?? 0;
  const inProgress = tasksToday?.filter(t => t.status === "IN_PROGRESS").length ?? 0;
  const delayed = tasksToday?.filter(t => t.status !== "DONE" && t.dueAt && new Date(t.dueAt) < new Date()).length ?? 0;
  const attention = [
    kpis?.overdueTasksCount ? { title: `${kpis.overdueTasksCount} overdue task${kpis.overdueTasksCount === 1 ? "" : "s"}`, detail: "Scheduled work needs intervention.", action: "tasks" } : null,
    kpis?.pendingApprovals ? { title: `${kpis.pendingApprovals} pending approval${kpis.pendingApprovals === 1 ? "" : "s"}`, detail: "A decision is required to keep work moving.", action: "governance" } : null,
    // unreadNotifications is always tenant-wide (no farm relationship — see
    // GET /api/dashboard/kpis's header); labelled so a farm-scoped view
    // never implies this count is specific to the selected farm.
    kpis?.unreadNotifications ? { title: `${kpis.unreadNotifications} unread notification${kpis.unreadNotifications === 1 ? '' : 's'}${kpis.farmId && kpis.farmId !== 'ALL' ? ' (all farms)' : ''}`, detail: "Review the latest operational updates.", action: "notifications" } : null,
  ].filter(Boolean) as { title: string; detail: string; action: any }[];
  const recent = (notifs ?? []).slice(0, 4);
  const isManager = role === "manager";

  return (
    <div className="screen-content px-screen" style={{ paddingTop: 24 }}>
      <header style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "flex-start", marginBottom: 24 }}>
        <div>
          <div style={{ fontSize: 'var(--fs-sm)', color: "var(--text-muted)", marginBottom: 4 }}>{isManager ? "Today’s operations" : "Executive overview"}</div>
          <div style={{ fontSize: 'var(--fs-sm)', color: "var(--text-muted)", marginBottom: 4 }}>{settings?.dashboardGreeting ?? "Good morning,"} {userName ?? ""}</div>
          {canSwitchFarm ? (
            <button onClick={onSwitchFarm} style={{ display: "flex", alignItems: "center", gap: 6, background: "none", border: "none", padding: 0, cursor: "pointer", margin: 0, fontSize: 'var(--fs-4xl)', lineHeight: 1.15, color: "var(--text-primary)", fontWeight: 800 }}>
              <span aria-hidden="true">{settings?.logoEmoji ?? "🌾"}</span> {farmName}
              <ChevronDown size={20} color="var(--text-muted)" aria-hidden="true" />
            </button>
          ) : (
            <h1 style={{ margin: 0, fontSize: 'var(--fs-4xl)', lineHeight: 1.15, color: "var(--text-primary)" }}><span aria-hidden="true">{settings?.logoEmoji ?? "🌾"}</span> {farmName}</h1>
          )}
          <div style={{ fontSize: 'var(--fs-base)', color: "var(--text-muted)", marginTop: 5 }}>{today} · {farmMeta}</div>
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
                <span style={{ flex: 1 }}><span style={{ display: "block", fontSize: 'var(--fs-md)', fontWeight: 650, color: "var(--text-primary)" }}>{item.title}</span><span style={{ display: "block", fontSize: 'var(--fs-sm)', color: "var(--text-muted)", marginTop: 2 }}>{item.detail}</span></span>
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
              {[['Scheduled', scheduled], ['Completed', completed], ['In progress', inProgress], ['Delayed', delayed]].map(([label, value], i) => <div key={label as string} style={{ textAlign: "center", borderLeft: i ? "1px solid var(--border-subtle)" : "none" }}><div style={{ fontSize: 'var(--fs-3xl)', fontWeight: 700 }}>{value as number}</div><div style={{ fontSize: 'var(--fs-xs)', color: "var(--text-muted)", marginTop: 3 }}>{label as string}</div></div>)}
            </div>
          </section>
          <section style={{ marginBottom: 28 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 10 }}><h2 className="section-title" style={{ margin: 0 }}>Today’s work</h2><button onClick={() => navigate("tasks")} style={{ background: "none", border: "none", color: "var(--primary-green)", cursor: "pointer", fontSize: 'var(--fs-base)', fontWeight: 600 }}>Open tasks</button></div>
            <div className="farm-card" style={{ overflow: "hidden" }}>
              {tasksToday === null ? <div style={{ padding: 14, fontSize: 'var(--fs-base)', color: "var(--text-muted)" }}>Loading scheduled work…</div> : tasksToday.length === 0 ? <div style={{ padding: 16, fontSize: 'var(--fs-base)', color: "var(--text-muted)" }}>No tasks are scheduled for today.</div> : tasksToday.map((task, index) => <button key={task.id} onClick={() => navigate("tasks")} style={{ width: "100%", padding: "13px 14px", display: "grid", gridTemplateColumns: "1fr auto", gap: 12, background: "transparent", border: "none", borderBottom: index < tasksToday.length - 1 ? "1px solid var(--border-subtle)" : "none", textAlign: "left", cursor: "pointer" }}><span><span style={{ display: "block", fontSize: 'var(--fs-md)', fontWeight: 650 }}>{task.title}</span><span style={{ display: "block", fontSize: 'var(--fs-sm)', color: "var(--text-muted)", marginTop: 3 }}>{task.dueAt ? new Date(task.dueAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "No scheduled time"}</span></span><span className={`chip ${task.status === "DONE" ? "chip-ok" : "chip-warning"}`}>{task.status.replace(/_/g, " ")}</span></button>)}
            </div>
          </section>
        </>
      ) : (
        <>
          <section style={{ marginBottom: 28 }}>
            <h2 className="section-title" style={{ margin: "0 0 10px" }}>Farm performance</h2>
            <div className="farm-card" style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr 1fr", padding: "16px 0" }}>
              <div style={{ paddingLeft: 16 }}><div className="kpi-value" style={{ color: settings?.accentColor ?? "var(--primary-green)" }}>{kpis ? `KSh ${centsToMajor(kpis.periodRevenueCents).toLocaleString()}` : "—"}</div><div style={{ fontSize: 'var(--fs-sm)', color: "var(--text-muted)", marginTop: 4 }}>Revenue this {period}</div></div>
              <button onClick={() => navigate("crops")} style={{ background: "none", border: "none", borderLeft: "1px solid var(--border-subtle)", textAlign: "left", paddingLeft: 16, cursor: "pointer" }}><div style={{ fontSize: 'var(--fs-3xl)', fontWeight: 700 }}>{kpis?.activeBatches ?? "—"}</div><div style={{ fontSize: 'var(--fs-sm)', color: "var(--text-muted)", marginTop: 4 }}>Active batches</div></button>
              <button onClick={() => navigate("tasks")} style={{ background: "none", border: "none", borderLeft: "1px solid var(--border-subtle)", textAlign: "left", paddingLeft: 16, cursor: "pointer" }}><div style={{ fontSize: 'var(--fs-3xl)', fontWeight: 700 }}>{kpis?.activeTasksCount ?? "—"}</div><div style={{ fontSize: 'var(--fs-sm)', color: "var(--text-muted)", marginTop: 4 }}>Open tasks</div></button>
            </div>
            <div style={{ display: "flex", gap: 6, marginTop: 10, marginBottom: 14 }}>{(["month", "quarter", "year"] as const).map(p => <button key={p} onClick={() => setPeriod(p)} className={`filter-chip ${period === p ? "active" : ""}`} style={{ textTransform: "capitalize" }}>{p}</button>)}</div>
            <RevenueTrendChart trend={kpis?.revenueTrend ?? null} color={settings?.accentColor ?? "var(--primary-green)"} />
          </section>
          <section style={{ marginBottom: 28 }}>
            <h2 className="section-title" style={{ margin: "0 0 10px" }}>Operational snapshot</h2>
            <div className="farm-card" style={{ overflow: "hidden" }}>
              {/* "Inventory items tracked" reads kpis.productCount, which the
                * route documents as tenant-wide on every farm (products has
                * no farm relationship — GET /api/dashboard/kpis's header).
                * Labelled "(all farms)" whenever a specific farm is selected
                * so this tile never implies a farm-specific count it can't
                * actually give. */}
              {[["Fields & crops", kpis?.cropBatchGroupsCount, "crops", false], ["Inventory items tracked", kpis?.productCount, "inventory", true], ["Pending approvals", kpis?.pendingApprovals, "governance", false]].map(([label, value, screen, tenantWide], index) => <button key={label as string} onClick={() => navigate(screen as any)} style={{ width: "100%", padding: "13px 14px", background: "transparent", border: "none", borderBottom: index < 2 ? "1px solid var(--border-subtle)" : "none", display: "flex", justifyContent: "space-between", cursor: "pointer", color: "var(--text-primary)", fontSize: 'var(--fs-md)' }}><span>{label as string}{tenantWide && kpis && kpis.farmId && kpis.farmId !== 'ALL' ? <span style={{ color: "var(--text-dim)", fontWeight: 500 }}> (all farms)</span> : null}</span><span style={{ fontWeight: 700 }}>{value as number ?? "—"}</span></button>)}
            </div>
          </section>
        </>
      )}

      <section style={{ paddingBottom: 28 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 10 }}><h2 className="section-title" style={{ margin: 0 }}>Recent activity</h2><button onClick={() => navigate("notifications")} style={{ background: "none", border: "none", color: "var(--primary-green)", cursor: "pointer", fontSize: 'var(--fs-base)', fontWeight: 600 }}>View all</button></div>
        <div className="farm-card" style={{ overflow: "hidden" }}>
          {recent.length === 0 ? <div style={{ padding: 16, fontSize: 'var(--fs-base)', color: "var(--text-muted)" }}>No recent operational updates.</div> : recent.map((note, index) => <button key={note.id} onClick={() => navigate("notifications")} style={{ width: "100%", padding: "13px 14px", textAlign: "left", background: "transparent", border: "none", borderBottom: index < recent.length - 1 ? "1px solid var(--border-subtle)" : "none", cursor: "pointer" }}><div style={{ fontSize: 'var(--fs-md)', fontWeight: 600 }}>{note.title}</div><div style={{ fontSize: 'var(--fs-sm)', color: "var(--text-muted)", marginTop: 3 }}>{note.message || "Open notification"}</div></button>)}
        </div>
      </section>
    </div>
  );
}

/* ── Farm Switcher Sheet ──
 * Multi-farm is a first-class feature (issue #219): an owner/manager with
 * several farms under their tenant switches between them here. As of the
 * farm-scoped-data task this actually re-filters real data, not just a
 * label — screens re-fetch with `farmId=${activeFarmId}` and re-render once
 * a new farm (or 'ALL', the aggregate view) is selected:
 *   dashboard (KPIs + today's tasks), navigation badges (pending approvals,
 *   open-tasks count), crops (batches/units, filtered client-side against
 *   real unit->farm ids), inventory (stock items' lots, purchases), tasks,
 *   finance (sales, purchases, batches), people (employees), and all four
 *   Reports types.
 * Screens/fields that do NOT re-filter, because no farm relationship exists
 * in the schema to filter by (see GET /api/dashboard/kpis's header for the
 * canonical list): the notification bell/feed, the product-price strip,
 * inventory variance, and Finance's GL (chart of accounts / trial balance /
 * budget overview) — journal_entries traces to a sale or purchase by id,
 * not by farm. Those stay tenant-wide on purpose rather than faking a
 * filter; several are labelled "(all farms)" in the UI for exactly that
 * reason. Farms come from the real GET /api/farms when the backend is
 * wired, else the mock set.
 */
function FarmSwitcherSheet({ onClose }: { onClose: () => void }) {
  // Selection compares/sets by `activeFarmId` (a real farms.id), never by
  // `farm.code` — codes are user-editable display labels (PATCH
  // /api/farms/[id] lets an owner rename one), so keying the filter on code
  // would silently stop matching the moment a farm is renamed.
  const { activeFarmId, setActiveFarmId, farms } = useNav()
  return (
    <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.75)", display: "flex", alignItems: "flex-end", zIndex: 100 }} onClick={onClose}>
      <div style={{ background: "var(--surface)", borderRadius: "24px 24px 0 0", padding: 20, width: "100%", border: "1px solid var(--border-subtle)", maxHeight: "60%" }} onClick={e => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <div style={{ fontWeight: 700, fontSize: 'var(--fs-lg)' }}>Switch Farm</div>
          <button className="btn-icon" onClick={onClose}><X size={16} /></button>
        </div>
        <button onClick={() => { setActiveFarmId("ALL"); onClose() }}
          style={{ width: "100%", padding: "12px 14px", marginBottom: 10, borderRadius: 14, textAlign: "left", cursor: "pointer",
            background: activeFarmId === "ALL" ? "rgba(74,222,128,0.12)" : "var(--card)",
            border: activeFarmId === "ALL" ? "1px solid rgba(74,222,128,0.4)" : "1px solid var(--border-subtle)",
            display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 36, height: 36, borderRadius: 12, background: "rgba(74,222,128,0.15)", display: "flex", alignItems: "center", justifyContent: "center", color: 'var(--primary-green)' }}><Globe size={18} aria-hidden="true" /></div>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: 'var(--fs-base)', color: "var(--text-primary)" }}>All Farms</div>
            <div style={{ fontSize: 'var(--fs-xs)', color: "var(--text-muted)" }}>Aggregated view · {farms.length} farms</div>
          </div>
          {activeFarmId === "ALL" && <Check size={16} color="var(--primary-green)" />}
        </button>
        {farms.map(farm => (
          <button key={farm.id} onClick={() => { setActiveFarmId(farm.id); onClose() }}
            style={{ width: "100%", padding: "12px 14px", marginBottom: 10, borderRadius: 14, textAlign: "left", cursor: "pointer",
              background: activeFarmId === farm.id ? "rgba(74,222,128,0.12)" : "var(--card)",
              border: activeFarmId === farm.id ? "1px solid rgba(74,222,128,0.4)" : "1px solid var(--border-subtle)",
              display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 36, height: 36, borderRadius: 12, background: "rgba(74,222,128,0.1)", display: "flex", alignItems: "center", justifyContent: "center", color: 'var(--primary-green)' }}><Building2 size={18} aria-hidden="true" /></div>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700, fontSize: 'var(--fs-base)', color: "var(--text-primary)" }}>{farm.name}</div>
              <div style={{ fontSize: 'var(--fs-xs)', color: "var(--text-muted)" }}>{farm.code} · {farm.location}</div>
            </div>
            {activeFarmId === farm.id && <Check size={16} color="var(--primary-green)" />}
          </button>
        ))}
      </div>
    </div>
  )
}


/* ── Dashboard Screen ── */
export function DashboardScreen({ userName }: { userName?: string }) {
  const { navigate, role, activeFarmId, activeFarm, farms, tenantId } = useNav();
  const [showFarmSwitcher, setShowFarmSwitcher] = useState(false);

  const farm = activeFarmId === "ALL" ? null : farms.find(f => f.id === activeFarmId) ?? farms[0];
  // (Issue #376 Gap 4: the BATCHES_DATA-driven enterprise-card computation
  // that lived here was deleted — it fed variables nothing ever rendered,
  // behind a comment claiming the `batches` table didn't exist. Both halves
  // were wrong: the table exists (db/schemas/index.ts), and per-group counts
  // already reach this screen for real via the KPI fetch below.)

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

  // Re-fetches on activeFarmId change (farm-scoped-data task) — this is the
  // fetch the file header calls out: GET /api/dashboard/kpis re-scopes every
  // farm-scopable metric server-side once `farmId` is in the query string.
  useEffect(() => {
    let cancelled = false;
    apiClient.get<KpiData>(`/api/dashboard/kpis?tenantId=${tenantId}&period=${period}&farmId=${activeFarmId}`).then(res => {
      if (cancelled) return;
      if (res.success) setKpis(res.data);
      else setKpisFailed(true);
    });
    return () => { cancelled = true; };
  }, [tenantId, period, activeFarmId]);

  useEffect(() => {
    let cancelled = false;
    // Product prices have no farm relationship (products is a tenant-wide
    // catalogue — see GET /api/dashboard/kpis's header) — fetched unscoped
    // regardless of activeFarmId.
    apiClient.get<PriceRow[]>(`/api/products/current-prices?tenantId=${tenantId}`).then(res => {
      if (!cancelled && res.success) setPrices(res.data);
    });
    // tasks.farmId is real (migration 0019) — re-scoped like every other
    // farmId-accepting route (activeFarmId in the dep array below).
    apiClient.get<TaskRow[]>(`/api/tasks?tenantId=${tenantId}&due=today&farmId=${activeFarmId}`).then(res => {
      if (!cancelled && res.success) setTasksToday(res.data);
    });
    // Notifications stay tenant-wide — no farm relationship exists.
    apiClient.get<NotificationRow[]>(`/api/notifications?tenantId=${tenantId}`).then(res => {
      if (!cancelled && res.success) setNotifs(res.data);
    });
    return () => { cancelled = true; };
  }, [tenantId, activeFarmId]);

  const unread = notifs?.filter(n => !n.read).length ?? 0;

  // Quick actions vary by role
  const quickActions = [
    { label: "Add Task", screen: "tasks" as const, icon: CheckSquare, roles: ["owner","manager"] },
    { label: "Record Sale", screen: "finance" as const, icon: DollarSign, roles: ["owner"] },
    { label: "Add Stock", screen: "inventory" as const, icon: Package, roles: ["owner","manager"] },
    { label: "AI Chat", screen: "ai-chat" as const, icon: Bot, roles: ["owner","manager","worker"] },
    { label: "Approvals", screen: "governance" as const, icon: Shield, roles: ["owner"] },
    { label: "People", screen: "people" as const, icon: Users, roles: ["owner","manager"] },
  ].filter(a => a.roles.includes(role));

  return <>
    <OperationalDashboard
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
      // Only worth surfacing a switcher when there's something to switch
      // to — a single-farm tenant gets the plain, non-interactive header it
      // had before.
      canSwitchFarm={farms.length > 1}
      onSwitchFarm={() => setShowFarmSwitcher(true)}
    />
    {showFarmSwitcher && <FarmSwitcherSheet onClose={() => setShowFarmSwitcher(false)} />}
  </>;
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
  const typeIcon: Record<string, LucideIcon> = { task: ClipboardList, alert: AlertTriangle, approval: CheckCircle2 };
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
    // sourceId (tasks.id today — see the sourceType comment above for why
    // "approval"/"alert" never actually fire yet) used to be dropped here,
    // so tapping a specific overdue-task notification always landed on the
    // Tasks screen's plain unfiltered list instead of that task. TasksScreen
    // now opens the matching task's detail sheet when `taskId` is present.
    if (n.sourceType === "task") navigate("tasks", n.sourceId ? { taskId: n.sourceId } : undefined);
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
                style={{ fontSize: 'var(--fs-xs)', fontWeight: 700, color: "var(--text-muted)", background: "none", border: "none", cursor: "pointer" }}>
                Mark all read
              </button>
            )}
            <button onClick={() => navigate("notification-settings")}
              style={{ fontSize: 'var(--fs-xs)', fontWeight: 700, color: "var(--primary-green)", background: "none", border: "none", cursor: "pointer" }}>
              Settings
            </button>
          </div>
        }
      />
      <div className="px-screen" style={{ paddingTop: 14 }}>
        {unread > 0 && (
          <div style={{ padding: "8px 12px", background: "rgba(74,222,128,0.06)", border: "1px solid rgba(74,222,128,0.15)", borderRadius: 10, fontSize: 'var(--fs-xs)', color: "var(--primary-green)", marginBottom: 14, fontWeight: 600 }}>
            {unread} unread notification{unread > 1 ? "s" : ""}
          </div>
        )}
        {notifs === null ? (
          <div style={{ fontSize: 'var(--fs-sm)', color: "var(--text-dim)" }}>Loading notifications…</div>
        ) : notifs.length === 0 ? (
          <div className="farm-card" style={{ padding: 16, fontSize: 'var(--fs-sm)', color: "var(--text-muted)", textAlign: "center" }}>
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
                        <div style={{ width: 32, height: 32, borderRadius: 10, background: `${color}15`, border: `1px solid ${color}30`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, color }}>
                          {(() => { const NotifIcon = typeIcon[n.sourceType] ?? Bell; return <NotifIcon size={15} aria-hidden="true" />; })()}
                        </div>
                        <div style={{ flex: 1 }}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                            <div style={{ fontSize: 'var(--fs-base)', fontWeight: n.read ? 500 : 700, color: "var(--text-primary)", lineHeight: 1.3, flex: 1 }}>{n.title}</div>
                            {!n.read && <div style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--primary-green)", flexShrink: 0, marginLeft: 8, marginTop: 4 }} />}
                          </div>
                          {n.message && <div style={{ fontSize: 'var(--fs-sm)', color: "var(--text-muted)", marginTop: 3, lineHeight: 1.4 }}>{n.message}</div>}
                          <div style={{ fontSize: 'var(--fs-2xs)', color: "var(--text-dim)", marginTop: 5 }}>{formatWhen(n.createdAt)}</div>
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
const NOTIF_TYPES: { id: string; label: string; icon: LucideIcon; desc: string }[] = [
  { id: "weather", label: "Weather Alerts", icon: CloudSun, desc: "Rainfall, temperature extremes, storms" },
  { id: "approval", label: "Approval Requests", icon: CheckCircle2, desc: "Worker submissions needing your review" },
  { id: "task", label: "Task Reminders", icon: ClipboardList, desc: "Overdue tasks and upcoming deadlines" },
  { id: "alert", label: "Stock & Farm Alerts", icon: AlertTriangle, desc: "Low stock, health alerts, anomalies" },
  { id: "system", label: "System", icon: Bell, desc: "Payroll reminders, subscription, updates" },
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
                  <div style={{ display: "flex", gap: 9, flex: 1 }}>
                    <t.icon size={16} color="var(--text-muted)" style={{ flexShrink: 0, marginTop: 2 }} aria-hidden="true" />
                    <div>
                      <div style={{ fontSize: 'var(--fs-base)', fontWeight: 600, color: "var(--text-primary)" }}>{t.label}</div>
                      <div style={{ fontSize: 'var(--fs-xs)', color: "var(--text-muted)", marginTop: 1 }}>{t.desc}</div>
                    </div>
                  </div>
                  <button onClick={() => setEnabled(e => ({ ...e, [t.id]: !e[t.id] }))}
                    style={{ width: 44, height: 24, borderRadius: 100, border: "none", cursor: "pointer", flexShrink: 0, marginLeft: 10,
                      background: enabled[t.id] ? "var(--primary-green)" : "rgba(255,255,255,0.1)", position: "relative" }}>
                    <div style={{ width: 18, height: 18, borderRadius: "50%", background: "#fff", position: "absolute", top: 3, left: enabled[t.id] ? 23 : 3, transition: "left 0.2s" }} />
                  </button>
                </div>
                {enabled[t.id] && (
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 'var(--fs-xs)', color: "var(--text-muted)" }}>SMS also</span>
                    <button onClick={() => setSms(s => ({ ...s, [t.id]: !s[t.id] }))}
                      style={{ width: 36, height: 20, borderRadius: 100, border: "none", cursor: "pointer",
                        background: sms[t.id] ? "rgba(96,165,250,0.6)" : "rgba(255,255,255,0.08)", position: "relative" }}>
                      <div style={{ width: 14, height: 14, borderRadius: "50%", background: "#fff", position: "absolute", top: 3, left: sms[t.id] ? 19 : 3, transition: "left 0.2s" }} />
                    </button>
                    <span style={{ fontSize: 'var(--fs-2xs)', color: sms[t.id] ? "var(--accent-blue)" : "var(--text-dim)", fontWeight: 600 }}>{sms[t.id] ? "ON" : "OFF"}</span>
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
                <div style={{ fontSize: 'var(--fs-base)', fontWeight: 600, color: "var(--text-primary)" }}>Enable Quiet Hours</div>
                <div style={{ fontSize: 'var(--fs-xs)', color: "var(--text-muted)", marginTop: 1 }}>Silence non-critical notifications overnight</div>
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
                  <label style={{ fontSize: 'var(--fs-xs)', fontWeight: 700, color: "var(--text-secondary)", display: "block", marginBottom: 5 }}>From</label>
                  <input className="farm-input" type="time" value={quietStart} onChange={e => setQuietStart(e.target.value)} />
                </div>
                <div>
                  <label style={{ fontSize: 'var(--fs-xs)', fontWeight: 700, color: "var(--text-secondary)", display: "block", marginBottom: 5 }}>Until</label>
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
