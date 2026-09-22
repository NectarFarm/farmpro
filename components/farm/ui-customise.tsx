'use client';
import React, { useState, useEffect, useCallback } from 'react';
import { useNav, TopNav } from './navigation';
import { useToast } from './ui-shared';
import { apiClient } from '@/lib/request';
import { cn } from '@/lib/utils';
import { PageHeader } from '@/components/ui-kit/page-header';
import { Segmented } from '@/components/ui-kit/segmented';
import { Button } from '@/components/ui-kit/button';
import { Input } from '@/components/ui-kit/input';
import { Field } from '@/components/ui-kit/field';
import {
  Check, X, Edit2, RefreshCw,
  Home, Leaf, CheckSquare, Package, DollarSign, Users, Shield, FileText, CloudSun, Bot,
  type LucideIcon,
} from './icons';

/* ── Module and label definitions ── */
interface ModuleConfig {
  id: string;
  defaultLabel: string;
  // Same icon set/mapping as the sidebar (navigation.tsx's AppSidebar) so a
  // module reads as the same thing in both places.
  icon: LucideIcon;
  enabled: boolean;
  customLabel?: string;
  description: string;
}

const DEFAULT_MODULES: ModuleConfig[] = [
  { id: 'dashboard', defaultLabel: 'Dashboard', icon: Home, enabled: true, description: 'Main farm overview screen' },
  { id: 'crops', defaultLabel: 'Farm / Batches', icon: Leaf, enabled: true, description: 'Enterprise batches and livestock/crop management' },
  { id: 'tasks', defaultLabel: 'Tasks', icon: CheckSquare, enabled: true, description: 'Daily task assignment and completion' },
  { id: 'inventory', defaultLabel: 'Inventory / Stock', icon: Package, enabled: true, description: 'Feed, supplies, and stock management' },
  { id: 'finance', defaultLabel: 'Finance', icon: DollarSign, enabled: true, description: 'P&L, expenses, sales and GL accounts' },
  { id: 'people', defaultLabel: 'People / HR', icon: Users, enabled: true, description: 'Employee management and payroll' },
  { id: 'governance', defaultLabel: 'Governance', icon: Shield, enabled: true, description: 'Approvals, roles and audit log' },
  { id: 'reports', defaultLabel: 'Reports', icon: FileText, enabled: true, description: 'Analytics, exports and auditor links' },
  { id: 'weather', defaultLabel: 'Weather & IoT', icon: CloudSun, enabled: true, description: 'Forecast, sensors and farm advisories' },
  { id: 'ai-chat', defaultLabel: 'AI Assistant', icon: Bot, enabled: true, description: 'AI-powered farm advisor chatbot' },
];

// Branding is a single tenant-wide record (db/schemas/settings.ts's
// tenantSettings — one row per tenant_id, not per farm), so there is no
// per-farm branding to key off; the mock's old per-farmCode branding array is
// gone in favour of one object shared by every farm on this tenant.
interface FarmBranding {
  accentColor: string;
  logoEmoji: string;
  dashboardGreeting: string;
}

const DEFAULT_BRANDING: FarmBranding = {
  accentColor: '#4ade80', logoEmoji: '🌾',
  dashboardGreeting: 'Good morning!',
};

const ACCENT_OPTIONS = [
  '#4ade80', '#60a5fa', '#f59e0b', '#a855f7', '#22d3ee', '#f87171', '#fb923c', '#34d399',
];

// Shape returned by GET /api/settings (trimmed to what this screen reads/
// writes). currencySymbol/weightUnit moved to components/farm/settings.tsx
// (settings-reorg) — they're operational, not branding — so this screen no
// longer reads or writes them, even though the underlying row still has them.
interface ApiModuleSetting { id: string; enabled: boolean; customLabel?: string }
interface ApiSettings {
  accentColor: string;
  logoEmoji: string;
  dashboardGreeting: string;
  modules: ApiModuleSetting[];
}

