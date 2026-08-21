import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { tenantSettings, type ModuleSetting } from '@/db/schemas'
import { getSessionUser, type SessionUser } from '@/lib/auth'

// ── GET/PATCH /api/settings (issue #255) ────────────────────────────────────
// Per-tenant settings store — one row per tenant (tenant_settings.tenant_id),
// not per user/device, so a setting changed by one user is immediately
// visible to a second user on the same tenant (this issue's acceptance
// criterion). Field set matches components/farm/settings.tsx (theme,
// fontSize, notifications, soundAlerts, offline mode) and
// components/farm/ui-customise.tsx (branding + modules) exactly — see
// db/schemas/settings.ts for the full mapping. Backend-only: #256 wires the
// two screens up to this store.
//
// GET is readable by any authenticated user on the tenant (same shape as
// GET /api/role-permissions) — a manager needs to see current settings even
// though only an owner/super_admin can change them. PATCH is write-gated to
// owner/super_admin, mirroring ui-customise.tsx's own nav gate
// (`role === "super_admin" || role === "owner"`).
//
// No row exists for a tenant until the first PATCH — GET returns the schema's
// documented defaults in that case (never a 404), and PATCH upserts.

const bad = (msg: string, status = 400) =>
  NextResponse.json({ success: false, error: msg }, { status })
const ok = <T>(data: T, status = 200) => NextResponse.json({ success: true, data }, { status })

const THEMES = new Set(['dark-farm', 'high-contrast', 'light-farm', 'sun-mode'])
const FONT_SIZES = new Set(['small', 'normal', 'large', 'xlarge'])

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
    updatedAt: null as Date | null,
  }
}

// Tenant resolution mirrors GET /api/role-permissions: a session's own tenant
// wins; a ?tenantId= query param is only a fallback (e.g. for a future
// super_admin admin view — super_admin sessions carry no tenantId of their
// own).
function resolveTenantId(req: Request, session: SessionUser | null): string | null {
  if (session?.tenantId) return session.tenantId
  const url = new URL(req.url)
  return url.searchParams.get('tenantId')?.trim() || null
}

export async function GET(req: Request) {
  const session = await getSessionUser()
  if (!session) return bad('Unauthorized', 401)
  const tenantId = resolveTenantId(req, session)
  if (!tenantId) return bad('tenantId is required')

  const rows = await db.select().from(tenantSettings).where(eq(tenantSettings.tenantId, tenantId)).limit(1)
  return ok(rows[0] ?? defaultsFor(tenantId))
}

export async function PATCH(req: Request) {
  const session = await getSessionUser()
  if (!session) return bad('Unauthorized', 401)
  if (session.role !== 'owner' && session.role !== 'super_admin') {
    return bad('Forbidden', 403)
  }
  const tenantId = resolveTenantId(req, session)
  if (!tenantId) return bad('tenantId is required')

  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return bad('Invalid JSON body')
  }
  const b = (raw ?? {}) as Record<string, unknown>

  const patch: Partial<typeof tenantSettings.$inferInsert> = {}

  if (b.theme !== undefined) {
    if (typeof b.theme !== 'string' || !THEMES.has(b.theme)) {
      return bad('theme must be one of: dark-farm, high-contrast, light-farm, sun-mode')
    }
    patch.theme = b.theme
  }
  if (b.fontSize !== undefined) {
    if (typeof b.fontSize !== 'string' || !FONT_SIZES.has(b.fontSize)) {
      return bad('fontSize must be one of: small, normal, large, xlarge')
    }
    patch.fontSize = b.fontSize
  }
  if (b.notificationsEnabled !== undefined) {
    if (typeof b.notificationsEnabled !== 'boolean') return bad('notificationsEnabled must be a boolean')
    patch.notificationsEnabled = b.notificationsEnabled
  }
  if (b.soundAlertsEnabled !== undefined) {
    if (typeof b.soundAlertsEnabled !== 'boolean') return bad('soundAlertsEnabled must be a boolean')
    patch.soundAlertsEnabled = b.soundAlertsEnabled
  }
  if (b.offlineModeEnabled !== undefined) {
    if (typeof b.offlineModeEnabled !== 'boolean') return bad('offlineModeEnabled must be a boolean')
    patch.offlineModeEnabled = b.offlineModeEnabled
  }
  if (b.accentColor !== undefined) {
    if (typeof b.accentColor !== 'string' || !b.accentColor.trim()) return bad('accentColor must be a non-empty string')
    patch.accentColor = b.accentColor
  }
  if (b.logoEmoji !== undefined) {
    if (typeof b.logoEmoji !== 'string' || !b.logoEmoji.trim()) return bad('logoEmoji must be a non-empty string')
    patch.logoEmoji = b.logoEmoji
  }
  if (b.dashboardGreeting !== undefined) {
    if (typeof b.dashboardGreeting !== 'string') return bad('dashboardGreeting must be a string')
    patch.dashboardGreeting = b.dashboardGreeting
  }
  if (b.currencySymbol !== undefined) {
    if (typeof b.currencySymbol !== 'string' || !b.currencySymbol.trim()) return bad('currencySymbol must be a non-empty string')
    patch.currencySymbol = b.currencySymbol
  }
  if (b.weightUnit !== undefined) {
    if (typeof b.weightUnit !== 'string' || !b.weightUnit.trim()) return bad('weightUnit must be a non-empty string')
    patch.weightUnit = b.weightUnit
  }
  if (b.modules !== undefined) {
    if (!Array.isArray(b.modules)) return bad('modules must be an array')
    for (const m of b.modules) {
      const entry = m as Record<string, unknown>
      if (!entry || typeof entry !== 'object' || typeof entry.id !== 'string' || typeof entry.enabled !== 'boolean') {
        return bad('each modules entry requires { id: string, enabled: boolean, customLabel?: string }')
      }
      if (entry.customLabel !== undefined && typeof entry.customLabel !== 'string') {
        return bad('modules[].customLabel must be a string when present')
      }
    }
    patch.modules = b.modules as ModuleSetting[]
  }

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
