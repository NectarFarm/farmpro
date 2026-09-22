'use client';
import React, { useState, useEffect, useRef, createContext, useContext, useCallback, useTransition } from 'react';
import { Home, Leaf, Package, CloudSun, DollarSign, CheckSquare, Users, Shield, BarChart3, Settings, Bell, ChevronLeft, Search, Plus, UserCircle, DoorOpen, FileText, UserCheck, Heart, Eye, Stethoscope, ClipboardList, Sunrise, Layers, Bot, ChevronUp, ChevronDown, ChevronRight, X, Key, Activity, Building2, Warehouse, PawPrint, Sprout, PanelLeftClose, PanelLeftOpen, SlidersHorizontal, MoreVertical, MapPin, CreditCard, HelpCircle } from './icons';
import { apiClient } from '@/lib/request';
import { useConfirm } from './ui-shared';
import type { SetupState } from '@/lib/setup-state';

/* ── Screen registry ── */
export type ScreenId =
  | 'dashboard' | 'crops' | 'inventory' | 'weather' | 'finance'
  | 'tasks' | 'people' | 'governance' | 'reports' | 'settings'
  | 'notifications' | 'ai-chat'
  | 'worker-home' | 'worker-record' | 'worker-pay' | 'worker-profile'
  | 'admin-dashboard' | 'admin-farms' | 'admin-settings' | 'admin-onboarding' | 'admin-users'
  | 'admin-enterprise-requests' | 'admin-tickets'
  | 'batch-detail' | 'crop-schedule' | 'inventory-detail'
  | 'people-detail'
  | 'notification-settings'
  | 'ui-customise' | 'security-settings' | 'role-notice' | 'routines'
  | 'farm-config'
  | 'dimensions'
  | 'auditor-reports' | 'vet-herd' | 'about' | 'getting-started'
  // SaaS back-office UI (package H2): plan selection/gate, billing, support.
  | 'plan-select' | 'billing' | 'support' | 'support-ticket';

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
  /* owner-roast finding #5: re-read pendingApprovals/unreadNotifs/openTasksCount.
   * These used to be fetched once per NavProvider mount (it wraps the whole
   * app and outlives screen switches) while a screen like Notifications or
   * Dashboard re-fetches the SAME underlying counts on every one of ITS OWN
   * mounts — so marking a notification read on one screen left the nav
   * badge (sidebar/bottom-nav) showing the old, higher number until a farm
   * switch happened to force a re-fetch. Same fix shape as
   * refreshSetupState: called by whatever screen just changed one of these
   * counts, so the badge and the screen agree immediately. */
  refreshBadges: () => void;
  /* Session user's display name, from GET /api/auth/session. Empty until the
   * shell has it — the sidebar then falls back to the role label rather than
   * inventing a person. */
  userName: string;
  /* ── SaaS back-office (package H2) ──
   * From GET /api/auth/session's additive `subscription` field at boot,
   * refreshable via GET /api/billing/subscription (docs/backoffice-api.md).
   * `null` for a super_admin session (the concept doesn't apply) and for any
   * tenant session before the boot fetch resolves. app/page.tsx's
   * ScreenRouter reads `needsPlan` to gate the whole app onto PlanSelect
   * (owner) or a calm "ask the owner" screen (everyone else) — see its own
   * comment for why that check lives there and not here. */
  subscription: {
    status: string;
    planName: string | null;
    trialEndsAt: string | null;
    currentPeriodEnd: string | null;
    needsPlan: boolean;
  } | null;
  /* Re-read it. Called after a successful subscribe/cancel so the gate and
   * the trial/past-due banner reflect the new state without a full reload —
   * same refresh-nonce pattern as refreshSetupState/refreshBadges. */
  refreshSubscription: () => void;
}

/* Support notifications (SaaS back-office) reuse the existing notifications
 * table with sourceType 'support_ticket' (customer) / 'support_ticket_staff'
 * (staff) and sourceId `${ticket.id}-${event}-${randomUUID()}`
 * (lib/support/notify.ts) — ticket.id is always a v4 UUID (lib/support/
 * tickets.ts#createTicket uses node:crypto randomUUID()), so it is recovered
 * by matching the LEADING uuid rather than splitting on '-', which would
 * break on the ticket id's own internal dashes. Exported so
 * NotificationsScreen (components/farm/dashboard.tsx, package A) can deep-
 * link a tapped support notification to its ticket without either package
 * needing to edit the other's file — see this package's report for the
 * one-line call site that request needs. */
