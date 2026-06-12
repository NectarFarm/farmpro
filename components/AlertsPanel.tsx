"use client";

import { useFarmStore } from "@/lib/store";
import { Bell, X, Check, AlertTriangle, Syringe, Trash2 } from "lucide-react";
import { formatDate } from "@/lib/utils";

interface AlertsPanelProps {
  onClose: () => void;
  onNavigate: (page: string) => void;
}

export default function AlertsPanel({ onClose, onNavigate }: AlertsPanelProps) {
  const { alerts, markAlertRead, clearAllAlerts } = useFarmStore();
  const sorted = [...alerts].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const iconMap: Record<string, React.ElementType> = {
    vaccination_overdue: Syringe,
    high_mortality: AlertTriangle,
    budget_alert: AlertTriangle,
    low_feed: AlertTriangle,
    cage_capacity: AlertTriangle,
  };

  const colorMap: Record<string, string> = {
    vaccination_overdue: "oklch(0.55 0.18 40)",
    high_mortality: "oklch(0.57 0.24 27)",
    budget_alert: "oklch(0.6 0.18 85)",
    low_feed: "oklch(0.5 0.12 250)",
    cage_capacity: "oklch(0.55 0.15 200)",
  };

  return (
    <div className="fixed right-0 top-0 bottom-0 w-80 z-50 flex flex-col shadow-2xl"
      style={{ background: "var(--card)", borderLeft: "1px solid var(--border)" }}>
      <div className="h-14 flex items-center justify-between px-4 border-b border-border">
        <div className="flex items-center gap-2">
          <Bell className="w-4 h-4 text-primary" />
          <span className="font-semibold text-sm">Alerts</span>
          {sorted.filter(a => !a.read).length > 0 && (
            <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold text-white"
              style={{ background: "oklch(0.57 0.24 27)" }}>
              {sorted.filter(a => !a.read).length}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button onClick={clearAllAlerts}
            className="p-1.5 rounded-lg hover:bg-muted transition-colors text-muted-foreground hover:text-destructive"
            title="Clear all">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
          <button onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-muted transition-colors text-muted-foreground">
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {sorted.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center py-8">
            <div className="w-12 h-12 rounded-full flex items-center justify-center mb-3"
              style={{ background: "oklch(0.42 0.14 148 / 0.1)" }}>
              <Bell className="w-5 h-5 text-primary/50" />
            </div>
            <p className="text-sm font-medium text-muted-foreground">All clear!</p>
            <p className="text-xs text-muted-foreground/70 mt-1">No active alerts</p>
          </div>
        ) : sorted.map(alert => {
          const Icon = iconMap[alert.type] || AlertTriangle;
          const color = colorMap[alert.type] || "oklch(0.55 0.12 148)";
          return (
            <div key={alert.id}
              className={`p-3 rounded-xl border cursor-pointer transition-all hover:shadow-sm ${alert.read ? "opacity-50" : ""}`}
              style={{ background: alert.read ? "var(--muted)" : "var(--card)", borderColor: "var(--border)" }}
              onClick={() => {
                markAlertRead(alert.id);
                if (alert.route) onNavigate(alert.route.replace("/", ""));
              }}>
              <div className="flex items-start gap-2.5">
                <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0 mt-0.5"
                  style={{ background: `${color.replace(')', ' / 0.12)')}`, border: `1px solid ${color.replace(')', ' / 0.3)')}` }}>
                  <Icon className="w-3.5 h-3.5" style={{ color }} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-foreground leading-tight">{alert.message}</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">{formatDate(alert.createdAt)}</p>
                </div>
                {!alert.read && (
                  <button onClick={(e) => { e.stopPropagation(); markAlertRead(alert.id); }}
                    className="p-1 rounded-md hover:bg-muted transition-colors shrink-0">
                    <Check className="w-3 h-3 text-primary" />
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
