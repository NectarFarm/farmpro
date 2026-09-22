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
import { cn } from '@/lib/utils';
import { PageHeader } from '@/components/ui-kit/page-header';
import { Avatar } from '@/components/ui-kit/avatar';
import { Badge } from '@/components/ui-kit/badge';
import { Button } from '@/components/ui-kit/button';
import { Input } from '@/components/ui-kit/input';
import { Field, controlClass } from '@/components/ui-kit/field';
import { Kv } from '@/components/ui-kit/inspector';
import { Dialog, DialogTitle, DialogDescription } from '@/components/ui-kit/dialog';
import {
  ChevronRight, ChevronLeft, DoorOpen, Check, Lock, Eye, EyeOff,
  Palette, SlidersHorizontal, Shield, Globe, UserCircle, Bell,
  Moon, Contrast, Sun, Sunrise, Lightbulb, Info, HelpCircle, ClipboardList, Layers,
  type LucideIcon,
} from './icons';
import { DATE_FORMATS, DEFAULT_DATE_FORMAT, DEFAULT_TIMEZONE, type DateFormat } from '@/lib/datetime';

/* ── Theme Context (global, used by globals.css overrides) ── */
export type ThemeMode = 'dark-farm' | 'high-contrast' | 'light-farm' | 'sun-mode';
export type FontSize = 'small' | 'normal' | 'large' | 'xlarge';

interface ThemeCtxShape {
  theme: ThemeMode;
  fontSize: FontSize;
  // Resolve to the write's outcome so the CALLER can report a refusal. These
  // used to be fire-and-forget `void` with a `console.error` on failure —
  // see the note on setTheme below for why that was a lie to every manager.
  setTheme: (t: ThemeMode) => Promise<SaveOutcome>;
  setFontSize: (s: FontSize) => Promise<SaveOutcome>;
}

type SaveOutcome = { ok: true } | { ok: false; error: string };

