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
import { requestTour } from './tour';
import { apiClient } from '@/lib/request';
import {
  ChevronRight, LogOut, Check, X, Lock, Eye, EyeOff,
  Package, CloudSun, Users, Shield, FileText, Bot, Palette,
  Moon, Contrast, Sun, Sunrise, Lightbulb, Info, HelpCircle,
  type LucideIcon,
} from './icons';
import { DATE_FORMATS, DEFAULT_DATE_FORMAT, DEFAULT_TIMEZONE, type DateFormat } from '@/lib/datetime';

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

/* ── Regional Context (settings-reorg) ──
 * timezone/dateFormat, fetched alongside theme/fontSize in the same
 * GET /api/settings call ThemeProvider already makes — no second round
 * trip. Consumed by components/farm/status-timeline.tsx (via useRegional())
 * so audit-log timestamps render in the tenant's own zone/day-order instead
 * of a hardcoded locale, wherever that shared component is used. */
interface RegionalCtxShape {
  timezone: string;
  dateFormat: DateFormat;
}
const RegionalCtx = createContext<RegionalCtxShape>({
  timezone: DEFAULT_TIMEZONE,
  dateFormat: DEFAULT_DATE_FORMAT,
});
export function useRegional() { return useContext(RegionalCtx); }

// Applies a theme choice to the DOM — the piece that was entirely missing
// before this task: picking a theme changed tenant_settings.theme and
// nothing else, because nothing ever set a class or attribute from it.
// `data-theme` on <html> is the one thing this needs to set; every actual
// colour lives in app/global.css's `:root[data-theme='…']` blocks, so this
// function doesn't know or care what a theme looks like — it can't drift
// out of sync with the CSS the way the previous version's ~30 scattered
// `.style.setProperty()` calls could (and did: that version only ever
// touched 8 of the app's colour tokens, so most of the UI never changed
// theme at all).
function applyThemeVisuals(t: ThemeMode) {
  document.documentElement.dataset.theme = t;
}

function applyFontSizeVisuals(s: FontSize) {
  const sizes: Record<FontSize, string> = { small: '87.5%', normal: '100%', large: '112.5%', xlarge: '125%' };
  document.documentElement.style.fontSize = sizes[s];
}

