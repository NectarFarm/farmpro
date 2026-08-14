import { NextResponse } from 'next/server'
import { db } from '@/db'
import { productionUnits, farms } from '@/db/schemas'
import { getSessionUser } from '@/lib/auth'
import { and, asc, eq, like } from 'drizzle-orm'
import { farmSegment, generateCode, unitPrefixFor } from '@/lib/codes'

// ── GET/POST /api/units (issue #232) ────────────────────────────────────────
// The `production_units` table has existed since #219, but no route ever read
// or wrote it — CropsScreen's "Units" tab and the batch-creation wizard both
// hardcoded a mock array/single-unit form instead. This is that missing route,
// built the same shape as GET/POST /api/farms and /api/batches (same tenant
// resolution, envelope, and per-tenant code-uniqueness conventions — see
// lib/codes.ts and db/schemas/index.ts's idx_production_units_tenant_code).
//
// Kept intentionally small: list/create only, no PATCH/DELETE — nothing in
// #232's scope needs updating a unit after creation (batch unit-transfer moves
// the *batch's* unitId via PATCH /api/batches/[id], not the unit row itself).

const ok = <T>(data: T) => NextResponse.json({ success: true, data }, { status: 200 })
const created = <T>(data: T) => NextResponse.json({ success: true, data }, { status: 201 })
const badRequest = (msg: string) => NextResponse.json({ success: false, error: msg }, { status: 400 })
const notFound = (msg: string) => NextResponse.json({ success: false, error: msg }, { status: 404 })

function isUniqueViolation(err: unknown): boolean {
  return !!err && typeof err === 'object' && (err as { code?: string }).code === '23505'
}

// GET /api/units?tenantId=...&farmId=... — list a tenant's production units,
// optionally filtered to one farm. Ordered by code so the UI's unit lists are
// stable across reloads.
export async function GET(req: Request) {
  const session = await getSessionUser()
  const url = new URL(req.url)
  const tenantId = session?.tenantId ?? url.searchParams.get('tenantId')?.trim()
  if (!tenantId) return badRequest('tenantId is required')

  const farmId = url.searchParams.get('farmId')?.trim()
  const conditions = [eq(productionUnits.tenantId, tenantId)]
  if (farmId) conditions.push(eq(productionUnits.farmId, farmId))

  const rows = await db
    .select()
    .from(productionUnits)
    .where(and(...conditions))
    .orderBy(asc(productionUnits.code), asc(productionUnits.id))

  return ok(rows)
}

// POST /api/units — create a production unit under a farm.
// Body: { tenantId?, farmId, type, name, code?, status?, enterprise? }
//
// `enterprise` is optional and only used (when `code` isn't supplied) to pick
// a human-readable code prefix via lib/codes.ts's unitPrefixFor — e.g. the
// batch-creation wizard already knows the enterprise subtype ("broiler") and
// can pass it through so a generated unit code looks like "HSE-KMU-004", the
// same scheme batch codes use. Falling back to `type` keeps direct/API-only
// callers (no enterprise context) working too.
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
  const farmId = typeof b.farmId === 'string' ? b.farmId.trim() : ''
  const type = typeof b.type === 'string' ? b.type.trim() : ''
  const name = typeof b.name === 'string' ? b.name.trim() : ''

  if (!tenantId) return badRequest('tenantId is required')
  if (!farmId) return badRequest('farmId is required')
  if (!type) return badRequest('type is required')
  if (!name) return badRequest('name is required')

  const farmRows = await db
    .select()
    .from(farms)
    .where(and(eq(farms.id, farmId), eq(farms.tenantId, tenantId)))
  const farm = farmRows[0]
  if (!farm) return notFound('Farm not found for this tenant')

  const status = typeof b.status === 'string' && b.status.trim() ? b.status.trim() : 'ACTIVE'
  const enterprise = typeof b.enterprise === 'string' ? b.enterprise.trim() : ''

  const id = crypto.randomUUID()
  const requestedCode = typeof b.code === 'string' ? b.code.trim() : ''
  const prefix = unitPrefixFor(enterprise || type)

  // Same friendly-code-then-DB-guard strategy as POST /api/batches: the SELECT
  // below produces a non-colliding code in the common case, and
  // idx_production_units_tenant_code is the real guard for the concurrent
  // race (handled below).
  const segment = farmSegment(farm.code)
  const likePattern = `${prefix}-${segment}-%`
  const existingWithPrefix = await db
    .select({ code: productionUnits.code })
    .from(productionUnits)
    .where(and(eq(productionUnits.tenantId, tenantId), like(productionUnits.code, likePattern)))
  let code = requestedCode || generateCode(prefix, farm.code, existingWithPrefix.length + 1)

  const takenCodes = new Set(
    (await db.select({ code: productionUnits.code }).from(productionUnits).where(eq(productionUnits.tenantId, tenantId))).map((r) => r.code)
  )
  if (takenCodes.has(code)) code = `${code}-${id.slice(0, 4).toUpperCase()}`

  try {
    const rows = await db
      .insert(productionUnits)
      .values({ id, tenantId, farmId, type, name, code, status })
      .returning()
    return created(rows[0])
  } catch (err) {
    if (isUniqueViolation(err)) {
      return NextResponse.json({ success: false, error: 'A unit with this code already exists — retry' }, { status: 409 })
    }
    return NextResponse.json({ success: false, error: 'Failed to create production unit' }, { status: 500 })
  }
}
