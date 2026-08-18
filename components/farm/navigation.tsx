"use client";
import React, { useState, useEffect, createContext, useContext, useCallback } from "react";
import { Home, Leaf, Package, CloudSun, DollarSign, CheckSquare, Users, Shield, BarChart3, Settings, Bell, ChevronLeft, Search, Plus, UserCircle, MessageCircle, LogOut } from "./icons";
import { apiClient } from "@/lib/request";

/* ── Screen registry ── */
export type ScreenId =
  | "dashboard" | "crops" | "inventory" | "weather" | "finance"
  | "tasks" | "people" | "governance" | "reports" | "settings"
  | "notifications" | "ai-chat"
  | "worker-home" | "worker-record" | "worker-pay" | "worker-profile"
  | "admin-dashboard" | "admin-farms" | "admin-settings" | "admin-onboarding"
  | "batch-detail" | "crop-schedule" | "inventory-detail"
  | "people-detail"
  | "process-config"
  | "notification-settings"
  | "ui-customise" | "role-notice";

/* ── Session role contract (issue #219) ──
 * The UI role set mirrors the backend exactly (backend: `lib/types/index.ts`):
 *   "owner" | "manager" | "worker" | "vet" | "auditor" | "super_admin"
 * The mock UI's old "admin" role maps to the backend's "super_admin" — there is
 * no "admin" role in the backend and we must not invent one.
 * vet/auditor are real backend roles but have no dedicated screens in this mobile
 * pass: they are routed to RoleNoticeScreen (explicit deny with a clear message),
 * never silently into the worker/owner tab set. */
export type Role = "owner" | "manager" | "worker" | "vet" | "auditor" | "super_admin";

/* A farm as the shell needs it: identity + display fields, mapped from the
 * backend's GET /api/farms rows. */
export interface FarmSummary {
  id: string;
  code: string;
  name: string;
  location: string;
}

/* Issue #320: each history entry captures the screen being left AND the
 * params that were active for it, so goBack() can restore both instead of
 * unconditionally clearing params to {}. Without this, any params-dependent
 * detail screen (batch-detail, inventory-detail, people-detail,
 * process-config) reached through 2+ levels of back navigation renders
 * "not found" once its params are wiped by an intermediate goBack(). */
export interface HistoryEntry {
  screen: ScreenId;
  params: Record<string, string>;
}

export interface NavContext {
  current: ScreenId;
  history: HistoryEntry[];
  role: Role;
  params: Record<string, string>;
  activeFarm: string; // Code of the farm currently in view — switchable (multi-farm, issue #219).
  farms: FarmSummary[]; // The tenant's farms, from GET /api/farms.
  tenantId: string; // Resolved tenant scope for tenant-scoped GETs (issue #228) — same
                     // session-tenant-wins / PROVISIONAL_TENANT_ID fallback as the farms fetch below.
  navigate: (to: ScreenId, params?: Record<string, string>) => void;
  goBack: () => void;
  setActiveFarm: (code: string) => void;
  pendingApprovals: number; // Real count from GET /api/approvals?status=pending (issue #293).
  unreadNotifs: number; // Real count from GET /api/notifications, filtered to read:false (issue #293).
  openTasksCount: number; // Real count from GET /api/dashboard/kpis's activeTasksCount — the
                          // tenant's tasks not DONE/CANCELLED (issue #298; reused, not re-derived).
  pendingOnboardingRequests: number; // Real count of `onboard_requests` rows with status
                                      // 'pending' (issue #251/#252), super_admin sessions only —
                                      // 0 for every other role (issue #298).
}

/* Tenant scope for /api/farms. With real sessions (issue #221) NavProvider gets
 * the session's tenantId from the bootstrap; this env value is only the fallback
 * for standalone mock mode (no backend running). */
const PROVISIONAL_TENANT_ID = process.env.NEXT_PUBLIC_TENANT_ID ?? "t1";

const NavCtx = createContext<NavContext>({
  current: "dashboard", history: [], role: "owner", params: {},
  activeFarm: "FRM-KMU-001",
  farms: [],
  tenantId: PROVISIONAL_TENANT_ID,
  navigate: () => {}, goBack: () => {}, setActiveFarm: () => {},
  pendingApprovals: 0, unreadNotifs: 0,
  openTasksCount: 0, pendingOnboardingRequests: 0,
});

