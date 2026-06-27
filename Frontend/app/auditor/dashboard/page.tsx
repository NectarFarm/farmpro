'use client';
import React, { useState, useEffect } from 'react';
import { getDashboardKPIs, getProductionChartData } from '@/lib/api';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';

const fmtKES = (n: number) => `KSh ${n.toLocaleString('en-KE')}`;
const EXPIRY = '2026-09-30';

export default function AuditorDashboardPage() {
  const [kpis, setKpis] = useState({
    activeBatches: 0, totalBirds: 0, mortalityPct: 0, avgFCR: 0,
    grossMargin: 0, pendingAlerts: 0, taskCompletionPct: 0, revenueThisMonth: 0,
  });
  const [chart, setChart] = useState<{ data: Record<string, string | number>[]; products: string[] }>({ data: [], products: [] });
  const daysLeft = Math.floor((new Date(EXPIRY).getTime() - Date.now()) / 86400000);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState('');

  const AUDITOR_REPORTS: { id: string; label: string }[] = [
    { id: 'pl', label: 'Profit & Loss' },
    { id: 'production', label: 'Production Summary' },
    { id: 'batch_card', label: 'Batch Performance Cards' },
    { id: 'baseline', label: 'Baseline vs Period Impact' },
  ];

  const runExport = async (id: string, fmt: 'PDF' | 'CSV') => {
    setErr(''); setBusy(`${id}:${fmt}`);
    try {
      const res = await fetch(`/api/reports/${id}`, { credentials: 'include' });
      if (!res.ok) throw new Error(res.status === 401 ? 'Please sign in again' : `Report failed (${res.status})`);
      const { exportReport } = await import('@/lib/export');
      await exportReport(await res.json(), fmt);
    } catch (e) { setErr((e as Error).message); } finally { setBusy(null); }
  };

  useEffect(() => { getDashboardKPIs().then(setKpis); getProductionChartData().then(setChart); }, []);
  const PCOLORS = ['#10b981', '#6366f1', '#06b6d4', '#ec4899', '#8b5cf6', '#f97316'];

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Read-only banner — SEC-1, FR-M15-6 */}
      <div className="bg-amber-500 text-white px-6 py-3 flex items-center gap-3">
        <span className="text-xl">🔒</span>
        <div>
          <p className="font-bold">Read-only · Access expires {new Date(EXPIRY).toLocaleDateString('en-KE')} ({daysLeft} days left)</p>
          <p className="text-amber-100 text-xs">You cannot edit any data. This session is scoped and time-boxed.</p>
        </div>
      </div>

      <div className="p-6 flex flex-col gap-6 max-w-5xl mx-auto w-full">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Investor / Auditor View</h1>
          <p className="text-gray-500 text-sm">Scoped read-only access — farm performance reports</p>
        </div>

        {/* KPIs — read only, grouped to match the owner dashboard */}
        {[
          { heading: 'Livestock & flock health', cards: [
            { label:'Active Batches', value: String(kpis.activeBatches), icon:'🐔' },
            { label:'Total Animals', value: String(kpis.totalBirds), icon:'🐄' },
            { label:'Mortality', value: `${kpis.mortalityPct}%`, icon:'❤️‍🩹' },
            { label:'Avg FCR', value: String(kpis.avgFCR), icon:'🌾' },
          ] },
          { heading: 'Finance', cards: [
            { label:'Gross Margin', value: fmtKES(kpis.grossMargin), icon:'💰' },
            { label:'Revenue (month)', value: fmtKES(kpis.revenueThisMonth), icon:'📈' },
            { label:'Task Completion', value: `${kpis.taskCompletionPct}%`, icon:'✅' },
          ] },
        ].map(group => (
          <div key={group.heading} className="flex flex-col gap-2">
            <h2 className="text-xs font-bold uppercase tracking-wide text-gray-400">{group.heading}</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {group.cards.map(k => (
                <div key={k.label} className="bg-white border border-gray-200 rounded-xl p-4 pointer-events-none select-none">
                  <span className="text-xl">{k.icon}</span>
                  <p className="text-xs text-gray-500 mt-1">{k.label}</p>
                  <p className="text-2xl font-bold text-gray-900">{k.value}</p>
                </div>
              ))}
            </div>
          </div>
        ))}

        {/* Production chart */}
        <div className="bg-white border border-gray-200 rounded-xl p-5 pointer-events-none select-none">
          <h2 className="font-bold text-gray-800 mb-4">Weekly Production</h2>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={chart.data}>
              <XAxis dataKey="date" tick={{ fontSize:11 }} />
              <YAxis tick={{ fontSize:11 }} allowDecimals={false} />
              <Tooltip formatter={(v, n) => n === 'revenue' ? [`KSh ${Number(v).toLocaleString()}`, 'Revenue'] : [`${v}`, String(n)]} />
              {chart.products.map((p, i) => <Bar key={p} dataKey={p} stackId="prod" fill={PCOLORS[i % PCOLORS.length]} radius={[4,4,0,0]} />)}
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Export only */}
        <div className="bg-white border border-gray-200 rounded-xl p-5">
          <h2 className="font-bold text-gray-800 mb-3">Available Reports</h2>
          <p className="text-gray-500 text-sm mb-3">You have been granted access to these reports for the duration of your access period.</p>
          {err && <p className="text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-xs font-semibold mb-2">{err}</p>}
          <div className="flex flex-col gap-2">
            {AUDITOR_REPORTS.map(r => (
              <div key={r.id} className="flex items-center justify-between bg-gray-50 rounded-xl px-4 py-3">
                <span className="font-medium text-gray-700 text-sm">{r.label}</span>
                <div className="flex gap-2">
                  {(['PDF','CSV'] as const).map(fmt => (
                    <button key={fmt} disabled={busy !== null} onClick={() => runExport(r.id, fmt)}
                      className="px-3 py-1 bg-white border border-gray-200 rounded-lg text-xs font-semibold text-gray-600 hover:bg-gray-100 disabled:opacity-40">
                      {busy === `${r.id}:${fmt}` ? '…' : fmt}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
