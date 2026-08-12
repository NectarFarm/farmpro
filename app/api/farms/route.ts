import { NextResponse } from 'next/server'
import { db } from '@/db'
import { farms } from '@/db/schemas'
import { eq, asc } from 'drizzle-orm'

// ── Farms API (issue #219) ─────────────────────────────────────────────────
// New-backend routes powering the shell's farm switcher. Built fresh in this
// project per the review on #266 — NOT against the old Frontend/ backend.
//
// Tenant scoping is PROVISIONAL: the new backend has no session system yet
// (that's the #220 session-bootstrap issue), so these routes take the tenant id
// per request. When #220 lands real sessions, swap `tenantId` below for
// `session.tenantId` and enforce the owner/manager gate there.
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

// GET /api/farms?tenantId=... — list a tenant's farms (oldest first).
export async function GET(req: Request) {
  const tenantId = new URL(req.url).searchParams.get('tenantId')?.trim()
  if (!tenantId) return badRequest('tenantId is required')
  const rows = await db
    .select()
    .from(farms)
    .where(eq(farms.tenantId, tenantId))
    .orderBy(asc(farms.createdAt))
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
  const tenantId = typeof b.tenantId === 'string' ? b.tenantId.trim() : ''
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

  await db.insert(farms).values({ id, tenantId, name, location, code })
  return created({ id, code })
}

function farmCodeFromName(name: string): string {
  const slug = name.toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 12).replace(/-+$/g, '')
  return `FRM-${slug || 'FARM'}`
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders })
}
