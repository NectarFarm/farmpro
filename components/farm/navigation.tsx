'use client';
import React, { useState, useEffect, useRef, createContext, useContext, useCallback, useTransition } from 'react';
import { Home, Leaf, Package, CloudSun, DollarSign, CheckSquare, Users, Shield, BarChart3, Settings, Bell, ChevronLeft, Search, Plus, UserCircle, MessageCircle, LogOut, FileText, UserCheck, Heart, Eye, Stethoscope, ClipboardList, Sunrise, Layers, Bot, ChevronUp, ChevronRight, X } from './icons';
import { apiClient } from '@/lib/request';
import type { SetupState } from '@/lib/setup-state';

/* ── Screen registry ── */
export type ScreenId =
  | 'dashboard' | 'crops' | 'inventory' | 'weather' | 'finance'
  | 'tasks' | 'people' | 'governance' | 'reports' | 'settings'
  | 'notifications' | 'ai-chat'
  | 'worker-home' | 'worker-record' | 'worker-pay' | 'worker-profile'
  | 'admin-dashboard' | 'admin-farms' | 'admin-settings' | 'admin-onboarding' | 'admin-users'
  | 'admin-enterprise-requests'
  | 'batch-detail' | 'crop-schedule' | 'inventory-detail'
  | 'people-detail'
  | 'notification-settings'
  | 'ui-customise' | 'security-settings' | 'role-notice' | 'routines'
  | 'farm-config'
  | 'auditor-reports' | 'vet-herd' | 'about' | 'getting-started';

/* ── Session role contract (issue #219) ──
 * The UI role set mirrors the backend exactly (backend: `lib/types/index.ts`):
 *   "owner" | "manager" | "worker" | "vet" | "auditor" | "super_admin"
 * The mock UI's old "admin" role maps to the backend's "super_admin" — there is
 * no "admin" role in the backend and we must not invent one.
 * vet/auditor are real backend roles but have no dedicated screens in this mobile
 * pass: they are routed to RoleNoticeScreen (explicit deny with a clear message),
 * never silently into the worker/owner tab set. */
export type Role = 'owner' | 'manager' | 'worker' | 'vet' | 'auditor' | 'super_admin';

/* A farm as the shell needs it: identity + display fields. Rows from the backend
 * GET /api/farms map onto this. */
export interface FarmSummary {
  id: string;
  code: string;
  name: string;
  location: string;
}

/* Issue #320: each history entry captures the screen being left AND the
 * params that were active for it, so goBack() can restore both instead of
 * unconditionally clearing params to {}. Without this, any params-dependent
 * detail screen (batch-detail, inventory-detail, people-detail,
 * process-config) reached through 2+ levels of back navigation renders
 * "not found" once its params are wiped by an intermediate goBack(). */
export interface HistoryEntry {
  screen: ScreenId;
  params: Record<string, string>;
}

export interface NavContext {
  current: ScreenId;
  history: HistoryEntry[];
  role: Role;
  params: Record<string, string>;
  // ── Multi-farm filtering (farm-scoped-data task) ──
  // `activeFarmId` is the CANONICAL filter value every data fetch must use —
  // a real `farms.id`, or the sentinel 'ALL' for no filter. It is NEVER a
  // farm code: codes are user-editable display labels (PATCH /api/farms/[id]
  // lets an owner rename one), so a filter keyed on code would silently stop
  // matching the moment someone renames their farm. `activeFarm` below is
  // the CODE, derived from `activeFarmId` via `farms` — display-only, e.g.
  // the switcher's farm-code badge text. Never fetch data by `activeFarm` —
  // fetch by `activeFarmId`.
  activeFarmId: string;
  activeFarm: string; // Display-only farm CODE derived from activeFarmId ('ALL' when unset).
  farms: FarmSummary[]; // The tenant's farms, from GET /api/farms. Empty until it answers.
  tenantId: string; // Resolved tenant scope for tenant-scoped GETs (issue #228) — same
                     // session-tenant-wins / PROVISIONAL_TENANT_ID fallback as the farms fetch below.
  navigate: (to: ScreenId, params?: Record<string, string>) => void;
  goBack: () => void;
  // True while a screen swap is still rendering — see navigate()'s comment on
  // why the swap is a transition. Anything that wants to show the tap landed
  // reads this.
  isNavigating: boolean;
  setActiveFarmId: (id: string) => void; // Pass a real farms.id, or 'ALL' to clear the filter.
  pendingApprovals: number; // Real count from GET /api/approvals?status=pending (issue #293),
                             // farm-scoped by activeFarmId (farm-scoped-data task).
  unreadNotifs: number; // Real count from GET /api/notifications, filtered to read:false (issue #293).
                         // NOT farm-scoped — notifications has no farm relationship (see
                         // GET /api/dashboard/kpis's header for the same tenant-wide list).
  openTasksCount: number; // Real count from GET /api/dashboard/kpis's activeTasksCount — the
                          // tenant's tasks not DONE/CANCELLED (issue #298; reused, not re-derived),
                          // farm-scoped by activeFarmId (farm-scoped-data task).
  pendingOnboardingRequests: number; // Real count of `onboard_requests` rows with status
                                      // 'pending' (issue #251/#252), super_admin sessions only —
                                      // 0 for every other role (issue #298).
  /* ── How far through setup this tenant is (setup-sequence task) ──
   * From GET /api/setup-state: real row counts plus a done/not-done flag per
   * step of lib/onboarding-guide.ts. `null` means "not loaded" — either still
   * in flight, the fetch failed, or this role never fetches it at all (only
   * owner/manager do; a worker cannot act on any of these steps and a
   * super_admin has no single tenant to report on). Every consumer treats
   * null as "say nothing", never as "nothing is set up": claiming a farm is
   * unconfigured because a request failed is exactly the kind of invented
   * state this codebase's honest-empty-state rule exists to prevent.
   *
   * Fetched HERE rather than per screen because three places read it — the
   * dashboard setup card, the sidebar's setup row, and the Getting Started
   * checklist — and they must agree. */
  setupState: SetupState | null;
  /* Re-read it. Called by the screens that can be looking at it when the user
   * has just finished a step elsewhere (adding a unit, issuing a login), so
   * progress moves without a reload. */
  refreshSetupState: () => void;
}

/* Tenant scope for /api/farms. With real sessions (issue #221) NavProvider gets
 * the session's tenantId from the bootstrap; this env value is only the fallback
 * for standalone mock mode (no backend running). */
const PROVISIONAL_TENANT_ID = process.env.NEXT_PUBLIC_TENANT_ID ?? 't1';

const NavCtx = createContext<NavContext>({
  current: 'dashboard', history: [], role: 'owner', params: {},
  // 'ALL' — not a phantom farm code. The old default here was a mock code
  // ('FRM-KMU-001') that never existed in the database, so the app briefly
  // filtered by a farm that could never match anything real until the farms
  // fetch landed. 'ALL' is always valid: it's the real "no filter" sentinel.
  activeFarmId: 'ALL',
  activeFarm: 'ALL',
  farms: [],
  tenantId: PROVISIONAL_TENANT_ID,
  navigate: () => {}, goBack: () => {}, isNavigating: false, setActiveFarmId: () => {},
  pendingApprovals: 0, unreadNotifs: 0,
  openTasksCount: 0, pendingOnboardingRequests: 0,
  setupState: null, refreshSetupState: () => {},
});

export function useNav() { return useContext(NavCtx); }

/* ── Pure history-stack push/pop (issue #320) ──
 * Extracted so the stack logic is testable without a DOM/render harness,
 * following the same pattern as tabBadge() (issue #298 / tests/nav-tab-badges.test.ts). */
export function pushHistoryEntry(history: HistoryEntry[], entry: HistoryEntry): HistoryEntry[] {
  return [...history, entry];
}