export function useNav() { return useContext(NavCtx); }

/* ── Pure history-stack push/pop (issue #320) ──
 * Extracted so the stack logic is testable without a DOM/render harness,
 * following the same pattern as tabBadge() (issue #298 / tests/nav-tab-badges.test.ts). */
export function pushHistoryEntry(history: HistoryEntry[], entry: HistoryEntry): HistoryEntry[] {
  return [...history, entry];
}

export function popHistoryEntry(history: HistoryEntry[]): { history: HistoryEntry[]; entry: HistoryEntry | null } {
  if (!history.length) return { history, entry: null };
  return { history: history.slice(0, -1), entry: history[history.length - 1] };
}

/* ── Tab bar config per role ── */
const OWNER_TABS = [
  { id: "dashboard" as ScreenId, label: "Home", icon: Home },
  { id: "crops" as ScreenId, label: "Farm", icon: Leaf },
  { id: "finance" as ScreenId, label: "Finance", icon: DollarSign },
  { id: "tasks" as ScreenId, label: "Tasks", icon: CheckSquare },
  { id: "settings" as ScreenId, label: "More", icon: Settings },
];
const MANAGER_TABS = [
  { id: "dashboard" as ScreenId, label: "Home", icon: Home },
  { id: "crops" as ScreenId, label: "Farm", icon: Leaf },
  { id: "tasks" as ScreenId, label: "Tasks", icon: CheckSquare },
  { id: "inventory" as ScreenId, label: "Stock", icon: Package },
  { id: "settings" as ScreenId, label: "More", icon: Settings },
];
const WORKER_TABS = [
  { id: "worker-home" as ScreenId, label: "Home", icon: Home },
  { id: "worker-record" as ScreenId, label: "Record", icon: Plus },
  { id: "worker-pay" as ScreenId, label: "Pay", icon: DollarSign },
  { id: "worker-profile" as ScreenId, label: "Profile", icon: UserCircle },
];
const ADMIN_TABS = [
  { id: "admin-dashboard" as ScreenId, label: "Overview", icon: BarChart3 },
  { id: "admin-farms" as ScreenId, label: "Farms", icon: Leaf },
  { id: "admin-onboarding" as ScreenId, label: "Requests", icon: Users },
  { id: "admin-settings" as ScreenId, label: "Config", icon: Settings },
];

function getTabsForRole(role: NavContext["role"]) {
  if (role === "worker") return WORKER_TABS;
  if (role === "super_admin") return ADMIN_TABS; // UI "admin" → backend "super_admin"
  if (role === "manager") return MANAGER_TABS;
  // vet / auditor: explicit deny — no tabs; the shell shows RoleNoticeScreen instead.
  if (role === "vet" || role === "auditor") return [];
  return OWNER_TABS;
}

/* Where each role lands on login (issue #219 role decisions). */
function startScreenForRole(role: Role): ScreenId {
  if (role === "worker") return "worker-home";
  if (role === "super_admin") return "admin-dashboard";
  // vet / auditor get an explicit "not supported yet" notice, not a silent fallback.
  if (role === "vet" || role === "auditor") return "role-notice";
  return "dashboard"; // owner / manager
}