const ThemeCtx = createContext<ThemeCtxShape>({
  theme: 'light-farm', fontSize: 'normal',
  setTheme: async () => ({ ok: true }), setFontSize: async () => ({ ok: true }),
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

  // ── Optimistic, then honest about a refusal ──────────────────────────────
  // These used to apply the change locally and, on a failed PATCH, do nothing
  // but `console.error`. The reasoning recorded here was that appearance is
  // low-stakes enough to leave the visual change in place and retry later.
  // That was wrong for one specific and common case: PATCH /api/settings is
  // owner/super_admin-only, and a MANAGER has this screen. So a manager
  // picked a theme, watched it apply, got no feedback at all, and found it
  // reverted on their next refresh — with nothing anywhere telling them the
  // farm's appearance is not theirs to set. There is no "retry next change"
  // for a permission error; it will fail every time.
  //
  // Now: apply optimistically (still snappy), roll back and report on
  // refusal — the same optimistic/rollback/toast shape toggleSetting and
  // updateSetting below already use. The toast itself is raised by the
  // caller, because ThemeProvider sits above the toast provider.
  //
  // A tenant-less session (super_admin) has nowhere to persist this, so the
  // change stays local and says so rather than reporting a phantom success.
  const setTheme = useCallback(async (t: ThemeMode): Promise<SaveOutcome> => {
    const previous = theme;
    setThemeState(t);
    if (!tenantId) return { ok: false, error: 'Appearance is saved per farm, and this account has no farm of its own.' };
    const res = await apiClient.patch(`/api/settings?tenantId=${tenantId}`, { theme: t });
    if (res.success) return { ok: true };
    setThemeState(previous);
    return { ok: false, error: res.error || 'Only the farm owner can change the appearance.' };
  }, [tenantId, theme]);

  const setFontSize = useCallback(async (s: FontSize): Promise<SaveOutcome> => {
    const previous = fontSize;
    setFontSizeState(s);
    if (!tenantId) return { ok: false, error: 'Text size is saved per farm, and this account has no farm of its own.' };
    const res = await apiClient.patch(`/api/settings?tenantId=${tenantId}`, { fontSize: s });
    if (res.success) return { ok: true };
    setFontSizeState(previous);
    return { ok: false, error: res.error || 'Only the farm owner can change the text size.' };
  }, [tenantId, fontSize]);

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
// Preview swatches (ui/governance-reference-redesign): dark-farm/light-farm
// updated to match their new app/global.css hex values; high-contrast/
// sun-mode are unchanged themes, so their swatches are unchanged too.
const THEME_OPTIONS: { id: ThemeMode; label: string; desc: string; preview: string; icon: LucideIcon }[] = [
  { id: 'dark-farm',      label: 'Dark Farm',       desc: 'Optional low-light view', preview: '#121612', icon: Moon },
  { id: 'high-contrast',  label: 'High Contrast',    desc: 'Black & white, maximum legibility', preview: '#000000', icon: Contrast },
  { id: 'light-farm',     label: 'Light Farm',       desc: 'Default operational view', preview: '#efece3', icon: Sun },
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
  reportNotesEnabled: boolean;
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

/* ── Settings hub: a calm list of grouped sections (settings-redesign, package
 * G). Reference's 4 flat tabs (Structure/Appearance/Access/Account) don't
 * scale to local's 7 real groups, so instead of tabs this hub behaves like
 * Android's Settings app: a row per section, each drilling into its own full
 * view on a phone (`mobileOpen`, below); on desktop the same rows sit in a
 * fixed left rail next to the selected section's content, both always
 * visible — no separate route needed, every field/handler here is the exact
 * one the old flat sections array used, just regrouped. */
type SectionId = 'profile' | 'regional' | 'appearance' | 'notifications' | 'security' | 'stages' | 'about';
interface SectionMeta { id: SectionId; label: string; hint: string; icon: LucideIcon }

const SECTIONS: SectionMeta[] = [
  { id: 'profile', label: 'Farm profile', hint: 'You, your role and this farm', icon: UserCircle },
  { id: 'regional', label: 'Regional', hint: 'Currency, weight, timezone, dates', icon: Globe },
  { id: 'appearance', label: 'Appearance', hint: 'Theme, text size, modules & branding', icon: Palette },
  { id: 'notifications', label: 'Notifications', hint: 'Alerts and offline recording', icon: Bell },
  { id: 'security', label: 'Security', hint: 'Password, sessions, worker PINs', icon: Lock },
  { id: 'stages', label: 'Stages', hint: 'Batch stages and farm structure', icon: Layers },
  { id: 'about', label: 'About', hint: 'Version, walkthrough, setup guide', icon: Info },
  // Package H2 (admin/back-office console + customer portal, see
  // docs/backoffice-api.md) will append two more rows here once it lands —
  // "Plan & billing" and "Help & support" don't exist yet and this package
  // does not build them. Same `{ id, label, hint, icon }` shape as the rows
  // above; dropping entries into this array is the only change needed here
  // (plus a `case` in SettingsScreen's section-content switch).
  // { id: 'billing', label: 'Plan & billing', hint: 'Subscription, invoices, usage', icon: CreditCard },
  // { id: 'support', label: 'Help & support', hint: 'Contact support, open a ticket', icon: HelpCircle },
];

/* One label/toggle row, shared by every "coming soon" control in the
 * Notifications section — same optimistic-disabled treatment the old flat
 * sections array used (#376 Gap 5: no push/sound/offline infra exists). */
function ToggleRow({
  label, desc, value, onToggle, comingSoon, last,
}: { label: string; desc?: string; value: boolean; onToggle?: () => void; comingSoon?: boolean; last?: boolean }) {
  return (
    <div className={cn('flex items-center gap-3 px-3.5 py-3', !last && 'border-b border-border/70')}>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{label}</span>
          {comingSoon && <Badge>Coming soon</Badge>}
        </div>
        {desc && <p className="mt-0.5 text-xs text-muted">{desc}</p>}
      </div>
      <button
        type="button"
        aria-disabled={comingSoon}
        onClick={() => { if (!comingSoon) onToggle?.(); }}
        className={cn(
          'relative h-6 w-11 shrink-0 rounded-full transition-colors',
          comingSoon ? 'cursor-not-allowed opacity-45' : 'cursor-pointer',
          value ? 'bg-primary' : 'bg-surface-2',
        )}
      >
        <span className={cn('absolute top-0.5 size-5 rounded-full bg-white transition-[left]', value ? 'left-[22px]' : 'left-0.5')} />
      </button>
    </div>
  );
}

/* One tappable link row — the shape every "goes to its own screen" item in
 * this hub shares (UI Customise, Security & access, Notification settings,
 * Stages, Farm structure, About IFMS, etc). */
function LinkRow({ icon: Icon, label, desc, onClick }: { icon: LucideIcon; label: string; desc?: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-xl bg-surface p-4 text-left shadow-(--shadow-border) transition-colors hover:bg-surface-2"
    >
      <Icon size={17} className="shrink-0 text-muted" aria-hidden="true" />
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">{label}</span>
        {desc && <span className="block text-xs text-muted">{desc}</span>}
      </span>
      <ChevronRight size={16} className="shrink-0 text-subtle" aria-hidden="true" />
    </button>
  );
}

export function SettingsScreen({ onLogout }: { onLogout?: () => void }) {
  // `pendingApprovals` is no longer read here: the Governance row that carried
  // its badge moved to the Manage tab's menu (navigation.tsx's TabMenuSheet),
  // which reads the same NavContext value.
  const { navigate, role, tenantId, farms, activeFarmId } = useNav();
  // Who is actually signed in. Fetched here rather than threaded through the
  // shell, matching how components/farm/governance.tsx already reads its own
  // user id — there is no user in NavContext to read.
  const [me, setMe] = useState<{ name: string; email: string } | null>(null);
  useEffect(() => {
    apiClient.get<{ name?: string; email?: string }>('/api/auth/session').then((res) => {
      if (res.success) setMe({ name: res.data.name ?? '', email: res.data.email ?? '' });
    });
  }, []);

  // The farm this session is looking at. "All farms" is only worth saying
  // when there is more than one; with a single farm its name is the honest
  // label, and with none there is nothing true to put here.
  const farmLabel = activeFarmId !== 'ALL'
    ? farms.find((f) => f.id === activeFarmId)?.name ?? ''
    : farms.length === 1 ? farms[0].name
    : farms.length > 1 ? `${farms.length} farms`
    : '';
  // Initials from the real name. Two words give two letters, one word gives
  // one — no padding with a letter the person does not have.
  const initials = (me?.name ?? '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('') || '·';
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

  // (#376 Gap 5: `notifications`/`offline` local reads were removed with the
  // dead toggles they fed — the flags still exist in tenant_settings and the
  // PATCH contract, but no control on this screen flips them today.)
  const soundAlerts = settings?.soundAlertsEnabled ?? false;
  // Defaults to true, matching the server: an unloaded settings object must
  // not render this as "off" and imply the notes are already suppressed.
  const reportNotes = settings?.reportNotesEnabled ?? true;
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

  // PATCH /api/settings is owner/super_admin-only (app/api/settings/route.ts),
  // and GET is open to any tenant session — which is why a manager can SEE
  // every value here and change none of them. Passed as `readOnly` to the
  // rows that write through that PATCH so the control says so up front,
  // instead of accepting a change and reverting it a moment later.
  const ownerOnlyNote = role === 'owner' || role === 'super_admin'
    ? undefined
    : 'Only the farm owner can change this';
  const isOwnerish = role === 'owner' || role === 'super_admin';

  // Drill state (settings-redesign): `activeSection` is shared by both
  // layouts — it is desktop's permanently-selected right-pane content AND
  // the section a phone opens into. `mobileOpen` only matters below `lg`: it
  // is what makes the list vs. the section content mutually exclusive there
  // (Android Settings-style), while desktop always shows both at once.
  const [activeSection, setActiveSection] = useState<SectionId>('profile');
  const [mobileOpen, setMobileOpen] = useState(false);
  function openSection(id: SectionId) { setActiveSection(id); setMobileOpen(true); }

  const visibleSections = SECTIONS.filter((s) => s.id !== 'stages' || isOwnerish);
  const activeMeta = SECTIONS.find((s) => s.id === activeSection) ?? SECTIONS[0];

  function renderSectionContent() {
    switch (activeSection) {
      case 'profile':
        return (
          <div className="grid gap-4">
            <div className="rounded-xl bg-surface p-5 shadow-(--shadow-border)">
              <div className="flex items-center gap-4">
                <Avatar name={me?.name || 'Your account'} size="lg" />
                <div className="min-w-0">
                  <div className="truncate text-lg font-medium">{me?.name || 'Your account'}</div>
                  <div className="text-sm text-muted">
                    {role === 'owner' ? 'Owner' : role === 'manager' ? 'Manager' : role === 'worker' ? 'Worker' : role === 'super_admin' ? 'Platform admin' : 'Staff'}
                    {farmLabel ? ` · ${farmLabel}` : ''}
                  </div>
                </div>
              </div>
              <dl className="mt-4">
                {me?.email && <Kv label="Email" value={me.email} />}
                <Kv label="Role" value={<Badge variant="warning">{role.toUpperCase()}</Badge>} />
                {farmLabel && <Kv label="Farm" value={farmLabel} />}
              </dl>
            </div>
            {/* There is no plan/tier anywhere in the schema (db/schemas/auth.ts's
               `tenants` is id, name, active, createdAt) — no invented badge here. */}
            <Button variant="danger" className="w-full justify-center" onClick={onLogout}>
              <DoorOpen size={16} /> Sign out
            </Button>
          </div>
        );

      case 'regional':
        return (
          <div className="rounded-xl bg-surface p-5 shadow-(--shadow-border)">
            <p className="text-sm text-muted">Currency, weight and time formatting used across this farm&apos;s reports and exports.</p>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <Field label="Currency">
                <select className={controlClass} value={currencySymbol} disabled={!!ownerOnlyNote} title={ownerOnlyNote} onChange={(e) => updateSetting('currencySymbol', e.target.value)}>
                  {CURRENCY_OPTIONS.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </Field>
              <Field label="Weight unit">
                <select className={controlClass} value={weightUnit} disabled={!!ownerOnlyNote} title={ownerOnlyNote} onChange={(e) => updateSetting('weightUnit', e.target.value)}>
                  {WEIGHT_UNIT_OPTIONS.map((u) => <option key={u} value={u}>{u}</option>)}
                </select>
              </Field>
              <Field label="Timezone">
                <select className={controlClass} value={timezone} disabled={!!ownerOnlyNote} title={ownerOnlyNote} onChange={(e) => updateSetting('timezone', e.target.value)}>
                  {TIMEZONE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </Field>
              <Field label="Date format">
                <select className={controlClass} value={dateFormat} disabled={!!ownerOnlyNote} title={ownerOnlyNote} onChange={(e) => updateSetting('dateFormat', e.target.value as DateFormat)}>
                  {DATE_FORMAT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </Field>
            </div>
            {ownerOnlyNote && <p className="mt-3 text-xs text-subtle">{ownerOnlyNote}.</p>}
            <button
              type="button"
              onClick={() => toggleSetting('reportNotesEnabled')}
              className="mt-4 flex w-full items-center justify-between rounded-lg bg-surface-2 px-3.5 py-3 text-left"
            >
              <span className="text-sm">Print notes on reports</span>
              <span className={cn('flex size-7 items-center justify-center rounded-full', reportNotes ? 'bg-primary text-primary-fg' : 'bg-surface')}>
                {reportNotes ? <Check size={14} /> : null}
              </span>
            </button>
          </div>
        );

      case 'appearance':
        return (
          <div className="grid gap-4">
            <div className="rounded-xl bg-surface p-5 shadow-(--shadow-border)">
              <h2 className="text-sm font-medium">Colour theme</h2>
              <div className="mt-3 grid grid-cols-2 gap-2">
                {THEME_OPTIONS.map((t) => {
                  const active = theme === t.id;
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={async () => { const r = await setTheme(t.id); if (!r.ok) showToast(r.error, 'error'); }}
                      className={cn('rounded-lg px-3 py-3 text-left shadow-(--shadow-border)', active && 'bg-primary-soft ring-2 ring-primary/40')}
                    >
                      <span className="flex items-center gap-2">
                        <span className="size-4 shrink-0 rounded" style={{ background: t.preview, border: '1px solid rgba(255,255,255,0.2)' }} />
                        <t.icon size={13} className={active ? 'text-primary' : 'text-fg'} aria-hidden="true" />
                        <span className={cn('text-sm font-medium', active && 'text-primary')}>{t.label}</span>
                      </span>
                      <span className="mt-1 block text-xs text-muted">{t.desc}</span>
                    </button>
                  );
                })}
              </div>
              <div className="mt-4 flex gap-2 rounded-lg px-3.5 py-3 text-xs text-muted" style={{ background: 'rgba(var(--info-rgb),0.08)', border: '1px solid rgba(var(--info-rgb),0.2)' }}>
                <Lightbulb size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
                <span><strong>Sun Mode</strong> uses warm amber tones for bright outdoor light. <strong>High Contrast</strong> maximises legibility for low vision.</span>
              </div>
            </div>

            <div className="rounded-xl bg-surface p-5 shadow-(--shadow-border)">
              <h2 className="text-sm font-medium">Text size</h2>
              <div className="mt-3 flex items-center gap-2">
                <span className="text-xs text-subtle">Aa</span>
                <div className="flex flex-1 gap-1.5">
                  {FONT_OPTIONS.map((f) => {
                    const active = fontSize === f.id;
                    return (
                      <button
                        key={f.id}
                        type="button"
                        onClick={async () => { const r = await setFontSize(f.id); if (!r.ok) showToast(r.error, 'error'); }}
                        className={cn('flex-1 rounded-lg py-2.5', active ? 'bg-primary-soft ring-2 ring-primary/40' : 'bg-surface-2')}
                      >
                        <span className={cn('font-medium', active ? 'text-primary' : 'text-muted')} style={{ fontSize: f.size }}>{f.label}</span>
                      </button>
                    );
                  })}
                </div>
                <span className="text-lg text-subtle">Aa</span>
              </div>
              <p className="mt-2 text-center text-xs text-subtle">Larger text helps in bright sunlight or for low-vision users.</p>
            </div>

            {isOwnerish && (
              <LinkRow icon={SlidersHorizontal} label="UI Customise" desc="Module toggles, label renames & farm branding" onClick={() => navigate('ui-customise')} />
            )}
          </div>
        );

      case 'notifications':
        return (
          <div className="grid gap-3">
            <div className="rounded-xl bg-surface p-1 shadow-(--shadow-border)">
              {/* #376 Gap 5: no push service, audio playback or offline cache
                 exists anywhere in this codebase (no service worker, no
                 IndexedDB queue, no Audio/AudioContext/navigator.vibrate call)
                 — every row below is disabled and says so rather than
                 persisting a flag nothing reads. The stored sound-alerts flag
                 is left alone, not reset, so a saved preference takes effect
                 the day playback actually lands. */}
              <ToggleRow label="Push notifications" desc="Alerts arrive in-app today — push delivery is coming soon" value={false} comingSoon />
              <ToggleRow label="Sound alerts" desc={`Alerts are silent today — audible alerts are coming soon${soundAlerts ? ' (your preference is saved)' : ''}`} value={false} comingSoon />
              <ToggleRow label="Offline mode" desc="Recording needs internet today — offline caching is coming soon" value={false} comingSoon last />
            </div>
            <LinkRow icon={Bell} label="Notification settings" desc="Per-type controls, SMS, quiet hours" onClick={() => navigate('notification-settings')} />
          </div>
        );

      case 'security':
        return (
          <div className="grid gap-3">
            <LinkRow icon={Lock} label="Change password" onClick={() => setShowPasswordModal(true)} />
            <LinkRow icon={Shield} label="Security & access" desc="Worker PINs, signed-in devices & backup" onClick={() => navigate('security-settings')} />
            <div className="rounded-xl bg-surface p-5 shadow-(--shadow-border)">
              {/* Farm offices share devices — this bounds how long a session
                 issued to this tenant stays valid (enforced in
                 app/api/auth/login/route.ts at sign-in, not just stored). */}
              <Field label="Session timeout">
                <select
                  className={controlClass}
                  value={sessionTimeoutMinutes === null ? 'default' : String(sessionTimeoutMinutes)}
                  disabled={!!ownerOnlyNote}
                  title={ownerOnlyNote}
                  onChange={(e) => updateSetting('sessionTimeoutMinutes', e.target.value === 'default' ? null : Number(e.target.value))}
                >
                  {SESSION_TIMEOUT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </Field>
              <p className="mt-2 text-xs text-muted">How long a shared device stays signed in.{ownerOnlyNote ? ` ${ownerOnlyNote}.` : ''}</p>
            </div>
          </div>
        );

      case 'stages':
        return (
          <div className="grid gap-3">
            <LinkRow icon={Layers} label="Batch stages" desc="When a batch moves from one stage to the next" onClick={() => navigate('farm-config')} />
            {/* D1–D3: reference's Settings has a Structure tab showing the
               farm→division→house tree inline; local builds that tree as its
               own Sites tab on Units instead (crops.tsx, params.tab='sites')
               rather than duplicating it here — this is the one-line link
               across the map calls for. */}
            <LinkRow icon={Globe} label="Farm structure" desc="Farms, houses and batches — opens Units → Sites" onClick={() => navigate('crops', { tab: 'sites' })} />
          </div>
        );

      case 'about':
        return (
          <div className="grid gap-3">
            <LinkRow icon={HelpCircle} label="Show me around" desc="Replay the guided walkthrough of the app" onClick={() => { navigate('dashboard'); requestTour(); }} />
            <LinkRow icon={ClipboardList} label="Set up your farm" desc="The nine steps, and how far through them you are" onClick={() => navigate('getting-started')} />
            <LinkRow icon={Info} label="About IFMS" desc={`Version ${process.env.NEXT_PUBLIC_APP_VERSION ?? '—'}`} onClick={() => navigate('about')} />
          </div>
        );

      default:
        return null;
    }
  }

  return (
    <div className="screen-content">
      {/* Was title="More". "More" named nothing — the owner's words: it "tells a
            user nothing about what's behind it". This screen is where a farm
            gets managed and configured, so it says that, and the bottom tab
            that reaches it now reads "Manage" too (navigation.tsx's OWNER_TABS). */}
      <TopNav title="" showBell />
      <div className="px-screen" style={{ paddingTop: 14, paddingBottom: 32 }}>
        {/* Header — hidden on a phone once a section is open, matching Android
           Settings: the list screen's own chrome disappears behind the
           sub-page it opened, rather than staying visible above it. */}
        <div className={cn(mobileOpen && 'hidden lg:block')}>
          <PageHeader kicker="Company" title="Settings" lede="Your farm, your people and your app — set up once, changed rarely." />

          {/* Account card — the signed-in user, not a mock. owner-roast finding
           * #4: this used to open 'people' — the whole team's roster — which
           * is not "your account" by any reading. It opens the same Security
           * & access screen the Security section's own link below leads to
           * (sessions, password/PIN, backup) — the actual account and
           * security surface this card's own content implies. There is no
           * plan/tier anywhere in the schema (db/schemas/auth.ts's `tenants`
           * is id, name, active, createdAt) — no invented badge here. */}
          <div style={{ marginTop: 20 }}>
          <button onClick={() => navigate('security-settings')} className="farm-card farm-card-active" style={{ padding: 14, marginBottom: 16, display: 'flex', gap: 12, alignItems: 'center', width: '100%', textAlign: 'left', cursor: 'pointer' }}>
            <div style={{ width: 52, height: 52, borderRadius: '50%', background: 'rgba(var(--warning-rgb),0.2)', border: '2px solid rgba(var(--warning-rgb),0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 'var(--fs-2xl)', fontWeight: 700, color: 'var(--accent-amber)', flexShrink: 0 }}>{initials}</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700, fontSize: 'var(--fs-lg)', color: 'var(--text-primary)' }}>{me?.name || 'Your account'}</div>
              <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', marginTop: 2 }}>
                {role === 'owner' ? 'Owner' : role === 'manager' ? 'Manager' : role === 'worker' ? 'Worker' : role === 'super_admin' ? 'Platform Admin' : 'Staff'}
                {farmLabel ? ` · ${farmLabel}` : ''}
              </div>
              {me?.email && (
                <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-dim)', marginTop: 2 }}>{me.email}</div>
              )}
              <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                <span className="chip chip-warning" style={{ fontSize: 'var(--fs-2xs)' }}>{role.toUpperCase()}</span>
              </div>
            </div>
            <ChevronRight size={16} color="var(--text-muted)" />
          </button>
          </div>
        </div>

        <div className={cn('lg:grid lg:grid-cols-[260px_minmax(0,1fr)] lg:items-start lg:gap-5', mobileOpen ? 'mt-0' : 'mt-5')}>
          <nav className={cn('flex flex-col gap-1.5', mobileOpen && 'hidden lg:flex')} aria-label="Settings sections">
            {visibleSections.map((s) => {
              const active = s.id === activeSection;
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => openSection(s.id)}
                  className={cn(
                    'flex items-center gap-3 rounded-xl px-3.5 py-3 text-left shadow-(--shadow-border) transition-colors',
                    active ? 'bg-primary text-primary-fg' : 'bg-surface hover:bg-surface-2',
                  )}
                >
                  <s.icon size={18} className={active ? '' : 'text-muted'} aria-hidden="true" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium">{s.label}</span>
                    <span className={cn('block truncate text-xs', active ? 'text-primary-fg/75' : 'text-muted')}>{s.hint}</span>
                  </span>
                  <ChevronRight size={16} className={active ? 'text-primary-fg/70' : 'text-subtle'} aria-hidden="true" />
                </button>
              );
            })}
          </nav>

          <div className={cn(!mobileOpen && 'hidden lg:block')}>
            <div className="mb-4 flex items-center gap-2 lg:hidden">
              <button
                type="button"
                onClick={() => setMobileOpen(false)}
                className="flex size-10 shrink-0 items-center justify-center rounded-md text-fg hover:bg-surface-2"
                aria-label="Back to Settings"
              >
                <ChevronLeft size={19} />
              </button>
              <span className="font-display text-xl font-medium">{activeMeta.label}</span>
            </div>
            {renderSectionContent()}
          </div>
        </div>
      </div>

      {showPasswordModal && <ChangePasswordDialog open={showPasswordModal} onClose={() => setShowPasswordModal(false)} />}
    </div>
  );
}

/* ── Change Password dialog — real POST /api/auth/change-password (issue
 * #256). Centred ui-kit Dialog, same shape as the reference's own
 * PasswordDialog. ── */
function ChangePasswordDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
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
      setCurrentPassword(''); setNewPassword(''); setConfirmPassword('');
      onClose();
    } else {
      setError(res.error || 'Failed to change password.');
    }
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogTitle>Change password</DialogTitle>
      <DialogDescription>Minimum 8 characters. Applies to owner/manager accounts — workers sign in with a PIN.</DialogDescription>
      <div className="mt-4 grid gap-3">
        <Field label="Current password">
          <Input type={showPasswords ? 'text' : 'password'} value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} autoFocus />
        </Field>
        <Field label="New password">
          <Input type={showPasswords ? 'text' : 'password'} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
        </Field>
        <Field label="Confirm new password">
          <Input type={showPasswords ? 'text' : 'password'} value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} />
        </Field>
        <button type="button" onClick={() => setShowPasswords((s) => !s)} className="inline-flex items-center gap-1.5 text-xs text-muted">
          {showPasswords ? <EyeOff size={12} /> : <Eye size={12} />} {showPasswords ? 'Hide' : 'Show'} passwords
        </button>
        {error && <div className="text-sm text-danger">{error}</div>}
        <Button className="w-full justify-center" disabled={saving} onClick={save}>
          {saving ? 'Saving…' : 'Change password'}
        </Button>
      </div>
    </Dialog>
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
          <section className="mb-5">
            <p className="mb-2 text-xs font-medium tracking-widest text-muted uppercase">Worker PINs</p>
            <div className="rounded-xl bg-surface p-4 shadow-(--shadow-border)">
              <div className="mb-1 text-sm font-medium">Reset worker sign-in PIN</div>
              <p className="mb-3 text-sm text-muted">PINs are never displayed. Set a new four-digit PIN and share it with the worker privately.</p>
              {workers === null ? <div className="text-sm text-muted">Loading worker accounts…</div> : workers.length === 0 ? (
                <div className="text-sm text-muted">
                  No worker has a sign-in yet. Open Workers, pick the person, and use the <strong>Sign-in</strong> card to give them a phone and PIN — this screen resets PINs, it doesn&apos;t create the accounts.
                </div>
              ) : (
                <div className="grid gap-3">
                  <Field label="Worker">
                    <select className={controlClass} value={selectedWorkerId} onChange={(event) => setSelectedWorkerId(event.target.value)}>
                      {workers.map((worker) => <option key={worker.id} value={worker.id}>{worker.name} · {worker.hasPin ? 'PIN set' : 'Needs PIN'}</option>)}
                    </select>
                  </Field>
                  <Field label="New 4-digit PIN">
                    <Input inputMode="numeric" pattern="[0-9]*" maxLength={4} type="password" value={newPin} onChange={(event) => setNewPin(event.target.value.replace(/\D/g, ''))} placeholder="••••" />
                  </Field>
                  <Button className="w-full justify-center" onClick={rotatePin} disabled={pinSaving}>{pinSaving ? 'Updating…' : 'Update worker PIN'}</Button>
                </div>
              )}
            </div>
          </section>
        )}

        <section className="mb-5">
          <p className="mb-2 text-xs font-medium tracking-widest text-muted uppercase">Active sessions</p>
          <div className="rounded-xl bg-surface p-4 shadow-(--shadow-border)">
            {sessions === null ? <div className="text-sm text-muted">Loading signed-in sessions…</div> : (
              <>
                <div className="text-sm font-medium">{sessions.length} active session{sessions.length === 1 ? '' : 's'}</div>
                <p className="mt-1 text-sm text-muted">This device stays signed in. You can safely end every other session for your account.</p>
                {otherSessionCount > 0 && (
                  <Button variant="secondary" className="mt-3 w-full justify-center" onClick={revokeOtherSessions} disabled={sessionSaving}>
                    {sessionSaving ? 'Signing out…' : `Sign out ${otherSessionCount} other session${otherSessionCount === 1 ? '' : 's'}`}
                  </Button>
                )}
              </>
            )}
          </div>
        </section>

        <section>
          <p className="mb-2 text-xs font-medium tracking-widest text-muted uppercase">Farm backup</p>
          <div className="rounded-xl bg-surface p-4 shadow-(--shadow-border)">
            <div className="text-sm font-medium">Download operational data</div>
            <p className="mt-1 text-sm text-muted">Exports farms, batches, work, inventory, finance and audit data as JSON. Passwords, PINs and session tokens are excluded.</p>
            {canDownloadBackup ? (
              <Button className="mt-3 w-full justify-center" onClick={downloadBackup} disabled={backupSaving}>{backupSaving ? 'Preparing backup…' : 'Download farm backup'}</Button>
            ) : (
              <p className="mt-2 text-xs text-subtle">Only the farm owner can download a full backup.</p>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
