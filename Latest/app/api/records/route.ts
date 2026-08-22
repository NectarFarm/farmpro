import { NextResponse } from 'next/server'
import { db } from '@/db'
import { records, batches, employees } from '@/db/schemas'
import { and, desc, eq, inArray } from 'drizzle-orm'
import { batchIdsForFarm, farmNotFoundResponse, resolveFarmFilter } from '@/lib/farm-scope'
import { requireTenantSession } from '@/lib/api-auth'

// ── GET/POST /api/records (issue #247 task 2) ───────────────────────────────
// Generic worker-submission log — feeding / mortality / physical_count today
// (see db/schemas/people.ts for why this is one table, not one per type).
//
// POST does not enforce employees.mortalityPhotoThreshold against `photoUrl`
// server-side: components/farm/worker.tsx's MortalityForm already blocks the
// submit flow client-side once the death count reaches the threshold
// (`needsPhoto` gates the Photo step before Confirm), and there is no
// deaths-count field standardized across `data` payloads yet to key a
// server-side check off (mortality's own `count` lives inside the loose
// jsonb `data` blob). Enforcing this properly needs a typed mortality
// payload — left for a follow-up rather than half-validating one field name
// out of an intentionally-loose jsonb column.
//
// Same tenant-resolution + envelope conventions as the batches/employees
// routes: session tenant wins, `tenantId` query param / body field is the
// standalone-mock-mode fallback.

const ok = <T>(data: T) => NextResponse.json({ success: true, data }, { status: 200 })
const created = <T>(data: T) => NextResponse.json({ success: true, data }, { status: 201 })
const badRequest = (msg: string) => NextResponse.json({ success: false, error: msg }, { status: 400 })
const notFound = (msg: string) => NextResponse.json({ success: false, error: msg }, { status: 404 })

const RECORD_TYPES = new Set(['feeding', 'mortality', 'physical_count'])

// GET /api/records?tenantId=&batchId=&type=&employeeId=&farmId= — activity
// feed / worker's own history, newest first.
//
// `farmId` is a two-hop JOIN filter (farm-scoped-data task):
// records.batchId -> batches.unitId -> production_units.farmId. `records`
// has no farm_id of its own — same "don't denormalise a fact reachable
// through an existing FK chain" reasoning as GET /api/batches's farmId.
export async function GET(req: Request) {
  const auth = await requireTenantSession()
  if ('error' in auth) return auth.error
  const { tenantId } = auth

  const url = new URL(req.url)
  const batchId = url.searchParams.get('batchId')?.trim()
  const type = url.searchParams.get('type')?.trim()
  const employeeId = url.searchParams.get('employeeId')?.trim()

  const farmFilter = await resolveFarmFilter(tenantId, url.searchParams.get('farmId'))
  if (farmFilter === null) return NextResponse.json(farmNotFoundResponse(), { status: 404 })

  const conditions = [eq(records.tenantId, tenantId)]
  if (batchId) conditions.push(eq(records.batchId, batchId))
  if (type) conditions.push(eq(records.type, type))
  if (employeeId) conditions.push(eq(records.employeeId, employeeId))
  if (farmFilter) {
    const batchIds = await batchIdsForFarm(tenantId, farmFilter)
    if (batchIds.length === 0) return ok([])
    conditions.push(inArray(records.batchId, batchIds))
  }

  const rows = await db
    .select()
    .from(records)
    .where(and(...conditions))
    .orderBy(desc(records.createdAt), desc(records.id))

  return ok(rows)
}

// POST /api/records — create a feeding/mortality/physical_count submission.
// Body: { tenantId?, batchId, employeeId, type, data?, photoUrl? }
// `batchId` and `employeeId` must belong to the same tenant — checked here
// (not just left to the FK) so a bad/foreign id gets a clean 400/404 instead
// of a bare constraint-violation 500, same convention POST /api/batches uses
// for `unitId`.
export async function POST(req: Request) {
  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return badRequest('Invalid JSON body')
  }
  const b = (raw ?? {}) as Record<string, unknown>
  // Auditor is strictly read-only (vet/auditor screens task) — refused here
  // with a real 403 rather than relying on the UI simply not offering a
  // write form. Session is required for every other role too (auth fix:
  // fix/authenticate-all-apis) — this used to fall back to a body `tenantId`
  // for a session-less caller.
  const auth = await requireTenantSession({
    roles: ['owner', 'manager', 'worker', 'vet', 'super_admin'],
    explicitTenantId: typeof b.tenantId === 'string' ? b.tenantId : undefined,
  })
  if ('error' in auth) return auth.error
  const { tenantId } = auth
  const batchId = typeof b.batchId === 'string' ? b.batchId.trim() : ''
  const employeeId = typeof b.employeeId === 'string' ? b.employeeId.trim() : ''
  const type = typeof b.type === 'string' ? b.type.trim() : ''

  if (!batchId) return badRequest('batchId is required')
  if (!employeeId) return badRequest('employeeId is required')
  if (!RECORD_TYPES.has(type)) {
    return badRequest(`type must be one of: ${Array.from(RECORD_TYPES).join(', ')}`)
  }

  const batchRows = await db
    .select({ id: batches.id })
    .from(batches)
    .where(and(eq(batches.id, batchId), eq(batches.tenantId, tenantId)))
  if (batchRows.length === 0) return notFound('Batch not found for this tenant')

  const employeeRows = await db
    .select({ id: employees.id })
    .from(employees)
    .where(and(eq(employees.id, employeeId), eq(employees.tenantId, tenantId)))
  if (employeeRows.length === 0) return notFound('Employee not found for this tenant')

  const data = (b.data && typeof b.data === 'object' && !Array.isArray(b.data)) ? (b.data as Record<string, unknown>) : {}
  const photoUrl = typeof b.photoUrl === 'string' && b.photoUrl.trim() ? b.photoUrl.trim() : null

  const id = crypto.randomUUID()
  const rows = await db
    .insert(records)
    .values({
      id,
      tenantId,
      batchId,
      employeeId,
      type,
      data,
      photoUrl,
    })
    .returning()

  return created(rows[0])
}