export function NavProvider({ children, initialRole = "owner", initialTenantId }: { children: React.ReactNode; initialRole?: NavContext["role"]; initialTenantId?: string }) {
  const [role, setRole] = useState<NavContext["role"]>(initialRole);
  const startScreen: ScreenId = startScreenForRole(initialRole);
  const [current, setCurrent] = useState<ScreenId>(startScreen);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [params, setParams] = useState<Record<string, string>>({});
  const [activeFarm, setActiveFarm] = useState("FRM-KMU-001");
  const tenantId = initialTenantId ?? PROVISIONAL_TENANT_ID;

  // The tenant's farms for the switcher, from the real backend (GET /api/farms).
  // Start empty — no mock farms flash in while the fetch is in flight, and a
  // failed/empty response stays empty (an empty tenant must not see fake
  // farms). The old mock FARMS_DATA fallback was removed for the same reason.
  const [farms, setFarms] = useState<FarmSummary[]>([]);
  useEffect(() => {
    let cancelled = false;
    apiClient.get<{ id: string; code: string; name: string; location: string }[]>(
      `/api/farms?tenantId=${tenantId}`
    ).then(res => {
      if (cancelled) return;
      if (res.success && Array.isArray(res.data) && res.data.length) {
        const real = res.data.map(f => ({ id: f.id, code: f.code || f.id, name: f.name, location: f.location ?? "" }));
        setFarms(real);
        // The shell starts on a default code; land on the first real farm so
        // the badge/filters stay coherent.
        setActiveFarm(prev => (real.some(f => f.code === prev) ? prev : real[0].code));
      }
    });
    return () => { cancelled = true; };
  }, []);

  // vet/auditor have no screens in this pass — funnel every navigation attempt to
  // the role notice (single enforcement point; startScreenForRole handles the
  // initial screen, this guard covers deep links / back / any future caller).
  const navigate = useCallback((to: ScreenId, p?: Record<string, string>) => {
    const dest = role === "vet" || role === "auditor" ? "role-notice" : to;
    // Push the screen being left along with the params it was showing —
    // not the destination's params — so a later goBack() can restore them.
    setHistory((h) => pushHistoryEntry(h, { screen: current, params }));
    setCurrent(dest);
    setParams(p ?? {});
  }, [role, current, params]);
  const goBack = useCallback(() => {
    const { history: rest, entry } = popHistoryEntry(history);
    if (!entry) return;
    setHistory(rest);
    setCurrent(entry.screen);
    setParams(entry.params);
  }, [history]);

  // Real nav-badge counts (issue #293): pendingApprovals from GET /api/approvals
  // (status=pending, server-side filtered) and unreadNotifs from GET
  // /api/notifications (client-side filtered on `read`, same convention
  // dashboard.tsx already uses). Fetched once per navigation mount / tenant
  // change — a v1-proportionate replacement for the old hardcoded literals,
  // not new polling infra. Defaults stay 0 so a tenant with no real pending
  // approvals/unread notifications shows no fake badge.
  const [pendingApprovals, setPendingApprovals] = useState(0);
  const [unreadNotifs, setUnreadNotifs] = useState(0);
  // issue #298: tasks tab badge reuses GET /api/dashboard/kpis's activeTasksCount
  // (tenant's tasks not DONE/CANCELLED, already computed server-side by that
  // route) rather than re-deriving the same DONE_STATUSES filter a second time
  // client-side.
  const [openTasksCount, setOpenTasksCount] = useState(0);
  useEffect(() => {
    let cancelled = false;
    apiClient.get<{ id: string }[]>(`/api/approvals?tenantId=${tenantId}&status=pending`).then(res => {
      if (!cancelled && res.success && Array.isArray(res.data)) setPendingApprovals(res.data.length);
    });
    apiClient.get<{ read: boolean }[]>(`/api/notifications?tenantId=${tenantId}`).then(res => {
      if (!cancelled && res.success && Array.isArray(res.data)) {
        setUnreadNotifs(res.data.filter(n => !n.read).length);
      }
    });
    apiClient.get<{ activeTasksCount: number }>(`/api/dashboard/kpis?tenantId=${tenantId}`).then(res => {
      if (!cancelled && res.success && res.data && typeof res.data.activeTasksCount === "number") {
        setOpenTasksCount(res.data.activeTasksCount);
      }
    });
    return () => { cancelled = true; };
  }, [tenantId]);

  // issue #298: admin-onboarding tab badge — real count of `onboard_requests`
  // rows with status 'pending' (issue #251/#252). GET /api/onboard-requests is
  // the super_admin review queue (403s for every other role), so this only
  // fetches — and only ever shows a badge — for a super_admin session.
  const [pendingOnboardingRequests, setPendingOnboardingRequests] = useState(0);
  useEffect(() => {
    if (role !== "super_admin") { setPendingOnboardingRequests(0); return; }
    let cancelled = false;
    apiClient.get<{ status: string }[]>(`/api/onboard-requests`).then(res => {
      if (!cancelled && res.success && Array.isArray(res.data)) {
        setPendingOnboardingRequests(res.data.filter(r => r.status === "pending").length);
      }
    });
    return () => { cancelled = true; };
  }, [role]);

  return (
    <NavCtx.Provider value={{ current, history, role, params, activeFarm, farms, tenantId, navigate, goBack, setActiveFarm, pendingApprovals, unreadNotifs, openTasksCount, pendingOnboardingRequests }}>
      {process.env.NODE_ENV !== "production" && (
        <RoleSelector role={role} setRole={(r) => { setRole(r); setCurrent(startScreenForRole(r)); setHistory([]); }} />
      )}
      {children}
    </NavCtx.Provider>
  );
}

