"use client";
import React, { useState, useEffect, createContext, useContext, useCallback } from "react";
import { Home, Leaf, Package, CloudSun, DollarSign, CheckSquare, Users, Shield, BarChart3, Settings, Bell, ChevronLeft, Search, Plus, UserCircle, MessageCircle, LogOut } from "./icons";
import { FARMS_DATA, NOTIFICATIONS_DATA } from "./data";
import { apiClient } from "@/lib/request";

/* ── Screen registry ── */
export type ScreenId =
  | "dashboard" | "crops" | "inventory" | "weather" | "finance"
  | "tasks" | "people" | "governance" | "reports" | "settings"
  | "notifications" | "ai-chat"
  | "worker-home" | "worker-record" | "worker-pay" | "worker-profile"
  | "admin-dashboard" | "admin-farms" | "admin-settings" | "admin-onboarding"
  | "batch-detail" | "crop-schedule" | "inventory-detail" | "finance-gl"
  | "payroll" | "approvals" | "people-detail" | "reports-export"
  | "enterprise-detail" | "process-config"
  | "role-builder" | "task-detail" | "notification-settings"
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

/* A farm as the shell needs it: identity + display fields. Rows from the backend
 * GET /api/farms map onto this; the mock FARMS_DATA do too. */
export interface FarmSummary {
  id: string;
  code: string;
  name: string;
  location: string;
}

export interface NavContext {
  current: ScreenId;
  history: ScreenId[];
  role: Role;
  params: Record<string, string>;
  activeFarm: string; // Code of the farm currently in view — switchable (multi-farm, issue #219).
  farms: FarmSummary[]; // The tenant's farms (from GET /api/farms; mock FARMS_DATA fallback).
  navigate: (to: ScreenId, params?: Record<string, string>) => void;
  goBack: () => void;
  setActiveFarm: (code: string) => void;
  alertCount: number;
  pendingApprovals: number;
  unreadNotifs: number;
}

/* Provisional tenant scope (issue #219): the new in-branch backend has no session
 * system yet — that's #220's session-bootstrap work — so /api/farms scopes per
 * request. This placeholder becomes `session.tenantId` once #220 lands. */
const PROVISIONAL_TENANT_ID = process.env.NEXT_PUBLIC_TENANT_ID ?? "t1";

const NavCtx = createContext<NavContext>({
  current: "dashboard", history: [], role: "owner", params: {},
  activeFarm: "FRM-KMU-001",
  farms: [],
  navigate: () => {}, goBack: () => {}, setActiveFarm: () => {},
  alertCount: 3, pendingApprovals: 2, unreadNotifs: 3,
});

export function useNav() { return useContext(NavCtx); }

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

export function NavProvider({ children, initialRole = "owner" }: { children: React.ReactNode; initialRole?: NavContext["role"] }) {
  const [role, setRole] = useState<NavContext["role"]>(initialRole);
  const startScreen: ScreenId = startScreenForRole(initialRole);
  const [current, setCurrent] = useState<ScreenId>(startScreen);
  const [history, setHistory] = useState<ScreenId[]>([]);
  const [params, setParams] = useState<Record<string, string>>({});
  const [activeFarm, setActiveFarm] = useState("FRM-KMU-001");

  // The tenant's farms for the switcher: prefer the real backend (GET /api/farms),
  // fall back to the mock FARMS_DATA when running standalone without the API
  // (the mock app has no /api/farms route, so the fetch 404s and the fallback holds).
  const [farms, setFarms] = useState<FarmSummary[]>(() =>
    FARMS_DATA.map(f => ({ id: f.code, code: f.code, name: f.name, location: f.location }))
  );
  useEffect(() => {
    let cancelled = false;
    apiClient.get<{ id: string; code: string; name: string; location: string }[]>(
      `/api/farms?tenantId=${PROVISIONAL_TENANT_ID}`
    ).then(res => {
      if (cancelled) return;
      // Empty (valid) responses keep the mock set — the standalone app isn't seeded.
      if (res.success && Array.isArray(res.data) && res.data.length) {
        const real = res.data.map(f => ({ id: f.id, code: f.code || f.id, name: f.name, location: f.location ?? "" }));
        setFarms(real);
        // The shell starts on the mock default code; if real farms replace the
        // mock set, land on the first real farm so the badge/filters stay coherent.
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
    setCurrent((prev) => { setHistory((h) => [...h, prev]); return dest; });
    setParams(p ?? {});
  }, [role]);
  const goBack = useCallback(() => {
    setHistory((h) => {
      if (!h.length) return h;
      const prev = h[h.length - 1];
      setCurrent(prev); return h.slice(0, -1);
    });
    setParams({});
  }, []);

  const unreadNotifs = NOTIFICATIONS_DATA.filter(n => !n.read).length;

  return (
    <NavCtx.Provider value={{ current, history, role, params, activeFarm, farms, navigate, goBack, setActiveFarm, alertCount: 3, pendingApprovals: 2, unreadNotifs }}>
      <RoleSelector role={role} setRole={(r) => { setRole(r); setCurrent(startScreenForRole(r)); setHistory([]); }} />
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
  const { current, navigate, role, pendingApprovals, unreadNotifs } = useNav();
  const tabs = getTabsForRole(role);
  const SUB_SCREENS: Record<string, string[]> = {
    settings: ["people","governance","reports","inventory","weather","role-builder","process-config","notification-settings","ui-customise","ai-chat"],
    crops: ["batch-detail","crop-schedule","enterprise-detail"],
    tasks: ["task-detail","approvals"],
    finance: ["finance-gl","payroll"],
    "admin-onboarding": ["admin-onboarding"],
  };

  return (
    <nav className="bottom-nav">
      {tabs.map((tab) => {
        const Icon = tab.icon;
        const isActive = current === tab.id || (SUB_SCREENS[tab.id] ?? []).includes(current);
        const badge = tab.id === "governance" && pendingApprovals > 0 ? pendingApprovals
          : tab.id === "tasks" && 2 > 0 ? 2
          : tab.id === "dashboard" && unreadNotifs > 0 ? unreadNotifs
          : tab.id === "admin-onboarding" && 2 > 0 ? 2
          : null;
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

/* ── Top Nav Bar ── */
export function TopNav({
  title, subtitle, showBack = false, showSearch = false, showBell = false,
  rightEl, farmBadge,
}: {
  title: string; subtitle?: string; showBack?: boolean; showSearch?: boolean;
  showBell?: boolean; rightEl?: React.ReactNode; farmBadge?: string;
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
        {showSearch && <button className="btn-icon"><Search size={16} /></button>}
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

/* ── Status Bar ── */
export function StatusBar() {
  const now = new Date();
  const time = now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
  return (
    <div className="status-bar">
      <span style={{ fontWeight: 700 }}>{time}</span>
      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <span style={{ fontSize: 10 }}>●●●●</span><span style={{ fontSize: 10 }}>WiFi</span>
        <span style={{ fontWeight: 700, fontSize: 11 }}>100%</span>
      </div>
    </div>
  );
}
