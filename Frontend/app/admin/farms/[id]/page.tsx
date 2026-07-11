'use client';
import React, { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  Users, Bird, Layers, TrendingUp, DollarSign,
  Activity, AlertTriangle,
  ArrowLeft, BarChart3, Wallet, PieChart,
} from 'lucide-react';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { enterpriseIcon as enterpriseIconFor } from '@/lib/species';

const fmt = (n: number) => n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(n);
const fmtKES = (n: number) => `KSh ${Math.abs(n).toLocaleString('en-KE')}`;

interface FarmAnalytics {
  farm: { id: string; name: string; plan: string; features: string[]; active: boolean; testingEnabled: boolean; createdAt: string | null };
  owner: { id: string; name: string; email: string; phone: string } | null;
  users: { total: number; workers: number; managers: number; owners: number };
  metrics: {
    totalBatches: number; activeBatches: number; totalAnimals: number;
    totalRevenue: number; totalCost: number; grossMargin: number;
    mortalityPct: number; avgFCR: number; totalDeaths: number; totalInitial: number;
  };
  enterpriseBreakdown: Record<string, { batches: number; animals: number }>;
  monthlyRevenue: { month: string; revenue: number }[];
  batches: {
    id: string; name: string; species: string; stage: string; status: string;
    initialQty: number; currentQty: number; acquiredDate: string;
    fcr?: number; mortalityPct: number; costPerUnit: number;
    grossMargin: number; totalRevenue: number; totalCost: number;
    costPerBird?: number; survivors: number; soldHead: number; deaths: number;
  }[];
  recentActivity: { clientUuid: string; type: string; payload: Record<string, unknown>; capturedAt: string; createdBy: string }[];
  recentAudits: { id: string; actor: string; action: string; entity: string | null; meta: unknown; at: string | null }[];
}

