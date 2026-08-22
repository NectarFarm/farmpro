import { NextResponse } from 'next/server'
import { db } from '@/db'
import { employees, batches } from '@/db/schemas'
import { and, asc, eq, inArray } from 'drizzle-orm'
import { farmNotFoundResponse, resolveFarmFilter } from '@/lib/farm-scope'
import { requireTenantSession } from '@/lib/api-auth'

// ── GET/POST /api/employees (issue #247) ────────────────────────────────────
// Fresh build: no `employees` table or `/api/employees/*` route existed on
// this branch before this issue (see the issue's branch-correction note).
// Field set mirrors `EMPLOYEES_DATA` in components/farm/data.ts, trimmed to
// what the issue's task list actually asks a from-scratch backend to carry —
// see db/schemas/people.ts for the full field-by-field rationale.
//
// Same tenant-resolution + envelope conventions as GET/POST /api/batches:
// session tenant wins, `tenantId` query param / body field is the
// standalone-mock-mode fallback. Write access (POST here, PATCH in
// [id]/route.ts) is meant for owner/manager callers; this branch has no
// role-gated middleware yet (same state every other CRUD route on this
// branch is in — see GET/POST /api/batches, /api/units), so this route
// trusts the caller's tenant scope and doesn't additionally check `role`.

const ok = <T>(data: T) => NextResponse.json({ success: true, data }, { status: 200 })
const created = <T>(data: T) => NextResponse.json({ success: true, data }, { status: 201 })
const badRequest = (msg: string) => NextResponse.json({ success: false, error: msg }, { status: 400 })
const notFound = (msg: string) => NextResponse.json({ success: false, error: msg }, { status: 404 })

// Validates that every id in `ids` is a real batch belonging to `tenantId`.
// Returns the deduped, trimmed list on success, or null if any id doesn't
// resolve — same "400/404 instead of a bare FK-violation 500" shape POST
// /api/batches uses for `unitId` (assignedBatchIds has no DB FK to enforce
// this itself — see db/schemas/people.ts).
async function validateBatchIds(tenantId: string, ids: string[]): Promise<string[] | null> {
  const unique = Array.from(new Set(ids.map((id) => id.trim()).filter(Boolean)))
  if (unique.length === 0) return []
  const rows = await db
    .select({ id: batches.id })
    .from(batches)
    .where(and(eq(batches.tenantId, tenantId), inArray(batches.id, unique)))
  if (rows.length !== unique.length) return null
  return unique
}

function parseAssignedBatchIds(value: unknown): string[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) return []
  return value.filter((v): v is string => typeof v === 'string')
}

// GET /api/employees?tenantId=&status= — list a tenant's employees.
export async function GET(req: Request) {
  const url = new URL(req.url)
  const auth = await requireTenantSession()
  if ('error' in auth) return auth.error
  const { tenantId } = auth

  const status = url.searchParams.get('status')?.trim()

  // farmId (direct filter — employees.farmId, farm-scoped-data task).
  const farmFilter = await resolveFarmFilter(tenantId, url.searchParams.get('farmId'))
  if (farmFilter === null) return NextResponse.json(farmNotFoundResponse(), { status: 404 })

  const conditions = [eq(employees.tenantId, tenantId)]
  if (status) conditions.push(eq(employees.status, status))
  if (farmFilter) conditions.push(eq(employees.farmId, farmFilter))

  const rows = await db
    .select()
    .from(employees)
    .where(and(...conditions))
    .orderBy(asc(employees.createdAt), asc(employees.id))

  return ok(rows)
}

// POST /api/employees — create an employee.
// Body: { tenantId?, userId?, name, phone?, role?, assignedBatchIds?,
//         mortalityPhotoThreshold?, status?, farmId? }
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

  // farmId (farm-scoped-data task) — the employee's home farm, optional.
  const farmFilter = await resolveFarmFilter(tenantId, typeof b.farmId === 'string' ? b.farmId : undefined)
  if (farmFilter === null) return notFound('Farm not found for this tenant')

  const userId = typeof b.userId === 'string' && b.userId.trim() ? b.userId.trim() : null
  const phone = typeof b.phone === 'string' ? b.phone.trim() : ''
  const role = typeof b.role === 'string' && b.role.trim() ? b.role.trim() : 'worker'
  const status = typeof b.status === 'string' && b.status.trim() ? b.status.trim() : 'ACTIVE'
  const mortalityPhotoThreshold = Number.isFinite(Number(b.mortalityPhotoThreshold))
    ? Math.max(0, Math.trunc(Number(b.mortalityPhotoThreshold)))
    : 3

  const requestedBatchIds = parseAssignedBatchIds(b.assignedBatchIds) ?? []
  const assignedBatchIds = await validateBatchIds(tenantId, requestedBatchIds)
  if (assignedBatchIds === null) return notFound('One or more assignedBatchIds do not belong to this tenant')

  const id = crypto.randomUUID()
  const rows = await db
    .insert(employees)
    .values({
      id,
      tenantId,
      userId,
      name,
      phone,
      role,
      assignedBatchIds,
      mortalityPhotoThreshold,
      status,
      farmId: farmFilter ?? null,
    })
    .returning()

  return created(rows[0])
}
