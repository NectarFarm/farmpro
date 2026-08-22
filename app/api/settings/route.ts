import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { tenantSettings, type ModuleSetting } from '@/db/schemas'
import { requireTenantSession } from '@/lib/api-auth'
import { MAX_SESSION_TIMEOUT_MINUTES, MIN_SESSION_TIMEOUT_MINUTES } from '@/lib/auth'
import { DATE_FORMATS, DEFAULT_DATE_FORMAT, DEFAULT_TIMEZONE, isValidTimezone, type DateFormat } from '@/lib/datetime'

// ── GET/PATCH /api/settings (issue #255, extended by settings-reorg) ───────
// Per-tenant settings store — one row per tenant (tenant_settings.tenant_id),
// not per user/device, so a setting changed by one user is immediately
// visible to a second user on the same tenant (this issue's acceptance
// criterion). Field set matches components/farm/settings.tsx (theme,
// fontSize, notifications, soundAlerts, offline mode, currency, weight unit,
// timezone, date format, session timeout) and components/farm/
// ui-customise.tsx (branding + modules) exactly — see db/schemas/settings.ts
// for the full mapping.
//
// GET is readable by any authenticated user on the tenant (same shape as
// GET /api/role-permissions) — a manager needs to see current settings even
// though only an owner/super_admin can change them. PATCH is write-gated to
// owner/super_admin, mirroring ui-customise.tsx's own nav gate
// (`role === "super_admin" || role === "owner"`).
//
// No row exists for a tenant until the first PATCH — GET returns the schema's
// documented defaults in that case (never a 404), and PATCH upserts.
//
// Tenant resolution goes through lib/api-auth.ts's requireTenantSession, same
// as every other route since fix/authenticate-all-apis: the session's own
// tenantId always wins, and a ?tenantId= query param is only consulted for a
// super_admin session (which carries none of its own) — never trusted from a
// tenant-scoped caller.

const ok = <T>(data: T, status = 200) => NextResponse.json({ success: true, data }, { status })

const badFields = (fields: Record<string, string>, status = 400) => {
  const firstKey = Object.keys(fields)[0]
  return NextResponse.json({ success: false, error: fields[firstKey], fields }, { status })
}
const bad = (msg: string, status = 400) => NextResponse.json({ success: false, error: msg }, { status })

const THEMES = new Set(['dark-farm', 'high-contrast', 'light-farm', 'sun-mode'])
const FONT_SIZES = new Set(['small', 'normal', 'large', 'xlarge'])
const DATE_FORMAT_SET = new Set<DateFormat>(DATE_FORMATS)

function defaultsFor(tenantId: string) {
  return {
    tenantId,
    theme: 'dark-farm',
    fontSize: 'normal',
    notificationsEnabled: true,
    soundAlertsEnabled: false,
    offlineModeEnabled: true,
    accentColor: '#4ade80',
    logoEmoji: '🌾',
    dashboardGreeting: 'Good morning!',
    currencySymbol: 'KSh',
    weightUnit: 'kg',
    modules: [] as ModuleSetting[],
    timezone: DEFAULT_TIMEZONE,
    dateFormat: DEFAULT_DATE_FORMAT,
    sessionTimeoutMinutes: null as number | null,
    updatedAt: null as Date | null,
  }
}

function getTenantId(req: Request): string | null {
  const url = new URL(req.url)
  return url.searchParams.get('tenantId')?.trim() || null
}

export async function GET(req: Request) {
  const result = await requireTenantSession({ explicitTenantId: getTenantId(req) })
  if ('error' in result) return result.error
  const { tenantId } = result

  const rows = await db.select().from(tenantSettings).where(eq(tenantSettings.tenantId, tenantId)).limit(1)
  return ok(rows[0] ?? defaultsFor(tenantId))
}