const LEADING_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
export function ticketIdFromNotificationSource(sourceType: string, sourceId: string | null | undefined): string | null {
  if (sourceType !== 'support_ticket' && sourceType !== 'support_ticket_staff') return null;
  if (!sourceId) return null;
  const m = sourceId.match(LEADING_UUID_RE);
  return m ? m[0] : null;
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
  refreshBadges: () => {},
  userName: '',
  subscription: null, refreshSubscription: () => {},
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
  'admin-enterprise-requests', 'admin-tickets',
  'batch-detail', 'crop-schedule', 'inventory-detail',
  'people-detail',
  'notification-settings',
  'ui-customise', 'security-settings', 'role-notice',
  'auditor-reports', 'vet-herd', 'about', 'routines', 'getting-started',
  'farm-config', 'dimensions',
  'plan-select', 'billing', 'support', 'support-ticket',
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

/* ── One word per destination ──────────────────────────────────────────────
 * Sidebar and the Android bar read the SAME list. A farmer who learns
 * "Houses & fields" on the phone must see those words on the desktop rail,
 * not "Production units" there and "Livestock batches" in a sheet.
 *
 * These are choices, not synonyms:
 *   Houses & fields  — what you walk, not "production units"
 *   Stages           — when a batch moves, not "farm configuration"
 *   By farm & house  — what the P&L slice does, not "dimensions"
 *   Money            — what they say, not "the books"
 *   Inventory        — everywhere, including the manager's tab (not "Stock")
 *   AI advisor       — the name they ask for
 *   Approvals        — the badge is pending decisions, not "governance"
 *   Manage           — the phone's fifth tab is the office drawer; "More"
 *                      told them nothing (owner's words) and this still
 *                      names the job. Settings is a row inside it, and a
 *                      footer row on desktop — never the name of the drawer.
 */
export const NAV = {
  home: 'Home',
  notifications: 'Notifications',
  finishSetup: 'Finish setup',
  houses: 'Houses & fields',
  livestock: 'Livestock',
  crops: 'Crops',
  products: 'Products',
  stages: 'Stages',
  inventory: 'Inventory',
  people: 'People',
  tasks: 'Tasks',
  routines: 'Routines',
  weather: 'Weather',
  advisor: 'AI advisor',
  approvals: 'Approvals',
  finance: 'Finance',
  // docs/ui-migration-map.md D2: local's GL Dimensions register keeps its own
  // nav row but under a label that no longer collides with the reference's
  // unrelated "Sites" feature (a farm→house structure tree — see NAV.sites
  // below) — the two "dimensions" words were coincidentally the same before
  // this, describing two different real screens.
  byFarm: 'GL Dimensions',
  reports: 'Reports',
  settings: 'Settings',
  farm: 'Farm',
  manage: 'Manage',
  // ui/governance-reference-redesign: the desktop sidebar's four section
  // headings, matching the reference IA (Overview / Farm / Daily / Company)
  // — theFarm/today/money keep their old identifiers (existing tests match
  // on `NAV.theFarm` etc. appearing in this file's source, not on the string
  // each one resolves to) but now resolve to the reference's own wording.
  overview: 'Overview',
  money: 'Company',
  today: 'Daily',
  theFarm: 'Farm',
  // The sidebar/bottom-tab row for 'crops' now stands for the whole Units
  // screen (Houses/Livestock/Crops/Products collapsed into one destination —
  // those four still exist as the screen's OWN internal tabs, and stay
  // reachable via the mobile Farm sheet below, which is unchanged). NAV.farm
  // ('Farm') is kept as the broader sheet title; NAV.units is the specific
  // row/tab label.
  units: 'Units',
  // docs/ui-migration-map.md D1–D3: the reference's farm→division→house
  // structure tree, unrelated to the GL Dimensions register above despite
  // the name collision. Lives as a 5th tab on the Units screen
  // (`crops` with params.tab='sites'), not a new top-level screen.
  sites: 'Sites',
  // SaaS back-office (package H2): owner-only plan/billing management, and
  // support reachable by every tenant role.
  billing: 'Plan & billing',
  support: 'Help & support',
  // The mobile bottom bar's 5th slot (final decision, ui/governance-
  // reference-redesign): opens MobileMoreSheet, the same role-gated section
  // list the desktop sidebar shows (including Settings, the farm switcher
  // and sign-out) — not the older, narrower TAB_MENUS.settings sheet, which
  // only covered a handful of Manage-adjacent destinations. NAV.manage is
  // kept (still used as TAB_MENUS.settings' own title, and by anything that
  // still opens that narrower sheet directly) — "More" is scoped to this one
  // bottom-tab label.
  more: 'More',
} as const;

// Reference TAB_BAR order: Home, Tasks, Units, Finance — kept for owner, who
// can see Finance. Manager can't (existing role gate, unchanged), so its 4th
// primary tab stays Inventory. Both keep a 5th tab, "More" (final decision,
// overriding this file's own earlier "More told them nothing" reasoning for
// the old "Manage" tab): it now opens MobileMoreSheet, the full sidebar IA,
// not the narrower settings-only sheet the old "Manage" tab opened — see
// BottomNav below.
const OWNER_TABS = [
  { id: 'dashboard' as ScreenId, label: NAV.home, icon: Home },
  { id: 'tasks' as ScreenId, label: NAV.tasks, icon: CheckSquare },
  { id: 'crops' as ScreenId, label: NAV.units, icon: Warehouse },
  { id: 'finance' as ScreenId, label: NAV.finance, icon: DollarSign },
  { id: 'settings' as ScreenId, label: NAV.more, icon: MoreVertical },
];
const MANAGER_TABS = [
  { id: 'dashboard' as ScreenId, label: NAV.home, icon: Home },
  { id: 'tasks' as ScreenId, label: NAV.tasks, icon: CheckSquare },
  { id: 'crops' as ScreenId, label: NAV.units, icon: Warehouse },
  { id: 'inventory' as ScreenId, label: NAV.inventory, icon: Package },
  { id: 'settings' as ScreenId, label: NAV.more, icon: MoreVertical },
];
const WORKER_TABS = [
  { id: 'worker-home' as ScreenId, label: 'Home', icon: Home },
  { id: 'worker-record' as ScreenId, label: 'Record', icon: Plus },
  { id: 'worker-pay' as ScreenId, label: 'Pay', icon: DollarSign },
  { id: 'worker-profile' as ScreenId, label: 'Profile', icon: UserCircle },
];
const ADMIN_TABS = [
  { id: 'admin-dashboard' as ScreenId, label: 'Overview', icon: BarChart3 },
  { id: 'admin-tickets' as ScreenId, label: 'Tickets', icon: ClipboardList },
  { id: 'admin-farms' as ScreenId, label: 'Tenants', icon: Building2 },
  { id: 'admin-users' as ScreenId, label: 'People', icon: UserCheck },
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
    title: NAV.farm,
    items: [
      { screen: 'crops', params: { tab: 'units' }, label: NAV.houses, desc: 'The house, pen, paddock or field a batch lives in — set these up first', icon: Warehouse },
      { screen: 'crops', params: { tab: 'livestock' }, label: NAV.livestock, desc: 'Animals you track together — pigs, cattle, goats, birds, fish', icon: PawPrint },
      { screen: 'crops', params: { tab: 'crops' }, label: NAV.crops, desc: 'Planted fields, their stage and harvest', icon: Sprout },
      { screen: 'crops', params: { tab: 'products' }, label: NAV.products, desc: 'What you sell — milk, eggs, grain, live animals', icon: Package },
      // docs/ui-migration-map.md D1–D3: a 5th tab on the Units screen, not a
      // new top-level screen — same `crops`/`params.tab` mechanism as the
      // four rows above.
      { screen: 'crops', params: { tab: 'sites' }, label: NAV.sites, desc: 'The farm→house tree, with who lives where', icon: MapPin },
      { screen: 'farm-config', label: NAV.stages, desc: 'When a batch moves from one stage to the next', icon: SlidersHorizontal, ownerOnly: true },
      { screen: 'inventory', label: NAV.inventory, desc: 'Feed, medicine and stock', icon: Package },
      { screen: 'people', label: NAV.people, desc: 'Who works here, and how they sign in', icon: Users },
    ],
  },
  settings: {
    title: NAV.manage,
    items: [
      // AI advisor leads this list on purpose: the owner said they cannot
      // find it when new. Findability beats "logical" grouping here.
      { screen: 'ai-chat', label: NAV.advisor, desc: 'Ask about your own records', icon: Bot },
      { screen: 'governance', label: NAV.approvals, desc: 'What is waiting on you', icon: Shield },
      { screen: 'routines', label: NAV.routines, desc: 'The round your workers walk each day', icon: Sunrise },
      { screen: 'weather', label: NAV.weather, desc: 'Forecast for this farm', icon: CloudSun },
      { screen: 'dimensions', label: NAV.byFarm, desc: 'GL codes, segments and which accounts require them', icon: Layers, ownerOnly: true },
      { screen: 'reports', label: NAV.reports, desc: 'Export, and share with an auditor', icon: FileText, ownerOnly: true },
      { screen: 'settings', label: NAV.settings, desc: 'Account, appearance, sign-in', icon: Settings },
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
  // A destination that already has its own tab (manager's Inventory) does
  // not also appear inside Farm — two doors to the same room on a 360px
  // bar is clutter, not convenience.
  const tabIds = new Set(getTabsForRole(role).map((t) => t.id));
  const items = menu.items.filter((item) => {
    if (item.ownerOnly && role !== 'owner') return false;
    if (!item.params && item.screen !== tabId && tabIds.has(item.screen)) return false;
    return true;
  });
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

export function NavProvider({ children, initialRole = 'owner', initialTenantId, userName = '', initialSubscription = null }: { children: React.ReactNode; initialRole?: NavContext['role']; initialTenantId?: string; userName?: string; initialSubscription?: NavContext['subscription'] }) {
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
  // Bumped by refreshBadges() to re-run the effect below — same plain-counter
  // shape as setupNonce/refreshSetupState just above.
  const [badgesNonce, setBadgesNonce] = useState(0);
  const refreshBadges = useCallback(() => { setBadgesNonce((n) => n + 1); }, []);
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
    // the previous role's count. `badgesNonce` is here purely so
    // refreshBadges() can force a re-run without changing any real scope.
  }, [tenantId, activeFarmId, role, badgesNonce]);

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

  // ── Subscription state (SaaS back-office, package H2) ──
  // Seeded from the session bootstrap's own GET /api/auth/session call
  // (app/page.tsx already made this request; re-fetching it here would be a
  // duplicate network call for information the caller already has), then
  // independently refreshable via the richer GET /api/billing/subscription
  // once refreshSubscription() is called (e.g. right after a successful
  // subscribe/cancel, so the gate and the trial banner update without a full
  // reload). super_admin never has a subscription — refreshSubscription() is
  // a no-op for that role, same as setupState above.
  const [subscription, setSubscription] = useState<NavContext['subscription']>(initialSubscription);
  const [subscriptionNonce, setSubscriptionNonce] = useState(0);
  const refreshSubscription = useCallback(() => { setSubscriptionNonce((n) => n + 1); }, []);
  useEffect(() => {
    if (role === 'super_admin' || subscriptionNonce === 0) return;
    let cancelled = false;
    apiClient.get<{
      subscription: { trialEndsAt: string | null; currentPeriodEnd: string | null } | null;
      plan: { name: string } | null;
      access: { status: string; needsPlan: boolean };
    }>('/api/billing/subscription').then((res) => {
      if (cancelled || !res.success || !res.data) return;
      setSubscription({
        status: res.data.access.status,
        planName: res.data.plan?.name ?? null,
        trialEndsAt: res.data.subscription?.trialEndsAt ?? null,
        currentPeriodEnd: res.data.subscription?.currentPeriodEnd ?? null,
        needsPlan: res.data.access.needsPlan,
      });
    });
    return () => { cancelled = true; };
    // subscriptionNonce === 0 guard above means mount never double-fetches
    // what initialSubscription already supplied — only a real
    // refreshSubscription() call (nonce > 0) triggers this fetch.
  }, [role, subscriptionNonce]);

  return (
    <NavCtx.Provider value={{ current, history, role, params, activeFarmId, activeFarm, farms, tenantId, navigate, goBack, isNavigating, setActiveFarmId, pendingApprovals, unreadNotifs, openTasksCount, pendingOnboardingRequests, setupState, refreshSetupState, refreshBadges, userName, subscription, refreshSubscription }}>
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
        style={{ background: 'rgba(10,15,10,0.95)', border: '1px solid rgba(var(--primary-rgb),0.3)', color: '#4ade80', borderRadius: 8, fontSize: 'var(--fs-2xs)', padding: '3px 6px', cursor: 'pointer', fontWeight: 700 }}>
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
        <div style={{ width: 72, height: 72, borderRadius: '50%', background: 'rgba(var(--info-rgb),0.1)', border: '1px solid rgba(var(--info-rgb),0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--accent-blue)', marginBottom: 18 }}>
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
            background: 'rgba(var(--critical-rgb),0.1)', border: '1px solid rgba(var(--critical-rgb),0.3)', color: 'var(--status-critical)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <DoorOpen size={14} /> Sign Out
        </button>
      </div>
    </div>
  );
}

/* The sheet a tab with several destinations opens.
 * It sits ABOVE the tab bar, not over it: the bar stays tappable so the
 * same thumb that opened Farm can close it. Overlay z-index is below the
 * bar on purpose. */
function TabMenuSheet({ menu, onClose }: { menu: { title: string; items: TabMenuItem[] }; onClose: () => void }) {
  const { navigate, current, params, setupState, pendingApprovals } = useNav();
  const nextStep = setupState && !setupState.complete
    ? setupState.steps.find((s) => s.id === setupState.nextStepId) ?? null
    : null;

  return (
    <div className="tab-menu-overlay" onClick={onClose}>
      <div
        className="tab-menu-sheet"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={`${menu.title} destinations`}
      >
        <div className="tab-menu-handle" aria-hidden="true" />
        <div className="tab-menu-head">
          <div className="tab-menu-title">{menu.title}</div>
          <button type="button" className="btn-icon" onClick={onClose} aria-label="Close"><X size={16} /></button>
        </div>
        <div className="tab-menu-list">
          {menu.items.map((item) => {
            const Icon = item.icon;
            const isNext = !!nextStep?.goTo
              && nextStep.goTo.screen === item.screen
              && (nextStep.goTo.params?.tab ?? null) === (item.params?.tab ?? null);
            const isCurrent = current === item.screen && (
              !item.params || Object.entries(item.params).every(([k, v]) => params[k] === v)
            );
            return (
              <button
                key={`${item.screen}:${item.params?.tab ?? ''}`}
                type="button"
                className={`tab-menu-row${isNext ? ' is-next' : ''}${isCurrent ? ' is-current' : ''}`}
                onClick={() => { onClose(); navigate(item.screen, item.params); }}
              >
                <div className="tab-menu-icon">
                  <Icon size={18} color={isNext || isCurrent ? 'var(--primary-green)' : 'var(--text-muted)'} aria-hidden="true" />
                </div>
                <div className="tab-menu-copy">
                  <div className="tab-menu-row-title">
                    <span>{item.label}</span>
                    {isNext && <span className="chip" style={{ fontSize: 'var(--fs-2xs)', fontWeight: 800, color: 'var(--primary-green)' }}>Next step</span>}
                    {item.screen === 'governance' && pendingApprovals > 0 && (
                      <span className="chip chip-warning" style={{ fontSize: 'var(--fs-2xs)' }}>{pendingApprovals} pending</span>
                    )}
                  </div>
                  <div className="tab-menu-desc">{item.desc}</div>
                </div>
                <ChevronRight size={16} color="var(--text-dim)" aria-hidden="true" />
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
  // ui/governance-reference-redesign (final decision): owner/manager's 5th
  // tab ("More") opens the full sidebar IA (MobileMoreSheet), not the
  // narrower TAB_MENUS.settings sheet every other role's 'settings' tab
  // would otherwise fall back to (worker/vet/auditor/admin have no
  // 'settings' tab at all, so this never applies to them).
  const isEnterprise = role === 'owner' || role === 'manager';
  const [moreOpen, setMoreOpen] = useState(false);

  return (
    <>
      <nav className="bottom-nav" aria-label="Primary mobile">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = tabIsActive(current, tab.id);
          const badge = tab.id === 'settings' && pendingApprovals > 0
            ? pendingApprovals
            : tabBadge(tab.id, pendingApprovals, unreadNotifs, openTasksCount, pendingOnboardingRequests);
          const isMoreTab = isEnterprise && tab.id === 'settings';
          const hasMenu = isMoreTab ? true : tabMenuFor(tab.id, role) !== null;
          const isOpen = isMoreTab ? moreOpen : (hasMenu && openMenu === tab.id);
          return (
            <button
              key={tab.id}
              type="button"
              className={`bottom-nav-item ${isActive ? 'active' : ''}${isOpen ? ' is-open' : ''}`}
              // A tab with several destinations shows them; a tab with one goes
              // straight there. Tapping the same tab again closes the sheet —
              // the bar stays visible above it, so the thumb that opened Farm
              // can close Farm. No long-press, no double-tap.
              onClick={() => {
                if (isMoreTab) { setMoreOpen((open) => !open); return; }
                if (!hasMenu) navigate(tab.id);
                else setOpenMenu((open) => (open === tab.id ? null : tab.id));
              }}
              aria-current={isActive ? 'page' : undefined}
              aria-haspopup={hasMenu ? 'menu' : undefined}
              aria-expanded={hasMenu ? isOpen : undefined}
              // Anchor for the guided tour (components/farm/tour.tsx). The
              // sidebar's equivalent button carries the same id — only one of
              // the two shells is visible at a time, and the tour picks
              // whichever one that is.
              data-tour={`nav-${tab.id}`}
            >
              <span className="nav-icon-wrap">
                <Icon className="nav-icon" size={20} />
              </span>
              {badge !== null && <NavBadge count={badge} tabId={tab.id === 'settings' ? 'governance' : tab.id} />}
              {/* The caret is the whole affordance: it is what distinguishes a
                  tab that opens a list from one that navigates, before you
                  have tapped either. Points up (sheet rises) when closed,
                  down when that sheet is open. */}
              <span className="nav-label">
                {tab.label}
                {hasMenu && (isOpen
                  ? <ChevronDown size={11} aria-hidden="true" />
                  : <ChevronUp size={11} aria-hidden="true" />)}
              </span>
            </button>
          );
        })}
      </nav>
      {menu && <TabMenuSheet menu={menu} onClose={() => setOpenMenu(null)} />}
      {isEnterprise && <MobileMoreSheet open={moreOpen} onClose={() => setMoreOpen(false)} />}
    </>
  );
}

/* Screen-reader label per tab kind, so the badge announces what the number
 * means ("5 pending approvals") instead of a bare "5" with no context. The
 * digits themselves are aria-hidden so they aren't announced a second time. */
function badgeAriaLabel(tabId: ScreenId, count: number): string {
  if (tabId === 'governance') return `${count} pending approval${count === 1 ? '' : 's'}`;
  if (tabId === 'tasks') return `${count} open task${count === 1 ? '' : 's'}`;
  if (tabId === 'dashboard' || tabId === 'notifications') return `${count} unread notification${count === 1 ? '' : 's'}`;
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
  // Dashboard keeps the unread count for the mobile Home tab (no Inbox tab
  // there). The desktop sidebar has its own Notifications row and reads the
  // same count through that id, so Home does not wear a badge that opens
  // the wrong screen.
  if (tabId === 'dashboard' && unreadNotifs > 0) return unreadNotifs;
  if (tabId === 'notifications' && unreadNotifs > 0) return unreadNotifs;
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
 * Keep their active state tied to the actual destination, not to Settings.
 *
 * Rows that deep-link with `params` (the four Farm tabs, admin Users'
 * sub-rows) must not all light up together. A bare row (Users, no tab) is
 * current only when no param-sibling matches. Detail screens map to exactly
 * one parent: batch-detail → Livestock, crop-schedule → Crops — never to
 * every crops row, and never to Dimensions / Farm configuration, which have
 * rows of their own. */
const SIDEBAR_DETAIL_SCREENS: Partial<Record<ScreenId, ScreenId[]>> = {
  inventory: ['inventory-detail'],
  people: ['people-detail'],
  'admin-onboarding': ['admin-enterprise-requests'],
  settings: ['notification-settings', 'ui-customise', 'about', 'security-settings'],
};

export function sidebarRowIsActive(
  current: ScreenId,
  params: Record<string, string>,
  item: { id: ScreenId; params?: Record<string, string> },
  siblings: { id: ScreenId; params?: Record<string, string> }[],
): boolean {
  // ui/governance-reference-redesign: the sidebar's Farm group now lists ONE
  // bare 'crops' row (no `params` at all — see the Units row in
  // ENTERPRISE_GROUPS) instead of four separate per-tab rows. `!item.params`
  // covers that row; `item.params?.tab === '…'` is kept for any caller still
  // passing the old per-tab shape (e.g. this function's own unit tests).
  if (current === 'batch-detail') {
    return item.id === 'crops' && (!item.params || item.params.tab === 'livestock');
  }
  if (current === 'crop-schedule') {
    return item.id === 'crops' && (!item.params || item.params.tab === 'crops');
  }

  const onScreen = current === item.id || (SIDEBAR_DETAIL_SCREENS[item.id] ?? []).includes(current);
  if (!onScreen) return false;

  // `#crops` with no tab is the Livestock view (CropsScreen's own default).
  const effective: Record<string, string> = (current === 'crops' && !params.tab)
    ? { ...params, tab: 'livestock' }
    : params;

  if (item.params) {
    return Object.entries(item.params).every(([k, v]) => effective[k] === v);
  }

  const paramSiblings = siblings.filter((s) => s.id === item.id && s.params);
  if (paramSiblings.some((s) => Object.entries(s.params!).every(([k, v]) => effective[k] === v))) {
    return false;
  }
  return true;
}

export const ROLE_LABEL: Record<Role, string> = {
  owner: 'Owner',
  manager: 'Manager',
  worker: 'Worker',
  vet: 'Veterinarian',
  auditor: 'Auditor',
  super_admin: 'Platform admin',
};

/* Shared shape for every grouped-sidebar row below (ENTERPRISE_GROUPS,
 * adminGroups, and the flat `tabs` fallback all render through the same
 * .map in AppSidebar). `params`/`dataTour` are only used by rows that deep-
 * link into a sub-tab of the screen they navigate to (e.g. the admin
 * People & Access group below) rather than the screen's own default view. */
interface SidebarGroupItem {
  id: ScreenId;
  label: string;
  icon: typeof Home;
  ownerOnly?: boolean;
  setupOnly?: boolean;
  params?: Record<string, string>;
  dataTour?: string;
  indent?: boolean;
}
interface SidebarGroup {
  label: string;
  items: SidebarGroupItem[];
}

const SIDEBAR_COLLAPSE_KEY = 'ifms.sidebar.collapsed';

function readSidebarCollapsed(): boolean {
  try {
    const stored = window.localStorage.getItem(SIDEBAR_COLLAPSE_KEY);
    if (stored === '1') return true;
    if (stored === '0') return false;
  } catch { /* private mode, no storage */ }
  return window.innerWidth < 1024;
}

function writeSidebarCollapsed(collapsed: boolean) {
  try {
    window.localStorage.setItem(SIDEBAR_COLLAPSE_KEY, collapsed ? '1' : '0');
  } catch { /* ignore */ }
}

/* ── ui/governance-reference-redesign: sidebar IA restructure (not just a
 * restyle) — adopts the reference's own four sections (Overview / Farm /
 * Daily / Company, grok/src/components/layout/nav-config.ts) in place of the
 * previous ux-revamp grouping. What moved and why:
 *
 * - Overview now has a real heading (it used to be the unlabelled first
 *   group) and Notifications no longer has a row here at all — it moved to
 *   the persistent top-right bell every screen's TopNav now shows by default
 *   (see TopNav's `showBell` default below).
 *
 * - Farm's four separate Houses/Livestock/Crops/Products rows collapse into
 *   ONE "Units" row. Those four are still real destinations — they're the
 *   Units screen's OWN internal tabs (CropsScreen reads `params.tab`), still
 *   reachable exactly as before through the mobile Farm sheet (TAB_MENUS.crops
 *   above, unchanged) — only the DESKTOP SIDEBAR stops listing all four
 *   separately. Restructuring that screen itself is a separate piece of work.
 *
 * - Stages (farm-config) drops out of the sidebar entirely. It has no row
 *   anywhere else in this file either, but it was never sidebar-only to
 *   begin with: components/farm/settings.tsx's "Farm Setup" section has
 *   linked to it since before the sidebar ever did (see that file's own
 *   comment on why — renaming/reordering a stage is owner-only and rare
 *   enough not to need a permanent nav row). Settings → Farm Setup → Stages
 *   is the path now, same as it was originally.
 *
 * - Company keeps Governance/Finance/Sites/Reports but NOT a second Settings
 *   row — SidebarFooter below already has a dedicated, always-visible
 *   Settings button (and the reference's own footer doubles as a settings
 *   link via the user block), so repeating it inside Company would be the
 *   one true duplicate row in this list.
 *
 * Module-level (not computed inside AppSidebar) so MobileMoreSheet — the
 * mobile bottom bar's "More" tab — renders the identical section list
 * instead of a second, driftable copy. */
const ENTERPRISE_GROUPS: SidebarGroup[] = [
  { label: NAV.overview, items: [
    { id: 'dashboard' as ScreenId, label: NAV.home, icon: Home, ownerOnly: false },
    // Rendered only while there is something left to do — see the filter
    // below. Once setup is complete this row disappears entirely rather
    // than sitting there as a permanent tick, which is the "get out of the
    // way" half of the brief.
    { id: 'getting-started' as ScreenId, label: NAV.finishSetup, icon: ClipboardList, ownerOnly: false, setupOnly: true },
  ] },
  { label: NAV.theFarm, items: [
    { id: 'crops' as ScreenId, label: NAV.units, icon: Warehouse, ownerOnly: false, dataTour: 'nav-crops' },
    // docs/ui-migration-map.md D1–D3: same 'crops' screen, params.tab='sites'
    // — sidebarRowIsActive's paramSiblings check is what keeps this row and
    // the bare Units row above from both lighting up at once.
    { id: 'crops' as ScreenId, label: NAV.sites, icon: MapPin, ownerOnly: false, params: { tab: 'sites' }, dataTour: 'nav-crops-sites' },
    { id: 'inventory' as ScreenId, label: NAV.inventory, icon: Package, ownerOnly: false },
    { id: 'people' as ScreenId, label: NAV.people, icon: Users, ownerOnly: false },
  ] },
  { label: NAV.today, items: [
    { id: 'tasks' as ScreenId, label: NAV.tasks, icon: CheckSquare, ownerOnly: false },
    { id: 'routines' as ScreenId, label: NAV.routines, icon: Sunrise, ownerOnly: false },
    { id: 'weather' as ScreenId, label: NAV.weather, icon: CloudSun, ownerOnly: false },
    { id: 'ai-chat' as ScreenId, label: NAV.advisor, icon: Bot, ownerOnly: false },
  ] },
  { label: NAV.money, items: [
    { id: 'governance' as ScreenId, label: NAV.approvals, icon: Shield, ownerOnly: false },
    { id: 'finance' as ScreenId, label: NAV.finance, icon: DollarSign, ownerOnly: true },
    { id: 'dimensions' as ScreenId, label: NAV.byFarm, icon: Layers, ownerOnly: true },
    { id: 'reports' as ScreenId, label: NAV.reports, icon: FileText, ownerOnly: true },
    // SaaS back-office (package H2, lead decision #5): billing is an
    // owner-level concern throughout the backend (docs/backoffice-api.md) —
    // a manager gets no row at all here rather than a read-only one, since
    // GET /api/billing/subscription is the only tenant-wide-readable route
    // and a bare status line isn't worth its own nav destination for that
    // role. Support is every tenant role's — no ownerOnly.
    { id: 'billing' as ScreenId, label: NAV.billing, icon: CreditCard, ownerOnly: true },
    { id: 'support' as ScreenId, label: NAV.support, icon: HelpCircle, ownerOnly: false },
  ] },
];

/* ── Desktop Sidebar (issue #220, ux-revamp) ──
 * Shown from 768px via CSS, where BottomNav is hidden. Grouped by when a
 * farmer needs the screen — not by which department owns it — and every
 * destination the mobile Farm/Manage menus name has a row of its own, so
 * nothing is reachable only by noticing a tab inside a screen. */
export function AppSidebar() {
  const { current, params, navigate, role, pendingApprovals, unreadNotifs, openTasksCount, pendingOnboardingRequests, activeFarmId, farms, setupState, tenantId, userName } = useNav();
  const tabs = getTabsForRole(role);
  const homeScreen = startScreenForRole(role);

  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => { setCollapsed(readSidebarCollapsed()); }, []);
  function toggleCollapsed() {
    setCollapsed((prev) => {
      const next = !prev;
      writeSidebarCollapsed(next);
      return next;
    });
  }

  const [branding, setBranding] = useState<{ orgName: string; logoEmoji: string } | null>(null);
  useEffect(() => {
    let cancelled = false;
    apiClient.get<{ orgName?: string; logoEmoji?: string }>(`/api/settings?tenantId=${tenantId}`).then((res) => {
      if (cancelled || !res.success || !res.data) return;
      setBranding({
        orgName: (res.data.orgName || '').trim(),
        logoEmoji: (res.data.logoEmoji || '').trim(),
      });
    });
    return () => { cancelled = true; };
  }, [tenantId]);

  const brandName = branding?.orgName
    || (role === 'super_admin' ? 'IFMS' : (farms.find((f) => f.id === activeFarmId)?.name || farms[0]?.name || 'IFMS'));
  const brandMeta = role === 'super_admin'
    ? 'Platform'
    : (activeFarmId === 'ALL' ? (farms.length > 1 ? 'All farms' : 'Farm management') : (farms.find((f) => f.id === activeFarmId)?.name || 'Farm'));
  const brandEmoji = branding?.logoEmoji || '';
  /* ── Platform admin's sidebar (owner brief: "his navigation is so small,
   * check presentation of that navigation") ───────────────────────────────
   * Every admin API already has a screen behind it — stats, tenants,
   * onboarding requests, users, admin-mediated password resets, and audited
   * impersonation (+ its log) all have a consuming component already. The
   * gap was never a missing feature; it was that super_admin fell through to
   * the same flat "Workspace" list as worker/vet/auditor below — five rows
   * repeating the bottom bar's five tabs — while two of those real
   * capabilities (password resets, the impersonation log) live one level
   * deeper, inside AdminUsersScreen's own tab row, with nothing in the
   * navigation hinting they exist at all.
   *
   * Grouped the same way ENTERPRISE_GROUPS is grouped above — by what the job
   * actually is, not by which API file backs it — and the two "Users"
   * sub-rows deep-link into AdminUsersScreen's existing tab state via
   * `params.tab` (the same params.tab mechanism CropsScreen already reads),
   * so this adds zero new screens. ADMIN_TABS / the bottom bar are untouched:
   * a phone's bottom bar stays five tabs by design, this only restructures
   * the desktop sidebar, which had room to actually say what the job is.
   */
  const adminGroups: SidebarGroup[] = [
    { label: 'Overview', items: [
      { id: 'admin-dashboard' as ScreenId, label: 'Overview', icon: BarChart3 },
    ] },
    { label: 'Support', items: [
      { id: 'admin-tickets' as ScreenId, label: 'Tickets', icon: ClipboardList },
    ] },
    { label: 'Tenants', items: [
      { id: 'admin-farms' as ScreenId, label: 'Farms', icon: Building2 },
      { id: 'admin-onboarding' as ScreenId, label: 'Onboarding requests', icon: Users },
      { id: 'admin-enterprise-requests' as ScreenId, label: 'Enterprise requests', icon: Sprout },
    ] },
    { label: 'People', items: [
      { id: 'admin-users' as ScreenId, label: 'Users', icon: UserCheck },
      // Deep links: same screen, opened straight on the tab that used to be
      // reachable only by first landing on "Users" and noticing its own
      // chip row. Distinct data-tour ids (not the shared `nav-admin-users`
      // the row above uses) so a future tour step can target exactly one of
      // the three without ambiguity.
      { id: 'admin-users' as ScreenId, label: 'Staff & roles', icon: Shield, params: { tab: 'staff' }, dataTour: 'nav-admin-users-staff' },
      { id: 'admin-users' as ScreenId, label: 'Password resets', icon: Key, params: { tab: 'password-resets' }, dataTour: 'nav-admin-users-password-resets' },
      { id: 'admin-users' as ScreenId, label: 'Impersonation log', icon: Activity, params: { tab: 'impersonation-log' }, dataTour: 'nav-admin-users-impersonation-log' },
    ] },
    { label: 'Config', items: [
      { id: 'admin-settings' as ScreenId, label: 'Config', icon: Settings },
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
  // Owner sees everything; super_admin gets its own grouping (adminGroups);
  // worker/vet/auditor keep the flat tab-set fallback — each has only one or
  // a handful of destinations, so a flat list already says what the job is.
  const groups: SidebarGroup[] = role === 'owner' || role === 'manager'
    ? ENTERPRISE_GROUPS
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
    : role === 'super_admin'
      ? adminGroups
      : [{ label: '', items: tabs }];
  const allItems = groups.flatMap((g) => g.items);
  // A filter with one farm (All farms vs that farm) is a distinction without
  // a difference. Hidden on platform-admin screens: they are tenant-scoped
  // and never read activeFarmId.
  const showFarmFilter = farms.length > 1 && !current.startsWith('admin-');
  const displayName = userName.trim() || ROLE_LABEL[role];

  return (
    <aside className={`farm-sidebar${collapsed ? ' is-collapsed' : ''}`}>
      <div className="farm-sidebar-brand">
        <button
          type="button"
          className="farm-sidebar-home"
          onClick={() => navigate(homeScreen)}
          aria-label={`Go to ${ROLE_LABEL[role] === 'Platform admin' ? 'overview' : 'home'}`}
          title={brandName}
        >
          <div className="brand-mark farm-sidebar-mark">
            {brandEmoji
              ? <span aria-hidden="true" className="farm-sidebar-emoji">{brandEmoji}</span>
              : <Leaf size={17} color="var(--on-primary)" strokeWidth={2.4} aria-hidden="true" />}
          </div>
          <div className="sidebar-brand-text">
            <div className="sidebar-brand-name">{brandName}</div>
            <div className="sidebar-brand-meta">{brandMeta}</div>
          </div>
        </button>
        <button
          type="button"
          className="sidebar-collapse-btn"
          onClick={toggleCollapsed}
          aria-pressed={collapsed}
          aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'}
          title={collapsed ? 'Expand navigation' : 'Collapse navigation'}
        >
          {collapsed ? <PanelLeftOpen size={16} aria-hidden="true" /> : <PanelLeftClose size={16} aria-hidden="true" />}
        </button>
      </div>
      <nav className="farm-sidebar-nav" aria-label="Primary">
        {groups.map((group, gi) => (
          <div key={group.label || `g-${gi}`} className="sidebar-group">
            {group.label ? <h2 className="sidebar-group-label">{group.label}</h2> : null}
            <ul className="sidebar-list">
            {group.items.map((tab) => {
          const Icon = tab.icon;
          const active = sidebarRowIsActive(current, params, tab, allItems);
          // Home must not wear the unread-notification badge — that number
          // belongs on Notifications, which is the screen it opens.
          const badge = tab.id === 'dashboard'
            ? null
            : tabBadge(tab.id, pendingApprovals, unreadNotifs, openTasksCount, pendingOnboardingRequests);
          const rowKey = tab.dataTour ?? `${tab.id}:${tab.params?.tab ?? ''}`;
          return (
            <li key={rowKey}>
            <button
              type="button"
              className={`sidebar-row${active ? ' is-active' : ''}${tab.indent ? ' is-nested' : ''}`}
              onClick={() => navigate(tab.id, tab.params)}
              aria-current={active ? 'page' : undefined}
              data-tour={tab.dataTour ?? `nav-${tab.id}`}
              title={collapsed ? tab.label : undefined}
            >
              <Icon size={18} aria-hidden="true" />
              <span className="sidebar-row-label">{tab.label}</span>
              {/* Position, not a count. A red circle with "4" in it would read
                  as four things wrong; "4 of 9" reads as progress, which is
                  what it is. Only ever rendered from real server state. */}
              {tab.id === 'getting-started' && setupProgressLabel && (
                <span
                  className="chip sidebar-progress"
                  // --sidebar-accent, not --primary-green: this text sits directly
                  // on the sidebar, which is permanently dark regardless of the
                  // active theme (see app/global.css's --sidebar-accent comment).
                  style={{ fontSize: 'var(--fs-2xs)', fontWeight: 800, color: 'var(--sidebar-accent)', flexShrink: 0 }}
                >
                  {setupProgressLabel}
                </span>
              )}
              {badge !== null && <NavBadge count={badge} tabId={tab.id} className="nav-badge sidebar-badge" />}
            </button>
            </li>
          );
            })}
            </ul>
          </div>
        ))}
      </nav>
      <SidebarFooter collapsed={collapsed} showFarmFilter={showFarmFilter} allItems={allItems} displayName={displayName} />
    </aside>
  );
}

/* ── Sidebar footer: farm switcher + identity + Settings + Sign out ──
 * Factored out of AppSidebar (ui/governance-reference-redesign) so
 * MobileMoreSheet's "full sidebar IA" sheet — the mobile bottom bar's new
 * "More" tab, see BottomNav — renders the EXACT same footer instead of a
 * second hand-written copy that could drift from it. */
function SidebarFooter({
  collapsed, showFarmFilter, allItems, displayName, onNavigate,
}: {
  collapsed: boolean;
  showFarmFilter: boolean;
  allItems: { id: ScreenId; params?: Record<string, string> }[];
  displayName: string;
  onNavigate?: () => void;
}) {
  const { current, params, navigate, role, activeFarmId, farms, setActiveFarmId } = useNav();
  return (
    <div className="farm-sidebar-footer">
      {showFarmFilter && (
      <label className="sidebar-farm-filter" data-tour="farm-switcher">
        <span className="sidebar-farm-label">{NAV.farm}</span>
        <select
          value={activeFarmId}
          onChange={(e) => setActiveFarmId(e.target.value)}
          aria-label="Farm to show"
        >
          <option value="ALL">All farms</option>
          {farms.map((farm) => (
            <option key={farm.id} value={farm.id}>{farm.name}</option>
          ))}
        </select>
      </label>
      )}
      <div className="sidebar-user">
        <div className="sidebar-user-text">
          <div className="sidebar-user-name">{displayName}</div>
          <div className="sidebar-user-role">{ROLE_LABEL[role]}</div>
        </div>
      </div>
      {(role === 'owner' || role === 'manager') && (
      <button
        type="button"
        className={`sidebar-row${sidebarRowIsActive(current, params, { id: 'settings' }, allItems) ? ' is-active' : ''}`}
        onClick={() => { navigate('settings'); onNavigate?.(); }}
        aria-current={current === 'settings' || (SIDEBAR_DETAIL_SCREENS.settings ?? []).includes(current) ? 'page' : undefined}
        data-tour="nav-settings"
        title={collapsed ? 'Settings' : undefined}
      >
        <Settings size={18} aria-hidden="true" />
        <span className="sidebar-row-label">{NAV.settings}</span>
      </button>
      )}
      <LogoutButton labeled />
    </div>
  );
}

/* ── The mobile bottom bar's "More" sheet (final decision, ui/governance-
 * reference-redesign) ──────────────────────────────────────────────────────
 * Opened by BottomNav's 5th tab for owner/manager. Same sections, same role
 * gating, same farm switcher and sign-out as the desktop sidebar — just
 * rendered as a bottom sheet instead of a docked rail, exactly the relationship
 * reference's own SidebarBody has to its mobile Sheet. Closes itself
 * (`onNavigate`) the moment a destination is picked, same as TabMenuSheet. */
function MobileMoreSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { current, params, navigate, role, pendingApprovals, unreadNotifs, openTasksCount, pendingOnboardingRequests, farms, setupState } = useNav();
  if (!open) return null;

  const tabs = getTabsForRole(role);
  const setupIncomplete = !!setupState && !setupState.complete;
  const setupProgressLabel = setupState && !setupState.complete
    ? `${setupState.completed} of ${setupState.total}`
    : null;
  const groups: SidebarGroup[] = (role === 'owner' || role === 'manager')
    ? ENTERPRISE_GROUPS
        .map((group) => ({
          label: group.label,
          items: group.items.filter((item) =>
            (role === 'owner' || !item.ownerOnly) &&
            (!('setupOnly' in item && item.setupOnly) || setupIncomplete)
          ),
        }))
        .filter((group) => group.items.length > 0)
    : [{ label: '', items: tabs }];
  const allItems = groups.flatMap((g) => g.items);
  const showFarmFilter = farms.length > 1;

  return (
    <div className="tab-menu-overlay" onClick={onClose}>
      <div
        className="tab-menu-sheet more-sheet"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="All screens"
      >
        <div className="tab-menu-handle" aria-hidden="true" />
        <div className="tab-menu-head">
          <div className="tab-menu-title">{NAV.more}</div>
          <button type="button" className="btn-icon" onClick={onClose} aria-label="Close"><X size={16} /></button>
        </div>
        <div className="tab-menu-list more-sheet-groups">
          {groups.map((group, gi) => (
            <div key={group.label || `g-${gi}`} className="sidebar-group">
              {group.label ? <h2 className="sidebar-group-label">{group.label}</h2> : null}
              <ul className="sidebar-list">
                {group.items.map((tab) => {
                  const Icon = tab.icon;
                  const active = sidebarRowIsActive(current, params, tab, allItems);
                  const badge = tab.id === 'dashboard' ? null : tabBadge(tab.id, pendingApprovals, unreadNotifs, openTasksCount, pendingOnboardingRequests);
                  const rowKey = tab.dataTour ?? `${tab.id}:${tab.params?.tab ?? ''}`;
                  return (
                    <li key={rowKey}>
                      <button
                        type="button"
                        className={`sidebar-row${active ? ' is-active' : ''}`}
                        onClick={() => { onClose(); navigate(tab.id, tab.params); }}
                        aria-current={active ? 'page' : undefined}
                      >
                        <Icon size={18} aria-hidden="true" />
                        <span className="sidebar-row-label">{tab.label}</span>
                        {tab.id === 'getting-started' && setupProgressLabel && (
                          <span className="chip" style={{ fontSize: 'var(--fs-2xs)', fontWeight: 800, color: 'var(--primary-green)', flexShrink: 0 }}>
                            {setupProgressLabel}
                          </span>
                        )}
                        {badge !== null && <NavBadge count={badge} tabId={tab.id} className="nav-badge sidebar-badge" />}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
        <SidebarFooter collapsed={false} showFarmFilter={showFarmFilter} allItems={allItems} displayName="" onNavigate={onClose} />
      </div>
    </div>
  );
}

/* ── Top Nav Bar ──
 * ui/governance-reference-redesign: `showBell` now defaults to true (was
 * false) — the reference IA moves notifications to a persistent top-right
 * bell rather than a sidebar row (see AppSidebar's Overview group), and
 * TopNav is the one component every screen already renders at its top, so
 * flipping the default reaches every screen with zero per-screen changes.
 * Suppressed for vet/auditor (guardDestination() would only bounce them to
 * role-notice — 'notifications' isn't in their allowed screen set) and while
 * already on the Notifications screen itself. */
export function TopNav({
  title, subtitle, showBack = false, showBell = true,
  rightEl, farmBadge,
}: {
  title: string; subtitle?: string; showBack?: boolean;
  showBell?: boolean; rightEl?: React.ReactNode; farmBadge?: string;
}) {
  const { goBack, unreadNotifs, navigate, role, current } = useNav();
  const canSeeBell = showBell && role !== 'vet' && role !== 'auditor' && current !== 'notifications';

  return (
    <div className="top-nav">
      {/* Left slot is back-or-nothing now — it used to fall back to the
       * sign-out button when showBack was false, which put sign-out in the
       * exact spot users build muscle memory for "back" on every other
       * screen (a stray tap there used to sign them out). Sign-out now lives
       * in the right-hand cluster below instead. */}
      {showBack && (
        <button type="button" className="btn-icon" onClick={goBack} aria-label="Back" style={{ width: 36, height: 36, minWidth: 36 }}>
          <ChevronLeft size={18} />
        </button>
      )}
      <div style={{ flex: 1 }}>
        <div className="top-nav-title" style={{ fontSize: 'var(--fs-2xl)', color: 'var(--text-primary)', lineHeight: 1.2 }}>{title}</div>
        {subtitle && <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', marginTop: 3 }}>{subtitle}</div>}
        {farmBadge && (
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: 'rgba(var(--primary-rgb),0.08)', border: '1px solid rgba(var(--primary-rgb),0.2)', borderRadius: 100, padding: '2px 8px', marginTop: 3 }}>
            <span style={{ fontSize: 'var(--fs-xs)', fontWeight: 600, color: 'var(--primary-green)' }}>{farmBadge}</span>
          </div>
        )}
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        {rightEl}
        {canSeeBell && (
          <button type="button" className="btn-icon" style={{ position: 'relative' }} onClick={() => navigate('notifications')} aria-label={unreadNotifs > 0 ? `Notifications, ${unreadNotifs} unread` : 'Notifications'}>
            <Bell size={16} />
            {unreadNotifs > 0 && (
              <span style={{ position: 'absolute', top: 6, right: 6, width: 8, height: 8, background: 'var(--status-critical)', borderRadius: '50%' }} />
            )}
          </button>
        )}
        <LogoutButton className="top-nav-signout" />
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

function LogoutButton({ labeled = false, className = '' }: { labeled?: boolean; className?: string }) {
  const { confirm } = useConfirm();

  async function onSignOut() {
    const ok = await confirm({
      message: 'Sign out?',
      detail: 'You will be returned to the login screen.',
      variant: 'danger',
      confirmLabel: 'Sign out',
    });
    if (ok && _globalLogout) _globalLogout();
  }

  return (
    <button
      type="button"
      className={`${labeled ? 'sidebar-row sidebar-signout' : 'logout-icon-btn'}${className ? ` ${className}` : ''}`}
      onClick={onSignOut}
      title="Sign out"
      aria-label="Sign out"
    >
      {/* `labeled` is only ever true inside the sidebar footer, which is
          permanently dark regardless of the active theme (see app/global.css's
          --sidebar-danger comment) — --status-critical is correct for the
          unlabeled icon-only button, which sits on the theme-following top nav. */}
      <DoorOpen size={labeled ? 18 : 14} color={labeled ? 'var(--sidebar-danger)' : 'var(--status-critical)'} aria-hidden="true" />
      {labeled && <span className="sidebar-row-label">Sign out</span>}
    </button>
  );
}