export function popHistoryEntry(history: HistoryEntry[]): { history: HistoryEntry[]; entry: HistoryEntry | null } {
  if (!history.length) return { history, entry: null };
  return { history: history.slice(0, -1), entry: history[history.length - 1] };
}

/* Every screen the registry above allows — used at runtime to validate a
 * location.hash we didn't control (typed in, restored from a bookmark, or
 * whatever an older/newer build previously wrote there). Keep in sync with
 * the ScreenId union above — this copy additionally has 'security-settings'. */
const ALL_SCREENS: ScreenId[] = [
  'dashboard', 'crops', 'inventory', 'weather', 'finance',
  'tasks', 'people', 'governance', 'reports', 'settings',
  'notifications', 'ai-chat',
  'worker-home', 'worker-record', 'worker-pay', 'worker-profile',
  'admin-dashboard', 'admin-farms', 'admin-settings', 'admin-onboarding', 'admin-users',
  'admin-enterprise-requests',
  'batch-detail', 'crop-schedule', 'inventory-detail',
  'people-detail',
  'notification-settings',
  'ui-customise', 'security-settings', 'role-notice',
  'auditor-reports', 'vet-herd', 'about', 'routines', 'getting-started',
];
const SCREEN_SET = new Set<string>(ALL_SCREENS);
function isScreenId(s: string): s is ScreenId {
  return SCREEN_SET.has(s);
}

/* ── Back-button fix (Android/browser back was closing the app) ──
 * NavProvider used to keep the whole nav stack in React state only, never
 * touching the browser History API — so there was nothing for a Back
 * gesture to pop, and in the Bubblewrap TWA it closed the app from any
 * screen depth. These two pure helpers mirror each navigate()/goBack() into
 * a URL hash (`#screen` or `#screen?k=v&...`) on the SAME path ('/'), so
 * Next.js routing/refresh are unaffected and only the hash changes. */
export function encodeScreen(screen: ScreenId, params?: Record<string, string>): string {
  const p = params ?? {};
  const keys = Object.keys(p);
  const query = keys.length ? '?' + new URLSearchParams(p).toString() : '';
  return '#' + screen + query;
}

export function decodeHash(hash: string): { screen: ScreenId; params: Record<string, string> } | null {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  if (!raw) return null;
  const [screenPart, queryPart] = raw.split('?');
  if (!screenPart || !isScreenId(screenPart)) return null;
  const params: Record<string, string> = {};
  if (queryPart) {
    new URLSearchParams(queryPart).forEach((v, k) => { params[k] = v; });
  }
  return { screen: screenPart, params };
}

/* ── Tab bar config per role ──
 * "More" is gone as a label (owner's words: it "tells a user nothing about
 * what's behind it"). The screen behind it is a hub — Inventory, Weather,
 * People, Routines, Governance, Reports on a phone, plus every app setting —
 * so "Manage" names what it is for. The tab ID is UNCHANGED ('settings'), so
 * every `data-tour="nav-settings"` anchor, deep link hash and sub-screen
 * mapping keeps working; only the word a user reads changed. */
const OWNER_TABS = [
  { id: 'dashboard' as ScreenId, label: 'Home', icon: Home },
  { id: 'crops' as ScreenId, label: 'Farm', icon: Leaf },
  { id: 'finance' as ScreenId, label: 'Finance', icon: DollarSign },
  { id: 'tasks' as ScreenId, label: 'Tasks', icon: CheckSquare },
  { id: 'settings' as ScreenId, label: 'Manage', icon: Settings },
];
const MANAGER_TABS = [
  { id: 'dashboard' as ScreenId, label: 'Home', icon: Home },
  { id: 'crops' as ScreenId, label: 'Farm', icon: Leaf },
  { id: 'tasks' as ScreenId, label: 'Tasks', icon: CheckSquare },
  { id: 'inventory' as ScreenId, label: 'Stock', icon: Package },
  { id: 'settings' as ScreenId, label: 'Manage', icon: Settings },
];
const WORKER_TABS = [
  { id: 'worker-home' as ScreenId, label: 'Home', icon: Home },
  { id: 'worker-record' as ScreenId, label: 'Record', icon: Plus },
  { id: 'worker-pay' as ScreenId, label: 'Pay', icon: DollarSign },
  { id: 'worker-profile' as ScreenId, label: 'Profile', icon: UserCircle },
];
const ADMIN_TABS = [
  { id: 'admin-dashboard' as ScreenId, label: 'Overview', icon: BarChart3 },
  { id: 'admin-farms' as ScreenId, label: 'Farms', icon: Leaf },
  { id: 'admin-onboarding' as ScreenId, label: 'Requests', icon: Users },
  { id: 'admin-users' as ScreenId, label: 'Users', icon: UserCheck },
  { id: 'admin-settings' as ScreenId, label: 'Config', icon: Settings },
];
// vet / auditor (issue #219 follow-up: these two roles get real screens
// instead of RoleNoticeScreen) — one tab each, matching how narrow their
// actual remit is: a vet reviews herd health and logs mortality; an auditor
// only ever reads reports. See ALLOWED_SCREENS_FOR_ROLE below for the
// server-side-equivalent client guard that keeps both roles inside their tab.
const VET_TABS = [
  { id: 'vet-herd' as ScreenId, label: 'Herd', icon: Heart },
];
const AUDITOR_TABS = [
  { id: 'auditor-reports' as ScreenId, label: 'Reports', icon: Eye },
];

/* ── What is behind each tab (setup-sequence task) ──────────────────────────
 * The owner, on the mobile shell: "even somethings look hidden — I expect when
 * I click Farm I see a dropdown or something for what I do under Farm, which
 * should take me to that exact screen. And for the AI advisor alone I struggle
 * finding it when new."
 *
 * Both halves are the same bug. A phone has five tabs and the app has about
 * twenty destinations, so fifteen of them lived behind a tab whose label
 * mentioned none of them — CropsScreen's four internal tabs (Livestock, Crops,
 * Units, Products) were invisible until you were already on the screen, and
 * the AI advisor was reachable only from a dashboard tile and a row buried in
 * a list called "More".
 *
 * So a tab with things under it now OPENS them instead of silently landing on
 * one of them. Each row names the destination and what you do there, and
 * navigates to that exact screen — including, where the destination is a tab
 * inside a screen, the params that open it on that tab (CropsScreen reads
 * `params.tab`).
 *
 * This is not a second navigation system: it is the existing tab, showing its
 * own contents. Nothing is reachable through a sheet that was not already
 * reachable, no sheet exists for a tab that has a single destination (Home,
 * Tasks, Finance, Stock and every worker tab still navigate on one tap), and
 * the sheet has no state of its own — it closes the moment you pick something.
 */
interface TabMenuItem {
  screen: ScreenId;
  params?: Record<string, string>;
  label: string;
  desc: string;
  icon: typeof Home;
  ownerOnly?: boolean;
}

const TAB_MENUS: Partial<Record<ScreenId, { title: string; items: TabMenuItem[] }>> = {
  crops: {
    title: 'Farm',
    items: [
      { screen: 'crops', params: { tab: 'units' }, label: 'Production units', desc: 'The houses, pens and fields a batch lives in — set these up first', icon: Home },
      { screen: 'crops', params: { tab: 'livestock' }, label: 'Livestock batches', desc: 'Flocks and herds, their headcount and how each is doing', icon: Heart },
      { screen: 'crops', params: { tab: 'crops' }, label: 'Crop batches', desc: 'Planted areas, their stage and expected harvest', icon: Leaf },
      { screen: 'crops', params: { tab: 'products' }, label: 'Products', desc: 'What you sell, and which units produce it', icon: Package },
      { screen: 'farm-config', label: 'Farm configuration', desc: 'Growth stages, products per batch, farm structure', icon: Layers, ownerOnly: true },
    ],
  },
  settings: {
    title: 'Manage',
    items: [
      { screen: 'inventory', label: 'Inventory', desc: 'Feed and supplies, stock lots and purchases', icon: Package },
      { screen: 'people', label: 'People', desc: 'Employees, their pay, and the logins they sign in with', icon: Users },
      { screen: 'routines', label: 'Daily routines', desc: 'The checklist your workers follow each round', icon: Sunrise },
      { screen: 'weather', label: 'Weather', desc: 'Forecast for your farm, and what to do about it', icon: CloudSun },
      { screen: 'ai-chat', label: 'AI farm advisor', desc: 'Ask a question about your own farm’s records', icon: Bot },
      { screen: 'governance', label: 'Governance', desc: 'Approvals, who can do what, and the audit trail', icon: Shield },
      { screen: 'reports', label: 'Reports', desc: 'Export production, money and mortality; share with an auditor', icon: FileText, ownerOnly: true },
      { screen: 'settings', label: 'App settings', desc: 'Your account, appearance, units, notifications and security', icon: Settings },
    ],
  },
};

