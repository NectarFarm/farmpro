'use client';
import React, { useState, useEffect } from 'react';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { getDashboardKPIs, getProductionChartData } from '@/lib/api';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import {
  Lock, Layers, Bird, TrendingDown, Wheat, Wallet, TrendingUp, CheckCircle2,
  type LucideIcon,
} from 'lucide-react';

const fmtKES = (n: number) => `KSh ${n.toLocaleString('en-KE')}`;

export default function AuditorDashboardPage() {
  const { t } = useTranslation();
  const [kpis, setKpis] = useState({
    activeBatches: 0, totalBirds: 0, mortalityPct: 0, avgFCR: 0,
    grossMargin: 0, pendingAlerts: 0, taskCompletionPct: 0, revenueThisMonth: 0,
  });
  const [chart, setChart] = useState<{ data: Record<string, string | number>[]; products: string[] }>({ data: [], products: [] });
  // Real session expiry (from /api/me), not a hardcoded date — the auditor's actual
  // access window is the signed session cookie's exp claim, currently always 8h from
  // when they followed the owner's link (see app/api/auditor/enter/route.ts). Shown
  // in hours, not days: an 8h window always floors to "0 days left" under day-based
  // math, which reads as already-expired rather than the ~8h that's actually left.
  const [expiresAt, setExpiresAt] = useState<number | null>(null);
  const msLeft = expiresAt ? Math.max(0, expiresAt * 1000 - Date.now()) : 0;
  const daysLeft = Math.floor(msLeft / 86400000);
  const hoursLeft = Math.max(0, Math.ceil(msLeft / 3600000));
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState('');

  const AUDITOR_REPORTS: { id: string; label: string }[] = [
    { id: 'pl', label: t('profitLoss') },
    { id: 'production', label: t('productionSummary') },
    { id: 'batch_card', label: t('batchPerformanceCards') },
    { id: 'baseline', label: t('baselineVsPeriod') },
  ];

  const runExport = async (id: string, fmt: 'PDF' | 'CSV') => {
    setErr(''); setBusy(`${id}:${fmt}`);
    try {
      const res = await fetch(`/api/reports/${id}`, { credentials: 'include' });
      if (!res.ok) throw new Error(res.status === 401 ? t('errorUnauthorized') : t('reportFailed', { status: String(res.status) }));
      const data = await res.json();
      // Translate server-side report column headers for exported PDF/CSV
      const colMap: Record<string, string> = {
        'Date': 'date', 'Batch': 'batch', 'Type': 'type', 'Qty': 'qty',
        'Product': 'product', 'Unit Price': 'unitPrice', 'Total': 'total',
        'Buyer': 'buyer', 'Deaths': 'deaths', 'Cause': 'cause', 'Lot': 'lot',
        'Hours': 'hours', 'Rate': 'rate', 'Cost': 'cost', 'Feed kg': 'feedKg',
        'Line': 'line', 'Amount': 'amount', 'Info': 'details',
        'Feed': 'feedConsumed', 'Health': 'health', 'Labour': 'labour',
        'Salaries': 'salaries', 'Overhead': 'overhead', 'Acquisition': 'acquisition',
        'Total Cost': 'totalCost', 'Revenue': 'revenue', 'Gross Margin': 'grossMargin',
        'Species': 'species',        'FCR': 'fcr', 'FCR basis': 'fcrBasis',
        'Mortality': 'mortalityRate', 'Feed Cost (KSh)': 'feedConsumed',
        'Stage': 'stage', 'Survived': 'survivors', 'Sold': 'sold',
        'On farm': 'onFarmNow', 'Cost/Unit': 'costPerUnit', 'Margin': 'margin',
      };
      data.columns = data.columns.map((c: string) => (t as (k: string) => string)(colMap[c] ?? c));
      const { exportReport } = await import('@/lib/export');
      await exportReport(data, fmt);
    } catch (e) { setErr((e as Error).message); } finally { setBusy(null); }
  };

  useEffect(() => {
    getDashboardKPIs().then(setKpis);
    getProductionChartData().then(setChart);
    fetch('/api/me', { credentials: 'include' }).then(r => r.ok ? r.json() : null)
      .then(d => { if (typeof d?.exp === 'number') setExpiresAt(d.exp); }).catch(() => {});
  }, []);
  const PCOLORS = ['#10b981', '#6366f1', '#06b6d4', '#ec4899', '#8b5cf6', '#f97316'];

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Read-only banner — SEC-1, FR-M15-6 */}
      <div className="bg-amber-500 text-white px-6 py-3 flex items-center gap-3">
        <Lock className="w-5 h-5 shrink-0" />
        <div>
          <p className="font-bold">
            {daysLeft >= 1
              ? t('readOnlyBanner', { date: expiresAt ? new Date(expiresAt * 1000).toLocaleDateString('en-KE') : '—', daysLeft })
              : t('readOnlyBannerHours', { date: expiresAt ? new Date(expiresAt * 1000).toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' }) : '—', hoursLeft })}
          </p>
          <p className="text-amber-100 text-xs">{t('readOnlyDescription')}</p>
        </div>
      </div>

      <div className="p-6 flex flex-col gap-6 max-w-5xl mx-auto w-full">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t('investorView')}</h1>
          <p className="text-gray-500 text-sm">{t('scopedAccessDesc')}</p>
        </div>

        {/* KPIs — read only, grouped to match the owner dashboard */}
        {[
          { heading: t('livestockHealth'), cards: [
            { label: t('activeBatches'), value: String(kpis.activeBatches), icon: Layers, tint: 'text-emerald-600 bg-emerald-50' },
            { label: t('totalAnimals'), value: String(kpis.totalBirds), icon: Bird, tint: 'text-sky-600 bg-sky-50' },
            { label: t('mortality'), value: `${kpis.mortalityPct}%`, icon: TrendingDown, tint: 'text-rose-600 bg-rose-50' },
            { label: t('avgFcr'), value: String(kpis.avgFCR), icon: Wheat, tint: 'text-amber-600 bg-amber-50' },
          ] },
          { heading: t('finance'), cards: [
            { label: t('grossMargin'), value: fmtKES(kpis.grossMargin), icon: Wallet, tint: 'text-emerald-600 bg-emerald-50' },
            { label: `${t('revenue')} (${t('month')})`, value: fmtKES(kpis.revenueThisMonth), icon: TrendingUp, tint: 'text-green-600 bg-green-50' },
            { label: t('taskCompletion'), value: `${kpis.taskCompletionPct}%`, icon: CheckCircle2, tint: 'text-violet-600 bg-violet-50' },
          ] },
        ].map(group => (
          <div key={group.heading} className="flex flex-col gap-2">
            <h2 className="text-xs font-bold uppercase tracking-wide text-gray-400">{group.heading}</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {group.cards.map(k => {
                const Icon = k.icon as LucideIcon;
                return (
                  <div key={k.label} className="bg-white border border-gray-200 rounded-xl p-4 pointer-events-none select-none">
                    <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${k.tint}`}>
                      <Icon className="w-[18px] h-[18px]" />
                    </div>
                    <p className="text-xs text-gray-500 mt-1">{k.label}</p>
                    <p className="text-2xl font-bold text-gray-900">{k.value}</p>
                  </div>
                );
              })}
            </div>
          </div>
        ))}

        {/* Production chart */}
        <div className="bg-white border border-gray-200 rounded-xl p-5 pointer-events-none select-none">
          <h2 className="font-bold text-gray-800 mb-4">{t('weeklyProduction')}</h2>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={chart.data}>
              <XAxis dataKey="date" tick={{ fontSize:11 }} />
              <YAxis tick={{ fontSize:11 }} allowDecimals={false} />
              <Tooltip formatter={(v, n) => n === 'revenue' ? [`KSh ${Number(v).toLocaleString()}`, t('revenue')] : [`${v}`, String(n)]} />
              {chart.products.map((p, i) => <Bar key={p} dataKey={p} stackId="prod" fill={PCOLORS[i % PCOLORS.length]} radius={[4,4,0,0]} />)}
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Export only */}
        <div className="bg-white border border-gray-200 rounded-xl p-5">
          <h2 className="font-bold text-gray-800 mb-3">{t('availableReports')}</h2>
          <p className="text-gray-500 text-sm mb-3">{t('reportsAccessDesc')}</p>
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
