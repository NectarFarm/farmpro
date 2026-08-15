"use client";
import React, { useState, createContext, useContext } from "react";
import { NavProvider, useNav, BottomNav, AppSidebar, StatusBar, setGlobalLogout, RoleNoticeScreen, type Role } from "@/components/farm/navigation";
import { DashboardScreen, NotificationsScreen, NotificationSettingsScreen } from "@/components/farm/dashboard";
import { CropsScreen, BatchDetailScreen, CropScheduleScreen, ProcessConfigScreen } from "@/components/farm/crops";
import { InventoryScreen, InventoryDetailScreen } from "@/components/farm/inventory";
import { WeatherScreen } from "@/components/farm/weather";
import { FinanceScreen } from "@/components/farm/finance";
import { TasksScreen } from "@/components/farm/tasks";
import { PeopleScreen, PeopleDetailScreen } from "@/components/farm/people";
import { GovernanceScreen } from "@/components/farm/governance";
import { ReportsScreen } from "@/components/farm/reports";
import { SettingsScreen } from "@/components/farm/settings";
import { ThemeProvider } from "@/components/farm/settings";
import { ToastProvider } from "@/components/farm/ui-shared";
import { ConfirmProvider } from "@/components/farm/ui-shared";
import {
  WorkerHomeScreen, WorkerRecordScreen,
  WorkerPayScreen, WorkerProfileScreen,
} from "@/components/farm/worker";
import {
  AdminDashboardScreen, AdminFarmsScreen, AdminSettingsScreen,
} from "@/components/farm/admin";
import { AIChatScreen } from "@/components/farm/ai-chat";
import { AdminOnboardingScreen } from "@/components/farm/admin-onboarding";
import { UICustomiseScreen } from "@/components/farm/ui-customise";
import { LoginScreen, RegisterScreen } from "@/components/farm/auth";
import { apiClient } from "@/lib/request";

/* ── App-level logout context so any screen can trigger logout ── */
export const LogoutCtx = createContext<() => void>(() => {});
export function useLogout() { return useContext(LogoutCtx); }

// Role is shared with navigation.tsx and mirrors the backend's 6 roles exactly
// (UI "admin" → backend "super_admin"; vet/auditor → explicit deny — see issue #219).

const TAB_SCREENS = new Set([
  "dashboard","crops","finance","tasks","settings",
  "worker-home","worker-record","worker-pay","worker-profile",
  "admin-dashboard","admin-farms","admin-settings","admin-onboarding",
  "inventory","weather","people","governance","reports",
  "ai-chat","ui-customise",
]);

function ScreenRouter({ onLogout }: { onLogout: () => void }) {
  const { current } = useNav();

  const screen = (() => {
    switch (current) {
      case "dashboard":         return <DashboardScreen />;
      case "crops":             return <CropsScreen />;
      case "batch-detail":      return <BatchDetailScreen />;
      case "crop-schedule":     return <CropScheduleScreen />;
      case "process-config":    return <ProcessConfigScreen />;
      case "inventory":         return <InventoryScreen />;
      case "inventory-detail":  return <InventoryDetailScreen />;
      case "weather":           return <WeatherScreen />;
      case "finance":           return <FinanceScreen />;
      case "tasks":             return <TasksScreen />;
      case "people":            return <PeopleScreen />;
      case "people-detail":     return <PeopleDetailScreen />;
      case "governance":        return <GovernanceScreen />;
      case "reports":           return <ReportsScreen />;
      case "settings":          return <SettingsScreen onLogout={onLogout} />;
      case "notifications":     return <NotificationsScreen />;
      case "notification-settings": return <NotificationSettingsScreen />;
      case "worker-home":       return <WorkerHomeScreen />;
      case "worker-record":     return <WorkerRecordScreen />;
      case "worker-pay":        return <WorkerPayScreen />;
      case "worker-profile":    return <WorkerProfileScreen />;
      case "admin-dashboard":   return <AdminDashboardScreen />;
      case "admin-farms":       return <AdminFarmsScreen />;
      case "admin-settings":    return <AdminSettingsScreen />;
      case "admin-onboarding":  return <AdminOnboardingScreen />;
      case "ai-chat":           return <AIChatScreen />;
      case "ui-customise":      return <UICustomiseScreen />;
      case "role-notice":       return <RoleNoticeScreen />;
      default:                  return <DashboardScreen />;
    }
  })();

  const showTabs = TAB_SCREENS.has(current);

  return (
    <div className="farm-shell">
      <AppSidebar />
      <div className="shell-main">
        <StatusBar />
        <div style={{ flex: 1, overflow: "hidden", position: "relative" }}>
          {screen}
        </div>
        {showTabs && <BottomNav />}
      </div>
    </div>
  );
}

