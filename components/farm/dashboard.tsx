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
//   The dashboard was rebuilt (issue #376 follow-up) to the brief "everything
//   accessible from there, not crowded, alerts as an icon": a hero figure per
//   role, a three-link stat strip, an 8-or-6 tile destination grid, and a
//   capped today's-work list. Alerts are two header badge icons rather than a
//   list that grows. See OperationalDashboard's own header for the four
//   things that were removed and why.
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
  ClipboardList, CloudSun, FileText, type LucideIcon,
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

/* ── Small, reusable pieces ────────────────────────────────────────────────
 * Same discipline as weather.tsx (StatChip / EmptyCard): one job each, house
 * classes only, so the shape of a section is legible at a glance instead of
 * being spelled out inline three times. */

// A headline number with its label. The dashboard's equivalent of the weather
// screen's big temperature — the figure you came to read, at a size you can
// read while walking.
function HeroMetric({ value, label, accent, sub }: { value: string; label: string; accent: string; sub?: string }) {
  return (
    <div>
      <div className="kpi-value" style={{ color: accent, lineHeight: 1.05 }}>{value}</div>
      <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', marginTop: 4 }}>{label}</div>
      {sub && <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-dim)', marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

// One tappable figure in the three-across strip. Tapping goes somewhere — a
// number the user can't act on doesn't earn a slot here.
function StatTile({ value, label, note, onClick }: { value: React.ReactNode; label: string; note?: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="farm-card"
      style={{ flex: 1, minWidth: 0, padding: '11px 8px', textAlign: 'center', cursor: 'pointer', border: '1px solid var(--border-subtle)' }}
    >
      <div style={{ fontSize: 'var(--fs-2xl)', fontWeight: 750, color: 'var(--text-primary)', lineHeight: 1.1 }}>{value}</div>
      <div className="kpi-label" style={{ marginTop: 3 }}>{label}</div>
      {note && <div style={{ fontSize: 'var(--fs-2xs)', color: 'var(--text-dim)', marginTop: 1 }}>{note}</div>}
    </button>
  );
}

// An icon-over-label destination tile. 72px tall, four across — a comfortable
// thumb target on a phone without the label wrapping at 360px.
function NavTile({ icon: Icon, label, tour, onClick }: { icon: LucideIcon; label: string; tour?: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      data-tour={tour}
      style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 5,
        height: 72, padding: '6px 4px', borderRadius: 14, cursor: 'pointer',
        background: 'var(--card)', border: '1px solid var(--border-subtle)',
      }}
    >
      <Icon size={20} color="var(--text-secondary)" aria-hidden="true" />
      <span style={{ fontSize: 'var(--fs-2xs)', fontWeight: 650, color: 'var(--text-secondary)', textAlign: 'center', lineHeight: 1.15 }}>{label}</span>
    </button>
  );
}

// A header status icon that carries its count as a badge instead of a row.
// This is the whole reason the old "Attention required" list is gone: three
// alerts became three full-width cards, and a farm with a real backlog pushed
// every actual number below the fold. A badge says the same thing in 20px and
// cannot grow the layout no matter how many there are.
function AlertIcon({ icon: Icon, count, label, tone, onClick }: {
  icon: LucideIcon; count: number; label: string; tone: string; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="btn-icon"
      aria-label={count > 0 ? `${label}: ${count}` : label}
      title={count > 0 ? `${label}: ${count}` : label}
      style={{ position: 'relative', flexShrink: 0 }}
    >
      <Icon size={17} color={count > 0 ? tone : undefined} />
      {count > 0 && (
        <span
          aria-hidden="true"
          style={{
            position: 'absolute', top: -3, right: -3, minWidth: 16, height: 16, padding: '0 4px',
            borderRadius: 100, background: tone, color: 'var(--surface)',
            fontSize: 10, fontWeight: 800, lineHeight: '16px', textAlign: 'center',
          }}
        >
          {count > 99 ? '99+' : count}
        </span>
      )}
    </button>
  );
}

