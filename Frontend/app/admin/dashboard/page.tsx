'use client';
import React, { useEffect, useState } from 'react';
import { FEATURES } from '@/lib/features';
import { AdminTesting } from '@/components/admin/AdminTesting';
import { AdminAudit } from '@/components/admin/AdminAudit';
import { AdminPackages } from '@/components/admin/AdminPackages';

interface Tenant { id: string; name: string; plan: string; features: string[]; active: boolean; users: number; workers: number; batches: number }
interface Owner { name: string; email: string; phone: string }

export default function AdminDashboardPage() {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState('');
  const [err, setErr] = useState('');

  // create farm
  const [showNew, setShowNew] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createMsg, setCreateMsg] = useState('');
  const [nf, setNf] = useState({ farmName: '', ownerName: '', ownerEmail: '', ownerPhone: '', ownerPassword: '', plan: 'pro' });

  // admin-defined packages (replace hardcoded plans)
  const [packages, setPackages] = useState<{ id: string; name: string; features: string[] }[]>([]);

  // platform branding
  const [settings, setSettings] = useState({ appName: '', tagline: '', logoUrl: '' });
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsMsg, setSettingsMsg] = useState('');

  // per-farm management panel
  const [manageId, setManageId] = useState<string | null>(null);
  const [rename, setRename] = useState('');
  const [owner, setOwner] = useState<Owner>({ name: '', email: '', phone: '' });
  const [newPass, setNewPass] = useState('');
  const [ownerMsg, setOwnerMsg] = useState('');

  const load = () => fetch('/api/admin/tenants', { credentials: 'include' })
    .then(r => r.ok ? r.json() : Promise.reject(new Error(r.status === 403 ? 'Admins only' : 'Failed to load')))
    .then(d => { setTenants(d); setLoading(false); })
    .catch(e => { setErr((e as Error).message); setLoading(false); });
  const loadSettings = () => fetch('/api/admin/settings', { credentials: 'include' })
    .then(r => r.ok ? r.json() : null).then(d => { if (d) setSettings({ appName: d.appName ?? '', tagline: d.tagline ?? '', logoUrl: d.logoUrl ?? '' }); }).catch(() => {});
  const loadPackages = () => fetch('/api/admin/packages', { credentials: 'include' })
    .then(r => r.ok ? r.json() : { packages: [] }).then(d => setPackages(d.packages ?? [])).catch(() => {});
  useEffect(() => { load(); loadSettings(); loadPackages(); }, []);

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
      if (!res.ok) throw new Error(data.error || 'Could not create farm');
      setCreateMsg(`✓ Created "${nf.farmName}". Owner login: ${nf.ownerEmail} (share the password you set).`);
      setNf({ farmName: '', ownerName: '', ownerEmail: '', ownerPhone: '', ownerPassword: '', plan: 'pro' });
      setShowNew(false); await load();
    } catch (e) { setErr((e as Error).message); } finally { setCreating(false); }
  };

  const saveSettings = async () => {
    setSettingsSaving(true); setSettingsMsg('');
    try {
      const res = await fetch('/api/admin/settings', { method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(settings) });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Save failed');
      setSettingsMsg('✓ Saved — refresh to see the new brand everywhere.');
    } catch (e) { setSettingsMsg((e as Error).message); } finally { setSettingsSaving(false); }
  };
  const onLogoFile = (file: File) => {
    if (file.size > 400_000) { setSettingsMsg('Logo too large (keep under 400 KB).'); return; }
    const reader = new FileReader();
    reader.onload = () => setSettings(s => ({ ...s, logoUrl: String(reader.result) }));
    reader.readAsDataURL(file);
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
  const removeFarm = async (t: Tenant) => {
    if (!window.confirm(`Permanently DELETE "${t.name}" and ALL its data (${t.batches} batches, ${t.users} users)? This cannot be undone.`)) return;
    setSaving(t.id);
    const res = await fetch(`/api/admin/tenants?id=${t.id}`, { method: 'DELETE', credentials: 'include' });
    setSaving('');
    if (!res.ok) { setErr('Delete failed'); return; }
    setManageId(null); await load();
  };

  const inp = 'border border-gray-300 rounded-lg px-3 py-2 text-sm';

  return (
    <div className="p-6 flex flex-col gap-6 max-w-5xl mx-auto">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Platform Console</h1>
          <p className="text-gray-500 text-sm mt-1">Branding, farms, subscriptions, owners — full control.</p>
        </div>
        <button onClick={() => { setShowNew(v => !v); setCreateMsg(''); setErr(''); }} className="px-4 py-2 bg-gray-900 text-white rounded-lg font-semibold text-sm shrink-0">{showNew ? 'Cancel' : '+ New Farm'}</button>
      </div>

      {createMsg && <p className="text-green-700 bg-green-50 border border-green-200 rounded-xl px-4 py-3 text-sm font-semibold">{createMsg}</p>}
      {err && <p className="text-red-600 bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm font-semibold">{err}</p>}

      {showNew && (
        <div className="bg-white border-2 border-gray-900/10 rounded-xl p-5 flex flex-col gap-3">
          <h2 className="font-bold text-gray-800">Onboard a new farm</h2>
          <p className="text-xs text-gray-500 -mt-2">Creates the tenant and its owner login. The owner signs in at <span className="font-mono">/login</span>.</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <input placeholder="Farm name" value={nf.farmName} onChange={e => setNf({ ...nf, farmName: e.target.value })} className={inp} />
            <select value={nf.plan} onChange={e => setNf({ ...nf, plan: e.target.value })} className={inp}>{packages.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
            <input placeholder="Owner full name" value={nf.ownerName} onChange={e => setNf({ ...nf, ownerName: e.target.value })} className={inp} />
            <input placeholder="Owner email (their login)" type="email" value={nf.ownerEmail} onChange={e => setNf({ ...nf, ownerEmail: e.target.value })} className={inp} />
            <input placeholder="Owner phone (optional)" value={nf.ownerPhone} onChange={e => setNf({ ...nf, ownerPhone: e.target.value })} className={inp} />
            <input placeholder="Temporary password (min 8)" type="text" value={nf.ownerPassword} onChange={e => setNf({ ...nf, ownerPassword: e.target.value })} className={inp} />
          </div>
          <button onClick={createFarm} disabled={creating || !nf.farmName || !nf.ownerEmail} className="self-start px-5 py-2 bg-green-600 text-white rounded-lg font-semibold text-sm disabled:opacity-50">{creating ? 'Creating…' : 'Create farm + owner login'}</button>
        </div>
      )}

      {/* Platform branding */}
      <div className="bg-white border border-gray-200 rounded-xl p-5 flex flex-col gap-3">
        <h2 className="font-bold text-gray-800">Branding</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="flex flex-col gap-1 text-xs font-semibold text-gray-500">App name
            <input value={settings.appName} onChange={e => setSettings(s => ({ ...s, appName: e.target.value }))} placeholder="IFMS" className={inp} />
          </label>
          <label className="flex flex-col gap-1 text-xs font-semibold text-gray-500">Tagline
            <input value={settings.tagline} onChange={e => setSettings(s => ({ ...s, tagline: e.target.value }))} className={inp} />
          </label>
          <label className="flex flex-col gap-1 text-xs font-semibold text-gray-500 sm:col-span-2">Logo URL (or upload below)
            <input value={settings.logoUrl} onChange={e => setSettings(s => ({ ...s, logoUrl: e.target.value }))} placeholder="https://… or upload" className={inp} />
          </label>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          {settings.logoUrl
            ?   <img src={settings.logoUrl} alt="logo" className="w-10 h-10 object-contain rounded bg-gray-50 border border-gray-200" />
            : <span className="text-2xl">🌾</span>}
          <input type="file" accept="image/*" onChange={e => e.target.files?.[0] && onLogoFile(e.target.files[0])} className="text-xs" />
          {settings.logoUrl && <button onClick={() => setSettings(s => ({ ...s, logoUrl: '' }))} className="text-xs text-gray-500 underline">remove logo</button>}
          <button onClick={saveSettings} disabled={settingsSaving} className="ml-auto px-4 py-2 bg-indigo-600 text-white rounded-lg font-semibold text-sm disabled:opacity-50">{settingsSaving ? 'Saving…' : 'Save branding'}</button>
        </div>
        {settingsMsg && <p className="text-sm text-gray-600">{settingsMsg}</p>}
      </div>

      {/* Subscription packages */}
      <AdminPackages onSaved={loadPackages} />

      {/* Acceptance testing */}
      <AdminTesting />

      {/* System audit trail */}
      <AdminAudit />

      {/* Farms */}
      <h2 className="font-bold text-gray-900 -mb-2">Farms ({tenants.length})</h2>
      {loading ? <p className="text-gray-400">Loading…</p>
        : tenants.length === 0 ? <p className="text-gray-400">No farms yet.</p>
        : tenants.map(t => (
          <div key={t.id} className={`bg-white border rounded-xl p-5 flex flex-col gap-4 ${t.active ? 'border-gray-200' : 'border-red-300 bg-red-50/30'}`}>
            <div className="flex items-start justify-between flex-wrap gap-3">
              <div>
                <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2">{t.name}
                  {!t.active && <span className="text-xs bg-red-600 text-white px-2 py-0.5 rounded-full">SUSPENDED</span>}
                </h3>
                <p className="text-xs text-gray-400">{t.batches} batches · {t.users} users · {t.workers} workers · {saving === t.id ? 'saving…' : `${t.features.length} features`}</p>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <label className="text-xs font-semibold text-gray-500">Plan</label>
                <select value={t.plan} onChange={e => setPlan(t, e.target.value)} className={inp}>{packages.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}{!packages.some(p => p.id === t.plan) && <option value={t.plan}>{t.plan}</option>}</select>
                <button onClick={() => openManage(t)} className="px-3 py-2 bg-gray-100 text-gray-700 rounded-lg font-semibold text-xs">{manageId === t.id ? 'Close' : 'Manage'}</button>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {FEATURES.map(f => {
                const on = t.features.includes(f.key);
                return (
                  <button key={f.key} onClick={() => toggle(t, f.key)} disabled={saving === t.id}
                    className={`flex items-center justify-between px-3 py-2 rounded-lg border-2 text-left disabled:opacity-50 ${on ? 'bg-green-50 border-green-300' : 'bg-gray-50 border-gray-200'}`}>
                    <div><p className={`text-sm font-semibold ${on ? 'text-green-800' : 'text-gray-500'}`}>{f.label}</p><p className="text-xs text-gray-400">{f.desc}</p></div>
                    <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${on ? 'bg-green-600 text-white' : 'bg-gray-300 text-gray-600'}`}>{on ? 'ON' : 'OFF'}</span>
                  </button>
                );
              })}
            </div>

            {manageId === t.id && (
              <div className="border-t border-gray-200 pt-4 flex flex-col gap-4">
                {/* rename */}
                <div className="flex items-end gap-2 flex-wrap">
                  <label className="flex flex-col gap-1 text-xs font-semibold text-gray-500 flex-1 min-w-[180px]">Farm name
                    <input value={rename} onChange={e => setRename(e.target.value)} className={inp} />
                  </label>
                  <button onClick={() => patch(t.id, { name: rename })} className="px-3 py-2 bg-gray-800 text-white rounded-lg text-xs font-semibold">Rename</button>
                </div>

                {/* owner */}
                <div className="bg-gray-50 rounded-lg p-3 flex flex-col gap-2">
                  <p className="text-xs font-bold text-gray-600">Owner login</p>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <input value={owner.name} onChange={e => setOwner({ ...owner, name: e.target.value })} placeholder="Name" className={inp} />
                    <input value={owner.email} onChange={e => setOwner({ ...owner, email: e.target.value })} placeholder="Email" className={inp} />
                    <input value={owner.phone} onChange={e => setOwner({ ...owner, phone: e.target.value })} placeholder="Phone" className={inp} />
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <button onClick={() => saveOwner(t, { name: owner.name, email: owner.email, phone: owner.phone }, '✓ Owner details updated')} className="px-3 py-2 bg-gray-800 text-white rounded-lg text-xs font-semibold">Save details</button>
                    <input value={newPass} onChange={e => setNewPass(e.target.value)} placeholder="New password (min 8)" className={`${inp} flex-1 min-w-[160px]`} />
                    <button onClick={() => saveOwner(t, { newPassword: newPass }, '✓ Password reset')} disabled={newPass.length < 8} className="px-3 py-2 bg-amber-600 text-white rounded-lg text-xs font-semibold disabled:opacity-50">Reset password</button>
                  </div>
                  {ownerMsg && <p className="text-xs text-gray-600">{ownerMsg}</p>}
                </div>

                {/* lifecycle */}
                <div className="flex items-center gap-2 flex-wrap">
                  <button onClick={() => patch(t.id, { active: !t.active })} className={`px-3 py-2 rounded-lg text-xs font-semibold text-white ${t.active ? 'bg-amber-600' : 'bg-green-600'}`}>{t.active ? 'Suspend farm' : 'Reactivate farm'}</button>
                  <button onClick={() => removeFarm(t)} className="px-3 py-2 bg-red-600 text-white rounded-lg text-xs font-semibold">Delete farm</button>
                  <span className="text-xs text-gray-400">Suspended farms can&apos;t sign in. Delete is permanent.</span>
                </div>
              </div>
            )}
          </div>
        ))
      }
    </div>
  );
}
