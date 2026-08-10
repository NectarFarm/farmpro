'use client';
// Shared farm-management controls — extracted from app/admin/farms/page.tsx's
// inline "Manage" accordion so app/admin/farms/[id]/page.tsx (previously
// analytics-only) can offer the same rename/owner/suspend/delete actions a
// new admin reasonably expects after clicking into a farm from the list.
import React, { useEffect, useState } from 'react';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { FEATURES } from '@/lib/features';

const inp = 'border border-gray-300 rounded-lg px-3 py-2 text-sm';

export interface ManagedTenant {
  id: string;
  name: string;
  plan: string;
  features: string[];
  active: boolean;
}
interface Owner { name: string; email: string; phone: string }
interface Pkg { id: string; name: string; features: string[] }

async function patchTenant(id: string, body: Record<string, unknown>): Promise<Response> {
  return fetch(`/api/admin/tenants?id=${id}`, {
    method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
}

// Plan dropdown + feature toggle grid — always-visible per tenant on the list
// page; also shown on the detail page since it previously had no equivalent.
export function FarmFeatureToggles({ tenant, packages, onChanged }: { tenant: ManagedTenant; packages: Pkg[]; onChanged: () => void }) {
  const { t } = useTranslation();
  const [saving, setSaving] = useState(false);

  const patch = async (body: Record<string, unknown>) => {
    setSaving(true);
    try { if ((await patchTenant(tenant.id, body)).ok) onChanged(); } finally { setSaving(false); }
  };
  const toggle = (key: string) => patch({ features: tenant.features.includes(key) ? tenant.features.filter((f) => f !== key) : [...tenant.features, key] });
  const setPlan = (plan: string) => patch({ plan, features: packages.find((p) => p.id === plan)?.features ?? tenant.features });

  return (
    <div className="flex flex-col gap-3">
      <select value={tenant.plan} onChange={(e) => setPlan(e.target.value)} disabled={saving}
        className="self-start border border-gray-300 rounded-lg px-2 py-1.5 text-xs disabled:opacity-50">
        {packages.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        {!packages.some((p) => p.id === tenant.plan) && <option value={tenant.plan}>{tenant.plan}</option>}
      </select>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {FEATURES.map((f) => {
          const on = tenant.features.includes(f.key);
          return (
            <button key={f.key} onClick={() => toggle(f.key)} disabled={saving}
              className={`flex items-center justify-between px-3 py-2 rounded-lg border-2 text-left disabled:opacity-50 transition-colors ${on ? 'bg-success/10 border-success/40 hover:bg-success/15' : 'bg-gray-50 border-gray-200 hover:bg-gray-100'}`}>
              <div>
                <p className={`text-sm font-semibold ${on ? 'text-success' : 'text-gray-500'}`}>{f.label}</p>
                <p className="text-xs text-gray-400">{f.desc}</p>
              </div>
              <span className={`text-xs font-bold px-2 py-0.5 rounded-full transition-colors ${on ? 'bg-success text-white' : 'bg-gray-300 text-gray-600'}`}>
                {on ? t('on') : t('off')}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// Rename + owner login (view/edit/reset password) + suspend/reactivate + delete.
export function FarmManagePanel({ tenant, onChanged }: { tenant: ManagedTenant; onChanged: () => void }) {
  const { t } = useTranslation();
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const [rename, setRename] = useState(tenant.name);
  const [owner, setOwner] = useState<Owner>({ name: '', email: '', phone: '' });
  const [newPass, setNewPass] = useState('');
  const [ownerMsg, setOwnerMsg] = useState('');
  const [confirmDialog, setConfirmDialog] = useState<{ title: string; body: string; danger?: boolean; onConfirm: () => void } | null>(null);

  useEffect(() => {
    setRename(tenant.name);
    setOwnerMsg(''); setNewPass('');
    fetch(`/api/admin/owner?tenantId=${tenant.id}`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((o) => { if (o) setOwner({ name: o.name ?? '', email: o.email ?? '', phone: o.phone ?? '' }); })
      .catch(() => {});
  }, [tenant.id]);

  const patch = async (body: Record<string, unknown>) => {
    setSaving(true); setErr('');
    try {
      const res = await patchTenant(tenant.id, body);
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Save failed');
      onChanged();
    } catch (e) { setErr((e as Error).message); } finally { setSaving(false); }
  };

  const saveOwner = async (body: Record<string, unknown>, msg: string) => {
    setOwnerMsg('');
    const res = await fetch(`/api/admin/owner?tenantId=${tenant.id}`, {
      method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    if (!res.ok) { setOwnerMsg((await res.json().catch(() => ({}))).error || 'Failed'); return; }
    setOwnerMsg(msg); setNewPass(''); onChanged();
  };

  const doRemoveFarm = async () => {
    setSaving(true);
    const res = await fetch(`/api/admin/tenants?id=${tenant.id}`, { method: 'DELETE', credentials: 'include' });
    setSaving(false);
    if (!res.ok) { setErr(t('deleteFailed')); return; }
    onChanged();
  };
  const removeFarm = () => {
    setConfirmDialog({
      title: t('deleteFarm'),
      body: t('confirmDeleteFarm', { name: tenant.name, batches: 0, users: 0 }),
      danger: true,
      onConfirm: () => { setConfirmDialog(null); doRemoveFarm(); },
    });
  };

  return (
    <div className="flex flex-col gap-4">
      {err && <p className="text-destructive bg-destructive/10 border border-destructive/30 rounded-lg px-3 py-2 text-xs font-semibold">{err}</p>}

      <div className="flex items-end gap-2 flex-wrap">
        <label className="flex flex-col gap-1 text-xs font-semibold text-gray-500 flex-1 min-w-[180px]">
          {t('farmName')}
          <input value={rename} onChange={(e) => setRename(e.target.value)} className={inp} />
        </label>
        <button onClick={() => patch({ name: rename })} disabled={saving}
          className="px-3 py-2 bg-gray-900 text-white rounded-lg text-xs font-semibold hover:bg-gray-800 disabled:opacity-50">{t('rename')}</button>
      </div>

      <div className="bg-gray-50 rounded-lg p-3 flex flex-col gap-2">
        <p className="text-xs font-bold text-gray-600">{t('ownerLogin')}</p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <input value={owner.name} onChange={(e) => setOwner({ ...owner, name: e.target.value })} placeholder={t('ownerName')} className={inp} />
          <input value={owner.email} onChange={(e) => setOwner({ ...owner, email: e.target.value })} placeholder={t('ownerEmail')} className={inp} />
          <input value={owner.phone} onChange={(e) => setOwner({ ...owner, phone: e.target.value })} placeholder={t('ownerPhone')} className={inp} />
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={() => saveOwner({ name: owner.name, email: owner.email, phone: owner.phone }, t('ownerUpdated'))}
            className="px-3 py-2 bg-gray-900 text-white rounded-lg text-xs font-semibold hover:bg-gray-800">{t('saveDetails')}</button>
          <input value={newPass} onChange={(e) => setNewPass(e.target.value)} placeholder={t('newPassword')} className={`${inp} flex-1 min-w-[160px]`} />
          <button onClick={() => saveOwner({ newPassword: newPass }, t('passwordReset'))} disabled={newPass.length < 8}
            className="px-3 py-2 bg-warning text-warning-foreground rounded-lg text-xs font-semibold hover:bg-warning/90 disabled:opacity-50">{t('resetPassword')}</button>
        </div>
        {ownerMsg && <p className="text-xs text-gray-600">{ownerMsg}</p>}
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <button onClick={() => patch({ active: !tenant.active })} disabled={saving}
          className={`px-3 py-2 rounded-lg text-xs font-semibold transition-colors disabled:opacity-50 ${tenant.active ? 'bg-warning text-warning-foreground hover:bg-warning/90' : 'bg-success text-white hover:bg-success/90'}`}>
          {tenant.active ? t('suspendFarm') : t('reactivateFarm')}
        </button>
        <button onClick={removeFarm} disabled={saving}
          className="px-3 py-2 bg-destructive text-white rounded-lg text-xs font-semibold hover:bg-destructive/90 transition-colors disabled:opacity-50">{t('deleteFarm')}</button>
        <span className="text-xs text-gray-400">{t('suspendNote')}</span>
      </div>

      {confirmDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => setConfirmDialog(null)} />
          <div className="relative bg-white rounded-2xl w-full max-w-sm mx-4 p-5 flex flex-col gap-3 shadow-2xl">
            <h3 className={`font-bold ${confirmDialog.danger ? 'text-destructive' : 'text-gray-900'}`}>{confirmDialog.title}</h3>
            <p className="text-sm text-gray-600">{confirmDialog.body}</p>
            <div className="flex gap-2 mt-2">
              <button onClick={confirmDialog.onConfirm}
                className={`flex-1 px-4 py-2 rounded-lg font-semibold text-sm text-white ${confirmDialog.danger ? 'bg-destructive hover:bg-destructive/90' : 'bg-success hover:bg-success/90'}`}>
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
