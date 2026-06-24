'use client';
import React, { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import type { WorkerProfile, FieldConfig, FieldPermission } from '@/lib/types';

const permissionOptions: { value: FieldPermission; label: string; color: string }[] = [
  { value: 'editable', label: 'Editable', color: 'bg-green-100 text-green-700 border-green-300' },
  { value: 'readonly', label: 'Read-only', color: 'bg-blue-100 text-blue-700 border-blue-300' },
  { value: 'hidden', label: 'Hidden', color: 'bg-red-100 text-red-700 border-red-300' },
];

export default function WorkerConfigPage() {
  const [profiles, setProfiles] = useState<WorkerProfile[]>([]);
  const [selected, setSelected] = useState<WorkerProfile | null>(null);
  const [edited, setEdited] = useState<FieldConfig[]>([]);
  const [photoThreshold, setPhotoThreshold] = useState(1);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const selectProfile = (p: WorkerProfile) => { setSelected(p); setEdited(p.fields); setPhotoThreshold(p.mortalityPhotoThreshold); setSaved(false); };
  const reload = (keepId?: string) => api.getWorkerProfiles().then(p => {
    setProfiles(p);
    const pick = (keepId && p.find(x => x.id === keepId)) || p[0];
    if (pick) selectProfile(pick);
  });

  useEffect(() => { reload(); }, []);

  const setFieldPerm = (key: string, perm: FieldPermission) => {
    setEdited(fs => fs.map(f => f.fieldKey === key ? { ...f, permission: perm } : f));
    setSaved(false);
  };

  const setFieldRequired = (key: string, req: boolean) => {
    setEdited(fs => fs.map(f => f.fieldKey === key ? { ...f, required: req } : f));
    setSaved(false);
  };

  const handleSave = async () => {
    if (!selected) return;
    setSaving(true); setErr('');
    try {
      const res = await fetch(`/api/data/worker-profiles?id=${selected.id}`, {
        method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields: edited, mortalityPhotoThreshold: photoThreshold }),
      });
      if (!res.ok) throw new Error(res.status === 403 ? 'Owner only' : res.status === 401 ? 'Please sign in again' : 'Save failed');
      setSaved(true); setTimeout(() => setSaved(false), 2500);
      await reload(selected.id);
    } catch (e) { setErr((e as Error).message); } finally { setSaving(false); }
  };

  const createProfile = async () => {
    const name = window.prompt('New profile name?', 'New Profile');
    if (!name) return;
    setErr('');
    try {
      const res = await fetch('/api/data/worker-profiles', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }),
      });
      if (!res.ok) throw new Error(res.status === 403 ? 'Owner only' : 'Could not create profile');
      const { id } = await res.json();
      await reload(id);
    } catch (e) { setErr((e as Error).message); }
  };

  return (
    <div className="p-6 flex flex-col gap-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">⚙️ Worker Portal Config</h1>
        <p className="text-gray-500 text-sm mt-1">Field-level permissions · Hidden fields are <strong>stripped server-side</strong> — not CSS-hidden (NFR-SEC-2)</p>
      </div>

      {/* Profile selector */}
      <div className="flex gap-3 flex-wrap">
        {profiles.map(p => (
          <button key={p.id} onClick={() => { setSelected(p); setEdited(p.fields); setPhotoThreshold(p.mortalityPhotoThreshold); }}
            className={`px-4 py-2 rounded-xl font-semibold text-sm border-2 ${selected?.id === p.id ? 'bg-green-600 text-white border-green-600' : 'bg-white text-gray-700 border-gray-300'}`}>
            {p.name}
          </button>
        ))}
        <button onClick={createProfile} className="px-4 py-2 rounded-xl font-semibold text-sm border-2 border-dashed border-green-400 text-green-600">+ New Profile</button>
      </div>

      {err && <p className="text-red-600 bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm font-semibold">{err}</p>}

      {profiles.length === 0 && (
        <div className="text-center py-10 bg-white border border-dashed border-gray-200 rounded-xl">
          <p className="text-gray-500 font-semibold">No worker profile yet</p>
          <p className="text-gray-400 text-sm mt-1 max-w-md mx-auto">A profile controls exactly what each worker can see and enter — hide costs &amp; prices, choose required fields. Click <span className="font-semibold text-green-700">+ New Profile</span> to create one, then assign it to workers.</p>
        </div>
      )}

      {selected && (
        <>
          {/* Field permission matrix */}
          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
            <div className="px-5 py-3 bg-gray-50 border-b border-gray-200">
              <h2 className="font-bold text-gray-800">Field Permissions — {selected.name}</h2>
              <p className="text-xs text-gray-400 mt-0.5">Controls exactly what workers can see and enter. Changes propagate on next sync.</p>
            </div>
            <table className="w-full text-sm">
              <thead className="text-gray-500 text-xs font-semibold border-b">
                <tr>
                  <th className="px-5 py-3 text-left">Field</th>
                  <th className="px-3 py-3 text-center" colSpan={3}>Permission</th>
                  <th className="px-3 py-3 text-center">Required</th>
                </tr>
                <tr className="bg-gray-50 text-gray-400">
                  <th className="px-5 pb-2"></th>
                  <th className="px-2 pb-2 text-green-600">Editable</th>
                  <th className="px-2 pb-2 text-blue-600">Read-only</th>
                  <th className="px-2 pb-2 text-red-500">Hidden</th>
                  <th className="px-3 pb-2">Required</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {edited.map(field => (
                  <tr key={field.fieldKey} className="hover:bg-gray-50">
                    <td className="px-5 py-3 font-medium text-gray-800">{field.label}</td>
                    {permissionOptions.map(opt => (
                      <td key={opt.value} className="px-2 py-3 text-center">
                        <button type="button" onClick={() => setFieldPerm(field.fieldKey, opt.value)}
                          className={`w-8 h-8 rounded-full border-2 transition-all ${field.permission === opt.value ? opt.color + ' border-2' : 'bg-gray-50 border-gray-200'}`}>
                          {field.permission === opt.value ? '✓' : ''}
                        </button>
                      </td>
                    ))}
                    <td className="px-3 py-3 text-center">
                      <input type="checkbox" checked={!!field.required} onChange={e => setFieldRequired(field.fieldKey, e.target.checked)}
                        disabled={field.permission === 'hidden'}
                        className="w-4 h-4 accent-green-600 disabled:opacity-30" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Photo threshold */}
          <div className="bg-white border border-gray-200 rounded-xl px-5 py-4 flex items-center justify-between">
            <div>
              <p className="font-semibold text-gray-800">Photo required if deaths &gt;</p>
              <p className="text-xs text-gray-400">Drives FR-M9-2 · Current: {photoThreshold} death{photoThreshold !== 1 ? 's' : ''}</p>
            </div>
            <div className="flex items-center gap-3">
              <button onClick={() => setPhotoThreshold(t => Math.max(0, t-1))} className="w-10 h-10 rounded-xl bg-gray-100 text-xl font-bold flex items-center justify-center">−</button>
              <span className="text-3xl font-bold w-12 text-center">{photoThreshold}</span>
              <button onClick={() => setPhotoThreshold(t => t+1)} className="w-10 h-10 rounded-xl bg-gray-100 text-xl font-bold flex items-center justify-center">+</button>
            </div>
          </div>

          {/* Save */}
          {err && <p className="text-red-600 bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm font-semibold">{err}</p>}
          <button onClick={handleSave} disabled={saving}
            className={`w-full min-h-[52px] rounded-xl font-bold text-base disabled:opacity-50 ${saved ? 'bg-green-100 text-green-700' : 'bg-green-600 text-white hover:bg-green-700'}`}>
            {saving ? 'Saving…' : saved ? '✓ Changes Saved' : 'Save Profile'}
          </button>

          {/* Security notice */}
          <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
            <p className="text-amber-800 font-semibold text-sm">🔒 Security Note (C4 fix)</p>
            <p className="text-amber-700 text-xs mt-0.5">Hidden fields are dropped in Django serializers before the response is sent. They never appear in the API payload — not just hidden in CSS. Verified by automated tests that assert forbidden keys are absent from worker JWT responses.</p>
          </div>
        </>
      )}
    </div>
  );
}
