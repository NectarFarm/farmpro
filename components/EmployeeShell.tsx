"use client";

import { useFarmStore } from "@/lib/store";
import EmployeePage from "@/components/pages/EmployeePage";
import { Egg, LogOut, User } from "lucide-react";
import { toast } from "sonner";

export default function EmployeeShell() {
  const { session, setSession } = useFarmStore();

  function handleLogout() {
    setSession(null);
    toast.info("Logged out");
  }

  return (
    <div className="min-h-screen flex flex-col bg-background">
      {/* Minimal employee header — no sidebar, no owner controls */}
      <header className="h-14 flex items-center justify-between px-4 shrink-0 border-b border-border/60 bg-card/50 backdrop-blur-sm">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center"
            style={{ background: "oklch(0.42 0.14 148 / 0.12)" }}>
            <Egg className="w-4 h-4 text-primary" />
          </div>
          <div>
            <div className="text-sm font-bold text-foreground">FarmPro</div>
            <div className="text-[10px] text-muted-foreground">Employee Portal</div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {/* Employee name badge */}
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl"
            style={{ background: "oklch(0.42 0.14 148 / 0.1)" }}>
            <User className="w-3.5 h-3.5 text-primary" />
            <span className="text-xs font-semibold text-primary">
              {session?.employeeName ?? "Employee"}
            </span>
          </div>

          <button
            onClick={handleLogout}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors">
            <LogOut className="w-3.5 h-3.5" />
            <span>Logout</span>
          </button>
        </div>
      </header>

      {/* Employee-only content — data entry only */}
      <main className="flex-1 overflow-y-auto">
        <EmployeePage />
      </main>
    </div>
  );
}
