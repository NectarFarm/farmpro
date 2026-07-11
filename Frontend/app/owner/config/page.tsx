'use client';
import React, { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useTranslation } from '@/lib/i18n/useTranslation';
import type { WorkerProfile, FieldConfig, FieldPermission } from '@/lib/types';
import { Settings, Check, Lock } from 'lucide-react';

export default function WorkerConfigPage() {
  const { t } = useTranslation();
  const permissionOptions: { value: FieldPermission; label: string; color: string }[] = [
    { value: 'editable', label: t('editable'), color: 'bg-green-100 text-green-700 border-green-300' },
    { value: 'readonly', label: t('readOnly'), color: 'bg-blue-100 text-blue-700 border-blue-300' },
    { value: 'hidden', label: t('hidden'), color: 'bg-red-100 text-red-700 border-red-300' },
  ];
  const permSubHeaders = [t('editable'), t('readOnly'), t('hidden')];
  const [profiles, setProfiles] = useState<WorkerProfile[]>([]);
  const [selected, setSelected] = useState<WorkerProfile | null>(null);
  const [edited, setEdited] = useState<FieldConfig[]>([]);
  const [photoThreshold, setPhotoThreshold] = useState(1);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const [showNew, setShowNew] = useState(false);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);

  const selectProfile = (p: WorkerProfile) => { setSelected(p); setEdited(p.fields); setPhotoThreshold(p.mortalityPhotoThreshold); setSaved(false); };
  const reload = (keepId?: string) => api.getWorkerProfiles().then(p => {
    setProfiles(p);
    const pick = (keepId && p.find(x => x.id === keepId)) || p[0];
    if (pick) selectProfile(pick);
  });

  useEffect(() => { reload(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
      await api.updateWorkerProfile(selected.id, { fields: edited, mortalityPhotoThreshold: photoThreshold });
      // Reflect the saved state locally instead of re-fetching: a reload would run
      // selectProfile → setSaved(false) and instantly wipe the confirmation, making
      // it look like nothing saved. Keep selection + the "✓ Saved" flag intact.
      const updated: WorkerProfile = { ...selected, fields: edited, mortalityPhotoThreshold: photoThreshold };
      setSelected(updated);
      setProfiles(ps => ps.map(p => (p.id === updated.id ? updated : p)));
      setSaved(true); setTimeout(() => setSaved(false), 2500);
    } catch (e) { setErr((e as Error).message); } finally { setSaving(false); }
  };

  const openNewProfile = () => { setNewName(''); setErr(''); setShowNew(true); };
  const submitNewProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = newName.trim();
    if (!name) { setErr('Enter a profile name.'); return; }
    setCreating(true); setErr('');
    try {
      const { id } = await api.createWorkerProfile({ name });
      setShowNew(false); setNewName('');
      await reload(id);
    } catch (e) { setErr((e as Error).message); } finally { setCreating(false); }
  };

  return (
    <div className="p-6 flex flex-col gap-6 max-w-4xl">
      <div className="flex items-center gap-3">
        <div className="shrink-0 w-11 h-11 rounded-xl bg-green-50 flex items-center justify-center">
          <Settings className="w-6 h-6 text-green-700" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t('config')}</h1>
          <p className="text-gray-500 text-sm">Control what each worker profile can see, edit, and must fill in.</p>
        </div>
      </div>

      {/* Profile selector */}
      <div className="flex gap-3 flex-wrap">
        {profiles.map(p => (
          <button key={p.id} onClick={() => selectProfile(p)}
            className={`px-4 py-2 rounded-xl font-semibold text-sm border-2 ${selected?.id === p.id ? 'bg-green-600 text-white border-green-600' : 'bg-white text-gray-700 border-gray-300'}`}>
            {p.name}
          </button>
        ))}
        <button onClick={openNewProfile} className="px-4 py-2 rounded-xl font-semibold text-sm border-2 border-dashed border-green-400 text-green-600">+ {t('newProfile')}</button>
      </div>

      {/* New-profile inline form (replaces the old browser prompt) */}
      {showNew && (
        <form onSubmit={submitNewProfile} className="bg-white border border-green-300 rounded-xl p-4 flex flex-col sm:flex-row gap-3 sm:items-end">
          <div className="flex-1">
            <label className="block text-xs font-semibold text-gray-500 mb-1">{t('profileName')}</label>
            <input autoFocus value={newName} onChange={e => setNewName(e.target.value)}
              placeholder="e.g. Poultry worker, Fish hand, Crop labourer"
              className="w-full border-2 border-gray-300 rounded-lg px-3 py-2 text-sm" />
          </div>
          <div className="flex gap-2">
            <button type="submit" disabled={creating || !newName.trim()}
              className="px-4 py-2 bg-green-600 text-white rounded-lg font-semibold text-sm disabled:opacity-50">
              {creating ? t('saving') : t('createProfile')}
            </button>
            <button type="button" onClick={() => { setShowNew(false); setErr(''); }}
              className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg font-semibold text-sm">Cancel</button>
          </div>
        </form>
      )}

      {err && <p className="text-red-600 bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm font-semibold">{err}</p>}

      {profiles.length === 0 && (
        <div className="text-center py-10 bg-white border border-dashed border-gray-200 rounded-xl">
          <p className="text-gray-500 font-semibold">{t('noProfileYet')}</p>
          <p className="text-gray-400 text-sm mt-1 max-w-md mx-auto">{t('fieldPermissions')}</p>
        </div>
      )}

      {selected && (
        <>
          {/* Field permission matrix */}
          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
            <div className="px-5 py-3 bg-gray-50 border-b border-gray-200">
              <h2 className="font-bold text-gray-800">{t('fieldPermissions')} — {selected.name}</h2>
              <p className="text-xs text-gray-400 mt-0.5">Editable, read-only, or hidden — per field, for this profile.</p>
            </div>
            <table className="w-full text-sm">
              <thead className="text-gray-500 text-xs font-semibold border-b">
                <tr>
                  <th className="px-5 py-3 text-left">{t('field')}</th>
                  <th className="px-3 py-3 text-center" colSpan={3}>{t('permission')}</th>
                  <th className="px-3 py-3 text-center">{t('required')}</th>
                </tr>
                <tr className="bg-gray-50 text-gray-400">
                  <th className="px-5 pb-2"></th>
                  <th className="px-2 pb-2 text-green-600">{permSubHeaders[0]}</th>
                  <th className="px-2 pb-2 text-blue-600">{permSubHeaders[1]}</th>
                  <th className="px-2 pb-2 text-red-500">{permSubHeaders[2]}</th>
                  <th className="px-3 pb-2">{t('required')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {edited.map(field => (
                  <tr key={field.fieldKey} className="hover:bg-gray-50">
                    <td className="px-5 py-3 font-medium text-gray-800">{field.label}</td>
                    {permissionOptions.map(opt => (
                      <td key={opt.value} className="px-2 py-3 text-center">
                        <button type="button" onClick={() => setFieldPerm(field.fieldKey, opt.value)}
                          className={`w-8 h-8 rounded-full border-2 flex items-center justify-center transition-all ${field.permission === opt.value ? opt.color + ' border-2' : 'bg-gray-50 border-gray-200'}`}>
                          {field.permission === opt.value && <Check className="w-4 h-4" />}
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
            className={`w-full min-h-[52px] rounded-xl font-bold text-base disabled:opacity-50 flex items-center justify-center gap-2 ${saved ? 'bg-green-100 text-green-700' : 'bg-green-600 text-white hover:bg-green-700'}`}>
            {saved && <Check className="w-5 h-5" />} {saving ? t('saving') : saved ? t('changesSaved') : t('saveProfile')}
          </button>

          {/* Security notice */}
          <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
            <p className="text-amber-800 font-semibold text-sm flex items-center gap-1.5"><Lock className="w-4 h-4" /> How hiding is enforced</p>
            <p className="text-amber-700 text-xs mt-0.5">Hidden fields are stripped on the server (<span className="font-mono">lib/server/fieldPermissions</span>) before the response leaves the API, based on the worker&apos;s assigned profile — so they never reach the phone and can&apos;t be revealed by inspecting network traffic or editing the page. Covered by automated tests (<span className="font-mono">fieldPermissions</span>).</p>
          </div>
        </>
      )}
    </div>
  );
}
