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
//     accentColor, logoEmoji, dashboardGreeting, currencySymbol, weightUnit,
//     and the per-module enabled/customLabel list.
// This issue is backend-only (#256 wires the screens up to this store), so
// the shape is trimmed to a single tenant-wide record — ui-customise.tsx's
// mock UI additionally keys branding by farmCode across multiple farms, but
// there is no per-farm branding requirement in this issue's task list.
import { pgTable, text, timestamp, boolean, jsonb } from 'drizzle-orm/pg-core'

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

  updatedAt: timestamp('updated_at').defaultNow(),
})
