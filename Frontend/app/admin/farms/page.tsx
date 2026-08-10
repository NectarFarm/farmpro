'use client';
import React, { useEffect, useState, useMemo } from 'react';
import Link from 'next/link';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { Tractor, Layers, Users, Bird, Search, Plus, Filter, Check } from 'lucide-react';
import { Pager } from '@/components/Pager';
import { FarmFeatureToggles, FarmManagePanel } from '@/components/admin/FarmManagePanel';

interface Tenant { id: string; name: string; plan: string; features: string[]; active: boolean; users: number; workers: number; batches: number }

const fmt = (n: number) => n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(n);
const inp = 'border border-gray-300 rounded-lg px-3 py-2 text-sm';

export default function AdminFarmsPage() {
  const { t } = useTranslation();
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [stats, setStats] = useState({ totalFarms: 0, activeFarms: 0, suspendedFarms: 0 });
  const [search, setSearch] = useState('');
  const [planFilter, setPlanFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'suspended'>('all');
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  const [showNew, setShowNew] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createMsg, setCreateMsg] = useState('');
  const [packages, setPackages] = useState<{ id: string; name: string; features: string[] }[]>([]);
  const [nf, setNf] = useState({ farmName: '', ownerName: '', ownerEmail: '', ownerPhone: '', ownerPassword: '', plan: 'pro' });

  const [manageId, setManageId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const pageSize = 10;

  const load = () => fetch('/api/admin/tenants', { credentials: 'include' })
    .then(r => r.ok ? r.json() : Promise.reject(new Error(r.status === 403 ? t('adminsOnly') : t('failedToLoad'))))
    .then(d => { setTenants(d); setLoading(false); })
    .catch(e => { setErr((e as Error).message); setLoading(false); });
  const loadStats = () => fetch('/api/admin/stats', { credentials: 'include' })
    .then(r => r.ok ? r.json() : {} as any).then(d => {
      if (d && typeof d.totalFarms === 'number') setStats({
        totalFarms: d.totalFarms ?? 0,
        activeFarms: d.activeFarms ?? 0,
        suspendedFarms: d.suspendedFarms ?? 0,
      });
    }).catch(() => { });
  const loadPackages = () => fetch('/api/admin/packages', { credentials: 'include' })
    .then(r => r.ok ? r.json() : { packages: [] }).then(d => setPackages(d.packages ?? [])).catch(() => { });
  useEffect(() => { load(); loadStats(); loadPackages(); }, []);

  const createFarm = async () => {
    setCreating(true); setErr(''); setCreateMsg('');
    try {
      const res = await fetch('/api/admin/tenants', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(nf) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || t('couldNotCreateFarm'));
      setCreateMsg(`Created "${nf.farmName}". Owner login: ${nf.ownerEmail}`);
      setNf({ farmName: '', ownerName: '', ownerEmail: '', ownerPhone: '', ownerPassword: '', plan: 'pro' });
      setShowNew(false); await load();
    } catch (e) { setErr((e as Error).message); } finally { setCreating(false); }
  };

  const openManage = (t: Tenant) => setManageId((cur) => (cur === t.id ? null : t.id));

  const filteredTenants = useMemo(() => {
    return tenants.filter(t => {
      if (search.trim()) {
        const q = search.toLowerCase();
        if (!t.name.toLowerCase().includes(q) && !t.plan.toLowerCase().includes(q)) return false;
      }
      if (statusFilter === 'active' && !t.active) return false;
      if (statusFilter === 'suspended' && t.active) return false;
      if (planFilter && t.plan !== planFilter) return false;
      return true;
    });
  }, [tenants, search, statusFilter, planFilter]);

  const totalPages = Math.max(1, Math.ceil(filteredTenants.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const paginatedTenants = filteredTenants.slice((safePage - 1) * pageSize, safePage * pageSize);

  // Reset to page 1 when filters change
  useEffect(() => { setPage(1); }, [search, statusFilter, planFilter]);

  return (
    <div className="p-6 flex flex-col gap-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="shrink-0 w-11 h-11 rounded-xl bg-gray-900 flex items-center justify-center">
            <Tractor className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{t('farms')}</h1>
            <p className="text-gray-500 text-sm mt-1">{t('farmListMeta', { total: tenants.length, active: stats.activeFarms, suspended: stats.suspendedFarms })}</p>
          </div>
        </div>
        <button onClick={() => { setShowNew(v => !v); setCreateMsg(''); setErr(''); }}
          className="px-4 py-2 bg-gray-900 text-white rounded-lg font-semibold text-sm shrink-0 flex items-center gap-2 hover:bg-gray-800">
          <Plus className="w-4 h-4" />{showNew ? t('cancel') : t('onboardFarm')}
        </button>
      </div>

      {createMsg && <p className="text-success bg-success/10 border border-success/30 rounded-xl px-4 py-3 text-sm font-semibold flex items-center gap-2"><Check className="w-4 h-4 shrink-0" /> {createMsg}</p>}
      {err && <p className="text-destructive bg-destructive/10 border border-destructive/30 rounded-xl px-4 py-3 text-sm font-semibold">{err}</p>}

      {/* New farm form */}
      {showNew && (
        <div className="bg-white border-2 border-gray-900/10 rounded-xl p-5 flex flex-col gap-3">
          <h2 className="font-bold text-gray-800">{t('onboardFarm')}</h2>
          <p className="text-xs text-gray-500 -mt-2">{t('onboardFarmDesc')}</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <input placeholder={t('farmName')} value={nf.farmName} onChange={e => setNf({ ...nf, farmName: e.target.value })} className={inp} />
            <select value={nf.plan} onChange={e => setNf({ ...nf, plan: e.target.value })} className={inp}>
              {packages.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <input placeholder={t('ownerName')} value={nf.ownerName} onChange={e => setNf({ ...nf, ownerName: e.target.value })} className={inp} />
            <input placeholder={t('ownerEmail')} type="email" value={nf.ownerEmail} onChange={e => setNf({ ...nf, ownerEmail: e.target.value })} className={inp} />
            <input placeholder={t('ownerPhone')} value={nf.ownerPhone} onChange={e => setNf({ ...nf, ownerPhone: e.target.value })} className={inp} />
            <input placeholder={t('temporaryPassword')} type="text" value={nf.ownerPassword} onChange={e => setNf({ ...nf, ownerPassword: e.target.value })} className={inp} />
          </div>
          <button onClick={createFarm} disabled={creating || !nf.farmName || !nf.ownerEmail}
            className="self-start px-5 py-2 bg-gray-900 text-white rounded-lg font-semibold text-sm hover:bg-gray-800 disabled:opacity-50">
            {creating ? t('creating') : t('createFarmLogin')}
          </button>
        </div>
      )}

      {/* Search & filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input type="search" placeholder={t('searchFarms')} value={search} onChange={e => setSearch(e.target.value)}
            className="w-full border border-gray-300 rounded-lg pl-9 pr-3 py-2 text-sm" />
        </div>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value as typeof statusFilter)}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm">
          <option value="all">{t('allStatus')}</option>
          <option value="active">{t('active')}</option>
          <option value="suspended">{t('suspended')}</option>
        </select>
        <select value={planFilter} onChange={e => setPlanFilter(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm">
          <option value="">{t('allPlans')}</option>
          {[...new Set(tenants.map(t => t.plan))].sort().map(p => <option key={p} value={p}>{p}</option>)}
        </select>
        <span className="text-xs text-gray-400">{filteredTenants.length} of {tenants.length}</span>
      </div>

      {/* Farm list */}
      {loading ? (
        <div className="flex items-center justify-center py-12"><p className="text-gray-400">{t('loading')}…</p></div>
      ) : filteredTenants.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-gray-400">
          <Tractor className="w-12 h-12 mb-3 opacity-30" />
          <p>{t('noFarms')}{search ? t('tryDifferentSearch') : ''}</p>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {paginatedTenants.map(tenant => (
            <div key={tenant.id} className={`bg-white border rounded-xl p-5 flex flex-col gap-4 transition-shadow hover:shadow-md ${tenant.active ? 'border-gray-200' : 'border-destructive/30 bg-destructive/5'}`}>
              <div className="flex items-start justify-between flex-wrap gap-3">
                <div>
                  <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                    <Link href={`/admin/farms/${tenant.id}`} className="hover:text-gray-700 transition-colors">
                      {tenant.name}
                    </Link>
                    {!tenant.active && <span className="text-xs bg-destructive text-white px-2 py-0.5 rounded-full">{t('suspended')}</span>}
                  </h3>
                  <div className="flex items-center gap-3 mt-1 text-xs text-gray-400">
                    <Link href={`/admin/farms/${tenant.id}`} className="flex items-center gap-1 hover:text-gray-700 transition-colors">
                      <Layers className="w-3 h-3" />{tenant.batches} {t('batches').toLowerCase()}
                    </Link>
                    <span className="flex items-center gap-1"><Users className="w-3 h-3" />{tenant.users} {t('users')}</span>
                    <span className="flex items-center gap-1"><Bird className="w-3 h-3" />{tenant.workers} {t('workers')}</span>
                    <span className="flex items-center gap-1"><Filter className="w-3 h-3" />{tenant.features.length} {t('features').toLowerCase()}</span>
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <button onClick={() => openManage(tenant)}
                    className="px-3 py-1.5 bg-gray-100 text-gray-700 rounded-lg text-xs font-semibold hover:bg-gray-200 transition-colors">
                    {manageId === tenant.id ? t('close') : t('manage')}
                  </button>
                </div>
              </div>

              <FarmFeatureToggles tenant={tenant} packages={packages} onChanged={load} />

              {manageId === tenant.id && (
                <div className="border-t border-gray-200 pt-4">
                  <FarmManagePanel tenant={tenant} onChanged={load} />
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <Pager page={safePage} totalPages={totalPages} onPageChange={setPage} prevLabel={t('prev')} nextLabel={t('next')} />
      )}
    </div>
  );
}