export default function AdminFarmDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { t } = useTranslation();
  const [data, setData] = useState<FarmAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [sortKey, setSortKey] = useState<string>('name');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [batchSearch, setBatchSearch] = useState('');

  const load = useCallback(() => {
    setLoading(true); setErr('');
    fetch(`/api/admin/tenants/analytics?id=${encodeURIComponent(id)}`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : Promise.reject(new Error(t('failedToLoadFarmData'))))
      .then(d => { setData(d); setLoading(false); })
      .catch(e => { setErr((e as Error).message); setLoading(false); });
  }, [id]);

  useEffect(() => { if (id) load(); }, [id, load]);

  const toggleSort = (key: string) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('asc'); }
  };
  const sortArrow = (key: string) => sortKey === key ? (sortDir === 'asc' ? ' ▲' : ' ▼') : '';

  if (loading) {
    return (
      <div className="p-6 flex items-center justify-center min-h-[60vh]">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-gray-300 border-t-gray-600 rounded-full animate-spin" />
          <p className="text-gray-400 text-sm">{t('loading')}</p>
        </div>
      </div>
    );
  }

  if (err) {
    return (
      <div className="p-6">
        <div className="bg-red-50 border border-red-200 rounded-xl p-5 text-center">
          <AlertTriangle className="w-8 h-8 text-red-400 mx-auto mb-2" />
          <p className="text-red-700 font-semibold">{err}</p>
          <button onClick={load} className="mt-3 px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-semibold">{t('retry')}</button>
        </div>
      </div>
    );
  }

  if (!data) return null;

  const { farm, owner, users: userStats, metrics, enterpriseBreakdown, monthlyRevenue, batches, recentActivity } = data;

  const filteredBatches = batches.filter(b => {
    if (!batchSearch.trim()) return true;
    const q = batchSearch.toLowerCase();
    return b.name.toLowerCase().includes(q) || b.species.toLowerCase().includes(q) || b.stage.toLowerCase().includes(q);
  });

  const sortedBatches = [...filteredBatches].sort((a, b) => {
    let cmp = 0;
    const av = (a as Record<string, unknown>)[sortKey];
    const bv = (b as Record<string, unknown>)[sortKey];
    if (typeof av === 'string' && typeof bv === 'string') cmp = av.localeCompare(bv);
    else if (typeof av === 'number' && typeof bv === 'number') cmp = av - bv;
    return sortDir === 'asc' ? cmp : -cmp;
  });

  const maxRevenue = Math.max(...monthlyRevenue.map(r => r.revenue), 1);

  const statCards = [
    { label: t('activeBatches'), value: String(metrics.activeBatches), icon: Layers, tint: 'text-emerald-600 bg-emerald-50', sub: `${metrics.totalBatches} ${t('total').toLowerCase()}` },
    { label: t('totalAnimals'), value: fmt(metrics.totalAnimals), icon: Bird, tint: 'text-sky-600 bg-sky-50', sub: `${metrics.totalInitial} ${t('initialQty')}` },
    { label: t('mortalityRate'), value: `${metrics.mortalityPct}%`, icon: Activity, tint: metrics.mortalityPct > 10 ? 'text-red-600 bg-red-50' : 'text-rose-600 bg-rose-50', sub: `${metrics.totalDeaths} ${t('deaths')}` },
    { label: t('averageFCR'), value: metrics.avgFCR ? String(metrics.avgFCR) : '—', icon: TrendingUp, tint: 'text-violet-600 bg-violet-50', sub: `${t('target')} \u2264 2.8` },
    { label: t('revenue'), value: fmtKES(metrics.totalRevenue), icon: DollarSign, tint: 'text-green-600 bg-green-50' },
    { label: t('grossMargin'), value: fmtKES(metrics.grossMargin), icon: Wallet, tint: metrics.grossMargin < 0 ? 'text-red-600 bg-red-50' : 'text-emerald-600 bg-emerald-50' },
  ];

  return (
    <div className="p-6 flex flex-col gap-6 max-w-6xl mx-auto">
      {/* Breadcrumb & header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <button onClick={() => router.back()} className="w-9 h-9 flex items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-700 transition-colors">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-sm text-gray-400">
              <Link href="/admin/farms" className="hover:underline">{t('farms')}</Link>
              <span>/</span>
            </div>
            <h1 className="text-2xl font-bold text-gray-900 truncate flex items-center gap-2">
              {farm.name}
              {!farm.active && <span className="text-xs bg-red-600 text-white px-2 py-0.5 rounded-full">{t('suspended')}</span>}
            </h1>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${farm.active ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
            {farm.active ? t('active') : t('inactive')}
          </span>
          <span className="text-xs bg-gray-100 text-gray-500 px-2.5 py-1 rounded-full capitalize">{farm.plan}</span>
          <span className="text-xs text-gray-400">{userStats.total} {t('users')} · {userStats.workers} {t('workers')}</span>
        </div>
      </div>

      {/* Owner card */}
      {owner && (
        <div className="bg-white border border-gray-200 rounded-xl px-5 py-3 flex items-center gap-4 flex-wrap">
          <div className="w-9 h-9 rounded-full bg-indigo-50 flex items-center justify-center">
            <Users className="w-4 h-4 text-indigo-600" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-gray-900">{owner.name}</p>
            <p className="text-xs text-gray-400">{owner.email}{owner.phone ? ` · ${owner.phone}` : ''}</p>
          </div>
          <span className="text-xs bg-indigo-50 text-indigo-600 px-2 py-0.5 rounded-full ml-auto">{t('owner')}</span>
        </div>
      )}

      {/* Stats cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3">
        {statCards.map(card => (
          <div key={card.label} className="rounded-xl border border-gray-200/80 bg-white p-4 shadow-sm flex flex-col gap-2">
            <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${card.tint}`}>
              <card.icon className="w-[18px] h-[18px]" strokeWidth={2} />
            </div>
            <p className="text-xl font-bold tracking-tight text-gray-900">{card.value}</p>
            <p className="text-[11px] text-gray-500 font-medium">{card.label}</p>
            {card.sub && <p className="text-[10px] text-gray-400 -mt-1">{card.sub}</p>}
          </div>
        ))}
      </div>

      {/* Charts row */}
      <div className="grid md:grid-cols-2 gap-5">
        {/* Revenue chart (last 6 months) */}
        <div className="bg-white border border-gray-200 rounded-xl p-5">
          <h2 className="font-bold text-gray-800 flex items-center gap-2 mb-4">
            <BarChart3 className="w-4 h-4 text-gray-400" /> {t('monthlyRevenue')}
          </h2>
          <div className="flex items-end gap-2 h-32">
            {monthlyRevenue.map((r, i) => {
              const pct = maxRevenue > 0 ? (r.revenue / maxRevenue) * 100 : 0;
              return (
                <div key={r.month} className="flex-1 flex flex-col items-center gap-1">
                  <span className="text-[10px] text-gray-400 font-medium">
                    {r.revenue > 0 ? `K${(r.revenue / 1000).toFixed(0)}K` : '—'}
                  </span>
                  <div className="w-full bg-green-100 rounded-t-md relative" style={{ height: `${Math.max(pct, 4)}%` }}>
                    <div className="absolute inset-0 bg-green-500 rounded-t-md opacity-80 hover:opacity-100 transition-opacity" />
                  </div>
                  <span className="text-[10px] text-gray-400">{r.month.slice(5)}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Enterprise breakdown */}
        <div className="bg-white border border-gray-200 rounded-xl p-5">
          <h2 className="font-bold text-gray-800 flex items-center gap-2 mb-4">
            <PieChart className="w-4 h-4 text-gray-400" /> {t('enterpriseBreakdown')}
          </h2>
          {Object.keys(enterpriseBreakdown).length === 0 ? (
            <p className="text-gray-400 text-sm text-center py-6">{t('noBatchesYet')}</p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {Object.entries(enterpriseBreakdown).map(([ent, ed]) => {
                const EntIcon = enterpriseIconFor(ent);
                return (
                  <div key={ent} className="bg-gray-50 rounded-lg p-3 text-center">
                    <EntIcon className="w-6 h-6 mx-auto text-gray-500" />
                    <p className="text-xs font-semibold text-gray-700 mt-1 capitalize">{ent.replace(/_/g, ' ')}</p>
                    <p className="text-lg font-bold text-gray-900">{ed.animals}</p>
                    <p className="text-[10px] text-gray-400">{ed.batches} {t('batches').toLowerCase()}</p>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Batches table */}
      <div className="bg-white border border-gray-200 rounded-xl p-5">
        <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
          <h2 className="font-bold text-gray-900">{t('batches')} ({batches.length})</h2>
          <input
            type="search" placeholder={t('searchBatches')}
            value={batchSearch} onChange={e => setBatchSearch(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm w-48"
          />
        </div>

        {batches.length === 0 ? (
          <p className="text-gray-400 text-sm text-center py-8">{t('noBatchesYet')}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-xs text-gray-400 font-semibold uppercase tracking-wider">
                  <th className="text-left py-2 px-2 cursor-pointer hover:text-gray-700" onClick={() => toggleSort('name')}>{t('name')}{sortArrow('name')}</th>
                  <th className="text-left py-2 px-2 cursor-pointer hover:text-gray-700" onClick={() => toggleSort('species')}>{t('species')}{sortArrow('species')}</th>
                  <th className="text-left py-2 px-2 cursor-pointer hover:text-gray-700" onClick={() => toggleSort('stage')}>{t('stage')}{sortArrow('stage')}</th>
                  <th className="text-right py-2 px-2 cursor-pointer hover:text-gray-700" onClick={() => toggleSort('currentQty')}>{t('qty')}{sortArrow('currentQty')}</th>
                  <th className="text-right py-2 px-2 cursor-pointer hover:text-gray-700" onClick={() => toggleSort('mortalityPct')}>{t('mortalityRate')}{sortArrow('mortalityPct')}</th>
                  <th className="text-right py-2 px-2 cursor-pointer hover:text-gray-700" onClick={() => toggleSort('fcr')}>{t('fcrAbbr')}{sortArrow('fcr')}</th>
                  <th className="text-right py-2 px-2 cursor-pointer hover:text-gray-700" onClick={() => toggleSort('grossMargin')}>{t('grossMargin')}{sortArrow('grossMargin')}</th>
                  <th className="text-center py-2 px-2 cursor-pointer hover:text-gray-700" onClick={() => toggleSort('status')}>{t('status')}{sortArrow('status')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {sortedBatches.map(b => (
                  <tr key={b.id} className="hover:bg-gray-50 transition-colors">
                    <td className="py-2.5 px-2 font-semibold text-gray-900">{b.name}</td>
                    <td className="py-2.5 px-2 text-gray-600 capitalize">{b.species}</td>
                    <td className="py-2.5 px-2">
                      <span className="text-xs bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full">{b.stage}</span>
                    </td>
                    <td className="py-2.5 px-2 text-right text-gray-800">{b.currentQty}<span className="text-gray-400 text-[10px]">/{b.initialQty}</span></td>
                    <td className={`py-2.5 px-2 text-right ${b.mortalityPct > 10 ? 'text-red-600 font-semibold' : 'text-gray-600'}`}>
                      {b.mortalityPct}%<span className="text-gray-400 text-[10px]"> ({b.deaths})</span>
                    </td>
                    <td className="py-2.5 px-2 text-right text-gray-600">{b.fcr ?? '—'}</td>
                    <td className={`py-2.5 px-2 text-right font-semibold ${b.grossMargin < 0 ? 'text-red-600' : 'text-green-600'}`}>
                      {b.grossMargin < 0 ? '-' : '+'}{fmtKES(Math.abs(b.grossMargin))}
                    </td>
                    <td className="py-2.5 px-2 text-center">
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${b.status === 'ACTIVE' ? 'bg-green-100 text-green-700' : b.status === 'SOLD' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-500'}`}>
                        {b.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Recent activity */}
      <div className="bg-white border border-gray-200 rounded-xl p-5">
        <h2 className="font-bold text-gray-800 flex items-center gap-2 mb-3">
          <Activity className="w-4 h-4 text-gray-400" /> {t('recentWorkerActivity')}
        </h2>
        {recentActivity.length === 0 ? (
          <p className="text-gray-400 text-sm text-center py-6">{t('noRecentActivity')}</p>
        ) : (
          <div className="flex flex-col gap-1 max-h-60 overflow-y-auto">
            {recentActivity.map((a, i) => (
              <div key={a.clientUuid} className="flex items-center gap-3 px-2 py-1.5 rounded-lg hover:bg-gray-50">
                <span className={`text-xs font-bold uppercase px-1.5 py-0.5 rounded ${a.type === 'mortality' ? 'bg-red-50 text-red-600' : a.type === 'feeding' ? 'bg-amber-50 text-amber-600' : a.type === 'health' ? 'bg-blue-50 text-blue-600' : 'bg-green-50 text-green-600'}`}>
                  {a.type}
                </span>
                <span className="text-xs text-gray-600 flex-1 min-w-0 truncate">
                  {JSON.stringify(a.payload).slice(0, 80)}…
                </span>
                <span className="text-[10px] text-gray-400 shrink-0">{new Date(a.capturedAt).toLocaleDateString('en-KE')}</span>
                <span className="text-[10px] text-gray-400 shrink-0">{t('by')} {a.createdBy}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