// The menu for a tab, or null when that tab is a single destination and should
// navigate straight there. Filtered by role: a manager must not be offered a
// screen whose API refuses them (same ownerOnly rule AppSidebar applies).
export function tabMenuFor(tabId: ScreenId, role: Role): { title: string; items: TabMenuItem[] } | null {
  const menu = TAB_MENUS[tabId];
  if (!menu) return null;
  if (role !== 'owner' && role !== 'manager') return null;
  const items = menu.items.filter((item) => role === 'owner' || !item.ownerOnly);
  // One item left after filtering is not a menu — it is a redirect with an
  // extra tap in front of it.
  return items.length > 1 ? { title: menu.title, items } : null;
}

function getTabsForRole(role: NavContext['role']) {
  if (role === 'worker') return WORKER_TABS;
  if (role === 'super_admin') return ADMIN_TABS; // UI "admin" → backend "super_admin"
  if (role === 'manager') return MANAGER_TABS;
  if (role === 'vet') return VET_TABS;
  if (role === 'auditor') return AUDITOR_TABS;
  return OWNER_TABS;
}

/* Where each role lands on login (issue #219 role decisions). */
function startScreenForRole(role: Role): ScreenId {
  if (role === 'worker') return 'worker-home';
  if (role === 'super_admin') return 'admin-dashboard';
  if (role === 'vet') return 'vet-herd';
  if (role === 'auditor') return 'auditor-reports';
  return 'dashboard'; // owner / manager
}

/* Screens vet/auditor may navigate to — everything else on a deep link/back/
 * programmatic navigate() attempt for these two roles is rewritten to
 * 'role-notice' (see guardDestination below). null means "no restriction"
 * (owner/manager/worker/super_admin keep their existing, unrestricted
 * client-side navigation — this only narrows the two roles that previously
 * had zero screens at all). This is a UX guard, not the access-control
 * boundary — the real boundary is server-side (each API route's own role
 * check, e.g. lib/reports.ts's REPORT_VIEWER_ROLES and POST /api/records'
 * auditor block), so a vet/auditor client that somehow reached a
 * disallowed screen still can't read/write data it shouldn't via the API. */
function allowedScreensForRole(role: Role): Set<ScreenId> | null {
  if (role === 'vet') return new Set<ScreenId>(['vet-herd']);
  if (role === 'auditor') return new Set<ScreenId>(['auditor-reports']);
  return null;
}

function guardDestination(role: Role, dest: ScreenId): ScreenId {
  const allowed = allowedScreensForRole(role);
  if (!allowed) return dest;
  return allowed.has(dest) ? dest : 'role-notice';
}

