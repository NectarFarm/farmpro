import { NextResponse } from 'next/server'
import { db } from '@/db'
import { employees, batches } from '@/db/schemas'
import { and, eq, inArray } from 'drizzle-orm'
import { writeAuditLog } from '@/lib/audit'
import { requireTenantSession } from '@/lib/api-auth'

// ── GET/PATCH /api/employees/[id] (issue #247; PATCH extended for farms/
// employees CRUD) ────────────────────────────────────────────────────────────
// GET is tenant-scoped: an id only reads when its tenantId matches the
// caller's session tenant — a super_admin session may name one explicitly
// via `?tenantId=` — otherwise 404, same convention as GET/PATCH
// /api/batches/[id]. `Note`: this file lives under app/api/employees/
// alongside a literal `me` segment (app/api/employees/me/route.ts) —
// Next.js resolves a literal path segment before a dynamic one, so
// GET /api/employees/me is never captured by this `[id]` route.
//
// PATCH derives tenant scope from the session only, same as GET, but is
// additionally role-gated: owner/manager write within their own session
// tenant, a super_admin (no tenant of its own) must name one explicitly in
// the body, and every other role is forbidden.

const ok = <T>(data: T) => NextResponse.json({ success: true, data }, { status: 200 })
const badRequest = (msg: string) => NextResponse.json({ success: false, error: msg }, { status: 400 })
const notFound = (msg = 'Employee not found') => NextResponse.json({ success: false, error: msg }, { status: 404 })
const badFields = (fields: Record<string, string>, status = 400) => {
  const firstKey = Object.keys(fields)[0]
  return NextResponse.json({ success: false, error: fields[firstKey], fields }, { status })
}

// The only two values components/farm/people.tsx's toggle / CSV import ever
// send (grepped — no third value used anywhere in this codebase).
const VALID_EMPLOYEE_STATUSES = new Set(['ACTIVE', 'INACTIVE'])

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

// GET /api/employees/[id]
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const auth = await requireTenantSession({ explicitTenantId: new URL(req.url).searchParams.get('tenantId') })
  if ('error' in auth) return auth.error
  const { tenantId } = auth

  const rows = await db
    .select()
    .from(employees)
    .where(and(eq(employees.id, id), eq(employees.tenantId, tenantId)))
  if (rows.length === 0) return notFound()
  return ok(rows[0])
}

// PATCH /api/employees/[id] — partial update. Every field is optional; only
// fields present in the body are changed. Supported fields: name, phone,
// role, status, mortalityPhotoThreshold, userId, assignedBatchIds (full
// replace, same "PATCH with a new array replaces the assignment" shape the
// UI's "Batches" step in the Add Employee modal implies — there is no
// separate add/remove-one-batch endpoint).
//
// Deactivating an employee is never a hard delete (records.employee_id is a
// real FK into employees.id — deleting would orphan production history);
// `status` toggling to INACTIVE is the whole mechanism, same "archive, don't
// destroy" shape as farms. The route itself doesn't block a deactivation
// over assigned batches / open work — that judgement call belongs to the
// admin, not a hard server-side gate — but the audit trail records exactly
// what changed, and the UI surfaces the employee's current assignments in
// the confirmation step before the call is made.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return badRequest('Invalid JSON body')
  }
  const b = (raw ?? {}) as Record<string, unknown>

  const auth = await requireTenantSession({
    roles: ['super_admin', 'owner', 'manager'],
    explicitTenantId: typeof b.tenantId === 'string' ? b.tenantId : undefined,
  })
  if ('error' in auth) return auth.error
  const { session, tenantId } = auth

  const existingRows = await db
    .select()
    .from(employees)
    .where(and(eq(employees.id, id), eq(employees.tenantId, tenantId)))
    .limit(1)
  const existing = existingRows[0]
  if (!existing) return notFound()

  const fields: Record<string, string> = {}
  const patch: Partial<typeof employees.$inferInsert> = {}
  if (typeof b.name === 'string' && b.name.trim()) patch.name = b.name.trim()
  if (typeof b.phone === 'string') patch.phone = b.phone.trim()
  if (typeof b.role === 'string' && b.role.trim()) patch.role = b.role.trim()
  if ('status' in b) {
    const status = typeof b.status === 'string' ? b.status.trim() : ''
    if (!VALID_EMPLOYEE_STATUSES.has(status)) {
      fields.status = `status must be one of: ${[...VALID_EMPLOYEE_STATUSES].join(', ')}`
    } else {
      patch.status = status
    }
  }
  if (typeof b.userId === 'string') patch.userId = b.userId.trim() || null
  if (b.mortalityPhotoThreshold !== undefined && Number.isFinite(Number(b.mortalityPhotoThreshold))) {
    patch.mortalityPhotoThreshold = Math.max(0, Math.trunc(Number(b.mortalityPhotoThreshold)))
  }
  // monthlySalaryCents (payroll v1): rides on this same owner/manager-gated
  // route rather than a separate payroll-module-gated one. Deliberate:
  // MODULES.payroll (lib/permissions.ts) governs running/viewing payroll —
  // the point where real money leaves the ledger — not employee-record
  // management in general, which this whole route already treats as an
  // owner/manager concern via the `roles` allowlist above (there is no
  // "people" module in the matrix; employee CRUD has never been
  // matrix-gated). A manager editing a pay rate here still cannot trigger a
  // run or see anyone else's payslips — those stay behind canEdit/canView(payroll).
  if (b.monthlySalaryCents !== undefined && Number.isFinite(Number(b.monthlySalaryCents))) {
    patch.monthlySalaryCents = Math.max(0, Math.trunc(Number(b.monthlySalaryCents)))
  }

  if (Array.isArray(b.assignedBatchIds)) {
    const requested = b.assignedBatchIds.filter((v): v is string => typeof v === 'string')
    const validated = await validateBatchIds(tenantId, requested)
    if (validated === null) return notFound('One or more assignedBatchIds do not belong to this tenant')
    patch.assignedBatchIds = validated
  }

  if (Object.keys(fields).length > 0) return badFields(fields)
  if (Object.keys(patch).length === 0) return badRequest('No updatable fields provided')

  const changes: Record<string, { old: unknown; new: unknown }> = {}
  for (const key of Object.keys(patch)) {
    const oldValue = (existing as Record<string, unknown>)[key]
    const newValue = (patch as Record<string, unknown>)[key]
    if (JSON.stringify(oldValue) !== JSON.stringify(newValue)) changes[key] = { old: oldValue, new: newValue }
  }
  if (Object.keys(changes).length === 0) return ok(existing)

  const rows = await db
    .update(employees)
    .set(patch)
    .where(and(eq(employees.id, id), eq(employees.tenantId, tenantId)))
    .returning()

  if (rows.length === 0) return notFound()

  await writeAuditLog({
    tenantId,
    actor: session.id,
    action: 'status' in changes ? 'employee.status_changed' : 'employee.updated',
    entity: 'employee',
    entityId: id,
    meta: { changes },
  })

  return ok(rows[0])
}
