'use client';
import React, { useEffect, useState } from 'react';
import { Settings, Palette, Package2, BookCheck, Building2 } from 'lucide-react';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { AdminPackages } from '@/components/admin/AdminPackages';
import { AdminTesting } from '@/components/admin/AdminTesting';

const inp = 'border border-gray-300 rounded-lg px-3 py-2 text-sm';

export default function AdminSettingsPage() {
  const { t } = useTranslation();

  // Branding
  const [settings, setSettings] = useState({ appName: '', tagline: '', logoUrl: '' });
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsMsg, setSettingsMsg] = useState('');

  const loadSettings = () => fetch('/api/admin/settings', { credentials: 'include' })
    .then(r => r.ok ? r.json() : null).then(d => {
      if (d) setSettings({ appName: d.appName ?? '', tagline: d.tagline ?? '', logoUrl: d.logoUrl ?? '' });
    }).catch(() => {});
  useEffect(() => { loadSettings(); }, []);

  const saveSettings = async () => {
    setSettingsSaving(true); setSettingsMsg('');
    try {
      const res = await fetch('/api/admin/settings', {
        method: 'PATCH', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || t('saveFailed'));
      setSettingsMsg(t('brandingSaved'));
    } catch (e) { setSettingsMsg((e as Error).message); } finally { setSettingsSaving(false); }
  };

  const onLogoFile = (file: File) => {
    if (file.size > 400_000) { setSettingsMsg(t('logoTooLarge')); return; }
    const reader = new FileReader();
    reader.onload = () => setSettings(s => ({ ...s, logoUrl: String(reader.result) }));
    reader.readAsDataURL(file);
  };

  return (
    <div className="p-6 flex flex-col gap-8 max-w-4xl mx-auto">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <Settings className="w-6 h-6" /> {t('settings')}
        </h1>
        <p className="text-gray-500 text-sm mt-1">{t('platformSettings')}</p>
      </div>

      {settingsMsg && (
        <p className={`text-sm font-semibold rounded-xl px-4 py-3 border ${
          settingsMsg.startsWith('✓')
            ? 'text-green-700 bg-green-50 border-green-200'
            : 'text-red-600 bg-red-50 border-red-200'
        }`}>
          {settingsMsg}
        </p>
      )}

      {/* Branding */}
      <section className="bg-white border border-gray-200 rounded-xl p-6 flex flex-col gap-5">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-indigo-50 flex items-center justify-center">
            <Palette className="w-5 h-5 text-indigo-600" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-gray-900">{t('branding')}</h2>
            <p className="text-sm text-gray-400">{t('branding') + ' — ' + t('appName') + ', ' + t('tagline') + ', ' + t('logoUrl')}</p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <label className="flex flex-col gap-1.5 text-sm font-medium text-gray-700">
            {t('appName')}
            <input value={settings.appName} onChange={e => setSettings(s => ({ ...s, appName: e.target.value }))}
              placeholder={t('appNamePlaceholder')} className={inp} />
          </label>
          <label className="flex flex-col gap-1.5 text-sm font-medium text-gray-700">
            {t('tagline')}
            <input value={settings.tagline} onChange={e => setSettings(s => ({ ...s, tagline: e.target.value }))}
              placeholder={t('taglinePlaceholder')} className={inp} />
          </label>
          <label className="flex flex-col gap-1.5 text-sm font-medium text-gray-700 sm:col-span-2">
            {t('logoUrl')}
            <input value={settings.logoUrl} onChange={e => setSettings(s => ({ ...s, logoUrl: e.target.value }))}
              placeholder={t('logoUrlPlaceholder')} className={inp} />
          </label>
        </div>

        <div className="flex items-center gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="w-14 h-14 rounded-xl bg-gray-50 border border-gray-200 flex items-center justify-center overflow-hidden">
              {settings.logoUrl
                ? <img src={settings.logoUrl} alt={t('logoAlt')} className="w-full h-full object-contain" />
                : <Building2 className="w-6 h-6 text-gray-300" />
              }
            </div>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-gray-500">{t('upload')}</span>
              <input type="file" accept="image/*" onChange={e => e.target.files?.[0] && onLogoFile(e.target.files[0])}
                className="text-xs text-gray-500 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-gray-100 file:text-gray-700 hover:file:bg-gray-200" />
            </label>
            {settings.logoUrl && (
              <button onClick={() => setSettings(s => ({ ...s, logoUrl: '' }))}
                className="text-xs text-gray-500 underline hover:text-gray-700">{t('remove')} {t('logoUrl').toLowerCase()}</button>
            )}
          </div>
          <button onClick={saveSettings} disabled={settingsSaving}
            className="ml-auto px-5 py-2.5 bg-indigo-600 text-white rounded-lg font-semibold text-sm disabled:opacity-50 hover:bg-indigo-700 transition-colors">
            {settingsSaving ? t('saving') : t('saveBranding')}
          </button>
        </div>
      </section>

      {/* Subscription packages */}
      <div className="overflow-hidden">          <div className="flex items-center gap-3 pl-1 pb-3">
            <div className="w-10 h-10 rounded-lg bg-purple-50 flex items-center justify-center">
              <Package2 className="w-5 h-5 text-purple-600" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-gray-900">{t('packages')}</h2>
              <p className="text-sm text-gray-400">{t('definePlans')}</p>
            </div>
          </div>
          <AdminPackages />
      </div>

      {/* Acceptance testing */}
      <div className="overflow-hidden">          <div className="flex items-center gap-3 pl-1 pb-3">
            <div className="w-10 h-10 rounded-lg bg-amber-50 flex items-center justify-center">
              <BookCheck className="w-5 h-5 text-amber-600" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-gray-900">{t('acceptanceTesting')}</h2>
              <p className="text-sm text-gray-400">{t('acceptanceTesting') + ' — ' + t('enableTesting') + ', ' + t('disableTesting') + ', ' + t('viewReport')}</p>
            </div>
          </div>
          <AdminTesting />
      </div>
    </div>
  );
}
