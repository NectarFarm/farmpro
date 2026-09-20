import { NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import { and, asc, eq, inArray } from 'drizzle-orm'
import { db } from '@/db'
import { dimensions, dimensionLevels } from '@/db/schemas'
import { requireTenantSession, forbidden } from '@/lib/api-auth'
import { canEdit, MODULES } from '@/lib/permissions'
import { ensureSystemDimensions } from '@/lib/dimensions'

// ── GET/POST /api/dimensions (dimensions-on-gl task) ────────────────────────
// The minimal config surface this task ships — see the task's final report
// for what was deliberately cut (a config SCREEN; this API is what a future
// one would call). GET always includes the tenant's system dimensions
// (UNIT/FARM/BATCH/ENTERPRISE — seeded on first call for a tenant that
// predates this feature and has no rows yet, same idempotent-seed
// convention as lib/finance.ts's ensureAccountsSeeded) alongside whatever
// user-defined ones the tenant has created.

const ok = <T>(data: T) => NextResponse.json({ success: true, data }, { status: 200 })
const created = <T>(data: T) => NextResponse.json({ success: true, data }, { status: 201 })
const badRequest = (msg: string, fields?: Record<string, string>) =>
  NextResponse.json({ success: false, error: msg, ...(fields ? { fields } : {}) }, { status: 400 })

function isUniqueViolation(err: unknown): boolean {
  return !!err && typeof err === 'object' && (err as { code?: string }).code === '23505'
}

// GET /api/dimensions?tenantId= — list a tenant's dimensions, system ones
// first (sortOrder), then user-defined ones in creation order.
export async function GET(req: Request) {
  const auth = await requireTenantSession({ explicitTenantId: new URL(req.url).searchParams.get('tenantId') ?? undefined })
  if ('error' in auth) return auth.error
  const { tenantId } = auth

  await ensureSystemDimensions(tenantId)
  const rows = await db.select().from(dimensions).where(eq(dimensions.tenantId, tenantId)).orderBy(asc(dimensions.sortOrder), asc(dimensions.createdAt))
  const levelRows = rows.length > 0
    ? await db.select().from(dimensionLevels).where(inArray(dimensionLevels.dimensionId, rows.map((d) => d.id))).orderBy(asc(dimensionLevels.ordinal))
    : []
  return ok(rows.map((d) => ({ ...d, levels: levelRows.filter((l) => l.dimensionId === d.id) })))
}

// POST /api/dimensions — create a user-defined dimension.
// Body: { tenantId?, code, name, levels: string[] } — `levels` names each
// ordinal from 1 upward (the owner's "two levels, e.g. Batch and Sub-batch,
// and one can type the name"); at least one level is required.
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
  const { session, tenantId } = auth

  if (!(await canEdit(tenantId, session.role, MODULES.finance))) {
    return forbidden('Your role does not have edit access to finance configuration')
  }

  const code = typeof b.code === 'string' ? b.code.trim().toUpperCase() : ''
  const name = typeof b.name === 'string' ? b.name.trim() : ''
  const levelNames = Array.isArray(b.levels) ? b.levels.filter((l): l is string => typeof l === 'string' && l.trim().length > 0).map((l) => l.trim()) : []
  // Register fields (dimensions-operable task) — all optional at creation,
  // same "sensible default rather than a blank column" convention as the
  // 0041 migration's backfill: shortName falls back to code.
  const shortName = typeof b.shortName === 'string' && b.shortName.trim() ? b.shortName.trim() : code
  const separator = typeof b.separator === 'string' && b.separator.trim() ? b.separator.trim() : '-'
  const budgetCheck = b.budgetCheck === true
  const budgetControl = b.budgetControl === true

  const fields: Record<string, string> = {}
  if (!code) fields.code = 'code is required'
  if (!name) fields.name = 'name is required'
  if (levelNames.length === 0) fields.levels = 'at least one level name is required'
  if (Object.keys(fields).length > 0) return badRequest('Invalid dimension', fields)

  const id = randomUUID()
  try {
    await db.transaction(async (tx) => {
      await tx.insert(dimensions).values({ id, tenantId, code, name, levelCount: levelNames.length, isSystem: false, sortOrder: 100, shortName, separator, budgetCheck, budgetControl })
      await tx.insert(dimensionLevels).values(levelNames.map((levelName, i) => ({ id: randomUUID(), dimensionId: id, ordinal: i + 1, name: levelName })))
    })
  } catch (err) {
    if (isUniqueViolation(err)) return badRequest('A dimension with this code already exists for this tenant', { code: 'Already exists' })
    throw err
  }

  const row = (await db.select().from(dimensions).where(and(eq(dimensions.id, id))).limit(1))[0]
  return created(row)
}
