'use client';
import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/lib/stores/auth';
import { useTranslation, type TranslationKey } from '@/lib/i18n/useTranslation';
import { getDashboardKPIs, getProductionChartData } from '@/lib/api';
import dynamic from 'next/dynamic';
import {
  Layers, Bird, Wheat, HeartPulse, Wallet, TrendingUp, CheckCircle2, BellRing,
  LayoutDashboard,
} from 'lucide-react';
import { ENTERPRISE_OPTIONS, enterpriseIcon as enterpriseIconFor } from '@/lib/species';

const ProductionChart = dynamic(() => import('./ProductionChart'), {
  ssr: false,
  loading: () => <div className="h-64 rounded-xl bg-gray-100 animate-pulse" />,
});

const fmt = (n: number) => n >= 1000 ? `${(n/1000).toFixed(1)}K` : String(n);
const fmtKES = (n: number) => `KSh ${n.toLocaleString('en-KE')}`;
const PRODUCT_COLORS = ['#10b981', '#6366f1', '#06b6d4', '#ec4899', '#8b5cf6', '#f97316'];

export default function OwnerDashboardPage() {
  const { user } = useAuthStore();
  const router = useRouter();
  const [kpis, setKpis] = useState({
    activeBatches: 0, totalBirds: 0, mortalityPct: 0, avgFCR: 0,
    grossMargin: 0, pendingAlerts: 0, taskCompletionPct: 0,
    revenueThisMonth: 0, revenueThisQuarter: 0, revenueThisYear: 0, revenueAllTime: 0,
    enterpriseBreaks: {} as Record<string, { batches: number; animals: number; mortalityPct: number }>,
  });
  const { t } = useTranslation();
  const [revPeriod, setRevPeriod] = useState<'month' | 'quarter' | 'year' | 'all'>('month');
  const REV = { month: kpis.revenueThisMonth, quarter: kpis.revenueThisQuarter, year: kpis.revenueThisYear, all: kpis.revenueAllTime };
  const [chart, setChart] = useState<{ data: Record<string, string | number>[]; products: string[] }>({ data: [], products: [] });
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState(false);

  const fetchDashboardData = useCallback(() => {
    setLoadError(false);
    getDashboardKPIs().then(d => {
      setKpis({ ...d, enterpriseBreaks: (d as any).enterpriseBreaks ?? {} });
      setLoaded(true);
    }).catch(() => {
      setLoadError(true);
      setLoaded(true);
    });
    getProductionChartData().then(setChart).catch(() => {
      setLoadError(true);
    });
  }, []);

  useEffect(() => {
    if (!user) { router.replace('/owner/login'); return; }
    fetchDashboardData();
  }, [user, router, fetchDashboardData]);

  const groups: { heading: string; cards: { label: string; value: string; Icon: typeof Layers; tint: string; sub?: string; good?: boolean; bad?: boolean }[] }[] = [
    { heading: t('livestockHealth'), cards: [
      { label: t('activeBatches'), value: String(kpis.activeBatches), Icon: Layers, tint:'text-emerald-600 bg-emerald-50' },
      { label: t('totalAnimals'), value: fmt(kpis.totalBirds), Icon: Bird, tint:'text-sky-600 bg-sky-50' },
      { label: t('mortalityRate'), value: `${kpis.mortalityPct}%`, Icon: HeartPulse, tint:'text-rose-600 bg-rose-50', bad:kpis.mortalityPct >= 5 },
      { label: t('averageFCR'), value: String(kpis.avgFCR), Icon: Wheat, tint:'text-violet-600 bg-violet-50', sub:`${t('target')} ≤ 2.8`, good:kpis.avgFCR > 0 && kpis.avgFCR <= 2.8 },
    ] },
    { heading: t('finance'), cards: [
      { label: t('grossMargin'), value: fmtKES(kpis.grossMargin), Icon: Wallet, tint:'text-emerald-600 bg-emerald-50', good:kpis.grossMargin > 0, bad:kpis.grossMargin < 0 },
      { label: `${t('revenue')} (${t(revPeriod as TranslationKey)})`, value: fmtKES(REV[revPeriod]), Icon: TrendingUp, tint:'text-amber-600 bg-amber-50' },
    ] },
    { heading: t('operations'), cards: [
      { label: t('taskCompletion'), value: `${kpis.taskCompletionPct}%`, Icon: CheckCircle2, tint:'text-indigo-600 bg-indigo-50', sub:t('today') },
      { label: t('pendingAlerts'), value: String(kpis.pendingAlerts), Icon: BellRing, tint:'text-orange-600 bg-orange-50', bad:kpis.pendingAlerts > 0 },
    ] },
  ];


  return (
    <div className="p-6 flex flex-col gap-6 max-w-7xl">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="shrink-0 w-11 h-11 rounded-xl bg-green-50 flex items-center justify-center">
            <LayoutDashboard className="w-6 h-6 text-green-700" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{t('farmDashboard')}</h1>
            <p className="text-gray-500 text-sm">{new Date().toLocaleDateString('en-KE', { weekday:'long', day:'numeric', month:'long', year:'numeric' })}</p>
          </div>
        </div>
        <div className="flex gap-2">
          <a href="/owner/setup" className="px-4 py-2 bg-green-600 text-white rounded-lg font-semibold text-sm hover:bg-green-700">+ {t('setupWizard')}</a>
          <a href="/owner/reports" className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg font-semibold text-sm hover:bg-gray-200">{t('reports')}</a>
        </div>
      </div>

      {/* Error banner — a failed fetch must never look like "no data" */}
      {loadError && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-5 flex items-center justify-between flex-wrap gap-3">
          <div>
            <p className="font-semibold text-red-800">{t('failedToLoadFarmData')}</p>
            <p className="text-red-700 text-sm">{t('loadFormDataFailed')}</p>
          </div>
          <button onClick={fetchDashboardData} className="px-4 py-2 bg-red-600 text-white rounded-lg font-semibold text-sm shrink-0">{t('retry')}</button>
        </div>
      )}

      {/* Empty state — only after data has loaded successfully, and never blocks the dashboard */}
      {loaded && !loadError && kpis.activeBatches === 0 && (
        <div className="bg-green-50 border border-green-200 rounded-xl p-5 flex items-center justify-between flex-wrap gap-3">
          <div>
            <p className="font-semibold text-green-800">{t('noActiveBatchesYet')}</p>
            <p className="text-green-700 text-sm">{t('setupGuideHint')}</p>
          </div>
          <Link href="/owner/farm" className="px-4 py-2 bg-green-600 text-white rounded-lg font-semibold text-sm shrink-0">{t('goToFarm')} →</Link>
        </div>
      )}

      {/* KPI groups */}
      {groups.map(group => (
        <div key={group.heading} className="flex flex-col gap-2">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <h2 className="text-xs font-bold uppercase tracking-wide text-gray-400">{group.heading}</h2>
            {group.heading === t('finance') && (
              <div className="flex gap-1">
                {(['month', 'quarter', 'year', 'all'] as const).map(p => (
                  <button key={p} onClick={() => setRevPeriod(p)}
                    className={`px-2 py-0.5 rounded text-[11px] font-semibold capitalize ${revPeriod === p ? 'bg-amber-500 text-white' : 'bg-gray-100 text-gray-500'}`}>{t(p as TranslationKey)}</button>
                ))}
              </div>
            )}
          </div>
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

      {/* Enterprise breakdown — what you're raising and how many */}
      {Object.keys(kpis.enterpriseBreaks).length > 0 && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-bold uppercase tracking-wide text-gray-400">{t('enterpriseBreakdown')}</h2>
            <Link href="/owner/farm" className="text-xs font-semibold text-green-700 hover:underline">{t('manageAll')} →</Link>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
            {Object.entries(kpis.enterpriseBreaks).map(([ent, data]) => {
              const opt = ENTERPRISE_OPTIONS.find(e => e.key === ent);
              const EntIcon = enterpriseIconFor(ent);
              return (
                <div key={ent} className="bg-white border border-gray-200/80 rounded-xl p-3 text-center shadow-sm">
                  <EntIcon className="w-6 h-6 mx-auto text-gray-600" />
                  <p className="text-xs font-semibold text-gray-700 mt-1">{opt?.label ?? ent}</p>
                  <p className="text-lg font-bold text-gray-900">{data.animals}</p>
                  <p className="text-[10px] text-gray-400">{t('batchMeta', { batches: data.batches, mortality: data.mortalityPct })}</p>
                </div>
              );
            })}
          </div>
        </div>
      )}        {/* Production chart */}
      <div className="bg-white border border-gray-200/80 rounded-2xl p-5 shadow-sm">
        <div className="flex items-center gap-4 mb-4 flex-wrap">
          <h2 className="font-bold text-gray-900">{t('dailyProduction')} & {t('revenue')}</h2>
          {chart.products.map((p, i) => (
            <span key={p} className="flex items-center gap-1.5 text-xs text-gray-500"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: PRODUCT_COLORS[i % PRODUCT_COLORS.length] }} />{p}</span>
          ))}
          <span className="flex items-center gap-1.5 text-xs text-gray-500"><span className="w-2.5 h-2.5 rounded-sm bg-amber-400" />{t('revenue')} (KSh)</span>
        </div>
        {chart.products.length === 0
          ? <p className="text-gray-400 text-sm text-center py-12">{t('noProduction')}</p>
          : <ProductionChart data={chart.data} products={chart.products} />
        }
      </div>

    </div>
  );
}