export function NavProvider({ children, initialRole = 'owner', initialTenantId }: { children: React.ReactNode; initialRole?: NavContext['role']; initialTenantId?: string }) {
  const [role, setRole] = useState<NavContext['role']>(initialRole);
  const startScreen: ScreenId = startScreenForRole(initialRole);
  const [current, setCurrent] = useState<ScreenId>(startScreen);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  // True while a screen swap is rendering. Exposed through the nav context so
  // the shell can show the tap was received — a transition without one reads
  // as a dead button on exactly the slow devices it was added for.
  const [isNavigating, startTransition] = useTransition();
  const [params, setParams] = useState<Record<string, string>>({});
  // Canonical filter value (farm-scoped-data task) — a real farms.id, or
  // 'ALL'. Starts at 'ALL' (not a phantom farm code — see the NavCtx default
  // above for why that used to be a bug), so every screen renders its
  // unfiltered/aggregate view until the user actually picks a farm.
  const [activeFarmId, setActiveFarmId] = useState('ALL');
  const tenantId = initialTenantId ?? PROVISIONAL_TENANT_ID;

  // The tenant's farms for the switcher, from GET /api/farms.
  // Starts EMPTY, not with the mock set. Seeding this from FARMS_DATA put
  // "Nakuru Main Farm" and "Eldoret Satellite Farm" in a real account's farm
  // switcher on first paint — and left them there permanently whenever the
  // fetch below failed rather than answering, which is exactly what happened
  // to every super_admin while GET /api/farms rejected their session. A farm
  // switcher showing two farms that do not exist is worse than one showing
  // none: the second is obviously loading, the first is quietly wrong, and
  // every screen keyed on activeFarmId inherits it.
  const [farms, setFarms] = useState<FarmSummary[]>([]);
  useEffect(() => {
    let cancelled = false;
    apiClient.get<{ id: string; code: string; name: string; location: string }[]>(
      `/api/farms?tenantId=${tenantId}`
    ).then(res => {
      if (cancelled) return;
      // A successful response is authoritative even when it's empty: a
      // super_admin (no tenant) and a freshly provisioned tenant both
      // legitimately have zero farms, and keeping the mock set there put
      // demo farms — "Rift Valley Poultry" and friends — in the switcher of
      // a real, live account. The mock is only a fallback for the standalone
      // app, which has no /api/farms route at all and so fails the request
      // outright rather than answering with [].
      if (res.success && Array.isArray(res.data)) {
        const real = res.data.map(f => ({ id: f.id, code: f.code || f.id, name: f.name, location: f.location ?? '' }));
        setFarms(real);
        // 'ALL' is always valid and needs no correction. If activeFarmId
        // somehow points at an id this fetch didn't return (e.g. it was
        // archived, or a stale mock id from the initial state above), fall
        // back to 'ALL' rather than guess at a replacement farm — landing on
        // an arbitrary "first farm" would silently swap what the user is
        // looking at out from under them.
        setActiveFarmId(prev => (prev === 'ALL' || real.some(f => f.id === prev)) ? prev : 'ALL');
      }
    });
    return () => { cancelled = true; };
  }, [tenantId]);

  // Display-only farm CODE derived from activeFarmId (see the NavContext
  // interface comment for why fetches must never key on this instead).
  const activeFarm = activeFarmId === 'ALL' ? 'ALL' : (farms.find(f => f.id === activeFarmId)?.code ?? 'ALL');

  // vet/auditor are restricted to their own screen (see allowedScreensForRole) —
  // any other destination is rewritten to the role notice (single enforcement
  // point; startScreenForRole handles the initial screen, this guard covers
  // deep links / back / any future caller).
  const navigate = useCallback((to: ScreenId, p?: Record<string, string>) => {
    const dest = guardDestination(role, to);
    const nextParams = p ?? {};
    // Push the screen being left along with the params it was showing —
    // not the destination's params — so a later goBack() can restore them.
    setHistory((h) => pushHistoryEntry(h, { screen: current, params }));
    // ── Why the screen swap is a transition (INP) ─────────────────────────
    // Measured on a real device: tapping a nav item gave INP 1,288ms, of
    // which input delay was 1ms and the handler 21ms — the other ~1,266ms was
    // PRESENTATION delay. Nothing here was slow; the browser simply could not
    // paint, because these setStates were urgent and app/page.tsx mounts the
    // whole destination screen in the same frame. Some of those screens are
    // 2,000 lines of component, so React's render, layout and paint all had
    // to finish before the tap could show any feedback at all.
    //
    // Marking the swap as a transition lets React paint the pressed state
    // first and build the new screen without blocking that frame. The screen
    // still arrives as fast as the work allows — what changes is that the UI
    // stops being frozen while it happens, which is exactly what INP
    // measures. `isNavigating` below is what keeps that honest: a transition
    // with no pending indicator just looks like a tap that did nothing.
    //
    // NOT wrapped: pushState, which must stay in the gesture's own task, and
    // setHistory, which is a cheap array push nothing renders from.
    startTransition(() => {
      setCurrent(dest);
      setParams(nextParams);
    });
    // Mirror onto the browser History API (Android/browser Back fix): a real
    // history entry per in-app navigation is what gives the Back gesture
    // something of ours to pop, instead of leaving/closing the app. Same
    // path ('/'), only the hash changes, so Next.js routing/refresh are
    // unaffected.
    if (typeof window !== 'undefined') {
      window.history.pushState({ screen: dest, params: nextParams }, '', encodeScreen(dest, nextParams));
    }
  }, [role, current, params]);
  const goBack = useCallback(() => {
    // Defer to the browser: window.history.back() fires a popstate event,
    // and the popstate handler below does the actual React-state pop via
    // popHistoryEntry. Popping here too would double-pop (one entry lost
    // per Back press).
    if (typeof window !== 'undefined') {
      window.history.back();
      return;
    }
    // No window (shouldn't happen — goBack is only reachable from a click):
    // fall back to popping directly so the call is never a silent no-op.
    const { history: rest, entry } = popHistoryEntry(history);
    if (!entry) return;
    setHistory(rest);
    // Same reason as navigate(): going back mounts a whole screen too.
    startTransition(() => {
      setCurrent(entry.screen);
      setParams(entry.params);
    });
  }, [history]);

  // `history` mirrored into a ref so the popstate handler (registered once)
  // always pops the latest stack without needing to be re-subscribed on
  // every push — re-adding the listener on every navigate() would risk
  // missing/duplicating a popstate delivered mid-render.
  const historyRef = useRef(history);
  useEffect(() => { historyRef.current = history; }, [history]);

  // Handles the actual Back/Forward navigation (Android hardware/gesture back,
  // browser back button, or swipe). Prefers our own history stack via
  // popHistoryEntry so params restoration keeps working exactly as issue
  // #320 intended; event.state is only a fallback/cross-check for when our
  // stack is already empty (e.g. after a hard refresh mid-flow).
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onPopState = (event: PopStateEvent) => {
      // The Android back gesture lands here and mounts a screen exactly like
      // navigate() does, so it gets the same treatment — this is the
      // interaction a phone user makes most.
      const { history: rest, entry } = popHistoryEntry(historyRef.current);
      if (entry) {
        setHistory(rest);
        startTransition(() => {
          setCurrent(entry.screen);
          setParams(entry.params);
        });
        return;
      }
      const state = event.state as { screen?: string; params?: Record<string, string> } | null;
      if (state && typeof state.screen === 'string' && isScreenId(state.screen)) {
        const guarded = guardDestination(role, state.screen);
        startTransition(() => {
          setCurrent(guarded);
          setParams(state.params ?? {});
        });
      } else {
        // Nothing usable to restore — land on the role's start screen rather
        // than crash or leak whatever `current` happened to be.
        startTransition(() => {
          setCurrent(startScreenForRole(role));
          setParams({});
        });
      }
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [role]);

  // On mount, honor a deep-link hash (e.g. a bookmarked/reloaded `#crops`) —
  // but only through the same role guard navigate() applies, so vet/auditor
  // still land on role-notice and an unknown/invalid hash never crashes or
  // leaks a screen the role can't see; it falls back to the role's normal
  // start screen instead. replaceState makes the first entry well-formed so
  // the very next Back press has real state to pop.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const decoded = decodeHash(window.location.hash);
    let initialScreen: ScreenId;
    let initialParams: Record<string, string>;
    if (decoded) {
      const guarded = guardDestination(role, decoded.screen);
      initialScreen = guarded;
      initialParams = guarded === decoded.screen ? decoded.params : {};
    } else {
      initialScreen = startScreenForRole(role);
      initialParams = {};
    }
    setCurrent(initialScreen);
    setParams(initialParams);
    window.history.replaceState({ screen: initialScreen, params: initialParams }, '', encodeScreen(initialScreen, initialParams));
    // Mount-only: this restores whatever hash the page loaded with once, for
    // this NavProvider instance (a fresh instance is mounted per login).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Real nav-badge counts (issue #293): pendingApprovals from GET /api/approvals
  // (status=pending, server-side filtered) and unreadNotifs from GET
  // /api/notifications (client-side filtered on `read`, same convention
  // dashboard.tsx already uses). Fetched once per navigation mount / tenant
  // change — a v1-proportionate replacement for the old hardcoded literals,
  // not new polling infra. Defaults stay 0 so a tenant with no real pending
  // approvals/unread notifications shows no fake badge.
  //
  // Re-fetched on `activeFarmId` change too (farm-scoped-data task):
  // pendingApprovals and openTasksCount are both farm-scopable server-side
  // (see GET /api/approvals and GET /api/dashboard/kpis's header comments)
  // — switching farms now changes these badges for real. unreadNotifs stays
  // tenant-wide (notifications has no farm relationship at all) and is
  // fetched the same way regardless of activeFarmId.
  const [pendingApprovals, setPendingApprovals] = useState(0);
  const [unreadNotifs, setUnreadNotifs] = useState(0);
  // issue #298: tasks tab badge reuses GET /api/dashboard/kpis's activeTasksCount
  // (tenant's tasks not DONE/CANCELLED, already computed server-side by that
  // route) rather than re-deriving the same DONE_STATUSES filter a second time
  // client-side.
  const [openTasksCount, setOpenTasksCount] = useState(0);
  useEffect(() => {
    let cancelled = false;
    // Scoped the same way the governance queue is (see its loadApprovals):
    // a badge counting decisions that are somebody else's to make sends the
    // user to a screen where those rows aren't even listed.
    const approvalScope = role === 'owner' ? '' : '&scope=mine'
    apiClient.get<{ id: string }[]>(`/api/approvals?tenantId=${tenantId}&status=pending&farmId=${activeFarmId}${approvalScope}`).then(res => {
      if (!cancelled && res.success && Array.isArray(res.data)) setPendingApprovals(res.data.length);
    });
    apiClient.get<{ read: boolean }[]>(`/api/notifications?tenantId=${tenantId}`).then(res => {
      if (!cancelled && res.success && Array.isArray(res.data)) {
        setUnreadNotifs(res.data.filter(n => !n.read).length);
      }
    });
    apiClient.get<{ activeTasksCount: number }>(`/api/dashboard/kpis?tenantId=${tenantId}&farmId=${activeFarmId}`).then(res => {
      if (!cancelled && res.success && res.data && typeof res.data.activeTasksCount === 'number') {
        setOpenTasksCount(res.data.activeTasksCount);
      }
    });
    return () => { cancelled = true; };
    // `role` is in here because the approvals badge is scoped by it — an
    // impersonation switch that changed role without refetching would show
    // the previous role's count.
  }, [tenantId, activeFarmId, role]);

  // issue #298: admin-onboarding tab badge — real count of `onboard_requests`
  // rows with status 'pending' (issue #251/#252). GET /api/onboard-requests is
  // the super_admin review queue (403s for every other role), so this only
  // fetches — and only ever shows a badge — for a super_admin session.
  const [pendingOnboardingRequests, setPendingOnboardingRequests] = useState(0);
  useEffect(() => {
    if (role !== 'super_admin') { setPendingOnboardingRequests(0); return; }
    let cancelled = false;
    apiClient.get<{ status: string }[]>('/api/onboard-requests').then(res => {
      if (!cancelled && res.success && Array.isArray(res.data)) {
        setPendingOnboardingRequests(res.data.filter(r => r.status === 'pending').length);
      }
    });
    return () => { cancelled = true; };
  }, [role]);

  // ── Setup progress (setup-sequence task) ──
  // GET /api/setup-state: ten real COUNT(*)s over this tenant's own rows,
  // turned into done/not-done per step of lib/onboarding-guide.ts server-side.
  //
  // Only owner/manager fetch it. A worker cannot complete any of these steps
  // (every one is an owner action), a vet/auditor never sees a screen that
  // renders it, and a super_admin has no single tenant whose setup this would
  // describe — asking for it in those sessions would be a request whose answer
  // is discarded at best and misleading at worst.
  //
  // Stays `null` on failure. Not "0 of 9": a farm with everything configured
  // must never be told it has nothing set up because one request timed out on
  // a patchy connection, which is the normal case for this app's users.
  const [setupState, setSetupState] = useState<SetupState | null>(null);
  // Bumped by refreshSetupState() to re-run the effect below — a plain counter
  // rather than calling the fetch directly so there is exactly one code path
  // that writes `setupState`, cancellation included.
  const [setupNonce, setSetupNonce] = useState(0);
  const refreshSetupState = useCallback(() => { setSetupNonce((n) => n + 1); }, []);
  useEffect(() => {
    if (role !== 'owner' && role !== 'manager') { setSetupState(null); return; }
    let cancelled = false;
    // Deliberately NOT scoped by activeFarmId — see GET /api/setup-state's
    // header: half of what it counts (products, stock items, permission rules)
    // has no farm column at all, so a per-farm figure would be half-filtered
    // and would move when you flipped the switcher for no honest reason.
    apiClient.get<SetupState>(`/api/setup-state?tenantId=${tenantId}`).then(res => {
      if (cancelled) return;
      if (res.success && res.data && Array.isArray(res.data.steps)) setSetupState(res.data);
    });
    return () => { cancelled = true; };
  }, [tenantId, role, setupNonce]);

  return (
    <NavCtx.Provider value={{ current, history, role, params, activeFarmId, activeFarm, farms, tenantId, navigate, goBack, isNavigating, setActiveFarmId, pendingApprovals, unreadNotifs, openTasksCount, pendingOnboardingRequests, setupState, refreshSetupState }}>
      {/* Two pixels saying the tap landed while the next screen renders. */}
      {isNavigating && <div className="nav-progress" role="status" aria-label="Loading screen" />}
      {process.env.NODE_ENV !== 'production' && (
        <RoleSelector role={role} setRole={(r) => { setRole(r); setCurrent(startScreenForRole(r)); setHistory([]); }} />
      )}
      {children}
    </NavCtx.Provider>
  );
}

