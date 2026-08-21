// ============================================================
// settings.tsx — Settings, Accessibility & Appearance
// Data flow: ThemeContext (globals) ← SettingsScreen changes, persisted
//            per-tenant via GET/PATCH /api/settings (issue #256) — theme and
//            font size are applied optimistically on the client for
//            snappiness, then written through to the settings store.
//            Notification/offline toggles and password change are wired to
//            the same store / POST /api/auth/change-password.
//            Navigate links to all major screens from here
// ============================================================
'use client';
import React, { useState, createContext, useContext, useCallback, useEffect } from 'react';
import { useNav, TopNav } from './navigation';
import { useToast } from './ui-shared';
import { apiClient } from '@/lib/request';
import { ChevronRight, LogOut, Check, X, Lock, Eye, EyeOff } from './icons';

/* ── Theme Context (global, used by globals.css overrides) ── */
export type ThemeMode = 'dark-farm' | 'high-contrast' | 'light-farm' | 'sun-mode';
export type FontSize = 'small' | 'normal' | 'large' | 'xlarge';

interface ThemeCtxShape {
  theme: ThemeMode;
  fontSize: FontSize;
  setTheme: (t: ThemeMode) => void;
  setFontSize: (s: FontSize) => void;
}

const ThemeCtx = createContext<ThemeCtxShape>({
  theme: 'light-farm', fontSize: 'normal',
  setTheme: () => {}, setFontSize: () => {},
});

// Pure CSS side-effects for a theme/font choice — no state, no network. Shared
// by the fetch-driven initial load and by user-triggered changes below.
function applyThemeVisuals(t: ThemeMode) {
    const root = document.documentElement;
    if (t === 'high-contrast') {
      root.style.setProperty('--background', '#000000');
      root.style.setProperty('--surface', '#0a0a0a');
      root.style.setProperty('--card', '#111111');
      root.style.setProperty('--text-primary', '#ffffff');
      root.style.setProperty('--text-secondary', '#ffff00');
      root.style.setProperty('--text-muted', '#aaaaaa');
      root.style.setProperty('--primary-green', '#00ff00');
      root.style.setProperty('--border-subtle', 'rgba(255,255,255,0.3)');
    } else if (t === 'light-farm') {
      root.style.setProperty('--background', '#f7f8f5');
      root.style.setProperty('--surface', '#ffffff');
      root.style.setProperty('--card', '#ffffff');
      root.style.setProperty('--text-primary', '#182018');
      root.style.setProperty('--text-secondary', '#3f6b49');
      root.style.setProperty('--text-muted', '#5f685f');
      root.style.setProperty('--text-dim', '#8a9289');
      root.style.setProperty('--primary-green', '#2f6f3e');
      root.style.setProperty('--border-subtle', '#e4e7e1');
    } else if (t === 'sun-mode') {
      // High brightness, warm tones — for outdoor use in strong sunlight
      root.style.setProperty('--background', '#1a1200');
      root.style.setProperty('--surface', '#231800');
      root.style.setProperty('--card', '#2a1e00');
      root.style.setProperty('--text-primary', '#fff9e6');
      root.style.setProperty('--text-secondary', '#fde68a');
      root.style.setProperty('--text-muted', '#d97706');
      root.style.setProperty('--text-dim', '#92400e');
      root.style.setProperty('--primary-green', '#fbbf24');
      root.style.setProperty('--border-subtle', 'rgba(251,191,36,0.2)');
    } else {
      // Restore dark-farm defaults
      root.style.setProperty('--background', '#0a0f0a');
      root.style.setProperty('--surface', '#0f1a0f');
      root.style.setProperty('--card', '#121f12');
      root.style.setProperty('--text-primary', '#f0fdf4');
      root.style.setProperty('--text-secondary', '#86efac');
      root.style.setProperty('--text-muted', '#4b7c52');
      root.style.setProperty('--text-dim', '#2d4a30');
      root.style.setProperty('--primary-green', '#4ade80');
      root.style.setProperty('--border-subtle', 'rgba(255,255,255,0.07)');
    }
}

