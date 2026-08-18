import { NextResponse } from 'next/server'
import { db } from '@/db'
import { records, batches, employees } from '@/db/schemas'
import { getSessionUser } from '@/lib/auth'
import { and, desc, eq } from 'drizzle-orm'

// ── GET/POST /api/records (issue #247 task 2) ───────────────────────────────
// Generic worker-submission log — feeding / mortality / physical_count today
// (see db/schemas/people.ts for why this is one table, not one per type).
//
// Mortality photo gate: `employees.mortalityPhotoThreshold` is the server-side
// source of truth. A mortality record whose `data.count` is at or above the
// threshold REQUIRES `photoUrl` — the route rejects it with 400 if the photo
// is missing, so the gate holds even against direct API calls, not just the
// client-side check in components/farm/worker.tsx's MortalityForm (`needsPhoto`
// gates the Photo step before Confirm). The mortality `count` lives inside the
// loose jsonb `data` blob, so this reads that one field by name — a typed
// mortality payload would let the check be stricter, but a plain count check
// is safe: feeding/physical_count records never carry a death count.
//
// Same tenant-resolution + envelope conventions as the batches/employees
// routes: session tenant wins, `tenantId` query param / body field is the
// standalone-mock-mode fallback.

const ok = <T>(data: T) => NextResponse.json({ success: true, data }, { status: 200 })
const created = <T>(data: T) => NextResponse.json({ success: true, data }, { status: 201 })
const badRequest = (msg: string) => NextResponse.json({ success: false, error: msg }, { status: 400 })
const notFound = (msg: string) => NextResponse.json({ success: false, error: msg }, { status: 404 })

const RECORD_TYPES = new Set(['feeding', 'mortality', 'physical_count'])

// GET /api/records?tenantId=&batchId=&type=&employeeId= — activity feed /
// worker's own history, newest first.
export async function GET(req: Request) {
  const session = await getSessionUser()
  const url = new URL(req.url)
  const tenantId = session?.tenantId ?? url.searchParams.get('tenantId')?.trim()
  if (!tenantId) return badRequest('tenantId is required')

  const batchId = url.searchParams.get('batchId')?.trim()
  const type = url.searchParams.get('type')?.trim()
  const employeeId = url.searchParams.get('employeeId')?.trim()

  const conditions = [eq(records.tenantId, tenantId)]
  if (batchId) conditions.push(eq(records.batchId, batchId))
  if (type) conditions.push(eq(records.type, type))
  if (employeeId) conditions.push(eq(records.employeeId, employeeId))

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
  const session = await getSessionUser()
  const tenantId = session?.tenantId ?? (typeof b.tenantId === 'string' ? b.tenantId.trim() : '')
  const batchId = typeof b.batchId === 'string' ? b.batchId.trim() : ''
  const employeeId = typeof b.employeeId === 'string' ? b.employeeId.trim() : ''
  const type = typeof b.type === 'string' ? b.type.trim() : ''

  if (!tenantId) return badRequest('tenantId is required')
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
    .select({ id: employees.id, mortalityPhotoThreshold: employees.mortalityPhotoThreshold })
    .from(employees)
    .where(and(eq(employees.id, employeeId), eq(employees.tenantId, tenantId)))
  if (employeeRows.length === 0) return notFound('Employee not found for this tenant')
  const employee = employeeRows[0]

  const data = (b.data && typeof b.data === 'object' && !Array.isArray(b.data)) ? (b.data as Record<string, unknown>) : {}
  const photoUrl = typeof b.photoUrl === 'string' && b.photoUrl.trim() ? b.photoUrl.trim() : null

  // Server-side mortality photo gate (the client-side `needsPhoto` check is
  // not a security boundary — a direct API call could bypass it). A mortality
  // record with `data.count >= threshold` must carry a photo.
  if (type === 'mortality') {
    const count = typeof data.count === 'number' ? data.count : Number(data.count)
    if (Number.isFinite(count) && count >= employee.mortalityPhotoThreshold && !photoUrl) {
      return badRequest(`A photo is required for ${employee.mortalityPhotoThreshold}+ deaths (this employee's threshold)`)
    }
  }

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
