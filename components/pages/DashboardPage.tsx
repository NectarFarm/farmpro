"use client";

import { useFarmStore } from "@/lib/store";
import { formatCurrency, calcMortalityRate } from "@/lib/utils";
import type { PageId } from "@/components/AppShell";
import { TrendingUp, TrendingDown, Egg, Bird, DollarSign, AlertTriangle, ArrowRight, Wallet, ShoppingCart, CheckCircle, Truck } from "lucide-react";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, BarChart, Bar } from "recharts";
import { useMemo, useState } from "react";

type DashPeriod = "7d" | "30d" | "thisMonth" | "thisYear";
interface Props { onNavigate: (page: PageId) => void; }

export default function DashboardPage({ onNavigate }: Props) {
  const { flocks, eggCollections, sales, birdStageSales, expenses, feedRecords, mortalityRecords, alerts, vaccinationRecords, employeeSalaries, orderRequests, customers } = useFarmStore();
  const [period, setPeriod] = useState<DashPeriod>("thisMonth");

  const totalBirds = flocks.filter(f => f.stage !== "sold").reduce((s, f) => s + f.currentCount, 0);
  const activeFlocks = flocks.filter(f => f.stage !== "sold").length;

  function periodStart(p: DashPeriod): Date {
    const now = new Date();
    if (p === "7d") { const d = new Date(now); d.setDate(d.getDate() - 7); return d; }
    if (p === "30d") { const d = new Date(now); d.setDate(d.getDate() - 30); return d; }
    if (p === "thisYear") return new Date(now.getFullYear(), 0, 1);
    return new Date(now.getFullYear(), now.getMonth(), 1);
  }

  const start = useMemo(() => periodStart(period), [period]);
  const inPeriod = (d: string) => new Date(d) >= start;

  const thisMonthSales = useMemo(() => {
    const salesRev = sales.filter(s => inPeriod(s.date)).reduce((sum, s) => sum + s.totalAmount, 0);
    const birdStageRev = birdStageSales.filter(s => inPeriod(s.date)).reduce((sum, s) => sum + s.totalAmount, 0);
    return salesRev + birdStageRev;
  }, [sales, birdStageSales, start]);

  const thisMonthExpenses = useMemo(() => {
    const feedCost = feedRecords.filter(r => inPeriod(r.date)).reduce((s, r) => s + r.totalCost, 0);
    const otherCost = expenses.filter(e => inPeriod(e.date)).reduce((s, e) => s + e.amount, 0);
    return feedCost + otherCost;
  }, [feedRecords, expenses, start]);

  // Cost of operations: expenses + feed + monthly salaries (prorated to period days)
  const periodDays = Math.max(1, Math.round((new Date().getTime() - start.getTime()) / 86400000));
  const monthlySalaries = employeeSalaries.reduce((s, sal) => s + sal.amount, 0);
  const salaryForPeriod = (monthlySalaries / 30) * periodDays;
  const costOfOperations = thisMonthExpenses + salaryForPeriod;

  const netProfit = thisMonthSales - costOfOperations;

  const last7DaysEggs = useMemo(() => {
    const result = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().split("T")[0];
      const count = eggCollections.filter(e => e.date === dateStr).reduce((s, e) => s + e.count, 0);
      result.push({ date: d.toLocaleDateString("en-US", { month: "short", day: "numeric" }), eggs: count });
    }
    return result;
  }, [eggCollections]);

  const last7DaysSales = useMemo(() => {
    const result = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().split("T")[0];
      const salesAmt = sales.filter(s => s.date === dateStr).reduce((sum, s) => sum + s.totalAmount, 0);
      const birdStageAmt = birdStageSales.filter(s => s.date === dateStr).reduce((sum, s) => sum + s.totalAmount, 0);
      result.push({ date: d.toLocaleDateString("en-US", { month: "short", day: "numeric" }), amount: salesAmt + birdStageAmt });
    }
    return result;
  }, [sales, birdStageSales]);

  const totalMortality = mortalityRecords.reduce((s, r) => s + r.count, 0);
  const initialTotal = flocks.reduce((s, f) => s + f.initialCount, 0);
  const overallMortality = calcMortalityRate(initialTotal, totalMortality);

  const overdueVacc = vaccinationRecords.filter(v => !v.completedDate && new Date(v.scheduledDate) < new Date()).length;
  const unreadAlerts = alerts.filter(a => !a.read).length;

  const kpis = [
    { label: "Active Birds", value: totalBirds.toLocaleString(), sub: `${activeFlocks} flocks`, icon: Bird, color: "oklch(0.42 0.14 148)", bg: "oklch(0.42 0.14 148 / 0.1)" },
    { label: "Revenue", value: formatCurrency(thisMonthSales), sub: netProfit >= 0 ? `+${formatCurrency(netProfit)} profit` : `${formatCurrency(Math.abs(netProfit))} loss`, icon: DollarSign, color: "oklch(0.52 0.17 148)", bg: "oklch(0.52 0.17 148 / 0.1)", positive: netProfit >= 0 },
    { label: "Cost of Operations", value: formatCurrency(costOfOperations), sub: `Incl. Ksh ${Math.round(salaryForPeriod).toLocaleString()} salaries`, icon: Wallet, color: "oklch(0.55 0.18 40)", bg: "oklch(0.55 0.18 40 / 0.1)" },
    { label: "Mortality Rate", value: `${overallMortality.toFixed(1)}%`, sub: `${totalMortality} total deaths`, icon: AlertTriangle, color: overallMortality > 5 ? "oklch(0.57 0.24 27)" : "oklch(0.55 0.12 148)", bg: overallMortality > 5 ? "oklch(0.57 0.24 27 / 0.1)" : "oklch(0.55 0.12 148 / 0.1)" },
  ];

  return (
    <div className="p-4 lg:p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-foreground">Farm Overview</h1>
          <p className="text-sm text-muted-foreground">Monitor your farm's performance at a glance</p>
        </div>
        <div className="flex gap-1 p-1 rounded-xl bg-muted">
          {(["7d","30d","thisMonth","thisYear"] as DashPeriod[]).map(p => (
            <button key={p} onClick={() => setPeriod(p)}
              className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
              style={period === p ? { background: "var(--primary)", color: "white" } : { color: "var(--muted-foreground)" }}>
              {p === "7d" ? "7 Days" : p === "30d" ? "30 Days" : p === "thisMonth" ? "This Month" : "This Year"}
            </button>
          ))}
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {kpis.map((kpi) => {
          const Icon = kpi.icon;
          return (
            <div key={kpi.label} className="glass-card rounded-2xl p-4">
              <div className="flex items-start justify-between mb-3">
                <div className="w-9 h-9 rounded-xl flex items-center justify-center"
                  style={{ background: kpi.bg }}>
                  <Icon className="w-4 h-4" style={{ color: kpi.color }} />
                </div>
                {kpi.positive !== undefined && (
                  kpi.positive
                    ? <TrendingUp className="w-3.5 h-3.5" style={{ color: "oklch(0.52 0.17 148)" }} />
                    : <TrendingDown className="w-3.5 h-3.5" style={{ color: "oklch(0.57 0.24 27)" }} />
                )}
              </div>
              <div className="text-xl font-bold text-foreground">{kpi.value}</div>
              <div className="text-xs font-medium text-muted-foreground mt-0.5">{kpi.label}</div>
              <div className="text-[11px] mt-1" style={{ color: kpi.color }}>{kpi.sub}</div>
            </div>
          );
        })}
      </div>

      {/* Charts row */}
      <div className="grid lg:grid-cols-2 gap-4">
        {/* Egg production chart */}
        <div className="glass-card rounded-2xl p-4">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="font-semibold text-sm text-foreground">Egg Production</h3>
              <p className="text-xs text-muted-foreground">Last 7 days</p>
            </div>
            <button onClick={() => onNavigate("analytics")}
              className="flex items-center gap-1 text-xs text-primary font-medium hover:underline">
              View All <ArrowRight className="w-3 h-3" />
            </button>
          </div>
          <ResponsiveContainer width="100%" height={160}>
            <AreaChart data={last7DaysEggs} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
              <defs>
                <linearGradient id="eggGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="oklch(0.42 0.14 148)" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="oklch(0.42 0.14 148)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: "oklch(0.55 0.05 148)" }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fontSize: 10, fill: "oklch(0.55 0.05 148)" }} tickLine={false} axisLine={false} />
              <Tooltip contentStyle={{ background: "oklch(0.97 0.012 142)", border: "1px solid oklch(0.88 0.04 142)", borderRadius: "8px", fontSize: "12px" }} />
              <Area type="monotone" dataKey="eggs" stroke="oklch(0.42 0.14 148)" strokeWidth={2} fill="url(#eggGrad)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* Revenue chart */}
        <div className="glass-card rounded-2xl p-4">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="font-semibold text-sm text-foreground">Daily Revenue</h3>
              <p className="text-xs text-muted-foreground">Last 7 days</p>
            </div>
            <button onClick={() => onNavigate("finance")}
              className="flex items-center gap-1 text-xs text-primary font-medium hover:underline">
              View All <ArrowRight className="w-3 h-3" />
            </button>
          </div>
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={last7DaysSales} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: "oklch(0.55 0.05 148)" }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fontSize: 10, fill: "oklch(0.55 0.05 148)" }} tickLine={false} axisLine={false} />
              <Tooltip contentStyle={{ background: "oklch(0.97 0.012 142)", border: "1px solid oklch(0.88 0.04 142)", borderRadius: "8px", fontSize: "12px" }}
                formatter={(v: number) => [formatCurrency(v), "Revenue"]} />
              <Bar dataKey="amount" fill="oklch(0.52 0.17 148)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Pending Orders widget */}
      <PendingOrdersWidget orders={orderRequests} customers={customers} onNavigate={onNavigate} />

      {/* Flocks + Alerts row */}
      <div className="grid lg:grid-cols-3 gap-4">
        {/* Active flocks */}
        <div className="lg:col-span-2 glass-card rounded-2xl p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-sm text-foreground">Active Flocks</h3>
            <button onClick={() => onNavigate("flocks")}
              className="flex items-center gap-1 text-xs text-primary font-medium hover:underline">
              Manage <ArrowRight className="w-3 h-3" />
            </button>
          </div>
          <div className="space-y-2">
            {flocks.filter(f => f.stage !== "sold").slice(0, 4).map(flock => (
              <div key={flock.id} className="flex items-center gap-3 p-3 rounded-xl hover:bg-muted/50 transition-colors">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                  style={{ background: "oklch(0.42 0.14 148 / 0.12)" }}>
                  <Bird className="w-4 h-4" style={{ color: "oklch(0.42 0.14 148)" }} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-foreground truncate">{flock.name}</div>
                  <div className="text-xs text-muted-foreground">{flock.currentCount.toLocaleString()} birds · {flock.breed}</div>
                </div>
                <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full stage-${flock.stage}`}>
                  {flock.stage.toUpperCase()}
                </span>
              </div>
            ))}
            {flocks.filter(f => f.stage !== "sold").length === 0 && (
              <p className="text-sm text-muted-foreground py-4 text-center">No active flocks. Add one in Flock Manager.</p>
            )}
          </div>
        </div>

        {/* Quick stats */}
        <div className="space-y-3">
          <div className="glass-card rounded-2xl p-4">
            <h3 className="font-semibold text-sm text-foreground mb-3">Quick Stats</h3>
            <div className="space-y-2.5">
              {[
                { label: "Unread Alerts", value: unreadAlerts, warning: unreadAlerts > 0 },
                { label: "Overdue Vaccinations", value: overdueVacc, warning: overdueVacc > 0 },
                { label: "Monthly Expenses", value: formatCurrency(thisMonthExpenses), warning: false },
                { label: "Total Customers", value: useFarmStore.getState().customers.length, warning: false },
              ].map(stat => (
                <div key={stat.label} className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">{stat.label}</span>
                  <span className={`text-xs font-semibold ${stat.warning ? "text-destructive" : "text-foreground"}`}>
                    {stat.value}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="glass-card rounded-2xl p-4">
            <h3 className="font-semibold text-sm text-foreground mb-1">Net P&L (Month)</h3>
            <div className={`text-2xl font-bold ${netProfit >= 0 ? "text-primary" : "text-destructive"}`}>
              {formatCurrency(Math.abs(netProfit))}
            </div>
            <div className="text-xs text-muted-foreground mt-0.5">
              {netProfit >= 0 ? "Profit" : "Loss"} this month
            </div>
            <div className="mt-2 flex gap-2 text-[11px]">
              <span className="text-muted-foreground">Revenue: <span className="font-medium text-foreground">{formatCurrency(thisMonthSales)}</span></span>
            </div>
            <div className="flex gap-2 text-[11px]">
              <span className="text-muted-foreground">Expenses: <span className="font-medium text-foreground">{formatCurrency(thisMonthExpenses)}</span></span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Pending Orders Widget ─────────────────────────────────────────────────────
import type { OrderRequest, Customer } from "@/lib/types";

function PendingOrdersWidget({ orders, customers, onNavigate }: {
  orders: OrderRequest[];
  customers: Customer[];
  onNavigate: (page: PageId) => void;
}) {
  const pending   = orders.filter(o => o.status === "pending");
  const confirmed = orders.filter(o => o.status === "confirmed");
  const needsPay  = orders.filter(o => o.status === "delivered" || (o.paidByCustomer && o.status !== "paid"));

  if (orders.length === 0) return null;

  const STATUS_COLORS: Record<string, { bg: string; icon: React.ElementType; color: string }> = {
    pending:   { bg: "oklch(0.95 0.08 85 / 0.2)",  icon: ShoppingCart, color: "oklch(0.45 0.12 85)"  },
    confirmed: { bg: "oklch(0.95 0.08 220 / 0.2)", icon: CheckCircle,  color: "oklch(0.35 0.12 220)" },
    delivered: { bg: "oklch(0.95 0.08 40 / 0.2)",  icon: Truck,        color: "oklch(0.50 0.15 40)"  },
  };

  return (
    <div className="glass-card rounded-2xl p-4">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="font-semibold text-sm text-foreground">Customer Orders</h3>
          <p className="text-xs text-muted-foreground">Requires your attention</p>
        </div>
        <button onClick={() => onNavigate("orders")}
          className="flex items-center gap-1 text-xs text-primary font-medium hover:underline">
          Manage All <ArrowRight className="w-3 h-3" />
        </button>
      </div>

      <div className="grid grid-cols-3 gap-2 mb-3">
        {[
          { label: "Pending",   count: pending.length,   key: "pending"   },
          { label: "Confirmed", count: confirmed.length, key: "confirmed" },
          { label: "Needs Pay", count: needsPay.length,  key: "delivered" },
        ].map(item => {
          const cfg = STATUS_COLORS[item.key];
          const Icon = cfg.icon;
          return (
            <button key={item.key} onClick={() => onNavigate("orders")}
              className="flex flex-col items-center gap-1 py-3 rounded-xl transition-all hover:opacity-80"
              style={{ background: cfg.bg }}>
              <Icon className="w-4 h-4" style={{ color: cfg.color }} />
              <span className="text-lg font-bold" style={{ color: cfg.color }}>{item.count}</span>
              <span className="text-[10px] font-medium" style={{ color: cfg.color }}>{item.label}</span>
            </button>
          );
        })}
      </div>

      {/* Latest 3 pending orders */}
      {pending.slice(0, 3).map(order => {
        const cust = customers.find(c => c.id === order.customerId);
        return (
          <div key={order.id} className="flex items-center justify-between py-2 border-t border-border/50">
            <div className="min-w-0">
              <p className="text-xs font-medium text-foreground truncate">{cust?.name ?? order.customerName}</p>
              <p className="text-[10px] text-muted-foreground capitalize">{order.quantity} {order.product} · {order.deliveryLocation}</p>
            </div>
            <button onClick={() => onNavigate("orders")}
              className="shrink-0 flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold text-white ml-2"
              style={{ background: "oklch(0.42 0.14 148)" }}>
              <CheckCircle className="w-3 h-3" /> Confirm
            </button>
          </div>
        );
      })}
      {pending.length === 0 && confirmed.length === 0 && needsPay.length === 0 && (
        <p className="text-xs text-muted-foreground text-center py-2">All orders are up to date ✓</p>
      )}
    </div>
  );
}