export function UICustomiseScreen() {
  const { tenantId, farms, activeFarm } = useNav();
  const { showToast } = useToast();
  const [tab, setTab] = useState<'modules' | 'labels' | 'branding'>('modules');
  const [modules, setModules] = useState<ModuleConfig[]>(DEFAULT_MODULES);
  const [branding, setBranding] = useState<FarmBranding>(DEFAULT_BRANDING);
  const [editingModule, setEditingModule] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  // Load the tenant's persisted modules/branding (issue #256) — merge onto
  // DEFAULT_MODULES so icon/description/defaultLabel (cosmetic, never sent to
  // the backend) survive even for module ids the tenant hasn't customised yet.
  const loadSettings = useCallback(() => {
    apiClient.get<ApiSettings>(`/api/settings?tenantId=${tenantId}`).then((res) => {
      if (!res.success) return;
      const data = res.data;
      setModules((ms) => ms.map((m) => {
        const savedModule = data.modules?.find((x) => x.id === m.id);
        return savedModule ? { ...m, enabled: savedModule.enabled, customLabel: savedModule.customLabel } : m;
      }));
      setBranding((b) => ({
        ...b,
        accentColor: data.accentColor ?? b.accentColor,
        logoEmoji: data.logoEmoji ?? b.logoEmoji,
        dashboardGreeting: data.dashboardGreeting ?? b.dashboardGreeting,
      }));
    });
  }, [tenantId]);

  useEffect(() => { loadSettings(); }, [loadSettings]);

  function toggleModule(id: string) {
    setModules((ms) => ms.map((m) => m.id === id ? { ...m, enabled: !m.enabled } : m));
  }

  function saveLabel(id: string) {
    setModules((ms) => ms.map((m) => m.id === id ? { ...m, customLabel: editLabel || undefined } : m));
    setEditingModule(null);
  }

  function updateBranding(key: keyof FarmBranding, value: string) {
    setBranding((b) => ({ ...b, [key]: value }));
  }

  // "Save Customisation" persists every tab's edits in one PATCH /api/settings
  // call — module toggles/labels and branding fields were only applied to
  // local state until now (issue #256 task 3); this is what makes a module
  // hidden or an accent colour set by one user show up for a second user on
  // the same tenant.
  async function handleSave() {
    setSaving(true);
    setError('');
    const res = await apiClient.patch(`/api/settings?tenantId=${tenantId}`, {
      modules: modules.map((m) => ({ id: m.id, enabled: m.enabled, customLabel: m.customLabel })),
      accentColor: branding.accentColor,
      logoEmoji: branding.logoEmoji,
      dashboardGreeting: branding.dashboardGreeting,
    });
    setSaving(false);
    if (res.success) {
      setSaved(true);
      showToast('Customisation saved.', 'success');
      setTimeout(() => setSaved(false), 2000);
    } else {
      setError(res.error || 'Failed to save customisation.');
      showToast(res.error || 'Failed to save customisation.', 'error');
    }
  }

  const farmName = farms.find((f) => f.code === activeFarm)?.name ?? 'Your farm';

  return (
    <div className="screen-content">
      <TopNav title="" showBack />
      <div className="px-screen" style={{ paddingTop: 12, paddingBottom: 96 }}>
        <PageHeader kicker="Farm setup" title="UI Customise" lede="Modules, labels & branding — applies tenant-wide, across every farm." />

        {/* These settings are tenant-wide (one settings record per tenant, not
           per farm) — every farm on this tenant shares the same module/branding
           configuration, so there is no per-farm switcher here. */}
        <div className="mt-3 rounded-lg px-3.5 py-2.5 text-xs text-muted" style={{ background: 'rgba(var(--info-rgb),0.08)', border: '1px solid rgba(var(--info-rgb),0.2)' }}>
          Applies to {farmName}{farms.length > 1 ? ` +${farms.length - 1} more` : ''}.
        </div>

        <div className="mt-4">
          <Segmented
            value={tab}
            onChange={setTab}
            items={[
              { id: 'modules', label: 'Modules', hint: 'Show or hide a screen' },
              { id: 'labels', label: 'Labels', hint: 'Rename a module' },
              { id: 'branding', label: 'Branding', hint: 'Colour, logo, greeting' },
            ]}
          />
        </div>

        {/* ── MODULES TAB ── */}
        {tab === 'modules' && (
          <div className="mt-4 grid gap-2">
            <p className="text-xs text-muted">Toggle which modules are visible in the app for this tenant. Disabled modules are hidden from all users, on every farm.</p>
            {modules.map((m) => (
              <div
                key={m.id}
                className={cn('flex items-center justify-between gap-3 rounded-xl p-3.5 shadow-(--shadow-border)', m.enabled ? 'bg-surface' : 'bg-surface/50')}
              >
                <div className="flex items-center gap-3">
                  <m.icon size={20} className={m.enabled ? 'text-fg' : 'text-subtle'} aria-hidden="true" />
                  <div>
                    <div className={cn('text-sm font-medium', !m.enabled && 'text-muted')}>{m.customLabel ?? m.defaultLabel}</div>
                    <div className="mt-0.5 text-xs text-subtle">{m.description}</div>
                  </div>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={m.enabled}
                  onClick={() => toggleModule(m.id)}
                  className={cn('relative h-6 w-11 shrink-0 rounded-full transition-colors', m.enabled ? 'bg-primary' : 'bg-surface-2')}
                >
                  <span className={cn('absolute top-0.5 size-5 rounded-full bg-white transition-[left]', m.enabled ? 'left-[22px]' : 'left-0.5')} />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* ── LABELS TAB ── */}
        {tab === 'labels' && (
          <div className="mt-4 grid gap-2">
            <p className="text-xs text-muted">Rename module labels to match your farm&apos;s terminology. Leave blank to use the default label.</p>
            {modules.map((m) => (
              <div key={m.id}>
                {editingModule === m.id ? (
                  <div className="flex items-center gap-2">
                    <m.icon size={19} className="shrink-0 text-fg" aria-hidden="true" />
                    <Input value={editLabel} onChange={(e) => setEditLabel(e.target.value)} placeholder={m.defaultLabel} autoFocus className="flex-1" />
                    <Button size="sm" onClick={() => saveLabel(m.id)}><Check size={12} /> Save</Button>
                    <Button size="icon-sm" variant="secondary" onClick={() => setEditingModule(null)}><X size={12} /></Button>
                  </div>
                ) : (
                  <div className="flex items-center justify-between gap-3 rounded-xl bg-surface p-3 shadow-(--shadow-border)">
                    <div className="flex items-center gap-3">
                      <m.icon size={19} className="text-fg" aria-hidden="true" />
                      <div>
                        <div className="text-sm font-medium">
                          {m.customLabel ?? m.defaultLabel}
                          {m.customLabel && <span className="ml-1.5 text-xs font-medium text-warning">Custom</span>}
                        </div>
                        {m.customLabel && <div className="mt-0.5 text-xs text-subtle">Default: {m.defaultLabel}</div>}
                      </div>
                    </div>
                    <div className="flex gap-1.5">
                      {m.customLabel && (
                        <button
                          onClick={() => setModules((ms) => ms.map((x) => x.id === m.id ? { ...x, customLabel: undefined } : x))}
                          className="rounded-md bg-surface-2 p-1.5 text-muted hover:text-fg"
                          title="Reset to default"
                        >
                          <RefreshCw size={11} />
                        </button>
                      )}
                      <Button size="sm" variant="secondary" onClick={() => { setEditingModule(m.id); setEditLabel(m.customLabel ?? ''); }}>
                        <Edit2 size={11} /> Edit
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* ── BRANDING TAB ── */}
        {tab === 'branding' && (
          <div className="mt-4">
            {/* Preview card */}
            <div
              className="mb-4 rounded-2xl p-4"
              style={{ background: `linear-gradient(135deg, ${branding.accentColor}22, ${branding.accentColor}08)`, border: `1px solid ${branding.accentColor}40` }}
            >
              <div className="flex items-center gap-2.5">
                <span className="text-3xl">{branding.logoEmoji}</span>
                <div>
                  <div className="text-lg font-semibold">{farmName}</div>
                  <div className="text-sm text-muted">{branding.dashboardGreeting}</div>
                </div>
              </div>
              <span
                className="mt-2 inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium"
                style={{ background: branding.accentColor + '33', color: branding.accentColor, border: `1px solid ${branding.accentColor}60` }}
              >
                Live preview
              </span>
            </div>

            {/* Fields */}
            {/* Currency/weight unit moved to Settings > Regional
               (settings-reorg) — they're operational, displayed on every
               amount/weight in the app, not a branding choice. */}
            <Field label="Dashboard greeting" className="mb-4">
              <Input value={branding.dashboardGreeting} onChange={(e) => updateBranding('dashboardGreeting', e.target.value)} />
            </Field>

            <div className="mb-4">
              <p className="mb-2 text-xs font-medium text-muted">Farm logo emoji</p>
              <div className="flex flex-wrap gap-2">
                {['🌾', '🐔', '🐄', '🐷', '🐐', '🌽', '🥦', '🍎', '🐠', '🌿', '🏡', '⚡'].map((e) => (
                  <button
                    key={e}
                    onClick={() => updateBranding('logoEmoji', e)}
                    className={cn('flex size-10 items-center justify-center rounded-lg text-xl shadow-(--shadow-border)', branding.logoEmoji === e ? 'bg-primary-soft ring-2 ring-primary/40' : 'bg-surface')}
                  >
                    {e}
                  </button>
                ))}
              </div>
            </div>

            <div className="mb-2">
              <p className="mb-2 text-xs font-medium text-muted">Accent colour</p>
              <div className="flex flex-wrap gap-2">
                {ACCENT_OPTIONS.map((c) => (
                  <button
                    key={c}
                    onClick={() => updateBranding('accentColor', c)}
                    className="size-8 rounded-full"
                    style={{ background: c, border: branding.accentColor === c ? '3px solid white' : '2px solid transparent', outline: branding.accentColor === c ? `2px solid ${c}` : 'none' }}
                  />
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Save button */}
        <div className="sticky bottom-20 mt-5 pb-3">
          {error && <div className="mb-2 text-xs text-danger">{error}</div>}
          <Button className="w-full justify-center" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : saved ? <><Check size={14} /> Saved!</> : <>Save customisation</>}
          </Button>
        </div>
      </div>
    </div>
  );
}
