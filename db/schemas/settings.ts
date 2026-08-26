// Per-tenant settings store (issue #255). One row per tenant, keyed by
// tenant_id — NOT per user/device — so a setting changed by one user on a
// tenant is immediately readable by a second user on the same tenant via
// GET /api/settings (the issue's own acceptance criterion).
//
// Field set is not invented: it mirrors the two real UI screens' state
// exactly —
//   - components/farm/settings.tsx's ThemeCtx + local toggles: theme,
//     fontSize, notifications (push), soundAlerts, offline mode.
//   - components/farm/ui-customise.tsx's FarmBranding + ModuleConfig:
//     accentColor, logoEmoji, dashboardGreeting, and the per-module
//     enabled/customLabel list.
// This issue is backend-only (#256 wires the screens up to this store), so
// the shape is trimmed to a single tenant-wide record — ui-customise.tsx's
// mock UI additionally keys branding by farmCode across multiple farms, but
// there is no per-farm branding requirement in this issue's task list.
//
// currencySymbol/weightUnit moved out of "branding" (settings-reorg): they
// are operational settings (every amount/weight in the app is displayed in
// them), edited from Settings proper (components/farm/settings.tsx) rather
// than the UI Customise branding tab. timezone/dateFormat/
// sessionTimeoutMinutes are new for the same task — see the fields below.
import { pgTable, text, timestamp, boolean, integer, jsonb } from 'drizzle-orm/pg-core'

// One entry per module id (dashboard/crops/tasks/inventory/finance/people/
// governance/reports/weather/ai-chat — DEFAULT_MODULES in ui-customise.tsx).
// Loose jsonb, validated in the route — same "validated in the route, not
// the DB" choice this codebase already makes for governance.ts's `meta` and
// people.ts's `data`.
export interface ModuleSetting {
  id: string
  enabled: boolean
  customLabel?: string
}

export const tenantSettings = pgTable('tenant_settings', {
  tenantId: text('tenant_id').primaryKey(),

  // Appearance & accessibility (settings.tsx ThemeCtx).
  theme: text('theme').notNull().default('dark-farm'),
  fontSize: text('font_size').notNull().default('normal'),

  // Notifications (settings.tsx toggles).
  notificationsEnabled: boolean('notifications_enabled').notNull().default(true),
  soundAlertsEnabled: boolean('sound_alerts_enabled').notNull().default(false),

  // Offline & sync (settings.tsx toggle).
  offlineModeEnabled: boolean('offline_mode_enabled').notNull().default(true),

  // Farm branding (ui-customise.tsx FarmBranding).
  accentColor: text('accent_color').notNull().default('#4ade80'),
  logoEmoji: text('logo_emoji').notNull().default('🌾'),
  dashboardGreeting: text('dashboard_greeting').notNull().default('Good morning!'),
  currencySymbol: text('currency_symbol').notNull().default('KSh'),
  weightUnit: text('weight_unit').notNull().default('kg'),

  // Module visibility/labels (ui-customise.tsx DEFAULT_MODULES) — defaults to
  // empty; an empty/absent list means "use the client's own defaults".
  modules: jsonb('modules').$type<ModuleSetting[]>().notNull().default([]),

  // ── Regional & session settings (settings-reorg) ──
  // Real gaps the Settings screen had no answer for: every record in this
  // app is timestamped, but there was no way to say what timezone a farm
  // actually runs in, or how a date should read once displayed. IANA zone
  // name, validated against Intl.supportedValuesOf('timeZone') in the route
  // (see app/api/settings/route.ts) rather than a hand-maintained list.
  // Default is East Africa Time — every seeded demo farm is Kenyan.
  timezone: text('timezone').notNull().default('Africa/Nairobi'),
  // One of DATE_FORMATS in lib/datetime.ts. Consumed by components/farm/
  // status-timeline.tsx (via useRegional() in settings.tsx) to render audit-
  // log timestamps in the tenant's own convention instead of a hardcoded
  // 'en-KE' locale.
  dateFormat: text('date_format').notNull().default('DD/MM/YYYY'),
  // ── Do the explanatory notes print on a report? (default: yes) ───────────
  // Every report carries a short "notes & basis" block saying what the
  // figures are and are not — GL totals being all-time, costs being
  // acquisition-only, a cause being worker-entered rather than
  // vet-confirmed. That candour is the point of it, and it stays the
  // default.
  //
  // But the same block goes out on a document a farmer hands to a buyer or a
  // co-op, and not every farm wants its caveats printed on the page. Turning
  // it off removes the notes from the preview, the PDF and the CSV together —
  // never from one and not another, or the screen and the file would disagree
  // about what the report says. The figures themselves never change.
  reportNotesEnabled: boolean('report_notes_enabled').notNull().default(true),

  // Farm offices share devices — this bounds how long a session issued to
  // this tenant's users stays valid, read by POST /api/auth/login when
  // minting a session (lib/auth.ts's createSession/attachSessionCookie both
  // already accepted a custom TTL for impersonation; this is the same knob,
  // tenant-configurable instead of hardcoded). Null = no override, i.e. the
  // platform default 30-day session (lib/auth.ts's SESSION_TTL_MS) — kept
  // nullable rather than defaulting to a number so "never configured" stays
  // distinguishable from "deliberately set to the same value".
  sessionTimeoutMinutes: integer('session_timeout_minutes'),

  updatedAt: timestamp('updated_at').defaultNow(),
})