function RoleSelector({ role, setRole }: { role: NavContext['role']; setRole: (r: NavContext['role']) => void }) {
  // Dev-only overlay (gated by the NODE_ENV check where this is rendered —
  // see tests/nav-role-selector-gate.test.ts). Used to sit at top:0/right:0,
  // which is exactly where TopNav's real bell/search/sign-out cluster lives —
  // this covered those controls in every screen. Dropping it below the fixed
  // top-nav height (--nav-height) keeps it clear of that cluster and of the
  // bottom tab bar (mobile) without borrowing space either one uses.
  return (
    <div style={{ position: 'fixed', top: 'calc(var(--nav-height) + 8px)', right: 8, zIndex: 200, padding: '5px 8px' }}>
      <select value={role} onChange={(e) => setRole(e.target.value as NavContext['role'])}
        style={{ background: 'rgba(10,15,10,0.95)', border: '1px solid rgba(74,222,128,0.3)', color: '#4ade80', borderRadius: 8, fontSize: 'var(--fs-2xs)', padding: '3px 6px', cursor: 'pointer', fontWeight: 700 }}>
        {/* Plain text — a native <option> can't render an icon component,
            and this dev-only selector never ships to production anyway. */}
        <option value="owner">Owner</option>
        <option value="manager">Manager</option>
        <option value="worker">Worker</option>
        <option value="vet">Vet</option>
        <option value="auditor">Auditor</option>
        <option value="super_admin">Super Admin</option>
      </select>
    </div>
  );
}

/* ── Role notice (vet / auditor guard fallback) ──
 * vet and auditor now have real dedicated screens (Herd Health / Reports —
 * see vet.tsx / auditor.tsx), each reachable only through their own single
 * tab. This screen is what guardDestination() rewrites any OTHER
 * destination to for those two roles — e.g. a vet whose browser restores an
 * old '#finance' hash, or any future caller that tries to navigate() them
 * somewhere outside their remit. So the copy here is about the destination
 * being out of scope for the role, not about the role having no home at all
 * (decision originally documented in issue #219; narrowed by the vet/auditor
 * screens task). */
