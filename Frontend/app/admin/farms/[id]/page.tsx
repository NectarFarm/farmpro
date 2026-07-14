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
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from '@/components/ui/table';
import { StatPanel } from '@/components/ui/stat-panel';
import { FarmFeatureToggles, FarmManagePanel } from '@/components/admin/FarmManagePanel';

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
  const [showManage, setShowManage] = useState(false);
  const [packages, setPackages] = useState<{ id: string; name: string; features: string[] }[]>([]);

  const load = useCallback(() => {
    setLoading(true); setErr('');
    fetch(`/api/admin/tenants/analytics?id=${encodeURIComponent(id)}`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : Promise.reject(new Error(t('failedToLoadFarmData'))))
      .then(d => { setData(d); setLoading(false); })
      .catch(e => { setErr((e as Error).message); setLoading(false); });
  }, [id]);

  useEffect(() => { if (id) load(); }, [id, load]);
  useEffect(() => {
    fetch('/api/admin/packages', { credentials: 'include' })
      .then(r => r.ok ? r.json() : { packages: [] }).then(d => setPackages(d.packages ?? [])).catch(() => {});
  }, []);

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
        <div className="bg-destructive/10 border border-destructive/30 rounded-xl p-5 text-center">
          <AlertTriangle className="w-8 h-8 text-destructive/70 mx-auto mb-2" />
          <p className="text-destructive font-semibold">{err}</p>
          <button onClick={load} className="mt-3 px-4 py-2 bg-destructive text-white rounded-lg text-sm font-semibold hover:bg-destructive/90">{t('retry')}</button>
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
    { label: t('activeBatches'), value: String(metrics.activeBatches), icon: Layers, tone: 'neutral' as const, sub: `${metrics.totalBatches} ${t('total').toLowerCase()}` },
    { label: t('totalAnimals'), value: fmt(metrics.totalAnimals), icon: Bird, tone: 'neutral' as const, sub: `${metrics.totalInitial} ${t('initialQty')}` },
    { label: t('mortalityRate'), value: `${metrics.mortalityPct}%`, icon: Activity, tone: metrics.mortalityPct > 10 ? 'bad' as const : 'neutral' as const, sub: `${metrics.totalDeaths} ${t('deaths')}` },
    { label: t('averageFCR'), value: metrics.avgFCR ? String(metrics.avgFCR) : '—', icon: TrendingUp, tone: 'neutral' as const, sub: `${t('target')} \u2264 2.8` },
    { label: t('revenue'), value: fmtKES(metrics.totalRevenue), icon: DollarSign, tone: 'good' as const },
    { label: t('grossMargin'), value: fmtKES(metrics.grossMargin), icon: Wallet, tone: metrics.grossMargin < 0 ? 'bad' as const : 'good' as const },
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
              {!farm.active && <span className="text-xs bg-destructive text-white px-2 py-0.5 rounded-full">{t('suspended')}</span>}
            </h1>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${farm.active ? 'bg-success/10 text-success' : 'bg-destructive/10 text-destructive'}`}>
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
          <span className="text-xs bg-indigo-50 text-indigo-600 px-2 py-0.5 rounded-full">{t('owner')}</span>
          <button onClick={() => setShowManage(v => !v)}
            className="ml-auto px-3 py-1.5 bg-gray-100 text-gray-700 rounded-lg text-xs font-semibold hover:bg-gray-200 transition-colors">
            {showManage ? t('close') : t('manage')}
          </button>
        </div>
      )}

      {/* Manage farm — rename, owner login, plan/features, suspend/delete */}
      {showManage && (
        <div className="bg-white border border-gray-200 rounded-xl p-5 flex flex-col gap-4">
          <h2 className="font-bold text-gray-800">{t('manage')}</h2>
          <FarmFeatureToggles tenant={farm} packages={packages} onChanged={load} />
          <div className="border-t border-gray-200 pt-4">
            <FarmManagePanel tenant={farm} onChanged={load} />
          </div>
        </div>
      )}

      {/* Stats cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3">
        {statCards.map(card => (
          <StatPanel key={card.label} label={card.label} value={card.value} icon={card.icon} tone={card.tone} sub={card.sub} />
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
                  <div className="w-full bg-success/15 rounded-t-md relative" style={{ height: `${Math.max(pct, 4)}%` }}>
                    <div className="absolute inset-0 bg-success rounded-t-md opacity-80 hover:opacity-100 transition-opacity" />
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
          <Table>
            <TableHeader>
              <TableRow className="text-xs text-gray-400 font-semibold uppercase tracking-wider">
                <TableHead className="cursor-pointer hover:text-gray-700" onClick={() => toggleSort('name')}>{t('name')}{sortArrow('name')}</TableHead>
                <TableHead className="cursor-pointer hover:text-gray-700" onClick={() => toggleSort('species')}>{t('species')}{sortArrow('species')}</TableHead>
                <TableHead className="cursor-pointer hover:text-gray-700" onClick={() => toggleSort('stage')}>{t('stage')}{sortArrow('stage')}</TableHead>
                <TableHead className="text-right cursor-pointer hover:text-gray-700" onClick={() => toggleSort('currentQty')}>{t('qty')}{sortArrow('currentQty')}</TableHead>
                <TableHead className="text-right cursor-pointer hover:text-gray-700" onClick={() => toggleSort('mortalityPct')}>{t('mortalityRate')}{sortArrow('mortalityPct')}</TableHead>
                <TableHead className="text-right cursor-pointer hover:text-gray-700" onClick={() => toggleSort('fcr')}>{t('fcrAbbr')}{sortArrow('fcr')}</TableHead>
                <TableHead className="text-right cursor-pointer hover:text-gray-700" onClick={() => toggleSort('grossMargin')}>{t('grossMargin')}{sortArrow('grossMargin')}</TableHead>
                <TableHead className="text-center cursor-pointer hover:text-gray-700" onClick={() => toggleSort('status')}>{t('status')}{sortArrow('status')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedBatches.map(b => (
                <TableRow key={b.id}>
                  <TableCell className="font-semibold text-gray-900">{b.name}</TableCell>
                  <TableCell className="text-gray-600 capitalize">{b.species}</TableCell>
                  <TableCell>
                    <span className="text-xs bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full">{b.stage}</span>
                  </TableCell>
                  <TableCell className="text-right text-gray-800">{b.currentQty}<span className="text-gray-400 text-[10px]">/{b.initialQty}</span></TableCell>
                  <TableCell className={`text-right ${b.mortalityPct > 10 ? 'text-destructive font-semibold' : 'text-gray-600'}`}>
                    {b.mortalityPct}%<span className="text-gray-400 text-[10px]"> ({b.deaths})</span>
                  </TableCell>
                  <TableCell className="text-right text-gray-600">{b.fcr ?? '—'}</TableCell>
                  <TableCell className={`text-right font-semibold ${b.grossMargin < 0 ? 'text-destructive' : 'text-success'}`}>
                    {b.grossMargin < 0 ? '-' : '+'}{fmtKES(Math.abs(b.grossMargin))}
                  </TableCell>
                  <TableCell className="text-center">
                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${b.status === 'ACTIVE' ? 'bg-success/10 text-success' : b.status === 'SOLD' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-500'}`}>
                      {b.status}
                    </span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
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
                <span className={`text-xs font-bold uppercase px-1.5 py-0.5 rounded ${a.type === 'mortality' ? 'bg-destructive/10 text-destructive' : a.type === 'feeding' ? 'bg-warning/15 text-warning-foreground' : a.type === 'health' ? 'bg-blue-50 text-blue-600' : 'bg-success/10 text-success'}`}>
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
