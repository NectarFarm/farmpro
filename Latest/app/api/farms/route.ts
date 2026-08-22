import { NextResponse } from 'next/server'
import { db } from '@/db'
import { farms } from '@/db/schemas'
import { and, eq, asc } from 'drizzle-orm'
import { requireTenantSession } from '@/lib/api-auth'
import { validateLocation } from '@/lib/validation'

// ── Farms API (issue #219; auth fix: fix/authenticate-all-apis) ────────────
// New-backend routes powering the shell's farm switcher. Built fresh in this
// project per the review on #266 — NOT against the old Frontend/ backend.
//
// Tenant scoping: comes from the authenticated session ONLY. This used to
// fall back to a `tenantId` query param / body field for a session-less
// caller ("standalone mock mode") — that fallback is exactly the hole this
// task closes, since it let anyone read/create farms for any tenant they
// could guess an id for.
//
// Response envelope matches app/api/health/route.ts and lib/api-response.ts
// ({ success, data | error }), which lib/request.ts's parseApiResponse already
// understands.

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
}

const ok = <T>(data: T) =>
  NextResponse.json({ success: true, data }, { status: 200, headers: corsHeaders })
const created = <T>(data: T) =>
  NextResponse.json({ success: true, data }, { status: 201, headers: corsHeaders })
const badRequest = (msg: string) =>
  NextResponse.json({ success: false, error: msg }, { status: 400, headers: corsHeaders })

// Postgres unique-violation (23505) — surfaced as a clean envelope, not a bare 500.
function isUniqueViolation(err: unknown): boolean {
  return !!err && typeof err === 'object' && (err as { code?: string }).code === '23505'
}

// GET /api/farms?tenantId=&includeArchived= — list a tenant's farms (oldest
// first). Archived farms are excluded by default so the farm switcher and
// every other existing caller keep seeing only farms they can actually
// switch into; the admin farms screen opts in with includeArchived=true to
// show (and manage) archived ones too.
export async function GET(req: Request) {
  const url = new URL(req.url)
  const auth = await requireTenantSession()
  if ('error' in auth) return auth.error
  const { tenantId } = auth

  const includeArchived = url.searchParams.get('includeArchived') === 'true'
  const conditions = [eq(farms.tenantId, tenantId)]
  if (!includeArchived) conditions.push(eq(farms.status, 'ACTIVE'))
  const rows = await db
    .select()
    .from(farms)
    .where(and(...conditions))
    .orderBy(asc(farms.createdAt), asc(farms.id))
  return ok(rows)
}

// POST /api/farms — create a farm under a tenant.
// Body: { tenantId? (super_admin only — see requireTenantSession), name, location?, code? }
export async function POST(req: Request) {
  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return badRequest('Invalid JSON body')
  }
  const b = (raw ?? {}) as Record<string, unknown>
  const auth = await requireTenantSession({ explicitTenantId: typeof b.tenantId === 'string' ? b.tenantId : undefined })
  if ('error' in auth) return auth.error
  const { tenantId } = auth
  const name = typeof b.name === 'string' ? b.name.trim() : ''
  if (!name) return badRequest('name is required')

  // GPS pin is optional at creation time (ui-polish-theme-weather) — most
  // farms get one later, from onboarding provisioning or the Weather
  // screen's empty state, not this form.
  const loc = validateLocation({ latitude: b.latitude, longitude: b.longitude })
  if (Object.keys(loc.fields).length > 0) {
    const firstKey = Object.keys(loc.fields)[0]
    return NextResponse.json({ success: false, error: loc.fields[firstKey], fields: loc.fields }, { status: 400, headers: corsHeaders })
  }

  const id = crypto.randomUUID()
  const requestedCode = typeof b.code === 'string' ? b.code.trim() : ''
  const location = typeof b.location === 'string' ? b.location.trim() : ''
  let code = requestedCode || farmCodeFromName(name)

  // Farm codes are a tenant's human-facing labels — keep them unique per tenant.
  const taken = new Set(
    (await db.select({ code: farms.code }).from(farms).where(eq(farms.tenantId, tenantId))).map((r) => r.code)
  )
  if (taken.has(code)) code = `${code}-${id.slice(0, 4).toUpperCase()}`

  // The per-tenant SELECT above generates a friendly non-colliding code; the DB's
  // unique index (idx_farms_tenant_code) is the real guard for the concurrent case.
  // Either way, a failure here must return the app's error envelope, not a bare 500.
  try {
    await db.insert(farms).values({ id, tenantId, name, location, code, latitude: loc.latitude, longitude: loc.longitude })
  } catch (err) {
    if (isUniqueViolation(err)) {
      return NextResponse.json({ success: false, error: 'A farm with this code already exists — retry' }, { status: 409, headers: corsHeaders })
    }
    return NextResponse.json({ success: false, error: 'Failed to create farm' }, { status: 500, headers: corsHeaders })
  }
  return created({ id, code })
}

function farmCodeFromName(name: string): string {
  const slug = name.toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 12).replace(/-+$/g, '')
  return `FRM-${slug || 'FARM'}`
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders })
}