export function ThemeProvider({ children, tenantId }: { children: React.ReactNode; tenantId?: string | null }) {
  const [theme, setThemeState] = useState<ThemeMode>('light-farm');
  const [fontSize, setFontSizeState] = useState<FontSize>('normal');
  const [timezone, setTimezone] = useState<string>(DEFAULT_TIMEZONE);
  const [dateFormat, setDateFormat] = useState<DateFormat>(DEFAULT_DATE_FORMAT);

  // Re-apply CSS overrides whenever the local value changes, whether that
  // change came from the server fetch below or a user pick — one code path.
  useEffect(() => { applyThemeVisuals(theme); }, [theme]);
  useEffect(() => { applyFontSizeVisuals(fontSize); }, [fontSize]);

  // Load the tenant's persisted theme/font size/regional settings once we
  // know which tenant we are (issue #256, extended by settings-reorg): the
  // per-tenant settings store is the source of truth, not a pure local
  // useState — this fetch is what makes a choice survive a refresh or show
  // up on a second device for the same tenant.
  useEffect(() => {
    if (!tenantId) return;
    let cancelled = false;
    apiClient
      .get<{ theme?: ThemeMode; fontSize?: FontSize; timezone?: string; dateFormat?: DateFormat }>(`/api/settings?tenantId=${tenantId}`)
      .then((res) => {
        if (cancelled || !res.success) return;
        if (res.data.theme) setThemeState(res.data.theme);
        if (res.data.fontSize) setFontSizeState(res.data.fontSize);
        if (res.data.timezone) setTimezone(res.data.timezone);
        if (res.data.dateFormat) setDateFormat(res.data.dateFormat);
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
      <RegionalCtx.Provider value={{ timezone, dateFormat }}>
        {children}
      </RegionalCtx.Provider>
    </ThemeCtx.Provider>
  );
}

export function useTheme() { return useContext(ThemeCtx); }

/* ── SettingsScreen ── */
const THEME_OPTIONS: { id: ThemeMode; label: string; desc: string; preview: string; icon: LucideIcon }[] = [
  { id: 'dark-farm',      label: 'Dark Farm',       desc: 'Optional low-light view', preview: '#0a0f0a', icon: Moon },
  { id: 'high-contrast',  label: 'High Contrast',    desc: 'Black & white, maximum legibility', preview: '#000000', icon: Contrast },
  { id: 'light-farm',     label: 'Light Farm',       desc: 'Default operational view', preview: '#f7f8f5', icon: Sun },
  { id: 'sun-mode',       label: 'Outdoor / Sun',    desc: 'Warm amber tones for bright sunlight', preview: '#2a1e00', icon: Sunrise },
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
  currencySymbol: string;
  weightUnit: string;
  timezone: string;
  dateFormat: DateFormat;
  sessionTimeoutMinutes: number | null;
}

const CURRENCY_OPTIONS = ['KSh', 'UGX', 'TZS', 'USD', 'EUR', 'ZAR', 'NGN'];
const WEIGHT_UNIT_OPTIONS = ['kg', 'lbs', 'tonnes'];

// A curated, real subset of IANA zones this app's farms plausibly run in —
// not exhaustive, but every value here is a real zone name the backend's
// isValidTimezone (lib/datetime.ts, backed by Intl.supportedValuesOf) also
// accepts, so picking one always saves.
const TIMEZONE_OPTIONS: { value: string; label: string }[] = [
  { value: 'Africa/Nairobi', label: 'Nairobi (EAT, UTC+3)' },
  { value: 'Africa/Kampala', label: 'Kampala (EAT, UTC+3)' },
  { value: 'Africa/Dar_es_Salaam', label: 'Dar es Salaam (EAT, UTC+3)' },
  { value: 'Africa/Kigali', label: 'Kigali (CAT, UTC+2)' },
  { value: 'Africa/Johannesburg', label: 'Johannesburg (SAST, UTC+2)' },
  { value: 'Africa/Lagos', label: 'Lagos (WAT, UTC+1)' },
  { value: 'Africa/Cairo', label: 'Cairo (EET, UTC+2)' },
  { value: 'Europe/London', label: 'London (GMT/BST)' },
  { value: 'UTC', label: 'UTC' },
];

const DATE_FORMAT_OPTIONS: { value: DateFormat; label: string }[] = DATE_FORMATS.map((f) => ({
  value: f,
  label: f === 'DD/MM/YYYY' ? 'DD/MM/YYYY (22/08/2026)' : f === 'MM/DD/YYYY' ? 'MM/DD/YYYY (08/22/2026)' : 'YYYY-MM-DD (2026-08-22)',
}));

// null = platform default (30-day session); every other option is minutes.
// Kept as discrete, sane choices rather than a free-text number field — the
// backend (app/api/settings/route.ts) still enforces the real bounds
// (lib/auth.ts's MIN/MAX_SESSION_TIMEOUT_MINUTES) independently of this list.
const SESSION_TIMEOUT_OPTIONS: { value: string; label: string }[] = [
  { value: 'default', label: 'Default (30 days)' },
  { value: '15', label: '15 minutes' },
  { value: '30', label: '30 minutes' },
  { value: '60', label: '1 hour' },
  { value: '240', label: '4 hours' },
  { value: '480', label: '8 hours (a work day)' },
  { value: '1440', label: '24 hours' },
  { value: '10080', label: '7 days' },
];

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
  const currencySymbol = settings?.currencySymbol ?? 'KSh';
  const weightUnit = settings?.weightUnit ?? 'kg';
  const timezone = settings?.timezone ?? 'Africa/Nairobi';
  const dateFormat = settings?.dateFormat ?? 'DD/MM/YYYY';
  const sessionTimeoutMinutes = settings?.sessionTimeoutMinutes ?? null;

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

  // Same optimistic/rollback shape as toggleSetting, generalised to any
  // scalar field (currency, weight unit, timezone, date format, session
  // timeout) instead of just booleans.
  function updateSetting<K extends keyof ApiSettings>(key: K, value: ApiSettings[K]) {
    if (!settings) return;
    const prev = settings[key];
    setSettings({ ...settings, [key]: value });
    apiClient.patch(`/api/settings?tenantId=${tenantId}`, { [key]: value }).then((res) => {
      if (!res.success) {
        setSettings((s) => (s ? { ...s, [key]: prev } : s));
        showToast(res.error || 'Only the farm owner or admin can change this setting.', 'error');
      }
    });
  }

  type SettingsRow = {
    label: string; desc?: string; action?: () => void; badge?: string; icon?: LucideIcon;
    toggle?: boolean; value?: boolean; onToggle?: () => void;
    select?: { value: string; options: { value: string; label: string }[]; onChange: (v: string) => void };
  };

  // Destinations the desktop sidebar (components/farm/navigation.tsx's
  // AppSidebar) already lists as first-class items for owner/manager —
  // Inventory, Weather, People, Governance and Reports. Showing them again
  // here meant every one of those appeared TWICE on desktop, under two
  // different labels ("More" here, its own sidebar entry there). Wrapped in
  // .settings-hub-mobile-only below (app/global.css) so this stays mobile's
  // "More" menu — its only job once a sidebar exists — without losing the
  // one thing that has no sidebar or other equivalent: AI Farm Assistant
  // does have a Dashboard quick-action on every breakpoint, but Governance/
  // Reports/etc. would otherwise vanish outright below 768px, not just get
  // decluttered.
  const mobileHubItems: SettingsRow[] = [
    { label: 'Inventory', icon: Package, desc: 'Stock, lots & purchases', action: () => navigate('inventory') },
    { label: 'Weather & IoT', icon: CloudSun, desc: 'Forecast & sensor alerts', action: () => navigate('weather') },
    { label: 'People & Staff', icon: Users, desc: 'Employees & role assignment', action: () => navigate('people') },
    // Where an owner says what a "morning round" is. The worker app has
    // always had the tile; this is the definition behind it.
    { label: 'Daily routines', icon: Sunrise, desc: 'What your workers are asked to do each round', action: () => navigate('routines') },
    // Real count from NavCtx's `pendingApprovals` (GET /api/approvals?status=pending,
    // issue #293) — reused, not re-fetched a second time (issue #298). No
    // badge (not a fake "0 pending") when the tenant has none pending.
    { label: 'Governance', icon: Shield, desc: 'Approvals, roles & audit', action: () => navigate('governance'), badge: pendingApprovals > 0 ? `${pendingApprovals} pending` : undefined },
    { label: 'Reports', icon: FileText, desc: 'Export, share & auditor links', action: () => navigate('reports') },
    { label: 'AI Farm Assistant', icon: Bot, desc: 'Smart farm advisor chatbot', action: () => navigate('ai-chat') },
  ];

  const sections: { label: string; items: SettingsRow[] }[] = [
    // UI Customise has no sidebar entry anywhere and no other path to it —
    // unlike the mobileHubItems above, hiding this on desktop would strand
    // an owner/super_admin's only way to reach it, not just declutter a
    // duplicate. Kept visible on every breakpoint, still gated the same way
    // its old "Farm Management" row was.
    ...(role === 'super_admin' || role === 'owner' ? [{
      label: 'Customisation',
      items: [{ label: 'UI Customise', icon: Palette, desc: 'Module toggles & farm branding', action: () => navigate('ui-customise') }],
    }] : []),
    {
      // Currency/weight unit used to live inside UI Customise's "branding"
      // tab, gated the same as UI Customise itself — but they are
      // operational (every amount and weight in the app displays in them),
      // not branding, and every role that can see Settings should at least
      // see what they're set to. Timezone/date format are new: every record
      // in this app is timestamped and there was previously no way to say
      // what zone a farm runs in. All four write through the same
      // owner/super_admin-gated PATCH the rest of this screen already uses.
      label: 'Regional & Units',
      items: [
        { label: 'Currency', desc: 'Used wherever an amount is displayed', select: { value: currencySymbol, options: CURRENCY_OPTIONS.map((c) => ({ value: c, label: c })), onChange: (v) => updateSetting('currencySymbol', v) } },
        { label: 'Weight unit', desc: 'Used wherever a weight is displayed', select: { value: weightUnit, options: WEIGHT_UNIT_OPTIONS.map((u) => ({ value: u, label: u })), onChange: (v) => updateSetting('weightUnit', v) } },
        { label: 'Timezone', desc: 'Used to render every timestamp in the app', select: { value: timezone, options: TIMEZONE_OPTIONS, onChange: (v) => updateSetting('timezone', v) } },
        { label: 'Date format', desc: 'Day/month order for displayed dates', select: { value: dateFormat, options: DATE_FORMAT_OPTIONS, onChange: (v) => updateSetting('dateFormat', v as DateFormat) } },
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
        // 'Sync Now' used to sit here (action: () => {}) — there is no
        // offline cache/sync engine anywhere in this codebase for it to
        // trigger (no service worker, no IndexedDB queue), so it did
        // nothing but looked functional beside a toggle that actually
        // persists. Removed rather than wired to a fake delay/spinner.
      ],
    },
    {
      label: 'Security',
      items: [
        { label: 'Change Password', action: () => setShowPasswordModal(true) },
        { label: 'Security & access', desc: 'Worker PINs, signed-in devices & backup', action: () => navigate('security-settings') },
        // Farm offices share devices — this bounds how long a session
        // issued to this tenant stays valid (enforced in
        // app/api/auth/login/route.ts at sign-in time, not just stored).
        { label: 'Session timeout', desc: 'How long a shared device stays signed in', select: { value: sessionTimeoutMinutes === null ? 'default' : String(sessionTimeoutMinutes), options: SESSION_TIMEOUT_OPTIONS, onChange: (v) => updateSetting('sessionTimeoutMinutes', v === 'default' ? null : Number(v)) } },
      ],
    },
    {
      label: 'App',
      items: [
        // Help & Support and Privacy Policy used to sit here as
        // action: () => {} — no real support address or privacy policy
        // exists to point them at, so they were removed rather than
        // wired to something invented. About IFMS is real: the version
        // below is the actual package.json version, inlined at build
        // time (next.config.ts) — no fabricated build number.
        // The walkthrough runs itself once, on a person's first sign-in, and
        // then never again — which is exactly when it is least useful,
        // because nothing has been set up yet and none of it means anything.
        // This is how you get it back after you have some data to look at.
        // It closes Settings first: the tour points at the navigation, and
        // reading "open Workers" while the Settings list is still covering
        // the screen is the kind of thing that makes a walkthrough feel
        // broken.
        { label: 'Show me around', icon: HelpCircle, desc: 'Replay the guided walkthrough of the app', action: () => { navigate('dashboard'); requestTour(); } },
        // This row has always been inert — it described the About screen and
        // never opened it, which made it read as a dead label rather than a
        // link. AboutScreen has existed and been routed the whole time
        // (app/page.tsx's 'about' case); nothing was pointing at it.
        { label: 'About IFMS', icon: Info, desc: `Version ${process.env.NEXT_PUBLIC_APP_VERSION ?? '—'}`, action: () => navigate('about') },
      ],
    },
  ];

  return (
    <div className="screen-content">
      <TopNav title="More" subtitle="Settings & configuration" showBell />
      <div className="px-screen" style={{ paddingTop: 14 }}>

        {/* Profile card */}
        <button onClick={() => navigate('people')} className="farm-card farm-card-active" style={{ padding: 14, marginBottom: 16, display: 'flex', gap: 12, alignItems: 'center', width: '100%', textAlign: 'left', cursor: 'pointer' }}>
          <div style={{ width: 52, height: 52, borderRadius: '50%', background: 'rgba(251,191,36,0.2)', border: '2px solid rgba(251,191,36,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 'var(--fs-2xl)', fontWeight: 700, color: 'var(--accent-amber)', flexShrink: 0 }}>JK</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: 'var(--fs-lg)', color: 'var(--text-primary)' }}>James Kamau</div>
            <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', marginTop: 2 }}>
              {role === 'owner' ? 'Owner' : role === 'manager' ? 'Manager' : role === 'worker' ? 'Worker' : role === 'super_admin' ? 'Platform Admin' : 'Staff'} · Nakuru Farm
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
              <span className="chip chip-warning" style={{ fontSize: 'var(--fs-2xs)' }}>{role.toUpperCase()}</span>
              <span className="chip chip-ok" style={{ fontSize: 'var(--fs-2xs)' }}>PRO PLAN</span>
            </div>
          </div>
          <ChevronRight size={16} color="var(--text-muted)" />
        </button>

        {/* ── Farm Management (mobile-only) ──
         * This is mobile's "More" tab — its whole reason to exist is that a
         * phone has no sidebar. Desktop (>=768px, app/global.css) already
         * lists every one of these as a first-class sidebar item, so showing
         * them again here duplicated five destinations under two different
         * labels. .settings-hub-mobile-only hides this block instead of
         * deleting it — a phone still has no other path to these screens. */}
        <div className="settings-hub-mobile-only" style={{ marginBottom: 16 }}>
          <div className="section-eyebrow" style={{ marginBottom: 8 }}>Farm Management</div>
          <div className="farm-card" style={{ overflow: 'hidden' }}>
            {mobileHubItems.map((item, i) => (
              <div key={item.label} onClick={item.action}
                style={{ padding: '13px 14px', display: 'flex', alignItems: 'center', gap: 12,
                  borderBottom: i < mobileHubItems.length - 1 ? '1px solid var(--border-subtle)' : 'none',
                  cursor: 'pointer' }}>
                {item.icon && <item.icon size={17} color="var(--text-muted)" aria-hidden="true" />}
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 'var(--fs-base)', fontWeight: 600, color: 'var(--text-primary)' }}>{item.label}</div>
                  {item.desc && <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', marginTop: 1 }}>{item.desc}</div>}
                </div>
                {item.badge && <span className="chip chip-warning" style={{ fontSize: 'var(--fs-2xs)' }}>{item.badge}</span>}
                <ChevronRight size={16} color="var(--text-dim)" />
              </div>
            ))}
          </div>
        </div>

        {/* ── Appearance ── */}
        <div style={{ marginBottom: 16 }}>
          <div className="section-eyebrow" style={{ marginBottom: 10 }}>Appearance & Accessibility</div>

          {/* Theme picker */}
          <div className="farm-card" style={{ padding: 14, marginBottom: 10 }}>
            <div style={{ fontSize: 'var(--fs-sm)', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 10 }}>Colour Theme</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              {THEME_OPTIONS.map(t => (
                <button key={t.id} onClick={() => setTheme(t.id)}
                  style={{ padding: '10px 12px', borderRadius: 12, cursor: 'pointer', textAlign: 'left',
                    background: theme === t.id ? 'rgba(74,222,128,0.12)' : 'var(--surface)',
                    border: theme === t.id ? '2px solid var(--primary-green)' : '1px solid var(--border-subtle)' }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4 }}>
                    <div style={{ width: 16, height: 16, borderRadius: 4, background: t.preview, border: '1px solid rgba(255,255,255,0.2)', flexShrink: 0 }} />
                    <t.icon size={13} color={theme === t.id ? 'var(--primary-green)' : 'var(--text-primary)'} aria-hidden="true" />
                    <div style={{ fontSize: 'var(--fs-xs)', fontWeight: 700, color: theme === t.id ? 'var(--primary-green)' : 'var(--text-primary)' }}>{t.label}</div>
                  </div>
                  <div style={{ fontSize: 'var(--fs-2xs)', color: 'var(--text-dim)', lineHeight: 1.4 }}>{t.desc}</div>
                  {theme === t.id && <Check size={11} color="var(--primary-green)" style={{ marginTop: 4 }} />}
                </button>
              ))}
            </div>
          </div>

          {/* Font size picker */}
          <div className="farm-card" style={{ padding: 14, marginBottom: 10 }}>
            <div style={{ fontSize: 'var(--fs-sm)', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 10 }}>Text Size</div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <span style={{ fontSize: 'var(--fs-2xs)', color: 'var(--text-dim)' }}>Aa</span>
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
              <span style={{ fontSize: 'var(--fs-lg)', color: 'var(--text-dim)' }}>Aa</span>
            </div>
            <div style={{ marginTop: 8, fontSize: 'var(--fs-2xs)', color: 'var(--text-dim)', textAlign: 'center' }}>
              Larger text helps in bright sunlight or for low-vision users
            </div>
          </div>

          {/* Info strip */}
          <div style={{ display: 'flex', gap: 8, padding: '10px 14px', background: 'rgba(96,165,250,0.06)', border: '1px solid rgba(96,165,250,0.15)', borderRadius: 12, fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', lineHeight: 1.5 }}>
            <Lightbulb size={14} color="var(--accent-blue)" style={{ flexShrink: 0, marginTop: 1 }} aria-hidden="true" />
            <span><strong>Sun Mode</strong> uses warm amber tones visible in bright outdoor sunlight. <strong>High Contrast</strong> maximises legibility for visually impaired users.</span>
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
                  {item.icon && <item.icon size={17} color="var(--text-muted)" aria-hidden="true" />}
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 'var(--fs-base)', fontWeight: 600, color: 'var(--text-primary)' }}>{item.label}</div>
                    {item.desc && <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', marginTop: 1 }}>{item.desc}</div>}
                  </div>
                  {item.badge && <span className="chip chip-warning" style={{ fontSize: 'var(--fs-2xs)' }}>{item.badge}</span>}
                  {item.select ? (
                    <select
                      value={item.select.value}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => item.select?.onChange(e.target.value)}
                      className="farm-input"
                      style={{ width: 'auto', maxWidth: 170, padding: '6px 8px', fontSize: 'var(--fs-sm)', flexShrink: 0 }}
                    >
                      {item.select.options.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                    </select>
                  ) : item.toggle ? (
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
        <button onClick={onLogout} style={{ width: '100%', padding: '14px', borderRadius: 14, fontSize: 'var(--fs-md)', fontWeight: 700,
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
          <div style={{ fontWeight: 700, fontSize: 'var(--fs-lg)', display: 'flex', alignItems: 'center', gap: 8 }}><Lock size={16} /> Change Password</div>
          <button className="btn-icon" onClick={onClose}><X size={16} /></button>
        </div>

        <div style={{ marginBottom: 12 }}>
          <label style={{ fontSize: 'var(--fs-xs)', fontWeight: 700, color: 'var(--text-secondary)', display: 'block', marginBottom: 5 }}>Current Password *</label>
          <input className="farm-input" type={showPasswords ? 'text' : 'password'} value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} autoFocus />
        </div>
        <div style={{ marginBottom: 12 }}>
          <label style={{ fontSize: 'var(--fs-xs)', fontWeight: 700, color: 'var(--text-secondary)', display: 'block', marginBottom: 5 }}>New Password *</label>
          <input className="farm-input" type={showPasswords ? 'text' : 'password'} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
        </div>
        <div style={{ marginBottom: 8 }}>
          <label style={{ fontSize: 'var(--fs-xs)', fontWeight: 700, color: 'var(--text-secondary)', display: 'block', marginBottom: 5 }}>Confirm New Password *</label>
          <input className="farm-input" type={showPasswords ? 'text' : 'password'} value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} />
        </div>
        <button onClick={() => setShowPasswords((s) => !s)} style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', gap: 6, alignItems: 'center', fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', marginBottom: 12, padding: 0 }}>
          {showPasswords ? <EyeOff size={12} /> : <Eye size={12} />} {showPasswords ? 'Hide' : 'Show'} passwords
        </button>

        <div style={{ fontSize: 'var(--fs-2xs)', color: 'var(--text-dim)', marginBottom: 12, lineHeight: 1.4 }}>
          Minimum 8 characters. Applies to owner/manager accounts — workers sign in with a PIN.
        </div>

        {error && <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--status-critical)', marginBottom: 10 }}>{error}</div>}
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
              <div style={{ fontSize: 'var(--fs-base)', fontWeight: 700, color: 'var(--text-primary)', marginBottom: 3 }}>Reset worker sign-in PIN</div>
              <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', lineHeight: 1.45, marginBottom: 12 }}>PINs are never displayed. Set a new four-digit PIN and share it with the worker privately.</div>
              {workers === null ? <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' }}>Loading worker accounts…</div> : workers.length === 0 ? <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', lineHeight: 1.5 }}>No worker has a sign-in yet. Open Workers, pick the person, and use the <strong>Sign-in</strong> card to give them a phone and PIN — this screen resets PINs, it doesn&apos;t create the accounts.</div> : <>
                <label style={{ fontSize: 'var(--fs-xs)', fontWeight: 700, color: 'var(--text-secondary)', display: 'block', marginBottom: 5 }}>Worker</label>
                <select className="farm-input" value={selectedWorkerId} onChange={(event) => setSelectedWorkerId(event.target.value)} style={{ marginBottom: 10 }}>
                  {workers.map((worker) => <option key={worker.id} value={worker.id}>{worker.name} · {worker.hasPin ? 'PIN set' : 'Needs PIN'}</option>)}
                </select>
                <label style={{ fontSize: 'var(--fs-xs)', fontWeight: 700, color: 'var(--text-secondary)', display: 'block', marginBottom: 5 }}>New 4-digit PIN</label>
                <input className="farm-input" inputMode="numeric" pattern="[0-9]*" maxLength={4} type="password" value={newPin} onChange={(event) => setNewPin(event.target.value.replace(/\D/g, ''))} placeholder="••••" style={{ marginBottom: 10 }} />
                <button className="btn-primary" onClick={rotatePin} disabled={pinSaving} style={{ width: '100%', justifyContent: 'center' }}>{pinSaving ? 'Updating…' : 'Update worker PIN'}</button>
              </>}
            </div>
          </section>
        )}

        <section style={{ marginBottom: 18 }}>
          <div className="section-eyebrow" style={{ marginBottom: 8 }}>Active sessions</div>
          <div className="farm-card" style={{ padding: 14 }}>
            {sessions === null ? <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' }}>Loading signed-in sessions…</div> : <>
              <div style={{ fontSize: 'var(--fs-base)', fontWeight: 700, color: 'var(--text-primary)' }}>{sessions.length} active session{sessions.length === 1 ? '' : 's'}</div>
              <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', marginTop: 3, lineHeight: 1.45 }}>This device stays signed in. You can safely end every other session for your account.</div>
              {otherSessionCount > 0 && <button className="btn-secondary" onClick={revokeOtherSessions} disabled={sessionSaving} style={{ marginTop: 12, width: '100%', justifyContent: 'center' }}>{sessionSaving ? 'Signing out…' : `Sign out ${otherSessionCount} other session${otherSessionCount === 1 ? '' : 's'}`}</button>}
            </>}
          </div>
        </section>

        <section>
          <div className="section-eyebrow" style={{ marginBottom: 8 }}>Farm backup</div>
          <div className="farm-card" style={{ padding: 14 }}>
            <div style={{ fontSize: 'var(--fs-base)', fontWeight: 700, color: 'var(--text-primary)' }}>Download operational data</div>
            <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', marginTop: 3, lineHeight: 1.45 }}>Exports farms, batches, work, inventory, finance and audit data as JSON. Passwords, PINs and session tokens are excluded.</div>
            {canDownloadBackup ? <button className="btn-primary" onClick={downloadBackup} disabled={backupSaving} style={{ width: '100%', justifyContent: 'center', marginTop: 12 }}>{backupSaving ? 'Preparing backup…' : 'Download farm backup'}</button> : <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-dim)', marginTop: 10 }}>Only the farm owner can download a full backup.</div>}
          </div>
        </section>
      </div>
    </div>
  );
}
