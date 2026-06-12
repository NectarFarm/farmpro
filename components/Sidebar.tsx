"use client";

import { Egg, LayoutDashboard, Bird, DollarSign, ShoppingCart, Users, BarChart2, Package, Settings, Leaf, ClipboardList } from "lucide-react";
import type { PageId } from "./AppShell";
import { cn } from "@/lib/utils";

interface SidebarProps {
  currentPage: PageId;
  onNavigate: (page: PageId) => void;
}

const navItems: { id: PageId; label: string; icon: React.ElementType; description: string }[] = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard, description: "Overview & KPIs" },
  { id: "flocks", label: "Flock Manager", icon: Bird, description: "Lifecycle tracking" },
  { id: "finance", label: "Finance", icon: DollarSign, description: "Costs & budgets" },
  { id: "sales", label: "Sales", icon: ShoppingCart, description: "Record sales" },
  { id: "customers", label: "Customers", icon: Users, description: "Customer CRUD" },
  { id: "analytics", label: "Analytics", icon: BarChart2, description: "Charts & trends" },
  { id: "inventory", label: "Inventory", icon: Package, description: "Feed & stock" },
  { id: "orders", label: "Orders", icon: ClipboardList, description: "Customer orders" },
  { id: "settings", label: "Settings", icon: Settings, description: "App settings" },
];

export default function Sidebar({ currentPage, onNavigate }: SidebarProps) {
  return (
    <aside className="w-60 h-full flex flex-col overflow-hidden"
      style={{ background: "var(--sidebar)", borderRight: "1px solid var(--sidebar-border)" }}>
      {/* Brand */}
      <div className="h-14 flex items-center gap-2.5 px-4 shrink-0"
        style={{ borderBottom: "1px solid var(--sidebar-border)" }}>
        <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
          style={{ background: "oklch(0.42 0.14 148)" }}>
          <Egg className="w-4 h-4 text-white" />
        </div>
        <div>
          <div className="text-sm font-bold" style={{ color: "var(--sidebar-foreground)" }}>FarmPro</div>
          <div className="text-[10px]" style={{ color: "oklch(0.6 0.06 148)" }}>Poultry Management</div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
        <p className="text-[10px] font-semibold uppercase tracking-widest mb-3 px-2" style={{ color: "oklch(0.5 0.06 148)" }}>
          Navigation
        </p>
        {navItems.map(item => {
          const Icon = item.icon;
          const active = currentPage === item.id;
          return (
            <button key={item.id} onClick={() => onNavigate(item.id)}
              className={cn(
                "w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-all",
                active ? "font-semibold" : "font-medium"
              )}
              style={active ? {
                background: "var(--sidebar-primary)",
                color: "var(--sidebar-primary-foreground)",
                boxShadow: "0 2px 8px oklch(0.42 0.14 148 / 0.35)"
              } : {
                color: "var(--sidebar-foreground)",
              }}
              onMouseEnter={(e) => {
                if (!active) (e.currentTarget as HTMLElement).style.background = "var(--sidebar-accent)";
              }}
              onMouseLeave={(e) => {
                if (!active) (e.currentTarget as HTMLElement).style.background = "";
              }}>
              <Icon className="w-4 h-4 shrink-0" />
              <div className="min-w-0">
                <div className="text-sm truncate">{item.label}</div>
                {active && <div className="text-[10px] opacity-70 truncate">{item.description}</div>}
              </div>
            </button>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="px-4 py-3 shrink-0" style={{ borderTop: "1px solid var(--sidebar-border)" }}>
        <div className="flex items-center gap-2">
          <Leaf className="w-3.5 h-3.5" style={{ color: "oklch(0.65 0.12 148)" }} />
          <span className="text-[11px]" style={{ color: "oklch(0.55 0.06 148)" }}>FarmPro v1.0 · Demo Mode</span>
        </div>
      </div>
    </aside>
  );
}