/* ── Operational dashboard ─────────────────────────────────────────────────
 * Rebuilt to the brief: everything reachable from here, nothing crowded, and
 * alerts collapsed into header icons rather than a list that grows.
 *
 * What changed and why:
 *
 *  1. "Attention required" (a card per alert) → two header icons with count
 *     badges. Three alerts used to cost three full-width rows and push the
 *     revenue figure off-screen on a 360px phone; a badge is fixed-size no
 *     matter how many there are. Nothing is lost — both icons navigate to the
 *     screen that lists them in full.
 *
 *  2. A destination grid replaces the old "Operational snapshot" list. On a
 *     phone the bottom nav holds five tabs, so for an owner Weather,
 *     Inventory, Workers, Governance, Reports, Routines and the AI advisor
 *     were reachable only from the desktop-only sidebar — seven screens with
 *     no mobile route at all. That was the actual "everything accessible"
 *     gap, and it is what this grid fixes.
 *
 *  3. `quickActions` in DashboardScreen was computed and then never passed to
 *     this component or rendered anywhere — dead code behind a file-header
 *     comment claiming "QuickActions navigate to relevant screens". The grid
 *     below is the live version of that intent; the dead array is deleted.
 *
 *  4. "Recent activity" (four notification rows) is gone. It restated the
 *     bell badge at four rows' cost, and every row navigated to the same
 *     screen the bell does.
 *
 * The tiles carry the same `data-tour` ids as the sidebar/tab items, which is
 * a real fix rather than decoration: tour.tsx picks the first VISIBLE match
 * for an id (see readRect there), and on mobile the 'nav-weather' and
 * 'nav-people' steps previously had no visible target at all, so the guided
 * tour silently skipped them. Now they land on these tiles. */
