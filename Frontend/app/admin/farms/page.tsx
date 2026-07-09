'use client';
import React, { useEffect, useState, useMemo } from 'react';
import Link from 'next/link';
import { FEATURES } from '@/lib/features';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { Tractor, CheckCircle2, XCircle, Layers, Users, Bird, Search, Plus, Filter } from 'lucide-react';

interface Tenant { id: string; name: string; plan: string; features: string[]; active: boolean; users: number; workers: number; batches: number }
interface Owner { name: string; email: string; phone: string }

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
  const [saving, setSaving] = useState('');
  const [err, setErr] = useState('');

  const [showNew, setShowNew] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createMsg, setCreateMsg] = useState('');
  const [packages, setPackages] = useState<{ id: string; name: string; features: string[] }[]>([]);
  const [nf, setNf] = useState({ farmName: '', ownerName: '', ownerEmail: '', ownerPhone: '', ownerPassword: '', plan: 'pro' });

  const [manageId, setManageId] = useState<string | null>(null);
  const [rename, setRename] = useState('');
  const [owner, setOwner] = useState<Owner>({ name: '', email: '', phone: '' });
  const [newPass, setNewPass] = useState('');
  const [ownerMsg, setOwnerMsg] = useState('');
  const [page, setPage] = useState(1);
  const pageSize = 10;
  const [confirmDialog, setConfirmDialog] = useState<{ title: string; body: string; danger?: boolean; onConfirm: () => void } | null>(null);

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

  const patch = async (id: string, body: Record<string, unknown>) => {
    setSaving(id); setErr('');
    try {
      const res = await fetch(`/api/admin/tenants?id=${id}`, { method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Save failed');
      await load();
    } catch (e) { setErr((e as Error).message); } finally { setSaving(''); }
  };
  const toggle = (t: Tenant, key: string) => patch(t.id, { features: t.features.includes(key) ? t.features.filter(f => f !== key) : [...t.features, key] });
  const setPlan = (t: Tenant, plan: string) => patch(t.id, { plan, features: packages.find(p => p.id === plan)?.features ?? t.features });

  const createFarm = async () => {
    setCreating(true); setErr(''); setCreateMsg('');
    try {
      const res = await fetch('/api/admin/tenants', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(nf) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || t('couldNotCreateFarm'));
      setCreateMsg(`✓ Created "${nf.farmName}". Owner login: ${nf.ownerEmail}`);
      setNf({ farmName: '', ownerName: '', ownerEmail: '', ownerPhone: '', ownerPassword: '', plan: 'pro' });
      setShowNew(false); await load();
    } catch (e) { setErr((e as Error).message); } finally { setCreating(false); }
  };

  const openManage = async (t: Tenant) => {
    if (manageId === t.id) { setManageId(null); return; }
    setManageId(t.id); setRename(t.name); setNewPass(''); setOwnerMsg(''); setOwner({ name: '', email: '', phone: '' });
    const r = await fetch(`/api/admin/owner?tenantId=${t.id}`, { credentials: 'include' });
    if (r.ok) { const o = await r.json(); setOwner({ name: o.name ?? '', email: o.email ?? '', phone: o.phone ?? '' }); }
  };
  const saveOwner = async (t: Tenant, body: Record<string, unknown>, msg: string) => {
    setOwnerMsg('');
    const res = await fetch(`/api/admin/owner?tenantId=${t.id}`, { method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!res.ok) { setOwnerMsg((await res.json().catch(() => ({}))).error || 'Failed'); return; }
    setOwnerMsg(msg); setNewPass(''); await load();
  };
  const doRemoveFarm = async (tenant: Tenant) => {
    setSaving(tenant.id);
    const res = await fetch(`/api/admin/tenants?id=${tenant.id}`, { method: 'DELETE', credentials: 'include' });
    setSaving('');
    if (!res.ok) { setErr(t('deleteFailed')); return; }
    setManageId(null); await load();
  };
  const removeFarm = (tenant: Tenant) => {
    setConfirmDialog({
      title: t('deleteFarm'),
      body: t('confirmDeleteFarm', { name: tenant.name, batches: tenant.batches, users: tenant.users }),
      danger: true,
      onConfirm: () => { setConfirmDialog(null); doRemoveFarm(tenant); },
    });
  };

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
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t('farms')}</h1>
          <p className="text-gray-500 text-sm mt-1">{t('farmListMeta', { total: tenants.length, active: stats.activeFarms, suspended: stats.suspendedFarms })}</p>
        </div>
        <button onClick={() => { setShowNew(v => !v); setCreateMsg(''); setErr(''); }}
          className="px-4 py-2 bg-green-600 text-white rounded-lg font-semibold text-sm shrink-0 flex items-center gap-2 hover:bg-green-700">
          <Plus className="w-4 h-4" />{showNew ? t('cancel') : t('onboardFarm')}
        </button>
      </div>

      {createMsg && <p className="text-green-700 bg-green-50 border border-green-200 rounded-xl px-4 py-3 text-sm font-semibold">{createMsg}</p>}
      {err && <p className="text-red-600 bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm font-semibold">{err}</p>}

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
            className="self-start px-5 py-2 bg-green-600 text-white rounded-lg font-semibold text-sm disabled:opacity-50">
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
            <div key={tenant.id} className={`bg-white border rounded-xl p-5 flex flex-col gap-4 transition-shadow hover:shadow-md ${tenant.active ? 'border-gray-200' : 'border-red-300 bg-red-50/30'}`}>
              <div className="flex items-start justify-between flex-wrap gap-3">
                <div>
                  <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                    <Link href={`/admin/farms/${tenant.id}`} className="hover:text-green-700 transition-colors">
                      {tenant.name}
                    </Link>
                    {!tenant.active && <span className="text-xs bg-red-600 text-white px-2 py-0.5 rounded-full">{t('suspended')}</span>}
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
                  <select value={tenant.plan} onChange={e => setPlan(tenant, e.target.value)}
                    className="border border-gray-300 rounded-lg px-2 py-1.5 text-xs">
                    {packages.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                    {!packages.some(p => p.id === tenant.plan) && <option value={tenant.plan}>{tenant.plan}</option>}
                  </select>
                  <button onClick={() => openManage(tenant)}
                    className="px-3 py-1.5 bg-gray-100 text-gray-700 rounded-lg text-xs font-semibold hover:bg-gray-200 transition-colors">
                    {manageId === tenant.id ? t('close') : t('manage')}
                  </button>
                  {saving === tenant.id && <span className="text-xs text-gray-400 animate-pulse">{t('saving')}</span>}
                </div>
              </div>

              {/* Feature toggles */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {FEATURES.map(f => {
                  const on = tenant.features.includes(f.key);
                  return (
                    <button key={f.key} onClick={() => toggle(tenant, f.key)} disabled={saving === tenant.id}
                      className={`flex items-center justify-between px-3 py-2 rounded-lg border-2 text-left disabled:opacity-50 transition-colors ${on ? 'bg-green-50 border-green-300 hover:bg-green-100' : 'bg-gray-50 border-gray-200 hover:bg-gray-100'}`}>
                      <div>
                        <p className={`text-sm font-semibold ${on ? 'text-green-800' : 'text-gray-500'}`}>{f.label}</p>
                        <p className="text-xs text-gray-400">{f.desc}</p>
                      </div>
                      <span className={`text-xs font-bold px-2 py-0.5 rounded-full transition-colors ${on ? 'bg-green-600 text-white' : 'bg-gray-300 text-gray-600'}`}>
                        {on ? t('on') : t('off')}
                      </span>
                    </button>
                  );
                })}
              </div>

              {/* Manage panel */}
              {manageId === tenant.id && (
                <div className="border-t border-gray-200 pt-4 flex flex-col gap-4">
                  <div className="flex items-end gap-2 flex-wrap">
                    <label className="flex flex-col gap-1 text-xs font-semibold text-gray-500 flex-1 min-w-[180px]">
                      {t('farmName')}
                      <input value={rename} onChange={e => setRename(e.target.value)} className={inp} />
                    </label>
                    <button onClick={() => patch(tenant.id, { name: rename })}
                      className="px-3 py-2 bg-green-600 text-white rounded-lg text-xs font-semibold hover:bg-green-700">{t('rename')}</button>
                  </div>

                  <div className="bg-gray-50 rounded-lg p-3 flex flex-col gap-2">
                    <p className="text-xs font-bold text-gray-600">{t('ownerLogin')}</p>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                      <input value={owner.name} onChange={e => setOwner({ ...owner, name: e.target.value })} placeholder={t('ownerName')} className={inp} />
                      <input value={owner.email} onChange={e => setOwner({ ...owner, email: e.target.value })} placeholder={t('ownerEmail')} className={inp} />
                      <input value={owner.phone} onChange={e => setOwner({ ...owner, phone: e.target.value })} placeholder={t('ownerPhone')} className={inp} />
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <button onClick={() => saveOwner(tenant, { name: owner.name, email: owner.email, phone: owner.phone }, t('ownerUpdated'))}
                        className="px-3 py-2 bg-green-600 text-white rounded-lg text-xs font-semibold hover:bg-green-700">{t('saveDetails')}</button>
                      <input value={newPass} onChange={e => setNewPass(e.target.value)} placeholder={t('newPassword')} className={`${inp} flex-1 min-w-[160px]`} />
                      <button onClick={() => saveOwner(tenant, { newPassword: newPass }, t('passwordReset'))} disabled={newPass.length < 8}
                        className="px-3 py-2 bg-amber-600 text-white rounded-lg text-xs font-semibold disabled:opacity-50">{t('resetPassword')}</button>
                    </div>
                    {ownerMsg && <p className="text-xs text-gray-600">{ownerMsg}</p>}
                  </div>

                  <div className="flex items-center gap-2 flex-wrap">
                    <button onClick={() => patch(tenant.id, { active: !tenant.active })}
                      className={`px-3 py-2 rounded-lg text-xs font-semibold text-white transition-colors ${tenant.active ? 'bg-amber-600 hover:bg-amber-700' : 'bg-green-600 hover:bg-green-700'}`}>
                      {tenant.active ? t('suspendFarm') : t('reactivateFarm')}
                    </button>
                    <button onClick={() => removeFarm(tenant)}
                      className="px-3 py-2 bg-red-600 text-white rounded-lg text-xs font-semibold hover:bg-red-700 transition-colors">{t('deleteFarm')}</button>
                    <span className="text-xs text-gray-400">{t('suspendNote')}</span>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={safePage <= 1}
            className="px-3 py-1.5 text-xs font-semibold border border-gray-200 rounded-lg disabled:opacity-30 hover:bg-gray-50 transition-colors">
            ← {t('prev')}
          </button>
          {(() => {
            const total = totalPages;
            const cur = safePage;
            let pages: number[];
            if (total <= 7) {
              pages = Array.from({ length: total }, (_, j) => j + 1);
            } else if (cur <= 4) {
              pages = [1, 2, 3, 4, 5, -1, total];
            } else if (cur >= total - 3) {
              pages = [1, -1, total - 4, total - 3, total - 2, total - 1, total];
            } else {
              pages = [1, -1, cur - 1, cur, cur + 1, -1, total];
            }
            return pages.map((p, idx) =>
              p === -1
                ? <span key={`ellipsis-${idx}`} className="px-1 text-gray-300 text-xs">⋯</span>
                : (
                  <button key={p} onClick={() => setPage(p)}
                    className={`min-w-[32px] h-[32px] text-xs font-semibold rounded-lg transition-colors ${p === cur ? 'bg-green-600 text-white shadow-sm' : 'text-gray-600 hover:bg-gray-100 border border-gray-200'}`}>
                    {p}
                  </button>
                )
            );
          })()}
          <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={safePage >= totalPages}
            className="px-3 py-1.5 text-xs font-semibold border border-gray-200 rounded-lg disabled:opacity-30 hover:bg-gray-50 transition-colors">
            {t('next')} →
          </button>
        </div>
      )}

      {/* Generic styled confirm dialog — replaces window.confirm for delete-farm */}
      {confirmDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => setConfirmDialog(null)} />
          <div className="relative bg-white rounded-2xl w-full max-w-sm mx-4 p-5 flex flex-col gap-3 shadow-2xl">
            <h3 className={`font-bold ${confirmDialog.danger ? 'text-red-700' : 'text-gray-900'}`}>{confirmDialog.title}</h3>
            <p className="text-sm text-gray-600">{confirmDialog.body}</p>
            <div className="flex gap-2 mt-2">
              <button onClick={confirmDialog.onConfirm}
                className={`flex-1 px-4 py-2 rounded-lg font-semibold text-sm text-white ${confirmDialog.danger ? 'bg-red-600 hover:bg-red-700' : 'bg-green-600 hover:bg-green-700'}`}>
                {t('confirm')}
              </button>
              <button onClick={() => setConfirmDialog(null)} className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg font-semibold text-sm">
                {t('cancel')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