export async function PATCH(req: Request) {
  const result = await requireTenantSession({ roles: ['owner', 'super_admin'], explicitTenantId: getTenantId(req) })
  if ('error' in result) return result.error
  const { tenantId } = result

  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return bad('Invalid JSON body')
  }
  const b = (raw ?? {}) as Record<string, unknown>

  const fields: Record<string, string> = {}
  const patch: Partial<typeof tenantSettings.$inferInsert> = {}

  if (b.theme !== undefined) {
    if (typeof b.theme !== 'string' || !THEMES.has(b.theme)) {
      fields.theme = 'theme must be one of: dark-farm, high-contrast, light-farm, sun-mode'
    } else patch.theme = b.theme
  }
  if (b.fontSize !== undefined) {
    if (typeof b.fontSize !== 'string' || !FONT_SIZES.has(b.fontSize)) {
      fields.fontSize = 'fontSize must be one of: small, normal, large, xlarge'
    } else patch.fontSize = b.fontSize
  }
  if (b.notificationsEnabled !== undefined) {
    if (typeof b.notificationsEnabled !== 'boolean') fields.notificationsEnabled = 'notificationsEnabled must be a boolean'
    else patch.notificationsEnabled = b.notificationsEnabled
  }
  if (b.soundAlertsEnabled !== undefined) {
    if (typeof b.soundAlertsEnabled !== 'boolean') fields.soundAlertsEnabled = 'soundAlertsEnabled must be a boolean'
    else patch.soundAlertsEnabled = b.soundAlertsEnabled
  }
  if (b.offlineModeEnabled !== undefined) {
    if (typeof b.offlineModeEnabled !== 'boolean') fields.offlineModeEnabled = 'offlineModeEnabled must be a boolean'
    else patch.offlineModeEnabled = b.offlineModeEnabled
  }
  if (b.accentColor !== undefined) {
    if (typeof b.accentColor !== 'string' || !b.accentColor.trim()) fields.accentColor = 'accentColor must be a non-empty string'
    else patch.accentColor = b.accentColor
  }
  if (b.logoEmoji !== undefined) {
    if (typeof b.logoEmoji !== 'string' || !b.logoEmoji.trim()) fields.logoEmoji = 'logoEmoji must be a non-empty string'
    else patch.logoEmoji = b.logoEmoji
  }
  if (b.dashboardGreeting !== undefined) {
    if (typeof b.dashboardGreeting !== 'string') fields.dashboardGreeting = 'dashboardGreeting must be a string'
    else patch.dashboardGreeting = b.dashboardGreeting
  }
  if (b.currencySymbol !== undefined) {
    if (typeof b.currencySymbol !== 'string' || !b.currencySymbol.trim()) fields.currencySymbol = 'currencySymbol must be a non-empty string'
    else patch.currencySymbol = b.currencySymbol
  }
  if (b.weightUnit !== undefined) {
    if (typeof b.weightUnit !== 'string' || !b.weightUnit.trim()) fields.weightUnit = 'weightUnit must be a non-empty string'
    else patch.weightUnit = b.weightUnit
  }
  if (b.modules !== undefined) {
    if (!Array.isArray(b.modules)) {
      fields.modules = 'modules must be an array'
    } else {
      let modulesOk = true
      for (const m of b.modules) {
        const entry = m as Record<string, unknown>
        if (!entry || typeof entry !== 'object' || typeof entry.id !== 'string' || typeof entry.enabled !== 'boolean') {
          fields.modules = 'each modules entry requires { id: string, enabled: boolean, customLabel?: string }'
          modulesOk = false
          break
        }
        if (entry.customLabel !== undefined && typeof entry.customLabel !== 'string') {
          fields.modules = 'modules[].customLabel must be a string when present'
          modulesOk = false
          break
        }
      }
      if (modulesOk) patch.modules = b.modules as ModuleSetting[]
    }
  }
  if (b.timezone !== undefined) {
    if (typeof b.timezone !== 'string' || !isValidTimezone(b.timezone)) {
      fields.timezone = 'timezone must be a valid IANA timezone name (e.g. Africa/Nairobi)'
    } else patch.timezone = b.timezone
  }
  if (b.dateFormat !== undefined) {
    if (typeof b.dateFormat !== 'string' || !DATE_FORMAT_SET.has(b.dateFormat as DateFormat)) {
      fields.dateFormat = `dateFormat must be one of: ${DATE_FORMATS.join(', ')}`
    } else patch.dateFormat = b.dateFormat
  }
  if (b.sessionTimeoutMinutes !== undefined) {
    if (b.sessionTimeoutMinutes === null) {
      // Explicit null clears the override, back to the platform default.
      patch.sessionTimeoutMinutes = null
    } else if (
      typeof b.sessionTimeoutMinutes !== 'number' ||
      !Number.isInteger(b.sessionTimeoutMinutes) ||
      b.sessionTimeoutMinutes < MIN_SESSION_TIMEOUT_MINUTES ||
      b.sessionTimeoutMinutes > MAX_SESSION_TIMEOUT_MINUTES
    ) {
      fields.sessionTimeoutMinutes = `sessionTimeoutMinutes must be an integer between ${MIN_SESSION_TIMEOUT_MINUTES} and ${MAX_SESSION_TIMEOUT_MINUTES}, or null`
    } else {
      patch.sessionTimeoutMinutes = b.sessionTimeoutMinutes
    }
  }

  if (Object.keys(fields).length > 0) return badFields(fields)
  if (Object.keys(patch).length === 0) return bad('No valid fields to update')

  const defaults = defaultsFor(tenantId)
  const [row] = await db
    .insert(tenantSettings)
    .values({ ...defaults, ...patch, tenantId, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: tenantSettings.tenantId,
      set: { ...patch, updatedAt: new Date() },
    })
    .returning()

  return ok(row)
}