type AuthState = "booting" | "login" | "register" | "app";

/* The backend's real role set (issue #220 session bootstrap). Unknown roles are
 * treated as unauthenticated — the shell only admits known roles. */
function sessionRole(raw: unknown): Role | null {
  if (typeof raw !== "string") return null;
  return (["owner", "manager", "worker", "vet", "auditor", "super_admin"] as const).includes(raw as Role)
    ? (raw as Role)
    : null;
}

export default function Home() {
  const [authState, setAuthState] = useState<AuthState>("booting");
  const [role, setRole] = useState<Role>("owner");
  const [tenantId, setTenantId] = useState<string | null>(null);

  // Real session bootstrap (issue #220): GET /api/auth/session on load. 200 with a
  // known role -> authenticated shell; anything else (401, network failure, unknown
  // role) -> login screen. The real backend landed in #221, so sessions persist
  // across refresh via the httpOnly cookie.
  React.useEffect(() => {
    let cancelled = false;
    // Timeout race mirrors the logout pattern (issue #220): a session endpoint
    // that hangs must not leave the shell stuck on the boot screen forever.
    const boot = apiClient.get<{ role?: string; tenantId?: string | null }>("/api/auth/session");
    const timeout = new Promise<{ success: false }>((resolve) =>
      setTimeout(() => resolve({ success: false }), 3000)
    );
    Promise.race([boot, timeout])
      .then((res) => {
        if (cancelled) return;
        const r = res.success ? sessionRole(res.data?.role) : null;
        const tenant = res.success && typeof res.data?.tenantId === "string" ? res.data.tenantId : null;
        if (r) {
          setRole(r);
          setTenantId(tenant);
          setAuthState("app");
        } else {
          // 401, endpoint absent on the new backend, timeout, or unknown role ->
          // login. Any failure is treated as logged-out: safe default.
          setAuthState("login");
        }
      })
      // apiClient resolves { success:false } on network errors today, but a
      // defensive catch keeps the "any failure -> login" contract honest.
      .catch(() => { if (!cancelled) setAuthState("login"); });
    return () => { cancelled = true; };
  }, []);

  function handleLogin(r: Role, tenant: string | null = null) {
    setRole(r);
    setTenantId(tenant);
    setAuthState("app");
  }

  function handleLogout() {
    // Real logout endpoint fires first (visible in the network tab); always return
    // to login, even while the endpoint doesn't exist yet (standalone mock mode) or
    // the request hangs — a 3s race guarantees the UI never blocks on logout.
    const settled = apiClient.post("/api/auth/logout", {});
    const timeout = new Promise((resolve) => setTimeout(resolve, 3000));
    Promise.race([settled, timeout]).finally(() => {
      setRole("owner");
      setAuthState("login");
    });
  }

  // Register globally so TopNav logout button can reach it
  React.useEffect(() => { setGlobalLogout(handleLogout); }, []);

  return (
    <ThemeProvider tenantId={tenantId}>
      <ConfirmProvider>
        <ToastProvider>
          <LogoutCtx.Provider value={handleLogout}>
            <div className="farm-viewport">
              <div className="farm-device-frame">

                {authState === "booting" && (
                  <div className="farm-shell">
                    <div className="shell-main">
                      <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12 }}>
                        <div style={{ fontSize: 40 }}>🌾</div>
                        <div style={{ fontSize: 12, color: "var(--text-muted)" }}>Loading your session…</div>
                      </div>
                    </div>
                  </div>
                )}

                {authState === "login" && (
                  <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
                    <StatusBar />
                    <div style={{ flex: 1, overflowY: "auto" }}>
                      <LoginScreen
                        onLogin={handleLogin}
                        onRegister={() => setAuthState("register")}
                      />
                    </div>
                  </div>
                )}

                {authState === "register" && (
                  <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
                    <StatusBar />
                    <div style={{ flex: 1, overflowY: "auto" }}>
                      <RegisterScreen
                        onBack={() => setAuthState("login")}
                      />
                    </div>
                  </div>
                )}

                {authState === "app" && (
                  <NavProvider initialRole={role} initialTenantId={tenantId ?? undefined}>
                    <ScreenRouter onLogout={handleLogout} />
                  </NavProvider>
                )}
              </div>
            </div>
          </LogoutCtx.Provider>
        </ToastProvider>
      </ConfirmProvider>
    </ThemeProvider>
  );
}
