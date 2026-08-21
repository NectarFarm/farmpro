import { NextResponse } from 'next/server'
import { db } from '@/db'
import { employees, batches } from '@/db/schemas'
import { getSessionUser } from '@/lib/auth'
import { and, eq, inArray } from 'drizzle-orm'

// ── GET/PATCH /api/employees/[id] (issue #247) ──────────────────────────────
// Tenant-scoped: an id only reads/updates when its tenantId matches the
// caller's (session tenant, or the `tenantId` query param in standalone mock
// mode) — otherwise 404, same convention as GET/PATCH /api/batches/[id].
// `Note`: this file lives under app/api/employees/ alongside a literal `me`
// segment (app/api/employees/me/route.ts) — Next.js resolves a literal path
// segment before a dynamic one, so GET /api/employees/me is never captured
// by this `[id]` route.

const ok = <T>(data: T) => NextResponse.json({ success: true, data }, { status: 200 })
const badRequest = (msg: string) => NextResponse.json({ success: false, error: msg }, { status: 400 })
const notFound = (msg = 'Employee not found') => NextResponse.json({ success: false, error: msg }, { status: 404 })

function resolveTenantId(req: Request, sessionTenantId: string | null | undefined): string {
  return sessionTenantId ?? new URL(req.url).searchParams.get('tenantId')?.trim() ?? ''
}

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
  const session = await getSessionUser()
  const tenantId = resolveTenantId(req, session?.tenantId)
  if (!tenantId) return badRequest('tenantId is required')

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
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = await getSessionUser()
  const tenantId = resolveTenantId(req, session?.tenantId)
  if (!tenantId) return badRequest('tenantId is required')

  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return badRequest('Invalid JSON body')
  }
  const b = (raw ?? {}) as Record<string, unknown>

  const patch: Partial<typeof employees.$inferInsert> = {}
  if (typeof b.name === 'string' && b.name.trim()) patch.name = b.name.trim()
  if (typeof b.phone === 'string') patch.phone = b.phone.trim()
  if (typeof b.role === 'string' && b.role.trim()) patch.role = b.role.trim()
  if (typeof b.status === 'string' && b.status.trim()) patch.status = b.status.trim()
  if (typeof b.userId === 'string') patch.userId = b.userId.trim() || null
  if (b.mortalityPhotoThreshold !== undefined && Number.isFinite(Number(b.mortalityPhotoThreshold))) {
    patch.mortalityPhotoThreshold = Math.max(0, Math.trunc(Number(b.mortalityPhotoThreshold)))
  }

  if (Array.isArray(b.assignedBatchIds)) {
    const requested = b.assignedBatchIds.filter((v): v is string => typeof v === 'string')
    const validated = await validateBatchIds(tenantId, requested)
    if (validated === null) return notFound('One or more assignedBatchIds do not belong to this tenant')
    patch.assignedBatchIds = validated
  }

  if (Object.keys(patch).length === 0) return badRequest('No updatable fields provided')

  const rows = await db
    .update(employees)
    .set(patch)
    .where(and(eq(employees.id, id), eq(employees.tenantId, tenantId)))
    .returning()

  if (rows.length === 0) return notFound()
  return ok(rows[0])
}