function RoleSelector({ role, setRole }: { role: NavContext["role"]; setRole: (r: NavContext["role"]) => void }) {
  return (
    <div style={{ position: "absolute", top: 0, right: 0, zIndex: 200, padding: "5px 8px" }}>
      <select value={role} onChange={(e) => setRole(e.target.value as NavContext["role"])}
        style={{ background: "rgba(10,15,10,0.95)", border: "1px solid rgba(74,222,128,0.3)", color: "#4ade80", borderRadius: 8, fontSize: 10, padding: "3px 6px", cursor: "pointer", fontWeight: 700 }}>
        <option value="owner">👑 Owner</option>
        <option value="manager">🧑‍💼 Manager</option>
        <option value="worker">👷 Worker</option>
        <option value="vet">🩺 Vet</option>
        <option value="auditor">🔍 Auditor</option>
        <option value="super_admin">⚙️ Super Admin</option>
      </select>
    </div>
  );
}

/* ── Role notice (vet / auditor) ──
 * vet and auditor are real backend roles but have no dedicated screens in this
 * mobile pass. Instead of silently landing them in the worker/owner tab set, the
 * shell shows this explicit notice (decision documented in issue #219). */
export function RoleNoticeScreen() {
  const { role } = useNav();
  const roleLabel = role === "vet" ? "Veterinarian" : "Auditor";
  return (
    <div className="screen-content" style={{ padding: "0 20px" }}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "72%", textAlign: "center", paddingTop: 10 }}>
        <div style={{ width: 72, height: 72, borderRadius: "50%", background: "rgba(96,165,250,0.1)", border: "1px solid rgba(96,165,250,0.3)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 34, marginBottom: 18 }}>
          {role === "vet" ? "🩺" : "🔍"}
        </div>
        <div style={{ fontSize: 18, fontWeight: 800, color: "var(--text-primary)", marginBottom: 8 }}>Role not yet supported</div>
        <div style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.55, maxWidth: 300 }}>
          You&apos;re signed in as a <strong style={{ color: "var(--text-secondary)" }}>{roleLabel}</strong>. This mobile app doesn&apos;t support the {roleLabel.toLowerCase()} role yet — please use the desktop web app. You can sign out below.
        </div>
        <button
          onClick={() => { if (_globalLogout) _globalLogout(); }}
          style={{ marginTop: 22, padding: "13px 34px", borderRadius: 14, fontSize: 14, fontWeight: 700, cursor: "pointer",
            background: "rgba(248,113,113,0.1)", border: "1px solid rgba(248,113,113,0.3)", color: "var(--status-critical)", display: "flex", alignItems: "center", gap: 8 }}>
          <LogOut size={14} /> Sign Out
        </button>
      </div>
    </div>
  );
}

/* ── Bottom Tab Bar ── */
export function BottomNav() {
  const { current, navigate, role, pendingApprovals, unreadNotifs, openTasksCount, pendingOnboardingRequests } = useNav();
  const tabs = getTabsForRole(role);

  return (
    <nav className="bottom-nav">
      {tabs.map((tab) => {
        const Icon = tab.icon;
        const isActive = tabIsActive(current, tab.id);
        const badge = tabBadge(tab.id, pendingApprovals, unreadNotifs, openTasksCount, pendingOnboardingRequests);
        return (
          <button key={tab.id} className={`bottom-nav-item ${isActive ? "active" : ""}`} onClick={() => navigate(tab.id)}>
            <Icon className="nav-icon" size={22} />
            {badge !== null && <span className="nav-badge">{badge}</span>}
            <span className="nav-label">{tab.label}</span>
          </button>
        );
      })}
    </nav>
  );
}

