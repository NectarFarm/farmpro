import { NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import { db } from '@/db'
import { batches, productionUnits, farms, auditLog } from '@/db/schemas'
import { getSessionUser } from '@/lib/auth'
import { and, asc, eq, like } from 'drizzle-orm'
import { batchPrefixFor, farmSegment, generateCode } from '@/lib/codes'
import { canEdit, MODULES } from '@/lib/permissions'

// ── GET/POST /api/batches (issue #231) ──────────────────────────────────────
// Fresh build: no `batches` table, `costing.ts`, or `/api/batches/*` route
// existed on this branch before this issue (see the issue's branch-correction
// note). Field set mirrors components/farm/data.ts's `Batch` interface —
// that mock data is the real UI contract, even though it's not real data
// itself. See db/schemas/index.ts for the full table-shape rationale and
// lib/codes.ts for the code-generation strategy.
//
// Same tenant-resolution + envelope conventions as GET /api/farms: session
// tenant wins, `tenantId` query param is the standalone-mock-mode fallback.
// No CORS headers — same-origin SPA only (matches the dashboard-epic routes).

const ok = <T>(data: T) => NextResponse.json({ success: true, data }, { status: 200 })
const created = <T>(data: T) => NextResponse.json({ success: true, data }, { status: 201 })
const badRequest = (msg: string) => NextResponse.json({ success: false, error: msg }, { status: 400 })
const notFound = (msg: string) => NextResponse.json({ success: false, error: msg }, { status: 404 })

function isUniqueViolation(err: unknown): boolean {
  return !!err && typeof err === 'object' && (err as { code?: string }).code === '23505'
}

// GET /api/batches?tenantId=...&unitId=... — list a tenant's batches (oldest
// first), optionally filtered to one production unit.
export async function GET(req: Request) {
  const session = await getSessionUser()
  const url = new URL(req.url)
  const tenantId = session?.tenantId ?? url.searchParams.get('tenantId')?.trim()
  if (!tenantId) return badRequest('tenantId is required')

  const unitId = url.searchParams.get('unitId')?.trim()
  const conditions = [eq(batches.tenantId, tenantId)]
  if (unitId) conditions.push(eq(batches.unitId, unitId))

  const rows = await db
    .select()
    .from(batches)
    .where(and(...conditions))
    .orderBy(asc(batches.createdAt), asc(batches.id))

  return ok(rows)
}

// POST /api/batches — create a batch under a production unit.
// Body: { tenantId?, unitId, name, enterprise, species?, stage?, status?,
//         initialQty?, currentQty?, acquisitionCostCents?, startDate?,
//         endDate?, harvestDate?, code? }
//
// `unitId` must reference a production unit belonging to the same tenant —
// checked here (not just left to the FK) so a bad/foreign unitId gets a clean
// 400/404 instead of a bare constraint-violation 500, and so the unit's farm
// can be looked up to generate the code's location segment.
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
  const unitId = typeof b.unitId === 'string' ? b.unitId.trim() : ''
  const name = typeof b.name === 'string' ? b.name.trim() : ''
  const enterprise = typeof b.enterprise === 'string' ? b.enterprise.trim() : ''

  if (!tenantId) return badRequest('tenantId is required')
  if (!unitId) return badRequest('unitId is required')
  if (!name) return badRequest('name is required')
  if (!enterprise) return badRequest('enterprise is required')

  // Role-matrix enforcement (lib/permissions.ts): creating a batch is a write
  // on the 'batches' module; only checked with a real session.
  if (session && !(await canEdit(tenantId, session.role, MODULES.batches))) {
    return NextResponse.json({ success: false, error: 'You do not have permission to create batches' }, { status: 403 })
  }

  const unitRows = await db
    .select()
    .from(productionUnits)
    .where(and(eq(productionUnits.id, unitId), eq(productionUnits.tenantId, tenantId)))
  const unit = unitRows[0]
  if (!unit) return notFound('Production unit not found for this tenant')

  const farmRows = await db.select().from(farms).where(eq(farms.id, unit.farmId))
  const farmCode = farmRows[0]?.code ?? 'FRM-XXX-000'

  const species = typeof b.species === 'string' ? b.species.trim() : ''
  const stage = typeof b.stage === 'string' ? b.stage.trim() : ''
  const status = typeof b.status === 'string' ? b.status.trim() : 'ACTIVE'
  const initialQty = Number.isFinite(Number(b.initialQty)) ? Math.max(0, Math.trunc(Number(b.initialQty))) : 0
  const currentQty = b.currentQty !== undefined && Number.isFinite(Number(b.currentQty))
    ? Math.max(0, Math.trunc(Number(b.currentQty)))
    : initialQty
  const acquisitionCostCents = Number.isFinite(Number(b.acquisitionCostCents))
    ? Math.max(0, Math.trunc(Number(b.acquisitionCostCents)))
    : 0
  const startDate = typeof b.startDate === 'string' && b.startDate ? new Date(b.startDate) : new Date()
  const endDate = typeof b.endDate === 'string' && b.endDate ? new Date(b.endDate) : null
  const harvestDate = typeof b.harvestDate === 'string' && b.harvestDate ? new Date(b.harvestDate) : null

  const id = crypto.randomUUID()
  const requestedCode = typeof b.code === 'string' ? b.code.trim() : ''
  const prefix = batchPrefixFor(enterprise)

  // Sequence number for the human-readable code: count of this tenant's
  // existing batches whose code already starts with PREFIX-SEGMENT-, plus
  // one. This SELECT generates a friendly non-colliding code in the common
  // case; the DB's unique index (idx_batches_tenant_code) is the real guard
  // for the concurrent-insert race (handled below).
  const segment = farmSegment(farmCode)
  const likePattern = `${prefix}-${segment}-%`
  const existingWithPrefix = await db
    .select({ code: batches.code })
    .from(batches)
    .where(and(eq(batches.tenantId, tenantId), like(batches.code, likePattern)))
  let code = requestedCode || generateCode(prefix, farmCode, existingWithPrefix.length + 1)

  const takenCodes = new Set(
    (await db.select({ code: batches.code }).from(batches).where(eq(batches.tenantId, tenantId))).map((r) => r.code)
  )
  if (takenCodes.has(code)) code = `${code}-${id.slice(0, 4).toUpperCase()}`

  try {
    const rows = await db
      .insert(batches)
      .values({
        id,
        tenantId,
        unitId,
        code,
        name,
        species,
        enterprise,
        stage,
        status,
        initialQty,
        currentQty,
        acquisitionCostCents,
        startDate,
        endDate,
        harvestDate,
      })
      .returning()
    // Timeline's first entry — who created the batch, when.
    await db.insert(auditLog).values({
      id: randomUUID(),
      tenantId,
      actor: session?.id ?? (typeof b.actorId === 'string' ? b.actorId.trim() : 'unknown'),
      action: 'batch.created',
      entity: 'batch',
      entityId: id,
      meta: { code, name, enterprise, initialQty, currentQty, acquisitionCostCents },
    })
    return created(rows[0])
  } catch (err) {
    if (isUniqueViolation(err)) {
      return NextResponse.json({ success: false, error: 'A batch with this code already exists — retry' }, { status: 409 })
    }
    return NextResponse.json({ success: false, error: 'Failed to create batch' }, { status: 500 })
  }
}
