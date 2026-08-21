import { NextResponse } from 'next/server'
import { db } from '@/db'
import { farms } from '@/db/schemas'
import { getSessionUser } from '@/lib/auth'
import { and, eq, asc } from 'drizzle-orm'

// ── Farms API (issue #219) ─────────────────────────────────────────────────
// New-backend routes powering the shell's farm switcher. Built fresh in this
// project per the review on #266 — NOT against the old Frontend/ backend.
//
// Tenant scoping: with real sessions (issue #221) the tenant comes from the
// authenticated session when present; the per-request `tenantId` stays as the
// fallback for standalone mock mode (no active session).
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
  const session = await getSessionUser()
  const url = new URL(req.url)
  const tenantId = session?.tenantId ?? url.searchParams.get('tenantId')?.trim()
  if (!tenantId) return badRequest('tenantId is required')
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
// Body: { tenantId, name, location?, code? }
export async function POST(req: Request) {
  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return badRequest('Invalid JSON body')
  }
  const b = (raw ?? {}) as Record<string, unknown>
  const session = await getSessionUser()
  const tenantId = session?.tenantId ?? (typeof b.tenantId === 'string' ? b.tenantId.trim() : '')
  const name = typeof b.name === 'string' ? b.name.trim() : ''
  if (!tenantId) return badRequest('tenantId is required')
  if (!name) return badRequest('name is required')

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
    await db.insert(farms).values({ id, tenantId, name, location, code })
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