function OperationalDashboard({
  role, userName, farmName, farmMeta, kpis, kpisFailed, tasksToday, notifs, period, setPeriod, navigate, settings,
  onSwitchFarm, canSwitchFarm,
}: {
  role: DashboardRole; userName?: string; farmName: string; farmMeta: string; kpis: KpiData | null;
  // Was set by the fetch and rendered nowhere — so a failed KPI load left
  // every figure showing "—", which reads as "your farm has no data" rather
  // than "we could not load it". Same honesty rule the rest of this app
  // follows: an unavailable number says why.
  kpisFailed: boolean;
  tasksToday: TaskRow[] | null; notifs: NotificationRow[] | null; period: Period;
  setPeriod: (period: Period) => void; navigate: (screen: any) => void;
  settings: DashboardSettings | null;
  // Mobile has no sidebar (AppSidebar's "Farm" <select> is desktop-only, CSS
  // media-query gated) — this is what lets a mobile user with more than one
  // farm actually switch.
  onSwitchFarm?: () => void; canSwitchFarm?: boolean;
}) {
  const today = new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
  const isManager = role === "manager";
  const accent = settings?.accentColor ?? "var(--primary-green)";

  const scheduled = tasksToday?.length ?? 0;
  const completed = tasksToday?.filter(t => t.status === "DONE").length ?? 0;
  const delayed = tasksToday?.filter(t => t.status !== "DONE" && t.dueAt && new Date(t.dueAt) < new Date()).length ?? 0;

  // The two alert counts, each collapsed to one icon. Overdue work and
  // pending approvals are the same kind of thing — "somebody has to act" — so
  // they share one triangle rather than competing for header space.
  const unread = notifs?.filter(n => !n.read).length ?? kpis?.unreadNotifications ?? 0;
  const needsAction = (kpis?.overdueTasksCount ?? 0) + (kpis?.pendingApprovals ?? 0);
  // Send the triangle wherever the bigger pile is, so one tap lands on the
  // list the farmer actually needs rather than a fixed guess.
  const actionScreen = (kpis?.pendingApprovals ?? 0) > (kpis?.overdueTasksCount ?? 0) ? "governance" : "tasks";

  // Destinations, role-filtered. `owner` only for Finance/Reports, matching
  // AppSidebar's ownerOnly flags and the server-side role checks behind those
  // screens — this grid must not offer a manager a screen the API refuses.
  // Deliberately excludes crops / tasks / governance: the stat strip directly
  // above already links to all three, with a live number on it. Repeating them
  // here would be the crowding this rebuild is removing, and it is what left
  // the owner grid with an orphan row of two.
  const destinations: { id: string; label: string; icon: LucideIcon; tour?: string; roles: readonly string[] }[] = ([
    { id: "inventory", label: "Stock", icon: Package, roles: ["owner", "manager"] },
    { id: "weather", label: "Weather", icon: CloudSun, tour: "nav-weather", roles: ["owner", "manager"] },
    { id: "people", label: "Workers", icon: Users, tour: "nav-people", roles: ["owner", "manager"] },
    { id: "routines", label: "Routines", icon: ClipboardList, roles: ["owner", "manager"] },
    { id: "finance", label: "Finance", icon: DollarSign, roles: ["owner"] },
    { id: "reports", label: "Reports", icon: FileText, roles: ["owner"] },
    { id: "ai-chat", label: "Advisor", icon: Bot, roles: ["owner", "manager"] },
    // On mobile the bottom tab for this is labelled "More", which says nothing
    // about where it goes. An explicit tile is clearer, and it squares the grid.
    { id: "settings", label: "Settings", icon: Settings, tour: "nav-settings", roles: ["owner", "manager"] },
  ]).filter(d => d.roles.includes(role));

  // Column count follows the item count so the last row is never a stray one
  // or two tiles: owner has 8 (two rows of four), manager 6 (two rows of
  // three). A partial row reads as an accident on a screen this sparse.
  const tileColumns = destinations.length % 4 === 0 ? 4 : 3;

  // Capped at three. The full list is one tap away, and an uncapped day's
  // work is exactly how this screen got crowded in the first place.
  const todayPreview = (tasksToday ?? []).slice(0, 3);

  return (
    <div className="screen-content px-screen" style={{ paddingTop: 20 }}>
      <header style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "flex-start", marginBottom: 18 }}>
        {/* flex:1 + minWidth:0 is what actually lets the name ellipsise — a
            flex item defaults to min-width:auto and will happily overflow its
            container, which is how "Kamau Poultry Farm" ran under the alert
            icons and got clipped mid-word. */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 'var(--fs-sm)', color: "var(--text-muted)" }}>
            {settings?.dashboardGreeting ?? "Good morning,"} {userName ?? ""}
          </div>
          {canSwitchFarm ? (
            <button
              onClick={onSwitchFarm}
              data-tour="farm-switcher"
              style={{ display: "flex", alignItems: "center", gap: 6, maxWidth: "100%", background: "none", border: "none", padding: 0, marginTop: 2, cursor: "pointer", fontSize: 'var(--fs-2xl)', lineHeight: 1.2, color: "var(--text-primary)", fontWeight: 800, textAlign: "left" }}
            >
              <span aria-hidden="true">{settings?.logoEmoji ?? "🌾"}</span>
              <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{farmName}</span>
              <ChevronDown size={18} color="var(--text-muted)" aria-hidden="true" style={{ flexShrink: 0 }} />
            </button>
          ) : (
            <h1 style={{ margin: "2px 0 0", fontSize: 'var(--fs-2xl)', lineHeight: 1.2, color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              <span aria-hidden="true">{settings?.logoEmoji ?? "🌾"}</span> {farmName}
            </h1>
          )}
          <div style={{ fontSize: 'var(--fs-xs)', color: "var(--text-dim)", marginTop: 4 }}>{today} · {farmMeta}</div>
        </div>
        {/* Alerts as icons, per the brief — fixed width whatever the counts. */}
        <div style={{ display: "flex", gap: 8, flexShrink: 0, paddingTop: 2 }}>
          <AlertIcon icon={AlertTriangle} count={needsAction} label="Needs action" tone="var(--status-warning)" onClick={() => navigate(actionScreen)} />
          <AlertIcon icon={Bell} count={unread} label="Notifications" tone="var(--status-info)" onClick={() => navigate("notifications")} />
        </div>
      </header>

      {/* Hero: the one figure this role opens the app for. An owner reads
          money; a manager reads whether today's work is on track. */}
      <div className="farm-card" style={{ padding: 16, marginBottom: 12 }}>
        {isManager ? (
          <>
            <HeroMetric
              value={tasksToday === null ? "—" : `${completed}/${scheduled}`}
              label="Today&rsquo;s work completed"
              accent={accent}
              sub={delayed > 0 ? `${delayed} running late` : scheduled === 0 ? "Nothing scheduled today" : "On track"}
            />
            {/* The owner's half of this card holds a revenue trend; a manager's
                held nothing, so the card was mostly empty space. This is the
                same number as the figure above, in the form you can read
                without doing the division. Rendered only when there IS work:
                an empty bar for an empty day is a worse answer than no bar. */}
            {scheduled > 0 && (
              <div style={{ marginTop: 14 }}>
                <div
                  role="img"
                  aria-label={`${completed} of ${scheduled} tasks complete${delayed > 0 ? `, ${delayed} running late` : ""}`}
                  style={{ display: "flex", gap: 2, height: 8, borderRadius: 100, overflow: "hidden", background: "var(--border-subtle)" }}
                >
                  <div style={{ width: `${(completed / scheduled) * 100}%`, background: accent }} />
                  {delayed > 0 && <div style={{ width: `${(delayed / scheduled) * 100}%`, background: "var(--status-warning)" }} />}
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", marginTop: 5, fontSize: 'var(--fs-2xs)', color: "var(--text-dim)" }}>
                  <span>{completed} done{delayed > 0 ? ` · ${delayed} late` : ""}</span>
                  <span>{scheduled} scheduled</span>
                </div>
              </div>
            )}
          </>
        ) : (
          <>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
              <HeroMetric
                value={kpis ? `KSh ${centsToMajor(kpis.periodRevenueCents).toLocaleString()}` : "—"}
                label={`Revenue this ${period}`}
                accent={accent}
                sub={kpis?.marginPct != null ? `${kpis.marginPct}% margin` : undefined}
              />
              <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                {(["month", "quarter", "year"] as const).map(p => (
                  <button key={p} onClick={() => setPeriod(p)} className={`filter-chip ${period === p ? "active" : ""}`} style={{ textTransform: "capitalize" }}>
                    {p.charAt(0).toUpperCase()}
                  </button>
                ))}
              </div>
            </div>
            <div style={{ marginTop: 12 }}>
              <RevenueTrendChart trend={kpis?.revenueTrend ?? null} color={accent} />
            </div>
          </>
        )}
      </div>

      {/* Three figures, each a link. Deliberately three: four fits at 360px
          but leaves no room for a label longer than one word. */}
      <div style={{ display: "flex", gap: 8, marginBottom: 18 }}>
        <StatTile value={kpis?.activeBatches ?? "—"} label="Batches" onClick={() => navigate("crops")} />
        <StatTile value={kpis?.activeTasksCount ?? "—"} label="Open tasks" onClick={() => navigate("tasks")} />
        {isManager
          ? <StatTile value={kpis?.cropBatchGroupsCount ?? "—"} label="Crops" onClick={() => navigate("crops")} />
          : <StatTile value={kpis?.pendingApprovals ?? "—"} label="Approvals" onClick={() => navigate("governance")} />}
      </div>

      {/* Everything else, one tap away. */}
      <section style={{ marginBottom: 18 }}>
        <div className="section-eyebrow" style={{ marginBottom: 8 }}>Go to</div>
        <div style={{ display: "grid", gridTemplateColumns: `repeat(${tileColumns}, 1fr)`, gap: 8 }}>
          {destinations.map(d => (
            <NavTile key={d.id} icon={d.icon} label={d.label} tour={d.tour} onClick={() => navigate(d.id)} />
          ))}
        </div>
      </section>

      {/* Today's work — capped, with the full list one tap away. */}
      <section style={{ paddingBottom: 28 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
          <div className="section-eyebrow">Today&rsquo;s work</div>
          <button onClick={() => navigate("tasks")} style={{ background: "none", border: "none", color: accent, cursor: "pointer", fontSize: 'var(--fs-xs)', fontWeight: 700 }}>
            {scheduled > todayPreview.length ? `All ${scheduled}` : "Open tasks"}
          </button>
        </div>
        <div className="farm-card" style={{ overflow: "hidden" }}>
          {tasksToday === null ? (
            <div style={{ padding: 14, fontSize: 'var(--fs-sm)', color: "var(--text-muted)" }}>Loading scheduled work…</div>
          ) : todayPreview.length === 0 ? (
            <div style={{ padding: 16, fontSize: 'var(--fs-sm)', color: "var(--text-muted)" }}>No tasks are scheduled for today.</div>
          ) : todayPreview.map((task, index) => (
            <button
              key={task.id}
              onClick={() => navigate("tasks")}
              style={{ width: "100%", padding: "12px 14px", display: "grid", gridTemplateColumns: "1fr auto", gap: 10, alignItems: "center", background: "transparent", border: "none", borderBottom: index < todayPreview.length - 1 ? "1px solid var(--border-subtle)" : "none", textAlign: "left", cursor: "pointer" }}
            >
              <span style={{ minWidth: 0 }}>
                <span style={{ display: "block", fontSize: 'var(--fs-sm)', fontWeight: 650, color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{task.title}</span>
                <span style={{ display: "block", fontSize: 'var(--fs-2xs)', color: "var(--text-muted)", marginTop: 2 }}>
                  {task.dueAt ? new Date(task.dueAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "No scheduled time"}
                </span>
              </span>
              <span className={`chip ${task.status === "DONE" ? "chip-ok" : "chip-warning"}`} style={{ fontSize: 'var(--fs-2xs)', flexShrink: 0 }}>
                {task.status.replace(/_/g, " ")}
              </span>
            </button>
          ))}
        </div>
        {kpisFailed && (
          <div className="farm-card" style={{ marginTop: 10, padding: '11px 13px', display: 'flex', gap: 9, alignItems: 'flex-start', border: '1px solid rgba(251,191,36,0.3)' }}>
            <Info size={15} color="var(--accent-amber)" style={{ flexShrink: 0, marginTop: 1 }} aria-hidden="true" />
            <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', lineHeight: 1.5 }}>
              Farm figures couldn&rsquo;t be loaded just now, so the numbers above are blank rather than wrong. Everything else on this screen still works.
            </div>
          </div>
        )}
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

  // (The `quickActions` array that used to sit here was computed on every
  // render and passed nowhere — see OperationalDashboard's header. Its intent
  // now lives in that component's destination grid, which actually renders.)

  return <>
    <OperationalDashboard
      role={role}
      userName={userName}
      farmName={activeFarm === "ALL" ? "All farms" : farm?.name ?? "Farm overview"}
      farmMeta={activeFarm === "ALL" ? `${farms.length} farms · synced` : `${farm?.location ?? ""} · synced`}
      kpis={kpis}
      kpisFailed={kpisFailed}
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
