'use client';

import { useState, useMemo } from 'react';
import { useFarmStore } from '@/lib/store';
import type { Expense, Budget, CostCategory } from '@/lib/types';
import { formatDate, formatCurrency, generateId } from '@/lib/utils';
import { Plus, Trash2, TrendingUp, TrendingDown, DollarSign, Target, AlertTriangle, FileText } from 'lucide-react';
import ReportModal from '@/components/ReportModal';
import {
  PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import { toast } from 'sonner';

const CATEGORIES: CostCategory[] = ['feed', 'vaccines', 'medications', 'labour', 'utilities', 'chicks', 'miscellaneous'];
const CAT_COLORS: Record<CostCategory, string> = {
  feed: '#f59e0b', vaccines: '#3b82f6', medications: '#8b5cf6',
  labour: '#10b981', utilities: '#f97316', chicks: '#ec4899', miscellaneous: '#6b7280',
};

type Period = 'this_month' | 'last_month' | 'this_year';

// ── helpers ───────────────────────────────────────────────────────────────────
function periodRange(p: Period): { start: Date; end: Date } {
  const now = new Date();
  if (p === 'this_month') {
    return { start: new Date(now.getFullYear(), now.getMonth(), 1), end: now };
  }
  if (p === 'last_month') {
    const s = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const e = new Date(now.getFullYear(), now.getMonth(), 0);
    return { start: s, end: e };
  }
  return { start: new Date(now.getFullYear(), 0, 1), end: now };
}

// ── P&L Section ──────────────────────────────────────────────────────────────
function PnLSection({ _p }: { _p: Period }) {
  const { expenses, sales, birdStageSales, feedRecords, vaccinationRecords } = useFarmStore();
  const { start, end } = useMemo(() => periodRange(_p), [_p]);

  const inRange = (d: string) => { const dt = new Date(d); return dt >= start && dt <= end; };

  const salesRevenue = useMemo(() =>
    (sales ?? []).filter((s: any) => inRange(s.date ?? s.createdAt)).reduce((a: number, s: any) => a + (s.totalAmount ?? s.amount ?? 0), 0),
    [sales, start, end]);

  const birdStageRevenue = useMemo(() =>
    (birdStageSales ?? []).filter((s: any) => inRange(s.date ?? s.createdAt)).reduce((a: number, s: any) => a + (s.totalAmount ?? 0), 0),
    [birdStageSales, start, end]);

  const revenue = salesRevenue + birdStageRevenue;

  const expenseCost = useMemo(() =>
    (expenses ?? []).filter((e: Expense) => inRange(e.date ?? e.createdAt)).reduce((a, e) => a + e.amount, 0),
    [expenses, start, end]);

  const feedCost = useMemo(() =>
    (feedRecords ?? []).filter((r: any) => inRange(r.date ?? r.createdAt)).reduce((a: number, r: any) => a + (r.totalCost ?? r.cost ?? 0), 0),
    [feedRecords, start, end]);

  const vacCost = useMemo(() =>
    (vaccinationRecords ?? []).filter((r: any) => inRange(r.date ?? r.createdAt)).reduce((a: number, r: any) => a + (r.cost ?? 0), 0),
    [vaccinationRecords, start, end]);

  const totalExp = expenseCost + feedCost + vacCost;
  const net = revenue - totalExp;

  const revenueRows = [
    { label: 'Sales Revenue (eggs/birds)', amount: salesRevenue },
    { label: 'Bird Valuation Sales', amount: birdStageRevenue },
  ];

  const rows = [
    { label: 'Direct Expenses', amount: expenseCost },
    { label: 'Feed Costs', amount: feedCost },
    { label: 'Vaccination Costs', amount: vacCost },
  ];

  return (
    <div className="glass-card rounded-2xl p-4 space-y-4">
      <div className="flex items-center gap-2">
        <DollarSign className="w-5 h-5 text-primary" />
        <h2 className="font-semibold text-lg">Profit &amp; Loss Statement</h2>
      </div>
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: 'Total Revenue', value: revenue, icon: TrendingUp, color: 'text-green-500' },
          { label: 'Total Expenses', value: totalExp, icon: TrendingDown, color: 'text-red-500' },
          { label: net >= 0 ? 'Net Profit' : 'Net Loss', value: Math.abs(net), icon: net >= 0 ? TrendingUp : TrendingDown, color: net >= 0 ? 'text-green-600' : 'text-red-600' },
        ].map(({ label, value, icon: Icon, color }) => (
          <div key={label} className="bg-muted/40 rounded-xl p-3">
            <div className="flex items-center gap-1.5 mb-1">
              <Icon className={`w-4 h-4 ${color}`} />
              <span className="text-xs text-muted-foreground">{label}</span>
            </div>
            <p className={`text-xl font-bold ${color}`}>{formatCurrency(value)}</p>
          </div>
        ))}
      </div>
      <table className="w-full text-sm">
        <thead><tr className="text-muted-foreground text-xs border-b border-border">
          <th className="text-left py-1.5">Category</th>
          <th className="text-right py-1.5">Amount</th>
          <th className="text-right py-1.5">% of Total</th>
        </tr></thead>
        <tbody>
          <tr><td colSpan={3} className="py-1 text-xs font-semibold text-green-600 uppercase tracking-wide">Revenue</td></tr>
          {revenueRows.map(({ label, amount }) => (
            <tr key={label} className="border-b border-border/50">
              <td className="py-1.5 pl-2 text-muted-foreground">{label}</td>
              <td className="text-right text-green-600">{formatCurrency(amount)}</td>
              <td className="text-right text-muted-foreground">{revenue > 0 ? ((amount / revenue) * 100).toFixed(1) : '0.0'}%</td>
            </tr>
          ))}
          <tr><td colSpan={3} className="py-1 text-xs font-semibold text-red-500 uppercase tracking-wide">Expenses</td></tr>
          {rows.map(({ label, amount }) => (
            <tr key={label} className="border-b border-border/50">
              <td className="py-1.5 pl-2 text-muted-foreground">{label}</td>
              <td className="text-right">{formatCurrency(amount)}</td>
              <td className="text-right text-muted-foreground">{totalExp > 0 ? ((amount / totalExp) * 100).toFixed(1) : '0.0'}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Add Expense Form ──────────────────────────────────────────────────────────
function AddExpenseForm() {
  const { addExpense, flocks } = useFarmStore();
  const today = new Date().toISOString().split('T')[0];
  const [form, setForm] = useState({ category: 'feed' as CostCategory, description: '', amount: '', date: today, flockId: '' });

  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.amount || isNaN(Number(form.amount))) { toast.error('Enter a valid amount'); return; }
    addExpense({ id: generateId(), createdAt: new Date().toISOString(), category: form.category, description: form.description, amount: Number(form.amount), date: form.date, ...(form.flockId ? { flockId: form.flockId } : {}) } as Expense);
    toast.success('Expense added');
    setForm({ category: 'feed', description: '', amount: '', date: today, flockId: '' });
  };

  const inp = 'w-full px-3 py-2 rounded-xl border border-border bg-input text-sm outline-none focus:ring-2 focus:ring-primary/30';

  return (
    <div className="glass-card rounded-2xl p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Plus className="w-4 h-4 text-primary" />
        <h2 className="font-semibold">Add Expense</h2>
      </div>
      <form onSubmit={handleSubmit} className="space-y-3">
        <select value={form.category} onChange={e => set('category', e.target.value)} className={inp}>
          {CATEGORIES.map(c => <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>)}
        </select>
        <input placeholder="Description" value={form.description} onChange={e => set('description', e.target.value)} className={inp} />
        <div className="grid grid-cols-2 gap-2">
          <input type="number" placeholder="Amount" value={form.amount} onChange={e => set('amount', e.target.value)} className={inp} min={0} />
          <input type="date" value={form.date} onChange={e => set('date', e.target.value)} className={inp} />
        </div>
        <select value={form.flockId} onChange={e => set('flockId', e.target.value)} className={inp}>
          <option value="">No specific flock</option>
          {(flocks ?? []).map((f: any) => <option key={f.id} value={f.id}>{f.name ?? f.id}</option>)}
        </select>
        <button type="submit" className="w-full py-2 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors">
          Add Expense
        </button>
      </form>
    </div>
  );
}

// ── Budget Section ────────────────────────────────────────────────────────────
function BudgetSection() {
  const { expenses, budgets, addBudget, updateBudget } = useFarmStore();
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  const spent = useMemo(() => {
    const map: Record<string, number> = {};
    (expenses ?? []).filter((e: Expense) => new Date(e.date ?? e.createdAt) >= monthStart)
      .forEach((e: Expense) => { map[e.category] = (map[e.category] ?? 0) + e.amount; });
    return map;
  }, [expenses]);

  const getBudget = (cat: CostCategory) =>
    (budgets ?? []).find((b: Budget) => b.category === cat && b.month === monthKey);

  const handleSet = (cat: CostCategory) => {
    const cur = getBudget(cat);
    const val = prompt(`Set budget for ${cat}:`, String(cur?.amount ?? ''));
    if (!val || isNaN(Number(val))) return;
    if (cur) updateBudget(cur.id, { amount: Number(val) });
    else addBudget({ id: generateId(), category: cat, amount: Number(val), month: monthKey, createdAt: new Date().toISOString() } as Budget);
    toast.success('Budget updated');
  };

  return (
    <div className="glass-card rounded-2xl p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Target className="w-4 h-4 text-primary" />
        <h2 className="font-semibold">Monthly Budgets</h2>
      </div>
      <div className="space-y-2.5">
        {CATEGORIES.map(cat => {
          const b = getBudget(cat);
          const budgetAmt = b?.amount ?? 0;
          const spentAmt = spent[cat] ?? 0;
          const pct = budgetAmt > 0 ? Math.min((spentAmt / budgetAmt) * 100, 100) : 0;
          const barColor = pct >= 90 ? 'bg-red-500' : pct >= 70 ? 'bg-yellow-500' : 'bg-green-500';
          return (
            <div key={cat} className="space-y-1">
              <div className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full" style={{ background: CAT_COLORS[cat] }} />
                  <span className="capitalize font-medium">{cat}</span>
                  {pct >= 90 && <AlertTriangle className="w-3 h-3 text-red-500" />}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground">{formatCurrency(spentAmt)} / {budgetAmt > 0 ? formatCurrency(budgetAmt) : '—'}</span>
                  <button onClick={() => handleSet(cat)} className="text-primary hover:underline">{b ? 'Edit' : 'Set'}</button>
                </div>
              </div>
              {budgetAmt > 0 && (
                <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                  <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${pct}%` }} />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Charts Section ────────────────────────────────────────────────────────────
function ChartsSection() {
  const { expenses, sales, birdStageSales, feedRecords } = useFarmStore();

  const pieData = useMemo(() => {
    const map: Record<string, number> = {};
    (expenses ?? []).forEach((e: Expense) => { map[e.category] = (map[e.category] ?? 0) + e.amount; });
    return Object.entries(map).map(([name, value]) => ({ name, value }));
  }, [expenses]);

  const barData = useMemo(() => {
    const now = new Date();
    return Array.from({ length: 6 }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1);
      const label = d.toLocaleString('default', { month: 'short' });
      const mStart = new Date(d.getFullYear(), d.getMonth(), 1);
      const mEnd = new Date(d.getFullYear(), d.getMonth() + 1, 0);
      const inM = (s: string) => { const dt = new Date(s); return dt >= mStart && dt <= mEnd; };
      const salesRev = (sales ?? []).filter((s: any) => inM(s.date ?? s.createdAt)).reduce((a: number, s: any) => a + (s.totalAmount ?? s.amount ?? 0), 0);
      const birdStageRev = (birdStageSales ?? []).filter((s: any) => inM(s.date ?? s.createdAt)).reduce((a: number, s: any) => a + (s.totalAmount ?? 0), 0);
      const exp = (expenses ?? []).filter((e: Expense) => inM(e.date ?? e.createdAt)).reduce((a, e) => a + e.amount, 0)
        + (feedRecords ?? []).filter((r: any) => inM(r.date ?? r.createdAt)).reduce((a: number, r: any) => a + (r.totalCost ?? r.cost ?? 0), 0);
      return { month: label, Revenue: salesRev + birdStageRev, Expenses: exp };
    });
  }, [expenses, sales, birdStageSales, feedRecords]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div className="glass-card rounded-2xl p-4">
        <h2 className="font-semibold mb-3 text-sm">Expense Breakdown</h2>
        <ResponsiveContainer width="100%" height={220}>
          <PieChart>
            <Pie data={pieData} cx="50%" cy="50%" innerRadius={55} outerRadius={90} dataKey="value" nameKey="name">
              {pieData.map((entry) => (
                <Cell key={entry.name} fill={CAT_COLORS[entry.name as CostCategory] ?? '#9ca3af'} />
              ))}
            </Pie>
            <Tooltip formatter={(v: number) => formatCurrency(v)} />
            <Legend iconType="circle" iconSize={8} />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <div className="glass-card rounded-2xl p-4">
        <h2 className="font-semibold mb-3 text-sm">6-Month Revenue vs Expenses</h2>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={barData} barGap={4}>
            <XAxis dataKey="month" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} tickFormatter={(v: number) => v >= 1000 ? `Ksh ${(v / 1000).toFixed(0)}k` : `Ksh ${v}`} />
            <Tooltip formatter={(v: number) => formatCurrency(v)} />
            <Legend iconType="square" iconSize={8} />
            <Bar dataKey="Revenue" fill="#10b981" radius={[4, 4, 0, 0]} />
            <Bar dataKey="Expenses" fill="#f97316" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// ── Expense List ──────────────────────────────────────────────────────────────
function ExpenseList() {
  const { expenses, deleteExpense } = useFarmStore();
  const [filterCat, setFilterCat] = useState<CostCategory | 'all'>('all');
  const [sortAsc, setSortAsc] = useState(false);

  const filtered = useMemo(() => {
    let list = [...(expenses ?? [])];
    if (filterCat !== 'all') list = list.filter((e: Expense) => e.category === filterCat);
    list.sort((a, b) => {
      const da = new Date(a.date ?? a.createdAt).getTime();
      const db = new Date(b.date ?? b.createdAt).getTime();
      return sortAsc ? da - db : db - da;
    });
    return list;
  }, [expenses, filterCat, sortAsc]);

  const inp = 'px-3 py-1.5 rounded-xl border border-border bg-input text-sm outline-none focus:ring-2 focus:ring-primary/30';

  return (
    <div className="glass-card rounded-2xl p-4 space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="font-semibold">All Expenses</h2>
        <div className="flex gap-2 flex-wrap">
          <select value={filterCat} onChange={e => setFilterCat(e.target.value as CostCategory | 'all')} className={inp}>
            <option value="all">All Categories</option>
            {CATEGORIES.map(c => <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>)}
          </select>
          <button onClick={() => setSortAsc(v => !v)} className={`${inp} cursor-pointer`}>
            Date {sortAsc ? '↑' : '↓'}
          </button>
        </div>
      </div>
      {filtered.length === 0 ? (
        <p className="text-center text-muted-foreground text-sm py-8">No expenses found.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-muted-foreground text-xs border-b border-border">
              <th className="text-left py-2">Date</th><th className="text-left py-2">Category</th>
              <th className="text-left py-2">Description</th><th className="text-right py-2">Amount</th><th className="py-2" />
            </tr></thead>
            <tbody>
              {filtered.map((e: Expense) => (
                <tr key={e.id} className="border-b border-border/40 hover:bg-muted/20 transition-colors">
                  <td className="py-2 text-muted-foreground whitespace-nowrap">{formatDate(e.date ?? e.createdAt)}</td>
                  <td className="py-2">
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium"
                      style={{ background: `${CAT_COLORS[e.category]}22`, color: CAT_COLORS[e.category] }}>
                      {e.category}
                    </span>
                  </td>
                  <td className="py-2 max-w-[180px] truncate">{e.description || '—'}</td>
                  <td className="py-2 text-right font-medium whitespace-nowrap">{formatCurrency(e.amount)}</td>
                  <td className="py-2 text-right">
                    <button onClick={() => { deleteExpense(e.id); toast.success('Expense deleted'); }}
                      className="p-1 rounded-lg hover:bg-red-500/10 text-muted-foreground hover:text-red-500 transition-colors">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function FinancePage() {
  const [period, setPeriod] = useState<Period>('this_month');
  const [showReport, setShowReport] = useState(false);

  return (
    <div className="space-y-6">
      {showReport && <ReportModal onClose={() => setShowReport(false)} />}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">Finance &amp; Budgeting</h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            Track all farm costs, set budgets, and generate profit &amp; loss reports
          </p>
        </div>
        <div className="flex gap-2 flex-wrap items-center">
          {(['this_month', 'last_month', 'this_year'] as Period[]).map((p) => (
            <button key={p} onClick={() => setPeriod(p)}
              className={`px-3 py-1.5 rounded-xl text-xs font-medium transition-colors ${period === p ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-muted/80'}`}>
              {p === 'this_month' ? 'This Month' : p === 'last_month' ? 'Last Month' : 'This Year'}
            </button>
          ))}
          <button onClick={() => setShowReport(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold text-white transition-all hover:opacity-90 active:scale-95"
            style={{ background: 'oklch(0.42 0.14 148)', boxShadow: '0 2px 8px oklch(0.42 0.14 148 / 0.4)' }}>
            <FileText className="w-3.5 h-3.5" />
            PDF Report
          </button>
        </div>
      </div>

      <PnLSection _p={period} />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <AddExpenseForm />
        <BudgetSection />
      </div>
      <ChartsSection />
      <ExpenseList />
    </div>
  );
}