/* Badge counts shared by BottomNav (mobile) and AppSidebar (desktop). All four
 * are real counts (issue #293 for governance/dashboard, issue #298 for
 * tasks/admin-onboarding) — no hardcoded literals. A tenant/session with 0 of
 * any of these shows no badge, not a fake number. */
export function tabBadge(tabId: ScreenId, pendingApprovals: number, unreadNotifs: number, openTasksCount: number, pendingOnboardingRequests: number): number | null {
  if (tabId === "governance" && pendingApprovals > 0) return pendingApprovals;
  if (tabId === "tasks" && openTasksCount > 0) return openTasksCount;
  if (tabId === "dashboard" && unreadNotifs > 0) return unreadNotifs;
  if (tabId === "admin-onboarding" && pendingOnboardingRequests > 0) return pendingOnboardingRequests;
  return null;
}

/* Active-tab detection shared by BottomNav (mobile) and AppSidebar (desktop). */
function tabIsActive(current: ScreenId, tabId: ScreenId): boolean {
  const SUB_SCREENS: Record<string, ScreenId[]> = {
    settings: ["people","governance","reports","inventory","weather","process-config","notification-settings","ui-customise","ai-chat"],
    crops: ["batch-detail","crop-schedule"],
    "admin-onboarding": ["admin-onboarding"],
  };
  return current === tabId || (SUB_SCREENS[tabId] ?? []).includes(current);
}

/* ── Desktop Sidebar (issue #220) ──
 * Same tab set BottomNav drives (getTabsForRole). Shown >=1024px via CSS, where
 * BottomNav is hidden; rendered on all sizes so the tab set lives in one place. */
export function AppSidebar() {
  const { current, navigate, role, pendingApprovals, unreadNotifs, openTasksCount, pendingOnboardingRequests, activeFarm, farms } = useNav();
  const tabs = getTabsForRole(role);
  return (
    <aside className="farm-sidebar">
      <div className="farm-sidebar-brand">
        <span style={{ fontSize: 26 }}>🌾</span>
        <div>
          <div style={{ fontSize: 15, fontWeight: 800, color: "var(--text-primary)" }}>IFMS</div>
          <div style={{ fontSize: 9, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.1em" }}>Farm OS</div>
        </div>
      </div>
      <nav style={{ flex: 1, overflowY: "auto", padding: "10px 12px" }}>
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const active = tabIsActive(current, tab.id);
          const badge = tabBadge(tab.id, pendingApprovals, unreadNotifs, openTasksCount, pendingOnboardingRequests);
          return (
            <button key={tab.id} onClick={() => navigate(tab.id)}
              style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", marginBottom: 2,
                borderRadius: 10, cursor: "pointer", textAlign: "left", position: "relative",
                background: active ? "rgba(74,222,128,0.12)" : "transparent",
                border: active ? "1px solid rgba(74,222,128,0.3)" : "1px solid transparent",
                color: active ? "var(--primary-green)" : "var(--text-muted)", fontWeight: active ? 700 : 500, fontSize: 13 }}>
              <Icon size={18} />
              <span style={{ flex: 1 }}>{tab.label}</span>
              {badge !== null && <span className="nav-badge">{badge}</span>}
            </button>
          );
        })}
      </nav>
      <div style={{ padding: "12px 14px", borderTop: "1px solid var(--border-subtle)", flexShrink: 0 }}>
        <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 2 }}>
          {activeFarm === "ALL" ? "🌐 All Farms" : `🌾 ${farms.find(f => f.code === activeFarm)?.name ?? activeFarm}`}
        </div>
        <div style={{ fontSize: 10, color: "var(--text-dim)", textTransform: "capitalize" }}>{role}</div>
      </div>
    </aside>
  );
}

