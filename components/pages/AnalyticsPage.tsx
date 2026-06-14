'use client';
import { useMemo, useState } from 'react';
import { BarChart2, TrendingUp, Egg, DollarSign } from 'lucide-react';
import {
  LineChart, Line, BarChart, Bar,
  XAxis, YAxis, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import { useFarmStore } from '@/lib/store';
import { linearRegression, formatCurrency, formatDateShort } from '@/lib/utils';

type Period = '7d' | '30d' | '90d' | 'custom';

function subDays(n: number) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}

function isoDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

function kpiCard(icon: React.ReactNode, label: string, value: string, sub: string) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 p-4 flex gap-3 items-start shadow-sm">
      <div className="p-2 bg-green-50 rounded-lg text-green-600">{icon}</div>
      <div>
        <p className="text-xs text-gray-500">{label}</p>
        <p className="text-lg font-bold text-gray-800">{value}</p>
        <p className="text-xs text-gray-400">{sub}</p>
      </div>
    </div>
  );
}

export default function AnalyticsPage() {
  const { eggCollections, sales, customers } = useFarmStore();
  const [period, setPeriod] = useState<Period>('30d');
  const [customFrom, setCustomFrom] = useState(isoDate(subDays(30)));
  const [customTo, setCustomTo] = useState(isoDate(new Date()));

  const { from, to } = useMemo(() => {
    if (period === '7d') return { from: isoDate(subDays(7)), to: isoDate(new Date()) };
    if (period === '30d') return { from: isoDate(subDays(30)), to: isoDate(new Date()) };
    if (period === '90d') return { from: isoDate(subDays(90)), to: isoDate(new Date()) };
    return { from: customFrom, to: customTo };
  }, [period, customFrom, customTo]);

  const filteredEggs = useMemo(
    () => eggCollections.filter(e => e.date >= from && e.date <= to),
    [eggCollections, from, to]
  );

  const filteredSales = useMemo(
    () => sales.filter(s => s.date >= from && s.date <= to && s.product === 'eggs'),
    [sales, from, to]
  );

  // Daily egg production
  const eggByDay = useMemo(() => {
    const map: Record<string, number> = {};
    filteredEggs.forEach(e => { map[e.date] = (map[e.date] || 0) + e.count; });
    return Object.entries(map).sort(([a], [b]) => a.localeCompare(b)).map(([date, eggs]) => ({
      date: formatDateShort(date), eggs,
    }));
  }, [filteredEggs]);

  // Weekly sales volume
  const salesByWeek = useMemo(() => {
    const map: Record<string, number> = {};
    filteredSales.forEach(s => {
      const d = new Date(s.date);
      const week = isoDate(new Date(d.setDate(d.getDate() - d.getDay())));
      map[week] = (map[week] || 0) + s.quantity;
    });
    return Object.entries(map).sort(([a], [b]) => a.localeCompare(b)).map(([week, qty]) => ({
      week: formatDateShort(week), qty,
    }));
  }, [filteredSales]);

  // Price trend
  const priceTrend = useMemo(() => {
    const map: Record<string, { total: number; qty: number }> = {};
    filteredSales.forEach(s => {
      if (!map[s.date]) map[s.date] = { total: 0, qty: 0 };
      map[s.date].total += s.totalAmount;
      map[s.date].qty += s.quantity;
    });
    return Object.entries(map).sort(([a], [b]) => a.localeCompare(b)).map(([date, v]) => ({
      date: formatDateShort(date), price: v.qty > 0 ? +(v.total / v.qty).toFixed(3) : 0,
    }));
  }, [filteredSales]);

  // Top-5 customer demand
  const top5Customers = useMemo(() => {
    const totals: Record<string, number> = {};
    filteredSales.forEach(s => { totals[s.customerId] = (totals[s.customerId] || 0) + s.quantity; });
    return Object.entries(totals).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([id]) => id);
  }, [filteredSales]);

  const customerDemand = useMemo(() => {
    const dateSet = new Set(filteredSales.map(s => s.date));
    const dates = [...dateSet].sort();
    return dates.map(date => {
      const row: Record<string, string | number> = { date: formatDateShort(date) };
      top5Customers.forEach(cid => {
        const name = customers.find(c => c.id === cid)?.name ?? cid;
        row[name] = filteredSales
          .filter(s => s.date === date && s.customerId === cid)
          .reduce((sum, s) => sum + s.quantity, 0);
      });
      return row;
    });
  }, [filteredSales, top5Customers, customers]);

  const top5Names = useMemo(
    () => top5Customers.map(cid => customers.find(c => c.id === cid)?.name ?? cid),
    [top5Customers, customers]
  );

  // Projection
  const projectionData = useMemo(() => {
    const dailyEggs = eggByDay.map(d => d.eggs);
    const projected = linearRegression(dailyEggs);
    const actual = eggByDay.map(d => ({ date: d.date, actual: d.eggs, projected: undefined as number | undefined }));
    const today = new Date();
    projected.forEach((v, i) => {
      const d = new Date(today);
      d.setDate(d.getDate() + i + 1);
      actual.push({ date: formatDateShort(isoDate(d)), actual: undefined as unknown as number, projected: v });
    });
    return actual;
  }, [eggByDay]);

  // KPIs
  const totalEggs = filteredEggs.reduce((s, e) => s + e.count, 0);
  const days = Math.max(1, eggByDay.length);
  const avgDailyEggs = Math.round(totalEggs / days);
  const totalRevenue = filteredSales.reduce((s, sale) => s + sale.totalAmount, 0);
  const totalSoldEggs = filteredSales.reduce((s, sale) => s + sale.quantity, 0);
  const avgEggPrice = totalSoldEggs > 0 ? totalRevenue / totalSoldEggs : 0;
  const bestCustomer = useMemo(() => {
    if (!top5Customers.length) return '—';
    return customers.find(c => c.id === top5Customers[0])?.name ?? '—';
  }, [top5Customers, customers]);

  const COLORS = ['#16a34a', '#2563eb', '#d97706', '#dc2626', '#7c3aed'];
  const periodBtns: Period[] = ['7d', '30d', '90d', 'custom'];

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-6xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
          <BarChart2 className="w-6 h-6 text-green-600" /> Analytics & Marketing
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          Visualise egg production, sales trends, and projected demand for smarter decisions
        </p>
      </div>

      {/* Period filter */}
      <div className="flex flex-wrap gap-2 items-center">
        {periodBtns.map(p => (
          <button
            key={p}
            onClick={() => setPeriod(p)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${period === p ? 'bg-green-600 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'}`}
          >
            {p === 'custom' ? 'Custom' : p.toUpperCase()}
          </button>
        ))}
        {period === 'custom' && (
          <div className="flex gap-2 items-center">
            <input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)}
              className="border border-gray-200 rounded-lg px-2 py-1 text-sm" />
            <span className="text-gray-400">—</span>
            <input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)}
              className="border border-gray-200 rounded-lg px-2 py-1 text-sm" />
          </div>
        )}
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {kpiCard(<Egg className="w-4 h-4" />, 'Avg Daily Eggs', avgDailyEggs.toLocaleString(), `${totalEggs.toLocaleString()} total`)}
        {kpiCard(<DollarSign className="w-4 h-4" />, 'Total Revenue', formatCurrency(totalRevenue), 'in period')}
        {kpiCard(<TrendingUp className="w-4 h-4" />, 'Avg Price/Egg', formatCurrency(avgEggPrice), 'weighted avg')}
        {kpiCard(<BarChart2 className="w-4 h-4" />, 'Best Customer', bestCustomer, 'by volume')}
      </div>

      {/* Egg production line chart */}
      <div className="bg-white rounded-xl border border-gray-100 p-4 shadow-sm">
        <h2 className="text-sm font-semibold text-gray-700 mb-3">Daily Egg Production</h2>
        <ResponsiveContainer width="100%" height={200}>
          <LineChart data={eggByDay}>
            <XAxis dataKey="date" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} />
            <Tooltip />
            <Line type="monotone" dataKey="eggs" stroke="#16a34a" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Sales volume bar chart */}
      <div className="bg-white rounded-xl border border-gray-100 p-4 shadow-sm">
        <h2 className="text-sm font-semibold text-gray-700 mb-3">Weekly Sales Volume (eggs)</h2>
        <ResponsiveContainer width="100%" height={180}>
          <BarChart data={salesByWeek}>
            <XAxis dataKey="week" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} />
            <Tooltip />
            <Bar dataKey="qty" fill="#16a34a" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Customer demand */}
      {customerDemand.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-100 p-4 shadow-sm">
          <h2 className="text-sm font-semibold text-gray-700 mb-3">Customer Demand Over Time</h2>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={customerDemand}>
              <XAxis dataKey="date" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip />
              <Legend />
              {top5Names.map((name, i) => (
                <Line key={name} type="monotone" dataKey={name} stroke={COLORS[i % COLORS.length]} strokeWidth={2} dot={false} />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Price trend */}
      <div className="bg-white rounded-xl border border-gray-100 p-4 shadow-sm">
        <h2 className="text-sm font-semibold text-gray-700 mb-3">Price Trend (Ksh/egg)</h2>
        <ResponsiveContainer width="100%" height={180}>
          <LineChart data={priceTrend}>
            <XAxis dataKey="date" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} />
            <Tooltip />
            <Line type="monotone" dataKey="price" stroke="#d97706" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Projection */}
      <div className="bg-white rounded-xl border border-gray-100 p-4 shadow-sm">
        <h2 className="text-sm font-semibold text-gray-700 mb-1">Egg Demand Projection (next 7 days)</h2>
        <p className="text-xs text-gray-400 mb-3">Dashed line = linear regression forecast</p>
        <ResponsiveContainer width="100%" height={200}>
          <LineChart data={projectionData}>
            <XAxis dataKey="date" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} />
            <Tooltip />
            <Legend />
            <Line type="monotone" dataKey="actual" stroke="#16a34a" strokeWidth={2} dot={false} name="Actual" />
            <Line type="monotone" dataKey="projected" stroke="#2563eb" strokeWidth={2} strokeDasharray="5 5" dot={false} name="Projected" />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