function applyFontSizeVisuals(s: FontSize) {
  const sizes: Record<FontSize, string> = { small: '87.5%', normal: '100%', large: '112.5%', xlarge: '125%' };
  document.documentElement.style.fontSize = sizes[s];
}

export function ThemeProvider({ children, tenantId }: { children: React.ReactNode; tenantId?: string | null }) {
  const [theme, setThemeState] = useState<ThemeMode>('light-farm');
  const [fontSize, setFontSizeState] = useState<FontSize>('normal');

  // Re-apply CSS overrides whenever the local value changes, whether that
  // change came from the server fetch below or a user pick — one code path.
  useEffect(() => { applyThemeVisuals(theme); }, [theme]);
  useEffect(() => { applyFontSizeVisuals(fontSize); }, [fontSize]);

  // Load the tenant's persisted theme/font size once we know which tenant we
  // are (issue #256): the per-tenant settings store is the source of truth,
  // not a pure local useState — this fetch is what makes a choice survive a
  // refresh or show up on a second device for the same tenant.
  useEffect(() => {
    if (!tenantId) return;
    let cancelled = false;
    apiClient
      .get<{ theme?: ThemeMode; fontSize?: FontSize }>(`/api/settings?tenantId=${tenantId}`)
      .then((res) => {
        if (cancelled || !res.success) return;
        if (res.data.theme) setThemeState(res.data.theme);
        if (res.data.fontSize) setFontSizeState(res.data.fontSize);
      });
    return () => { cancelled = true; };
  }, [tenantId]);

  // User-triggered changes: apply immediately (optimistic, for snappiness),
  // persist to the tenant settings store in the background. A failed PATCH
  // is logged but doesn't roll back the visual change — theme/font size are
  // low-stakes enough that "looks right now, retry the write next change" beats
  // snapping the UI back under the user.
  const setTheme = useCallback((t: ThemeMode) => {
    setThemeState(t);
    if (!tenantId) return;
    apiClient.patch(`/api/settings?tenantId=${tenantId}`, { theme: t }).then((res) => {
      if (!res.success) console.error('Failed to persist theme:', res.error);
    });
  }, [tenantId]);

  const setFontSize = useCallback((s: FontSize) => {
    setFontSizeState(s);
    if (!tenantId) return;
    apiClient.patch(`/api/settings?tenantId=${tenantId}`, { fontSize: s }).then((res) => {
      if (!res.success) console.error('Failed to persist font size:', res.error);
    });
  }, [tenantId]);

  return (
    <ThemeCtx.Provider value={{ theme, fontSize, setTheme, setFontSize }}>
      {children}
    </ThemeCtx.Provider>
  );
}

export function useTheme() { return useContext(ThemeCtx); }

/* ── SettingsScreen ── */
const THEME_OPTIONS: { id: ThemeMode; label: string; desc: string; preview: string }[] = [
  { id: 'dark-farm',      label: '🌑 Dark Farm',       desc: 'Optional low-light view', preview: '#0a0f0a' },
  { id: 'high-contrast',  label: '⬛ High Contrast',    desc: 'Black & white, maximum legibility', preview: '#000000' },
  { id: 'light-farm',     label: '☀️ Light Farm',       desc: 'Default operational view', preview: '#f7f8f5' },
  { id: 'sun-mode',       label: '🌅 Outdoor / Sun',    desc: 'Warm amber tones for bright sunlight', preview: '#2a1e00' },
];

const FONT_OPTIONS: { id: FontSize; label: string; size: string }[] = [
  { id: 'small',  label: 'A',  size: '13px' },
  { id: 'normal', label: 'A',  size: '15px' },
  { id: 'large',  label: 'A',  size: '17px' },
  { id: 'xlarge', label: 'A',  size: '19px' },
];

// Shape returned by GET /api/settings (db/schemas/settings.ts's tenantSettings,
// trimmed to what this screen reads/writes).
interface ApiSettings {
  notificationsEnabled: boolean;
  soundAlertsEnabled: boolean;
  offlineModeEnabled: boolean;
}

