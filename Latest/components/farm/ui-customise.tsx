'use client';
import React, { useState, useEffect, useCallback } from 'react';
import { useNav, TopNav } from './navigation';
import { useToast } from './ui-shared';
import { apiClient } from '@/lib/request';
import { Check, X, ChevronDown, ChevronUp, Eye, EyeOff, Edit2, RefreshCw } from './icons';

/* ── Module and label definitions ── */
interface ModuleConfig {
  id: string;
  defaultLabel: string;
  icon: string;
  enabled: boolean;
  customLabel?: string;
  description: string;
}

const DEFAULT_MODULES: ModuleConfig[] = [
  { id: 'dashboard', defaultLabel: 'Dashboard', icon: '🏠', enabled: true, description: 'Main farm overview screen' },
  { id: 'crops', defaultLabel: 'Farm / Batches', icon: '🌿', enabled: true, description: 'Enterprise batches and livestock/crop management' },
  { id: 'tasks', defaultLabel: 'Tasks', icon: '✅', enabled: true, description: 'Daily task assignment and completion' },
  { id: 'inventory', defaultLabel: 'Inventory / Stock', icon: '📦', enabled: true, description: 'Feed, supplies, and stock management' },
  { id: 'finance', defaultLabel: 'Finance', icon: '💰', enabled: true, description: 'P&L, expenses, sales and GL accounts' },
  { id: 'people', defaultLabel: 'People / HR', icon: '👥', enabled: true, description: 'Employee management and payroll' },
  { id: 'governance', defaultLabel: 'Governance', icon: '🛡️', enabled: true, description: 'Approvals, roles and audit log' },
  { id: 'reports', defaultLabel: 'Reports', icon: '📊', enabled: true, description: 'Analytics, exports and auditor links' },
  { id: 'weather', defaultLabel: 'Weather & IoT', icon: '🌤️', enabled: true, description: 'Forecast, sensors and farm advisories' },
  { id: 'ai-chat', defaultLabel: 'AI Assistant', icon: '🤖', enabled: true, description: 'AI-powered farm advisor chatbot' },
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
      <TopNav title="UI Customise" subtitle="Modules, labels & branding" />

      <div className="px-screen" style={{ paddingTop: 12 }}>
        {/* These settings are tenant-wide (one settings record per tenant, not
           per farm) — every farm on this tenant shares the same module/branding
           configuration, so there is no per-farm switcher here. */}
        <div style={{ padding: '9px 14px', background: 'rgba(96,165,250,0.08)', borderRadius: 12, marginBottom: 14, border: '1px solid rgba(96,165,250,0.2)', fontSize: 11, color: 'var(--text-muted)' }}>
          Applies tenant-wide, across all farms ({farmName}{farms.length > 1 ? ` +${farms.length - 1} more` : ''}).
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
          {[['modules', 'Modules'], ['labels', 'Labels'], ['branding', 'Branding']].map(([id, label]) => (
            <button
              key={id}
              onClick={() => setTab(id as typeof tab)}
              style={{
                flex: 1, padding: '8px', borderRadius: 10, fontSize: 11, fontWeight: 700, cursor: 'pointer',
                background: tab === id ? 'rgba(74,222,128,0.15)' : 'var(--card)',
                border: tab === id ? '1px solid rgba(74,222,128,0.4)' : '1px solid var(--border-subtle)',
                color: tab === id ? 'var(--primary-green)' : 'var(--text-muted)',
              }}
            >
              {label}
            </button>
          ))}
        </div>

        {/* ── MODULES TAB ── */}
        {tab === 'modules' && (
          <div style={{ paddingBottom: 80 }}>
            <div style={{ padding: '10px 14px', background: 'rgba(168,85,247,0.08)', borderRadius: 12, marginBottom: 14, border: '1px solid rgba(168,85,247,0.2)', fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.5 }}>
              Toggle which modules are visible in the app for this tenant. Disabled modules are hidden from all users, on every farm.
            </div>
            {modules.map((m) => (
              <div
                key={m.id}
                style={{
                  marginBottom: 8, padding: '12px 14px', borderRadius: 12,
                  background: m.enabled ? 'var(--card)' : 'rgba(255,255,255,0.02)',
                  border: m.enabled ? '1px solid var(--border-subtle)' : '1px solid rgba(255,255,255,0.05)',
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                }}
              >
                <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                  <span style={{ fontSize: 20, opacity: m.enabled ? 1 : 0.4 }}>{m.icon}</span>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: m.enabled ? 'var(--text-primary)' : 'var(--text-muted)' }}>
                      {m.customLabel ?? m.defaultLabel}
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 1 }}>{m.description}</div>
                  </div>
                </div>
                <button
                  onClick={() => toggleModule(m.id)}
                  style={{
                    width: 44, height: 24, borderRadius: 100, cursor: 'pointer', border: 'none',
                    background: m.enabled ? 'var(--primary-green)' : 'var(--border-subtle)',
                    position: 'relative', flexShrink: 0, transition: 'background 0.2s',
                  }}
                >
                  <div style={{
                    position: 'absolute', top: 2, left: m.enabled ? 22 : 2,
                    width: 20, height: 20, borderRadius: '50%', background: 'white',
                    transition: 'left 0.15s',
                  }} />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* ── LABELS TAB ── */}
        {tab === 'labels' && (
          <div style={{ paddingBottom: 80 }}>
            <div style={{ padding: '10px 14px', background: 'rgba(96,165,250,0.08)', borderRadius: 12, marginBottom: 14, border: '1px solid rgba(96,165,250,0.2)', fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.5 }}>
              Rename module labels to match your farm's terminology. Leave blank to use the default label.
            </div>
            {modules.map((m) => (
              <div key={m.id} style={{ marginBottom: 10 }}>
                {editingModule === m.id ? (
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <span style={{ fontSize: 18, flexShrink: 0 }}>{m.icon}</span>
                    <input
                      className="farm-input"
                      style={{ flex: 1 }}
                      value={editLabel}
                      onChange={(e) => setEditLabel(e.target.value)}
                      placeholder={m.defaultLabel}
                      autoFocus
                    />
                    <button onClick={() => saveLabel(m.id)} style={{ padding: '8px 12px', borderRadius: 8, background: 'rgba(74,222,128,0.15)', border: '1px solid rgba(74,222,128,0.35)', color: 'var(--status-ok)', cursor: 'pointer', fontWeight: 700, fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}>
                      <Check size={12} /> Save
                    </button>
                    <button onClick={() => setEditingModule(null)} style={{ padding: '8px', borderRadius: 8, background: 'var(--card)', border: '1px solid var(--border-subtle)', color: 'var(--text-muted)', cursor: 'pointer' }}>
                      <X size={12} />
                    </button>
                  </div>
                ) : (
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', background: 'var(--card)', borderRadius: 12, border: '1px solid var(--border-subtle)' }}>
                    <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                      <span style={{ fontSize: 18 }}>{m.icon}</span>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>
                          {m.customLabel ?? m.defaultLabel}
                          {m.customLabel && (
                            <span style={{ fontSize: 10, color: 'var(--accent-amber)', marginLeft: 6, fontWeight: 600 }}>Custom</span>
                          )}
                        </div>
                        {m.customLabel && (
                          <div style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 1 }}>Default: {m.defaultLabel}</div>
                        )}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      {m.customLabel && (
                        <button
                          onClick={() => setModules((ms) => ms.map((x) => x.id === m.id ? { ...x, customLabel: undefined } : x))}
                          style={{ padding: '5px 8px', borderRadius: 8, background: 'var(--surface)', border: '1px solid var(--border-subtle)', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 10 }}
                        >
                          <RefreshCw size={10} />
                        </button>
                      )}
                      <button
                        onClick={() => { setEditingModule(m.id); setEditLabel(m.customLabel ?? ''); }}
                        style={{ padding: '5px 10px', borderRadius: 8, background: 'var(--surface)', border: '1px solid var(--border-subtle)', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 11, display: 'flex', alignItems: 'center', gap: 4 }}
                      >
                        <Edit2 size={11} /> Edit
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* ── BRANDING TAB ── */}
        {tab === 'branding' && (
          <div style={{ paddingBottom: 80 }}>
            {/* Preview card */}
            <div style={{
              marginBottom: 16, padding: 16, borderRadius: 16,
              background: `linear-gradient(135deg, ${branding.accentColor}22, ${branding.accentColor}08)`,
              border: `1px solid ${branding.accentColor}40`,
            }}>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 6 }}>
                <span style={{ fontSize: 28 }}>{branding.logoEmoji}</span>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text-primary)' }}>{farmName}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{branding.dashboardGreeting}</div>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <span style={{ fontSize: 12, fontWeight: 700, padding: '3px 10px', borderRadius: 100, background: branding.accentColor + '33', color: branding.accentColor, border: `1px solid ${branding.accentColor}60` }}>
                  Live Preview
                </span>
              </div>
            </div>

            {/* Fields */}
            {/* Currency/weight unit moved to Settings > Regional & Units
               (settings-reorg) — they're operational, displayed on every
               amount/weight in the app, not a branding choice. */}
            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', display: 'block', marginBottom: 5 }}>Dashboard Greeting</label>
              <input className="farm-input" value={branding.dashboardGreeting} onChange={(e) => updateBranding('dashboardGreeting', e.target.value)} />
            </div>

            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', display: 'block', marginBottom: 5 }}>Farm Logo Emoji</label>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {['🌾', '🐔', '🐄', '🐷', '🐐', '🌽', '🥦', '🍎', '🐠', '🌿', '🏡', '⚡'].map((e) => (
                  <button
                    key={e}
                    onClick={() => updateBranding('logoEmoji', e)}
                    style={{
                      width: 38, height: 38, borderRadius: 10, fontSize: 20, cursor: 'pointer',
                      background: branding.logoEmoji === e ? 'rgba(74,222,128,0.15)' : 'var(--card)',
                      border: branding.logoEmoji === e ? '1px solid rgba(74,222,128,0.4)' : '1px solid var(--border-subtle)',
                    }}
                  >
                    {e}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ marginBottom: 20 }}>
              <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', display: 'block', marginBottom: 8 }}>Accent Colour</label>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {ACCENT_OPTIONS.map((c) => (
                  <button
                    key={c}
                    onClick={() => updateBranding('accentColor', c)}
                    style={{
                      width: 32, height: 32, borderRadius: '50%', background: c, border: branding.accentColor === c ? '3px solid white' : '2px solid transparent',
                      outline: branding.accentColor === c ? `2px solid ${c}` : 'none', cursor: 'pointer',
                    }}
                  />
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Save button */}
        <div style={{ position: 'sticky', bottom: 80, paddingBottom: 12 }}>
          {error && <div style={{ fontSize: 11, color: 'var(--status-critical)', marginBottom: 8 }}>{error}</div>}
          <button
            className="btn-primary"
            style={{ width: '100%', justifyContent: 'center' }}
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? 'Saving…' : saved ? <><Check size={14} /> Saved!</> : <>Save Customisation</>}
          </button>
        </div>
      </div>
    </div>
  );
}