export function RoleNoticeScreen() {
  const { role } = useNav();
  const roleLabel = role === 'vet' ? 'Veterinarian' : role === 'auditor' ? 'Auditor' : 'this role';
  return (
    <div className="screen-content" style={{ padding: '0 20px' }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '72%', textAlign: 'center', paddingTop: 10 }}>
        <div style={{ width: 72, height: 72, borderRadius: '50%', background: 'rgba(96,165,250,0.1)', border: '1px solid rgba(96,165,250,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--accent-blue)', marginBottom: 18 }}>
          {role === 'vet' ? <Stethoscope size={32} aria-hidden="true" /> : <Search size={32} aria-hidden="true" />}
        </div>
        <div style={{ fontSize: 'var(--fs-xl)', fontWeight: 800, color: 'var(--text-primary)', marginBottom: 8 }}>Not available for your role</div>
        <div style={{ fontSize: 'var(--fs-base)', color: 'var(--text-muted)', lineHeight: 1.55, maxWidth: 300 }}>
          You&apos;re signed in as a <strong style={{ color: 'var(--text-secondary)' }}>{roleLabel}</strong>, which only has access to its own screen in this app. You can sign out below.
        </div>
        <button
          type="button"
          onClick={() => { if (_globalLogout) _globalLogout(); }}
          style={{ marginTop: 22, padding: '13px 34px', borderRadius: 14, fontSize: 'var(--fs-md)', fontWeight: 700, cursor: 'pointer',
            background: 'rgba(248,113,113,0.1)', border: '1px solid rgba(248,113,113,0.3)', color: 'var(--status-critical)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <LogOut size={14} /> Sign Out
        </button>
      </div>
    </div>
  );
}

/* The sheet a tab with several destinations opens. Deliberately the same
 * bottom-sheet shape the farm switcher and the sign-out confirm already use,
 * so it reads as part of the app rather than a new kind of thing. */
function TabMenuSheet({ menu, onClose }: { menu: { title: string; items: TabMenuItem[] }; onClose: () => void }) {
  const { navigate, setupState, pendingApprovals } = useNav();
  // The one step the setup card is currently pointing at, so the same "you are
  // here" thread runs through the menu: if the next thing to do is behind this
  // tab, the row that leads to it says so. Null once setup is complete, or
  // whenever setup state hasn't loaded — never guessed.
  const nextStep = setupState && !setupState.complete
    ? setupState.steps.find((s) => s.id === setupState.nextStepId) ?? null
    : null;

  return (
    <div
      style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'flex-end', zIndex: 400 }}
      onClick={onClose}
    >
      <div
        style={{ background: 'var(--surface)', borderRadius: '20px 20px 0 0', width: '100%', border: '1px solid var(--border-subtle)', maxHeight: '78%', display: 'flex', flexDirection: 'column' }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={`${menu.title} destinations`}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 18px 10px', flexShrink: 0 }}>
          <div>
            <div style={{ fontWeight: 800, fontSize: 'var(--fs-lg)', color: 'var(--text-primary)' }}>{menu.title}</div>
            <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', marginTop: 2 }}>What you can do here</div>
          </div>
          <button type="button" className="btn-icon" onClick={onClose} aria-label="Close"><X size={16} /></button>
        </div>
        <div style={{ overflowY: 'auto', padding: '0 14px 18px' }}>
          {menu.items.map((item) => {
            const Icon = item.icon;
            // Matches on screen AND the tab param, so "Production units"
            // highlights only when the next step is actually the units step,
            // not merely something else on the same screen.
            const isNext = !!nextStep?.goTo
              && nextStep.goTo.screen === item.screen
              && (nextStep.goTo.params?.tab ?? null) === (item.params?.tab ?? null);
            return (
              <button
                key={`${item.screen}:${item.params?.tab ?? ''}`}
                type="button"
                onClick={() => { onClose(); navigate(item.screen, item.params); }}
                style={{
                  width: '100%', display: 'flex', gap: 12, alignItems: 'center', textAlign: 'left',
                  padding: '12px 13px', marginBottom: 8, borderRadius: 14, cursor: 'pointer',
                  background: isNext ? 'rgba(74,222,128,0.1)' : 'var(--card)',
                  border: isNext ? '1px solid rgba(74,222,128,0.4)' : '1px solid var(--border-subtle)',
                }}
              >
                <div style={{ width: 34, height: 34, borderRadius: 11, flexShrink: 0, background: 'var(--surface)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Icon size={17} color={isNext ? 'var(--primary-green)' : 'var(--text-muted)'} aria-hidden="true" />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', gap: 7, alignItems: 'baseline', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 'var(--fs-base)', fontWeight: 700, color: 'var(--text-primary)' }}>{item.label}</span>
                    {isNext && (
                      <span className="chip" style={{ fontSize: 'var(--fs-2xs)', fontWeight: 800, color: 'var(--primary-green)' }}>Next step</span>
                    )}
                    {/* The Settings screen's mobile hub carried this badge
                        before that list was replaced by this menu. Same real
                        count from the same NavContext value (GET /api/approvals
                        ?status=pending), and still no badge at zero — an
                        explicit "0 pending" is the fake number this codebase
                        keeps deleting. */}
                    {item.screen === 'governance' && pendingApprovals > 0 && (
                      <span className="chip chip-warning" style={{ fontSize: 'var(--fs-2xs)' }}>{pendingApprovals} pending</span>
                    )}
                  </div>
                  <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', marginTop: 2, lineHeight: 1.45 }}>{item.desc}</div>
                </div>
                <ChevronRight size={16} color="var(--text-dim)" aria-hidden="true" style={{ flexShrink: 0 }} />
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ── Bottom Tab Bar ── */
export function BottomNav() {
  const { current, navigate, role, pendingApprovals, unreadNotifs, openTasksCount, pendingOnboardingRequests } = useNav();
  const tabs = getTabsForRole(role);
  // Which tab's contents are open, if any. Local to the bar — a menu is not
  // application state and must not survive a navigation.
  const [openMenu, setOpenMenu] = useState<ScreenId | null>(null);
  const menu = openMenu ? tabMenuFor(openMenu, role) : null;

  return (
    <>
      <nav className="bottom-nav" aria-label="Primary mobile">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = tabIsActive(current, tab.id);
          const badge = tabBadge(tab.id, pendingApprovals, unreadNotifs, openTasksCount, pendingOnboardingRequests);
          const hasMenu = tabMenuFor(tab.id, role) !== null;
          return (
            <button
              key={tab.id}
              type="button"
              className={`bottom-nav-item ${isActive ? 'active' : ''}`}
              // A tab with several destinations shows them; a tab with one goes
              // straight there. Same control, no long-press, no double-tap —
              // nothing a first-time user has to be told about.
              onClick={() => (hasMenu ? setOpenMenu(tab.id) : navigate(tab.id))}
              aria-current={isActive ? 'page' : undefined}
              aria-haspopup={hasMenu ? 'menu' : undefined}
              aria-expanded={hasMenu ? openMenu === tab.id : undefined}
              // Anchor for the guided tour (components/farm/tour.tsx). The
              // sidebar's equivalent button carries the same id — only one of
              // the two shells is visible at a time, and the tour picks
              // whichever one that is.
              data-tour={`nav-${tab.id}`}
            >
              <Icon className="nav-icon" size={22} />
              {badge !== null && <NavBadge count={badge} tabId={tab.id} />}
              {/* The caret is the whole affordance: it is what distinguishes a
                  tab that opens a list from one that navigates, before you
                  have tapped either. 9px and inline with the label so it costs
                  no vertical space in a 68px bar. */}
              <span className="nav-label" style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
                {tab.label}
                {hasMenu && <ChevronUp size={9} aria-hidden="true" />}
              </span>
            </button>
          );
        })}
      </nav>
      {menu && <TabMenuSheet menu={menu} onClose={() => setOpenMenu(null)} />}
    </>
  );
}

/* Screen-reader label per tab kind, so the badge announces what the number
 * means ("5 pending approvals") instead of a bare "5" with no context. The
 * digits themselves are aria-hidden so they aren't announced a second time. */
function badgeAriaLabel(tabId: ScreenId, count: number): string {
  if (tabId === 'governance') return `${count} pending approval${count === 1 ? '' : 's'}`;
  if (tabId === 'tasks') return `${count} open task${count === 1 ? '' : 's'}`;
  if (tabId === 'dashboard') return `${count} unread notification${count === 1 ? '' : 's'}`;
  if (tabId === 'admin-onboarding') return `${count} pending request${count === 1 ? '' : 's'}`;
  return `${count}`;
}

function NavBadge({ count, tabId, className = 'nav-badge' }: { count: number; tabId: ScreenId; className?: string }) {
  return (
    <span className={className} role="status" aria-label={badgeAriaLabel(tabId, count)}>
      <span aria-hidden="true">{count}</span>
    </span>
  );
}

/* Badge counts shared by BottomNav (mobile) and AppSidebar (desktop). All four
 * are real counts (issue #293 for governance/dashboard, issue #298 for
 * tasks/admin-onboarding) — no hardcoded literals. A tenant/session with 0 of
 * any of these shows no badge, not a fake number. */
export function tabBadge(tabId: ScreenId, pendingApprovals: number, unreadNotifs: number, openTasksCount: number, pendingOnboardingRequests: number): number | null {
  if (tabId === 'governance' && pendingApprovals > 0) return pendingApprovals;
  if (tabId === 'tasks' && openTasksCount > 0) return openTasksCount;
  if (tabId === 'dashboard' && unreadNotifs > 0) return unreadNotifs;
  if (tabId === 'admin-onboarding' && pendingOnboardingRequests > 0) return pendingOnboardingRequests;
  return null;
}

/* Active-tab detection shared by BottomNav (mobile) and AppSidebar (desktop). */
function tabIsActive(current: ScreenId, tabId: ScreenId): boolean {
  const SUB_SCREENS: Record<string, ScreenId[]> = {
    settings: ['people','governance','reports','inventory','weather','notification-settings','ui-customise','ai-chat','about','routines','getting-started'],
    crops: ['batch-detail','crop-schedule'],
    // Enterprise requests (widen an existing tenant's scope) has no tab of
    // its own — it's reached from the Onboarding queue and the Overview
    // quick actions (see admin-enterprise-requests.tsx) rather than a 6th
    // bottom-nav icon, which would squeeze five already-tight labels at
    // 360px. Grouping it under 'admin-onboarding' here keeps the Requests
    // tab visually "on" while it's open, instead of no tab lighting up at all.
    'admin-onboarding': ['admin-onboarding', 'admin-enterprise-requests'],
  };
  return current === tabId || (SUB_SCREENS[tabId] ?? []).includes(current);
}

/* Desktop has first-class destinations that sit under mobile's "More" tab.
 * Keep their active state tied to the actual destination, not to Settings. */
function sidebarIsActive(current: ScreenId, tabId: ScreenId): boolean {
  const DETAIL_SCREENS: Partial<Record<ScreenId, ScreenId[]>> = {
    // farm-config is reached from the Farm menu, so it belongs to this row.
    crops: ['batch-detail', 'crop-schedule', 'farm-config'],
    inventory: ['inventory-detail'],
    people: ['people-detail'],
    // Same reasoning as tabIsActive's SUB_SCREENS above — enterprise requests
    // has no sidebar row of its own on the super_admin's plain tab list.
    'admin-onboarding': ['admin-enterprise-requests'],
    // 'routines', 'getting-started' and 'ai-chat' used to fold into Settings
    // here, because none of them had a sidebar row of its own. All three do
    // now (see AppSidebar's groups), so folding them in would light up the
    // wrong item.
    settings: ['notification-settings', 'ui-customise', 'about', 'security-settings'],
  };
  return current === tabId || (DETAIL_SCREENS[tabId] ?? []).includes(current);
}

/* ── Desktop Sidebar (issue #220) ──
 * Same tab set BottomNav drives (getTabsForRole). Shown >=1024px via CSS, where
 * BottomNav is hidden; rendered on all sizes so the tab set lives in one place. */
export function AppSidebar() {
  const { current, navigate, role, pendingApprovals, unreadNotifs, openTasksCount, pendingOnboardingRequests, activeFarmId, farms, setActiveFarmId, setupState } = useNav();
  const tabs = getTabsForRole(role);
  /* ── Grouped by WHEN you need it, not by what department owns it ──
   * (setup-sequence task; before this the three groups were Overview /
   * Operations / Business.)
   *
   * The owner's complaint was that every destination looked equally like a
   * starting point. Alphabet-soup department headings are part of why: they
   * tell you which team owns a screen, which is not a question a farmer
   * standing in a shed has. These four say where in the life of the farm the
   * screen belongs, which IS the sequence — set the farm up, then run it day
   * to day, then read the business off it.
   *
   * "Set up your farm" appears in the first group ONLY while setup is
   * unfinished, and carries its real position ("4 of 9") from
   * GET /api/setup-state. It is one row pointing at one existing screen, not a
   * parallel menu: nothing is reachable through it that is not reachable
   * without it.
   *
   * Labels changed for the same reason: "Fields & crops" named half of what
   * that screen holds and named it wrong for a poultry farm — its four tabs
   * are Livestock, Crops, Units and Products, which is "Units & batches".
   * "Workers" → "People" matches the screen's own title and the guide's
   * wording ("Add employees, then give each one a login").
   */
  const enterpriseGroups = [
    { label: 'Start here', items: [
      { id: 'dashboard' as ScreenId, label: 'Dashboard', icon: Home, ownerOnly: false },
      // Rendered only while there is something left to do — see the filter
      // below. Once setup is complete this row disappears entirely rather
      // than sitting there as a permanent tick, which is the "get out of the
      // way" half of the brief.
      { id: 'getting-started' as ScreenId, label: 'Set up your farm', icon: ClipboardList, ownerOnly: false, setupOnly: true },
    ] },
    { label: 'Set up your farm', items: [
      { id: 'crops' as ScreenId, label: 'Units & batches', icon: Leaf, ownerOnly: false },
      { id: 'inventory' as ScreenId, label: 'Inventory', icon: Package, ownerOnly: false },
      { id: 'people' as ScreenId, label: 'People', icon: Users, ownerOnly: false },
    ] },
    { label: 'Day to day', items: [
      { id: 'tasks' as ScreenId, label: 'Tasks', icon: CheckSquare, ownerOnly: false },
      // Daily routines had no sidebar entry at all — it was reachable only
      // through mobile's hub list and the dashboard tile, despite being one
      // of the nine setup steps. A step the guide tells you to do needs a
      // door in the shell that names it.
      { id: 'routines' as ScreenId, label: 'Daily routines', icon: Sunrise, ownerOnly: false },
      { id: 'weather' as ScreenId, label: 'Weather', icon: CloudSun, ownerOnly: false },
      // The advisor had no sidebar row either — it was a dashboard tile and a
      // line inside mobile's hub list, which is precisely the "I struggle
      // finding it when new" the owner reported. A screen people ask for by
      // name needs a row that says its name.
      { id: 'ai-chat' as ScreenId, label: 'AI advisor', icon: Bot, ownerOnly: false },
    ] },
    { label: 'Business', items: [
      // 'governance' used to be dead code: tabBadge() already had a branch
      // returning pendingApprovals for it, but no tab set and no sidebar
      // group ever listed 'governance' as a destination, so that badge never
      // rendered anywhere in the app. Adding it here is what makes it live.
      { id: 'governance' as ScreenId, label: 'Governance', icon: Shield, ownerOnly: false },
      { id: 'finance' as ScreenId, label: 'Finance', icon: DollarSign, ownerOnly: true },
      { id: 'reports' as ScreenId, label: 'Reports', icon: FileText, ownerOnly: true },
      { id: 'settings' as ScreenId, label: 'Settings', icon: Settings, ownerOnly: false },
    ] },
  ];
  // Progress text for the setup row, e.g. "4 of 9". Absent (not "0 of 9")
  // while setupState is null — the row only claims a position once the server
  // has actually told it one.
  const setupIncomplete = !!setupState && !setupState.complete;
  const setupProgressLabel = setupState && !setupState.complete
    ? `${setupState.completed} of ${setupState.total}`
    : null;
  // Manager still can't see Finance/Reports — same restriction as before,
  // now expressed per-item (ownerOnly) instead of by dropping whole groups.
  // Owner sees everything; worker/super_admin keep the flat tab-set fallback.
  const groups = role === 'owner' || role === 'manager'
    ? enterpriseGroups
        .map((group) => ({
          label: group.label,
          items: group.items.filter((item) =>
            (role === 'owner' || !item.ownerOnly) &&
            // The setup row exists only while setup is unfinished. `setupOnly`
            // is checked against real server state, so a tenant whose fetch
            // failed (setupState null) does NOT get the row either — better to
            // omit it than to show "set up your farm" to a farm that is
            // already running.
            (!('setupOnly' in item && item.setupOnly) || setupIncomplete)
          ),
        }))
        // A group can empty out (Start here never does, but keeping this
        // general means a future ownerOnly-only group doesn't leave a bare
        // heading behind).
        .filter((group) => group.items.length > 0)
    : [{ label: 'Workspace', items: tabs }];
  // Platform-admin screens are tenant-scoped, not farm-scoped: they carry
  // their own tenant picker and never read activeFarmId.
  const showFarmFilter = farms.length > 0 && !current.startsWith('admin-');

  return (
    <aside className="farm-sidebar">
      <div className="farm-sidebar-brand">
        <Leaf size={23} color="var(--primary-green)" strokeWidth={2.2} />
        <div>
          <div style={{ fontSize: 'var(--fs-lg)', fontWeight: 800, color: 'var(--text-primary)' }}>IFMS</div>
          <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>Farm management</div>
        </div>
      </div>
      <nav style={{ flex: 1, overflowY: 'auto', padding: '10px 12px' }} aria-label="Primary">
        {groups.map((group) => (
          <div key={group.label} style={{ marginBottom: 16 }}>
            <div style={{ padding: '0 12px', margin: '8px 0 5px', fontSize: 'var(--fs-xs)', fontWeight: 650, color: 'var(--text-dim)' }}>{group.label}</div>
            {group.items.map((tab) => {
          const Icon = tab.icon;
          const active = sidebarIsActive(current, tab.id);
          const badge = tabBadge(tab.id, pendingApprovals, unreadNotifs, openTasksCount, pendingOnboardingRequests);
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => navigate(tab.id)}
              aria-current={active ? 'page' : undefined}
              data-tour={`nav-${tab.id}`}
              style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', marginBottom: 2,
                borderRadius: 10, cursor: 'pointer', textAlign: 'left', position: 'relative',
                // Was a hardcoded #e8f0e9 / #c9ddcc pair — switched to the same
                // rgba(primary-green) active tint the rest of this file already
                // uses (farmBadge chip, LogoutButton, RoleNoticeScreen), so this
                // no longer breaks in a dark theme.
                background: active ? 'rgba(74,222,128,0.1)' : 'transparent',
                border: active ? '1px solid rgba(74,222,128,0.25)' : '1px solid transparent',
                color: active ? 'var(--primary-green)' : 'var(--text-muted)', fontWeight: active ? 700 : 500, fontSize: 'var(--fs-base)' }}>
              <Icon size={18} />
              <span style={{ flex: 1 }}>{tab.label}</span>
              {/* Position, not a count. A red circle with "4" in it would read
                  as four things wrong; "4 of 9" reads as progress, which is
                  what it is. Only ever rendered from real server state. */}
              {tab.id === 'getting-started' && setupProgressLabel && (
                <span
                  className="chip"
                  style={{ fontSize: 'var(--fs-2xs)', fontWeight: 800, color: 'var(--primary-green)', flexShrink: 0 }}
                >
                  {setupProgressLabel}
                </span>
              )}
              {badge !== null && <NavBadge count={badge} tabId={tab.id} />}
            </button>
          );
            })}
          </div>
        ))}
      </nav>
      <div style={{ padding: '12px 14px', borderTop: '1px solid var(--border-subtle)', flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {/* The farm row used to be plain, non-interactive text — the only way
         * to switch farms was a bottom sheet inside dashboard.tsx, which the
         * desktop shell never surfaces. A native <select> is the lowest-risk
         * control (no custom popover to build/maintain); 'ALL' mirrors the
         * same all-farms convention dashboard.tsx's own switcher uses.
         *
         * Hidden where it would do nothing: the platform admin screens are
         * scoped by TENANT (they have their own tenant picker) and read
         * activeFarmId nowhere, so a farm filter sitting in the sidebar there
         * only invites the question of what it's filtering. Hidden too when
         * the account has no farms — an owner mid-setup, or a super_admin,
         * who would otherwise see a control offering only "All farms". */}
        {showFarmFilter && (
        <label style={{ display: 'block' }} data-tour="farm-switcher">
          <span style={{ fontSize: 'var(--fs-2xs)', color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.03em' }}>Farm</span>
          <select
            value={activeFarmId}
            onChange={(e) => setActiveFarmId(e.target.value)}
            style={{ width: '100%', marginTop: 2, padding: '6px 8px', borderRadius: 8, border: '1px solid var(--border-subtle)',
              background: 'var(--card)', color: 'var(--text-primary)', fontSize: 'var(--fs-sm)', fontWeight: 600, cursor: 'pointer' }}
          >
            <option value="ALL">All farms</option>
            {farms.map((farm) => (
              <option key={farm.id} value={farm.id}>{farm.name}</option>
            ))}
          </select>
        </label>
        )}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontSize: 'var(--fs-2xs)', color: 'var(--text-dim)', textTransform: 'capitalize' }}>{role}</div>
          {/* Sign-out was only reachable from the mobile TopNav before this —
           * desktop users had no sign-out control anywhere. Reuses the same
           * LogoutButton (and its _globalLogout mechanism/confirm sheet), not
           * a second logout path. */}
          <LogoutButton />
        </div>
      </div>
    </aside>
  );
}

/* ── Top Nav Bar ── */
export function TopNav({
  title, subtitle, showBack = false, showSearch = false, showBell = false,
  rightEl, farmBadge,
}: {
  title: string; subtitle?: string; showBack?: boolean; showSearch?: boolean;
  showBell?: boolean; rightEl?: React.ReactNode; farmBadge?: string;
}) {
  const { goBack, unreadNotifs, navigate, role } = useNav();

  return (
    <div className="top-nav">
      {/* Left slot is back-or-nothing now — it used to fall back to the
       * sign-out button when showBack was false, which put sign-out in the
       * exact spot users build muscle memory for "back" on every other
       * screen (a stray tap there used to sign them out). Sign-out now lives
       * in the right-hand cluster below instead. */}
      {showBack && (
        <button type="button" className="btn-icon" onClick={goBack} style={{ width: 36, height: 36, minWidth: 36 }}>
          <ChevronLeft size={18} />
        </button>
      )}
      <div style={{ flex: 1 }}>
        <div className="top-nav-title" style={{ fontSize: 'var(--fs-2xl)', fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.2 }}>{title}</div>
        {subtitle && <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', marginTop: 3 }}>{subtitle}</div>}
        {farmBadge && (
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: 'rgba(74,222,128,0.08)', border: '1px solid rgba(74,222,128,0.2)', borderRadius: 100, padding: '2px 8px', marginTop: 3 }}>
            <span style={{ fontSize: 'var(--fs-xs)', fontWeight: 600, color: 'var(--primary-green)' }}>{farmBadge}</span>
          </div>
        )}
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        {rightEl}
        {showSearch && <button type="button" className="btn-icon"><Search size={16} /></button>}
        {showBell && (
          <button type="button" className="btn-icon" style={{ position: 'relative' }} onClick={() => navigate('notifications')}>
            <Bell size={16} />
            {unreadNotifs > 0 && (
              <span style={{ position: 'absolute', top: 6, right: 6, width: 8, height: 8, background: 'var(--status-critical)', borderRadius: '50%' }} />
            )}
          </button>
        )}
        <LogoutButton />
      </div>
    </div>
  );
}