/* ── Top Nav Bar ── */
export function TopNav({
  title, subtitle, showBack = false, showSearch = false, showBell = false,
  rightEl, farmBadge, onSearchClick,
}: {
  title: string; subtitle?: string; showBack?: boolean; showSearch?: boolean;
  showBell?: boolean; rightEl?: React.ReactNode; farmBadge?: string;
  onSearchClick?: () => void;
}) {
  const { goBack, unreadNotifs, navigate, role } = useNav();
  // Lazy import to avoid circular dep — LogoutCtx lives in page.tsx
  // We access it via a dynamic require-style context lookup
  const [showLogoutConfirm, setShowLogoutConfirm] = React.useState(false);

  return (
    <div className="top-nav">
      {showBack ? (
        <button className="btn-icon" onClick={goBack} style={{ width: 36, height: 36, minWidth: 36 }}>
          <ChevronLeft size={18} />
        </button>
      ) : (
        /* Logout icon sits in the top-left when not showing back */
        <LogoutButton />
      )}
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 17, fontWeight: 700, color: "var(--text-primary)", lineHeight: 1.2 }}>{title}</div>
        {subtitle && <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 1 }}>{subtitle}</div>}
        {farmBadge && (
          <div style={{ display: "inline-flex", alignItems: "center", gap: 4, background: "rgba(74,222,128,0.08)", border: "1px solid rgba(74,222,128,0.2)", borderRadius: 100, padding: "2px 8px", marginTop: 3 }}>
            <span style={{ fontSize: 9, fontWeight: 700, color: "var(--primary-green)" }}>🌾 {farmBadge}</span>
          </div>
        )}
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        {rightEl}
        {showSearch && <button className="btn-icon" onClick={onSearchClick}><Search size={16} /></button>}
        {showBell && (
          <button className="btn-icon" style={{ position: "relative" }} onClick={() => navigate("notifications")}>
            <Bell size={16} />
            {unreadNotifs > 0 && (
              <span style={{ position: "absolute", top: 6, right: 6, width: 8, height: 8, background: "var(--status-critical)", borderRadius: "50%" }} />
            )}
          </button>
        )}
      </div>
    </div>
  );
}

/* Logout button — reads LogoutCtx lazily from a global ref set in page.tsx */
let _globalLogout: (() => void) | null = null;
export function setGlobalLogout(fn: () => void) { _globalLogout = fn; }

function LogoutButton() {
  const [showMenu, setShowMenu] = React.useState(false);

  function doLogout() {
    setShowMenu(false);
    if (_globalLogout) _globalLogout();
  }

  return (
    <>
      <button
        onClick={() => setShowMenu(true)}
        style={{ width: 32, height: 32, borderRadius: 10, background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.2)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0 }}
        title="Sign out"
      >
        <LogOut size={14} color="var(--status-critical)" />
      </button>

      {showMenu && (
        <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "flex-end", zIndex: 500 }} onClick={() => setShowMenu(false)}>
          <div style={{ background: "var(--surface)", borderRadius: "20px 20px 0 0", padding: 20, width: "100%", border: "1px solid var(--border-subtle)" }} onClick={e => e.stopPropagation()}>
            <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4, color: "var(--text-primary)" }}>Sign Out</div>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 16 }}>You will be returned to the login screen.</div>
            <button onClick={doLogout} style={{ width: "100%", padding: "13px", borderRadius: 14, background: "rgba(248,113,113,0.1)", border: "1px solid rgba(248,113,113,0.3)", color: "var(--status-critical)", fontWeight: 700, fontSize: 14, cursor: "pointer" }}>
              Sign Out
            </button>
            <button onClick={() => setShowMenu(false)} style={{ width: "100%", marginTop: 10, padding: "11px", borderRadius: 12, background: "transparent", border: "1px solid var(--border-subtle)", color: "var(--text-muted)", fontWeight: 600, fontSize: 13, cursor: "pointer" }}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </>
  );
}

/* ── Status Bar ──
 * Shows the real clock plus the browser's actual connectivity state
 * (navigator.onLine + online/offline events). The old fake device telemetry
 * (signal dots, a literal "WiFi" label, a hardcoded "100%" battery) was
 * fabricated UI and is gone — there is no device-battery API worth faking
 * (the Battery API is deprecated) and a hardcoded percentage reads as real.
 */
export function StatusBar() {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    setOnline(navigator.onLine);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); };
  }, []);
  const now = new Date();
  const time = now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
  return (
    <div className="status-bar">
      <span style={{ fontWeight: 700 }}>{time}</span>
      <span style={{ fontSize: 10, fontWeight: 700, color: online ? "var(--status-ok)" : "var(--status-critical)" }}>{online ? "● Online" : "● Offline"}</span>
    </div>
  );
}
