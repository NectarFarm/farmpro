'use client';
import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/lib/stores/auth';
import { getDashboardKPIs, getProductionChartData } from '@/lib/api';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { Layers, Bird, Wheat, HeartPulse, Wallet, TrendingUp, CheckCircle2, BellRing } from 'lucide-react';

const fmt = (n: number) => n >= 1000 ? `${(n/1000).toFixed(1)}K` : String(n);
const fmtKES = (n: number) => `KSh ${n.toLocaleString('en-KE')}`;
const PRODUCT_COLORS = ['#10b981', '#6366f1', '#06b6d4', '#ec4899', '#8b5cf6', '#f97316'];

export default function OwnerDashboardPage() {
  const { user } = useAuthStore();
  const router = useRouter();
  const [kpis, setKpis] = useState({
    activeBatches: 0, totalBirds: 0, mortalityPct: 0, avgFCR: 0,
    grossMargin: 0, pendingAlerts: 0, taskCompletionPct: 0, revenueThisMonth: 0,
  });
  const [chart, setChart] = useState<{ data: Record<string, string | number>[]; products: string[] }>({ data: [], products: [] });
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!user) { router.replace('/owner/login'); return; }
    getDashboardKPIs().then(d => { setKpis(d); setLoaded(true); });
    getProductionChartData().then(setChart);
  }, [user, router]);

  const groups: { heading: string; cards: { label: string; value: string; Icon: typeof Layers; tint: string; sub?: string; good?: boolean; bad?: boolean }[] }[] = [
    { heading: 'Livestock & flock health', cards: [
      { label:'Active Batches', value: String(kpis.activeBatches), Icon: Layers, tint:'text-emerald-600 bg-emerald-50' },
      { label:'Total Animals', value: fmt(kpis.totalBirds), Icon: Bird, tint:'text-sky-600 bg-sky-50' },
      { label:'Mortality', value: `${kpis.mortalityPct}%`, Icon: HeartPulse, tint:'text-rose-600 bg-rose-50', bad:kpis.mortalityPct >= 5 },
      { label:'Avg FCR', value: String(kpis.avgFCR), Icon: Wheat, tint:'text-violet-600 bg-violet-50', sub:'target ≤ 2.8', good:kpis.avgFCR > 0 && kpis.avgFCR <= 2.8 },
    ] },
    { heading: 'Finance', cards: [
      { label:'Gross Margin', value: fmtKES(kpis.grossMargin), Icon: Wallet, tint:'text-emerald-600 bg-emerald-50', good:kpis.grossMargin > 0, bad:kpis.grossMargin < 0 },
      { label:'Revenue (month)', value: fmtKES(kpis.revenueThisMonth), Icon: TrendingUp, tint:'text-amber-600 bg-amber-50' },
    ] },
    { heading: 'Operations', cards: [
      { label:'Task Completion', value: `${kpis.taskCompletionPct}%`, Icon: CheckCircle2, tint:'text-indigo-600 bg-indigo-50', sub:'today' },
      { label:'Pending Alerts', value: String(kpis.pendingAlerts), Icon: BellRing, tint:'text-orange-600 bg-orange-50', bad:kpis.pendingAlerts > 0 },
    ] },
  ];


  return (
    <div className="p-6 flex flex-col gap-6 max-w-7xl">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Farm Dashboard</h1>
          <p className="text-gray-500 text-sm">{new Date().toLocaleDateString('en-KE', { weekday:'long', day:'numeric', month:'long', year:'numeric' })}</p>
        </div>
        <div className="flex gap-2">
          <a href="/owner/setup" className="px-4 py-2 bg-green-600 text-white rounded-lg font-semibold text-sm hover:bg-green-700">+ Setup Wizard</a>
          <a href="/owner/reports" className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg font-semibold text-sm hover:bg-gray-200">Reports</a>
        </div>
      </div>

      {/* Empty state — only after data has loaded, and never blocks the dashboard */}
      {loaded && kpis.activeBatches === 0 && (
        <div className="bg-green-50 border border-green-200 rounded-xl p-5 flex items-center justify-between flex-wrap gap-3">
          <div>
            <p className="font-semibold text-green-800">Your farm has no active batches yet.</p>
            <p className="text-green-700 text-sm">Add a batch and your numbers will fill in. The 📖 Setup Guide (bottom-right) walks you through it.</p>
          </div>
          <Link href="/owner/farm" className="px-4 py-2 bg-green-600 text-white rounded-lg font-semibold text-sm shrink-0">Go to Farm →</Link>
        </div>
      )}

      {/* KPI groups */}
      {groups.map(group => (
        <div key={group.heading} className="flex flex-col gap-2">
          <h2 className="text-xs font-bold uppercase tracking-wide text-gray-400">{group.heading}</h2>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {group.cards.map(card => (
              <div key={card.label} className="rounded-2xl border border-gray-200/80 bg-white p-4 shadow-sm hover:shadow-md transition-shadow flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <span className={`w-9 h-9 rounded-xl flex items-center justify-center ${card.tint}`}>
                    <card.Icon className="w-[18px] h-[18px]" strokeWidth={2} />
                  </span>
                  {card.sub && <span className="text-[11px] text-gray-400">{card.sub}</span>}
                </div>
                <div>
                  <p className={`text-2xl font-bold tracking-tight ${card.bad ? 'text-rose-600' : card.good ? 'text-emerald-600' : 'text-gray-900'}`}>{card.value}</p>
                  <p className="text-xs text-gray-500 mt-0.5">{card.label}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}

      {/* Production chart — real products by name */}
      <div className="bg-white border border-gray-200/80 rounded-2xl p-5 shadow-sm">
        <div className="flex items-center gap-4 mb-4 flex-wrap">
          <h2 className="font-bold text-gray-900">Daily Production & Revenue</h2>
          {chart.products.map((p, i) => (
            <span key={p} className="flex items-center gap-1.5 text-xs text-gray-500"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: PRODUCT_COLORS[i % PRODUCT_COLORS.length] }} />{p}</span>
          ))}
          <span className="flex items-center gap-1.5 text-xs text-gray-500"><span className="w-2.5 h-2.5 rounded-sm bg-amber-400" />Revenue (KSh)</span>
        </div>
        {chart.products.length === 0
          ? <p className="text-gray-400 text-sm text-center py-12">No production recorded yet — your workers&apos; collections (eggs, milk, meat…) appear here.</p>
          : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={chart.data} margin={{ top:4, right:8, bottom:0, left:-8 }} barGap={2}>
                <CartesianGrid vertical={false} stroke="#f1f5f9" />
                <XAxis dataKey="date" tick={{ fontSize:11, fill:'#94a3b8' }} axisLine={false} tickLine={false} />
                <YAxis yAxisId="prod" orientation="left" tick={{ fontSize:11, fill:'#94a3b8' }} axisLine={false} tickLine={false} width={32} allowDecimals={false} />
                <YAxis yAxisId="rev" orientation="right" tick={{ fontSize:11, fill:'#94a3b8' }} axisLine={false} tickLine={false} tickFormatter={v=>`${(v/1000).toFixed(0)}K`} width={36} />
                <Tooltip cursor={{ fill:'#f8fafc' }} contentStyle={{ borderRadius:12, border:'1px solid #e2e8f0', fontSize:12, boxShadow:'0 4px 12px rgba(0,0,0,0.06)' }}
                  formatter={(v, n) => n === 'revenue' ? [`KSh ${Number(v).toLocaleString()}`, 'Revenue'] : [`${v}`, String(n)]} />
                {chart.products.map((p, i) => (
                  <Bar key={p} yAxisId="prod" dataKey={p} stackId="prod" fill={PRODUCT_COLORS[i % PRODUCT_COLORS.length]} maxBarSize={28} />
                ))}
                <Bar yAxisId="rev" dataKey="revenue" fill="#fbbf24" radius={[4,4,0,0]} maxBarSize={12} />
              </BarChart>
            </ResponsiveContainer>
          )
        }
      </div>

    </div>
  );
}