export function SettingsScreen({ onLogout }: { onLogout?: () => void }) {
  const { navigate, role, tenantId, pendingApprovals } = useNav();
  const { showToast } = useToast();
  const { theme, setTheme, fontSize, setFontSize } = useTheme();
  const [settings, setSettings] = useState<ApiSettings | null>(null);
  const [showPasswordModal, setShowPasswordModal] = useState(false);

  const loadSettings = useCallback(() => {
    apiClient.get<ApiSettings>(`/api/settings?tenantId=${tenantId}`).then((res) => {
      if (res.success) setSettings(res.data);
    });
  }, [tenantId]);

  useEffect(() => { loadSettings(); }, [loadSettings]);

  const notifications = settings?.notificationsEnabled ?? true;
  const offline = settings?.offlineModeEnabled ?? true;
  const soundAlerts = settings?.soundAlertsEnabled ?? false;

  // Toggles are optimistic (flip immediately), then persisted per-tenant via
  // PATCH /api/settings — this is a tenant-wide record (issue #255), so a
  // failed write (e.g. a non-owner/admin role, which the backend 403s) rolls
  // the toggle back and says why instead of pretending it worked.
  function toggleSetting(key: keyof ApiSettings) {
    if (!settings) return;
    const next = { ...settings, [key]: !settings[key] };
    setSettings(next);
    apiClient.patch(`/api/settings?tenantId=${tenantId}`, { [key]: next[key] }).then((res) => {
      if (!res.success) {
        setSettings((s) => (s ? { ...s, [key]: !next[key] } : s));
        showToast(res.error || 'Only the farm owner or admin can change this setting.', 'error');
      }
    });
  }

  const sections: {
    label: string;
    items: { label: string; desc?: string; action?: () => void; badge?: string; toggle?: boolean; value?: boolean; onToggle?: () => void }[];
  }[] = [
    {
      label: 'Farm Management',
      items: [
        { label: '📦 Inventory', desc: 'Stock, lots & purchases', action: () => navigate('inventory') },
        { label: '🌤️ Weather & IoT', desc: 'Forecast & sensor alerts', action: () => navigate('weather') },
        { label: '👥 People & Staff', desc: 'Employees & role assignment', action: () => navigate('people') },
        // Real count from NavCtx's `pendingApprovals` (GET /api/approvals?status=pending,
        // issue #293) — reused, not re-fetched a second time (issue #298). No
        // badge (not a fake "0 pending") when the tenant has none pending.
        { label: '🛡️ Governance', desc: 'Approvals, roles & audit', action: () => navigate('governance'), badge: pendingApprovals > 0 ? `${pendingApprovals} pending` : undefined },
        { label: '📊 Reports', desc: 'Export, share & auditor links', action: () => navigate('reports') },
        { label: '🤖 AI Farm Assistant', desc: 'Smart farm advisor chatbot', action: () => navigate('ai-chat') },
        ...(role === 'super_admin' || role === 'owner' ? [{ label: '🎨 UI Customise', desc: 'Module toggles & farm branding', action: () => navigate('ui-customise') }] : []),
      ],
    },
    {
      label: 'Notifications',
      items: [
        { label: 'Push Notifications', desc: 'Alerts, approvals, task reminders', toggle: true, value: notifications, onToggle: () => toggleSetting('notificationsEnabled') },
        { label: 'Sound Alerts', desc: 'Audible alerts for critical events', toggle: true, value: soundAlerts, onToggle: () => toggleSetting('soundAlertsEnabled') },
        { label: 'Notification Settings', desc: 'Per-type controls, SMS, quiet hours', action: () => navigate('notification-settings') },
      ],
    },
    {
      label: 'Offline & Sync',
      items: [
        { label: 'Offline Mode', desc: 'Cache data for use without internet', toggle: true, value: offline, onToggle: () => toggleSetting('offlineModeEnabled') },
        { label: 'Sync Now', desc: 'Force sync with server', action: () => {} },
      ],
    },
    {
      label: 'Security',
      items: [
        { label: 'Change Password', action: () => setShowPasswordModal(true) },
        { label: 'Security & access', desc: 'Worker PINs, signed-in devices & backup', action: () => navigate('security-settings') },
      ],
    },
    {
      label: 'App',
      items: [
        { label: 'Help & Support', action: () => {} },
        { label: 'About IFMS', desc: 'Version 2.1.0 — Build 2026.08', action: () => {} },
        { label: 'Privacy Policy', action: () => {} },
      ],
    },
  ];

  return (
    <div className="screen-content">
      <TopNav title="More" subtitle="Settings & configuration" showBell />
      <div className="px-screen" style={{ paddingTop: 14 }}>

        {/* Profile card */}
        <button onClick={() => navigate('people')} className="farm-card farm-card-active" style={{ padding: 14, marginBottom: 16, display: 'flex', gap: 12, alignItems: 'center', width: '100%', textAlign: 'left', cursor: 'pointer' }}>
          <div style={{ width: 52, height: 52, borderRadius: '50%', background: 'rgba(251,191,36,0.2)', border: '2px solid rgba(251,191,36,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, fontWeight: 700, color: 'var(--accent-amber)', flexShrink: 0 }}>JK</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--text-primary)' }}>James Kamau</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
              {role === 'owner' ? 'Owner' : role === 'manager' ? 'Manager' : role === 'worker' ? 'Worker' : role === 'super_admin' ? 'Platform Admin' : 'Staff'} · Nakuru Farm
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
              <span className="chip chip-warning" style={{ fontSize: 9 }}>{role.toUpperCase()}</span>
              <span className="chip chip-ok" style={{ fontSize: 9 }}>PRO PLAN</span>
            </div>
          </div>
          <ChevronRight size={16} color="var(--text-muted)" />
        </button>

        {/* ── Appearance ── */}
        <div style={{ marginBottom: 16 }}>
          <div className="section-eyebrow" style={{ marginBottom: 10 }}>Appearance & Accessibility</div>

          {/* Theme picker */}
          <div className="farm-card" style={{ padding: 14, marginBottom: 10 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 10 }}>Colour Theme</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              {THEME_OPTIONS.map(t => (
                <button key={t.id} onClick={() => setTheme(t.id)}
                  style={{ padding: '10px 12px', borderRadius: 12, cursor: 'pointer', textAlign: 'left',
                    background: theme === t.id ? 'rgba(74,222,128,0.12)' : 'var(--surface)',
                    border: theme === t.id ? '2px solid var(--primary-green)' : '1px solid var(--border-subtle)' }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4 }}>
                    <div style={{ width: 16, height: 16, borderRadius: 4, background: t.preview, border: '1px solid rgba(255,255,255,0.2)', flexShrink: 0 }} />
                    <div style={{ fontSize: 11, fontWeight: 700, color: theme === t.id ? 'var(--primary-green)' : 'var(--text-primary)' }}>{t.label}</div>
                  </div>
                  <div style={{ fontSize: 9, color: 'var(--text-dim)', lineHeight: 1.4 }}>{t.desc}</div>
                  {theme === t.id && <Check size={11} color="var(--primary-green)" style={{ marginTop: 4 }} />}
                </button>
              ))}
            </div>
          </div>

          {/* Font size picker */}
          <div className="farm-card" style={{ padding: 14, marginBottom: 10 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 10 }}>Text Size</div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <span style={{ fontSize: 10, color: 'var(--text-dim)' }}>Aa</span>
              <div style={{ flex: 1, display: 'flex', gap: 6 }}>
                {FONT_OPTIONS.map(f => (
                  <button key={f.id} onClick={() => setFontSize(f.id)}
                    style={{ flex: 1, padding: '10px 4px', borderRadius: 10, cursor: 'pointer', border: 'none',
                      background: fontSize === f.id ? 'rgba(74,222,128,0.15)' : 'var(--surface)',
                      outline: fontSize === f.id ? '2px solid var(--primary-green)' : '2px solid transparent' }}>
                    <span style={{ fontSize: f.size, fontWeight: 700, color: fontSize === f.id ? 'var(--primary-green)' : 'var(--text-muted)' }}>{f.label}</span>
                  </button>
                ))}
              </div>
              <span style={{ fontSize: 16, color: 'var(--text-dim)' }}>Aa</span>
            </div>
            <div style={{ marginTop: 8, fontSize: 10, color: 'var(--text-dim)', textAlign: 'center' }}>
              Larger text helps in bright sunlight or for low-vision users
            </div>
          </div>

          {/* Info strip */}
          <div style={{ padding: '10px 14px', background: 'rgba(96,165,250,0.06)', border: '1px solid rgba(96,165,250,0.15)', borderRadius: 12, fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.5 }}>
            💡 <strong>Sun Mode</strong> uses warm amber tones visible in bright outdoor sunlight. <strong>High Contrast</strong> maximises legibility for visually impaired users.
          </div>
        </div>

        {/* Sections */}
        {sections.map((sec) => (
          <div key={sec.label} style={{ marginBottom: 16 }}>
            <div className="section-eyebrow" style={{ marginBottom: 8 }}>{sec.label}</div>
            <div className="farm-card" style={{ overflow: 'hidden' }}>
              {sec.items.map((item, i) => (
                <div key={item.label} onClick={item.action}
                  style={{ padding: '13px 14px', display: 'flex', alignItems: 'center', gap: 12,
                    borderBottom: i < sec.items.length - 1 ? '1px solid var(--border-subtle)' : 'none',
                    cursor: item.action ? 'pointer' : 'default' }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{item.label}</div>
                    {item.desc && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 1 }}>{item.desc}</div>}
                  </div>
                  {item.badge && <span className="chip chip-warning" style={{ fontSize: 9 }}>{item.badge}</span>}
                  {item.toggle ? (
                    <button onClick={(e) => { e.stopPropagation(); item.onToggle?.(); }}
                      style={{ width: 44, height: 24, borderRadius: 100, border: 'none', cursor: 'pointer',
                        background: item.value ? 'var(--primary-green)' : 'rgba(255,255,255,0.1)',
                        position: 'relative', padding: 0, flexShrink: 0 }}>
                      <div style={{ width: 18, height: 18, borderRadius: '50%', background: '#fff',
                        position: 'absolute', top: 3, left: item.value ? 23 : 3, transition: 'left 0.2s' }} />
                    </button>
                  ) : item.action ? (
                    <ChevronRight size={16} color="var(--text-dim)" />
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        ))}

        {/* Logout */}
        <button onClick={onLogout} style={{ width: '100%', padding: '14px', borderRadius: 14, fontSize: 14, fontWeight: 700,
          background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.25)',
          color: 'var(--status-critical)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 24 }}>
          <LogOut size={16} /> Sign Out
        </button>
      </div>

      {showPasswordModal && <ChangePasswordSheet onClose={() => setShowPasswordModal(false)} />}
    </div>
  );
}

/* ── Change Password sheet — real POST /api/auth/change-password (issue #256).
 * Same bottom-sheet shell used elsewhere in the app (e.g. RecordPurchaseSheet
 * in inventory.tsx). ── */
function ChangePasswordSheet({ onClose }: { onClose: () => void }) {
  const { showToast } = useToast();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPasswords, setShowPasswords] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function save() {
    if (!currentPassword) { setError('Current password is required.'); return; }
    if (newPassword.length < 8) { setError('New password must be at least 8 characters.'); return; }
    if (newPassword !== confirmPassword) { setError('New password and confirmation do not match.'); return; }
    if (newPassword === currentPassword) { setError('New password must be different from the current password.'); return; }

    setSaving(true);
    setError('');
    const res = await apiClient.post('/api/auth/change-password', { currentPassword, newPassword });
    setSaving(false);
    if (res.success) {
      showToast('Password changed.', 'success');
      onClose();
    } else {
      setError(res.error || 'Failed to change password.');
    }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.78)', display: 'flex', alignItems: 'flex-end', zIndex: 210 }} onClick={onClose}>
      <div style={{ background: 'var(--surface)', borderRadius: '24px 24px 0 0', padding: 20, width: '100%', border: '1px solid var(--border-subtle)', maxHeight: '85%', overflowY: 'auto' }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <div style={{ fontWeight: 700, fontSize: 16, display: 'flex', alignItems: 'center', gap: 8 }}><Lock size={16} /> Change Password</div>
          <button className="btn-icon" onClick={onClose}><X size={16} /></button>
        </div>

        <div style={{ marginBottom: 12 }}>
          <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', display: 'block', marginBottom: 5 }}>Current Password *</label>
          <input className="farm-input" type={showPasswords ? 'text' : 'password'} value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} autoFocus />
        </div>
        <div style={{ marginBottom: 12 }}>
          <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', display: 'block', marginBottom: 5 }}>New Password *</label>
          <input className="farm-input" type={showPasswords ? 'text' : 'password'} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
        </div>
        <div style={{ marginBottom: 8 }}>
          <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', display: 'block', marginBottom: 5 }}>Confirm New Password *</label>
          <input className="farm-input" type={showPasswords ? 'text' : 'password'} value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} />
        </div>
        <button onClick={() => setShowPasswords((s) => !s)} style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', gap: 6, alignItems: 'center', fontSize: 11, color: 'var(--text-muted)', marginBottom: 12, padding: 0 }}>
          {showPasswords ? <EyeOff size={12} /> : <Eye size={12} />} {showPasswords ? 'Hide' : 'Show'} passwords
        </button>

        <div style={{ fontSize: 10, color: 'var(--text-dim)', marginBottom: 12, lineHeight: 1.4 }}>
          Minimum 8 characters. Applies to owner/manager accounts — workers sign in with a PIN.
        </div>

        {error && <div style={{ fontSize: 11, color: 'var(--status-critical)', marginBottom: 10 }}>{error}</div>}
        <button className="btn-primary" style={{ width: '100%', justifyContent: 'center' }} disabled={saving} onClick={save}>
          {saving ? 'Saving…' : 'Change Password'}
        </button>
      </div>
    </div>
  );
}

interface WorkerPinAccount {
  id: string;
  name: string;
  email: string;
  status: string;
  hasPin: boolean;
}

interface SessionSummary {
  createdAt: string | null;
  expiresAt: string;
  current: boolean;
}

/* ── Security & access ──
 * The previous Settings rows were either a redirect to the general People
 * screen or inert. This focused workspace exposes the actual security tasks
 * and talks only to the tenant-scoped security APIs. */
export function SecuritySettingsScreen() {
  const { role } = useNav();
  const { showToast } = useToast();
  const [workers, setWorkers] = useState<WorkerPinAccount[] | null>(null);
  const [sessions, setSessions] = useState<SessionSummary[] | null>(null);
  const [selectedWorkerId, setSelectedWorkerId] = useState('');
  const [newPin, setNewPin] = useState('');
  const [pinSaving, setPinSaving] = useState(false);
  const [sessionSaving, setSessionSaving] = useState(false);
  const [backupSaving, setBackupSaving] = useState(false);

  const canManagePins = role === 'owner' || role === 'manager';
  const canDownloadBackup = role === 'owner';

  const load = useCallback(() => {
    apiClient.get<SessionSummary[]>('/api/security/sessions').then((res) => {
      if (res.success) setSessions(res.data);
      else showToast(res.error || 'Could not load active sessions.', 'error');
    });
    if (canManagePins) {
      apiClient.get<WorkerPinAccount[]>('/api/security/worker-pins').then((res) => {
        if (res.success) {
          setWorkers(res.data);
          setSelectedWorkerId((current) => current || res.data[0]?.id || '');
        } else showToast(res.error || 'Could not load worker accounts.', 'error');
      });
    }
  }, [canManagePins, showToast]);

  useEffect(() => { load(); }, [load]);

  async function rotatePin() {
    if (!selectedWorkerId) { showToast('Select a worker first.', 'error'); return; }
    if (!/^\d{4}$/.test(newPin)) { showToast('Enter an exact 4-digit PIN.', 'error'); return; }
    setPinSaving(true);
    const res = await apiClient.post('/api/security/worker-pins', { userId: selectedWorkerId, pin: newPin });
    setPinSaving(false);
    if (!res.success) { showToast(res.error || 'Could not update the PIN.', 'error'); return; }
    setNewPin('');
    showToast('Worker PIN updated. Share it securely with the worker.', 'success');
    load();
  }

  async function revokeOtherSessions() {
    setSessionSaving(true);
    const res = await apiClient.delete('/api/security/sessions');
    setSessionSaving(false);
    if (!res.success) { showToast(res.error || 'Could not revoke other sessions.', 'error'); return; }
    showToast('Other sessions were signed out.', 'success');
    load();
  }

  async function downloadBackup() {
    setBackupSaving(true);
    try {
      const res = await fetch('/api/security/backup');
      if (!res.ok) {
        const body = await res.json().catch(() => null) as { error?: string } | null;
        throw new Error(body?.error || 'Could not create the farm backup.');
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `ifms-farm-backup-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      URL.revokeObjectURL(url);
      showToast('Farm backup downloaded.', 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not create the farm backup.', 'error');
    } finally {
      setBackupSaving(false);
    }
  }

  const otherSessionCount = sessions?.filter((session) => !session.current).length ?? 0;
  return (
    <div className="screen-content">
      <TopNav title="Security & access" subtitle="Credentials, sessions and data protection" showBack />
      <div className="px-screen" style={{ paddingTop: 14, paddingBottom: 88 }}>
        {canManagePins && (
          <section style={{ marginBottom: 18 }}>
            <div className="section-eyebrow" style={{ marginBottom: 8 }}>Worker PINs</div>
            <div className="farm-card" style={{ padding: 14 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 3 }}>Reset worker sign-in PIN</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.45, marginBottom: 12 }}>PINs are never displayed. Set a new four-digit PIN and share it with the worker privately.</div>
              {workers === null ? <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Loading worker accounts…</div> : workers.length === 0 ? <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>No worker login accounts are available for this farm.</div> : <>
                <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', display: 'block', marginBottom: 5 }}>Worker</label>
                <select className="farm-input" value={selectedWorkerId} onChange={(event) => setSelectedWorkerId(event.target.value)} style={{ marginBottom: 10 }}>
                  {workers.map((worker) => <option key={worker.id} value={worker.id}>{worker.name} · {worker.hasPin ? 'PIN set' : 'Needs PIN'}</option>)}
                </select>
                <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', display: 'block', marginBottom: 5 }}>New 4-digit PIN</label>
                <input className="farm-input" inputMode="numeric" pattern="[0-9]*" maxLength={4} type="password" value={newPin} onChange={(event) => setNewPin(event.target.value.replace(/\D/g, ''))} placeholder="••••" style={{ marginBottom: 10 }} />
                <button className="btn-primary" onClick={rotatePin} disabled={pinSaving} style={{ width: '100%', justifyContent: 'center' }}>{pinSaving ? 'Updating…' : 'Update worker PIN'}</button>
              </>}
            </div>
          </section>
        )}

        <section style={{ marginBottom: 18 }}>
          <div className="section-eyebrow" style={{ marginBottom: 8 }}>Active sessions</div>
          <div className="farm-card" style={{ padding: 14 }}>
            {sessions === null ? <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Loading signed-in sessions…</div> : <>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>{sessions.length} active session{sessions.length === 1 ? '' : 's'}</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 3, lineHeight: 1.45 }}>This device stays signed in. You can safely end every other session for your account.</div>
              {otherSessionCount > 0 && <button className="btn-secondary" onClick={revokeOtherSessions} disabled={sessionSaving} style={{ marginTop: 12, width: '100%', justifyContent: 'center' }}>{sessionSaving ? 'Signing out…' : `Sign out ${otherSessionCount} other session${otherSessionCount === 1 ? '' : 's'}`}</button>}
            </>}
          </div>
        </section>

        <section>
          <div className="section-eyebrow" style={{ marginBottom: 8 }}>Farm backup</div>
          <div className="farm-card" style={{ padding: 14 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>Download operational data</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 3, lineHeight: 1.45 }}>Exports farms, batches, work, inventory, finance and audit data as JSON. Passwords, PINs and session tokens are excluded.</div>
            {canDownloadBackup ? <button className="btn-primary" onClick={downloadBackup} disabled={backupSaving} style={{ width: '100%', justifyContent: 'center', marginTop: 12 }}>{backupSaving ? 'Preparing backup…' : 'Download farm backup'}</button> : <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 10 }}>Only the farm owner can download a full backup.</div>}
          </div>
        </section>
      </div>
    </div>
  );
}
