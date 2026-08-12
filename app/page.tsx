"use client";
import React, { useState, createContext, useContext } from "react";
import { NavProvider, useNav, BottomNav, StatusBar, setGlobalLogout } from "@/components/farm/navigation";
import { DashboardScreen } from "@/components/farm/dashboard";
import { CropsScreen, BatchDetailScreen, CropScheduleScreen } from "@/components/farm/crops";
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

/* ── App-level logout context so any screen can trigger logout ── */
export const LogoutCtx = createContext<() => void>(() => {});
export function useLogout() { return useContext(LogoutCtx); }

type Role = "owner" | "manager" | "worker" | "admin";

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
      default:                  return <DashboardScreen />;
    }
  })();

  const showTabs = TAB_SCREENS.has(current);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      <StatusBar />
      <div style={{ flex: 1, overflow: "hidden", position: "relative" }}>
        {screen}
      </div>
      {showTabs && <BottomNav />}
    </div>
  );
}

export default function Home() {
  const [authState, setAuthState] = useState<"login" | "register" | "app">("login");
  const [role, setRole] = useState<Role>("owner");

  function handleLogin(r: Role) {
    setRole(r);
    setAuthState("app");
  }

  function handleLogout() {
    setRole("owner");
    setAuthState("login");
  }

  // Register globally so TopNav logout button can reach it
  React.useEffect(() => { setGlobalLogout(handleLogout); }, []);

  return (
    <ThemeProvider>
      <ConfirmProvider>
        <ToastProvider>
          <LogoutCtx.Provider value={handleLogout}>
            <div className="farm-viewport">
              <div className="farm-device-frame">

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
                        onSubmit={() => setAuthState("login")}
                      />
                    </div>
                  </div>
                )}

                {authState === "app" && (
                  <NavProvider initialRole={role}>
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