/* Logout button — reads LogoutCtx lazily from a global ref set in page.tsx */
let _globalLogout: (() => void) | null = null;
export function setGlobalLogout(fn: () => void) { _globalLogout = fn; }

// Any screen can trigger the same app logout the TopNav button uses (issue
// #322: Worker Profile's "Sign Out" had no onClick at all). No-op before
// page.tsx registers the handler — same lazy contract as above.
export function requestLogout() { _globalLogout?.(); }

function LogoutButton() {
  const [showMenu, setShowMenu] = React.useState(false);

  function doLogout() {
    setShowMenu(false);
    if (_globalLogout) _globalLogout();
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setShowMenu(true)}
        style={{ width: 32, height: 32, borderRadius: 10, background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0 }}
        title="Sign out"
        aria-label="Sign out"
      >
        <LogOut size={14} color="var(--status-critical)" />
      </button>

      {showMenu && (
        <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'flex-end', zIndex: 500 }} onClick={() => setShowMenu(false)}>
          <div style={{ background: 'var(--surface)', borderRadius: '20px 20px 0 0', padding: 20, width: '100%', border: '1px solid var(--border-subtle)' }} onClick={e => e.stopPropagation()}>
            <div style={{ fontWeight: 700, fontSize: 'var(--fs-md)', marginBottom: 4, color: 'var(--text-primary)' }}>Sign Out</div>
            <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', marginBottom: 16 }}>You will be returned to the login screen.</div>
            <button type="button" onClick={doLogout} style={{ width: '100%', padding: '13px', borderRadius: 14, background: 'rgba(248,113,113,0.1)', border: '1px solid rgba(248,113,113,0.3)', color: 'var(--status-critical)', fontWeight: 700, fontSize: 'var(--fs-md)', cursor: 'pointer' }}>
              Sign Out
            </button>
            <button type="button" onClick={() => setShowMenu(false)} style={{ width: '100%', marginTop: 10, padding: '11px', borderRadius: 12, background: 'transparent', border: '1px solid var(--border-subtle)', color: 'var(--text-muted)', fontWeight: 600, fontSize: 'var(--fs-base)', cursor: 'pointer' }}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </>
  );
}
