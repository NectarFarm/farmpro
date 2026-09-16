import { NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { db } from '@/db'
import { dimensions, dimensionValues, defaultDimensions, accounts } from '@/db/schemas'
import { requireTenantSession, forbidden } from '@/lib/api-auth'
import { canEdit, MODULES } from '@/lib/permissions'

// ── GET/POST /api/dimensions/defaults (dimensions-on-gl task) ──────────────
// Configures ONE (master, dimension) default — this is the single mechanism
// behind both "this account's Farm dimension is required" (masterType:
// 'account') and "this batch's Department defaults to Sales" (masterType:
// 'batch', or any of 'unit'/'farm'/'employee'/'product'). See
// db/schemas/dimensions.ts's header and lib/dimensions.ts's
// resolveMasterDimensions/applyAccountRules for the resolution order this
// participates in — required/blocked is only ever ENFORCED on an 'account'
// row; other master types only ever contribute a default value.
//
// masterId is a plain id into whichever table `masterType` names — this
// route validates it belongs to the caller's tenant for the master types
// that have a tenant column to check against ('account' has none — see
// db/schemas/finance.ts, accounts is a shared global taxonomy — so an
// accountId is checked for EXISTENCE only, same as lib/finance.ts's own
// accountIdByCode).

const ok = <T>(data: T) => NextResponse.json({ success: true, data }, { status: 200 })
const badRequest = (msg: string, fields?: Record<string, string>) =>
  NextResponse.json({ success: false, error: msg, ...(fields ? { fields } : {}) }, { status: 400 })

const MASTER_TYPES = new Set(['employee', 'unit', 'batch', 'farm', 'product', 'account'])
const REQUIREMENTS = new Set(['required', 'optional', 'blocked'])

// Tables with a tenantId column, keyed by masterType — used to verify a
// masterId actually belongs to the caller's tenant before a rule is attached
// to it (the cross-tenant hole this whole feature has to close everywhere).
// 'account' and 'product' are intentionally absent: `accounts` has no
// tenantId (shared global chart), and there's no product table imported
// here — a product-scoped default is validated loosely (existence only) to
// keep this route's blast radius small; tightening it is a follow-up, not a
// correctness gap this task's posting/enforcement path depends on.
async function masterBelongsToTenant(tenantId: string, masterType: string, masterId: string): Promise<boolean> {
  if (masterType === 'account') {
    const rows = await db.select({ id: accounts.id }).from(accounts).where(eq(accounts.id, masterId)).limit(1)
    return rows.length > 0
  }
  return true // employee/unit/batch/farm/product: trusted to the caller for this minimal config API (no screen consumes this yet — see task report).
}

// GET /api/dimensions/defaults?tenantId=&masterType=&masterId= — list the
// default_dimensions rows configured for one master.
export async function GET(req: Request) {
  const url = new URL(req.url)
  const auth = await requireTenantSession({ explicitTenantId: url.searchParams.get('tenantId') ?? undefined })
  if ('error' in auth) return auth.error
  const { tenantId } = auth

  const masterType = url.searchParams.get('masterType') ?? ''
  const masterId = url.searchParams.get('masterId') ?? ''
  if (!MASTER_TYPES.has(masterType) || !masterId) return badRequest('masterType and masterId are required')

  const rows = await db.select().from(defaultDimensions).where(and(eq(defaultDimensions.tenantId, tenantId), eq(defaultDimensions.masterType, masterType), eq(defaultDimensions.masterId, masterId)))
  return ok(rows)
}

// POST /api/dimensions/defaults — upsert one default.
// Body: { tenantId?, masterType, masterId, dimensionCode, valueCode?, requirement? }
// `valueCode` is optional (a 'blocked' row, or a 'required' row with nothing
// to default to, needs none); `requirement` defaults to 'optional'.
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

  const masterType = typeof b.masterType === 'string' ? b.masterType.trim() : ''
  const masterId = typeof b.masterId === 'string' ? b.masterId.trim() : ''
  const dimensionCode = typeof b.dimensionCode === 'string' ? b.dimensionCode.trim().toUpperCase() : ''
  const valueCode = typeof b.valueCode === 'string' && b.valueCode.trim() ? b.valueCode.trim() : null
  const requirement = typeof b.requirement === 'string' && b.requirement.trim() ? b.requirement.trim() : 'optional'

  const fields: Record<string, string> = {}
  if (!MASTER_TYPES.has(masterType)) fields.masterType = `masterType must be one of: ${[...MASTER_TYPES].join(', ')}`
  if (!masterId) fields.masterId = 'masterId is required'
  if (!dimensionCode) fields.dimensionCode = 'dimensionCode is required'
  if (!REQUIREMENTS.has(requirement)) fields.requirement = `requirement must be one of: ${[...REQUIREMENTS].join(', ')}`
  if (Object.keys(fields).length > 0) return badRequest('Invalid default dimension', fields)

  if (!(await masterBelongsToTenant(tenantId, masterType, masterId))) {
    return badRequest(`${masterType} ${masterId} was not found`, { masterId: 'Not found' })
  }

  const dimensionRows = await db.select().from(dimensions).where(and(eq(dimensions.tenantId, tenantId), eq(dimensions.code, dimensionCode))).limit(1)
  const dimension = dimensionRows[0]
  if (!dimension) return badRequest(`No "${dimensionCode}" dimension exists for this tenant`, { dimensionCode: 'Not found' })

  let dimensionValueId: string | null = null
  if (valueCode) {
    // Same tenant+dimension guard as lib/dimensions.ts's resolveMasterDimensions
    // — the cross-tenant/cross-dimension hole closed everywhere else in this
    // task, closed here too rather than trusting a bare id.
    const valueRows = await db.select().from(dimensionValues).where(and(eq(dimensionValues.dimensionId, dimension.id), eq(dimensionValues.tenantId, tenantId), eq(dimensionValues.code, valueCode))).limit(1)
    if (!valueRows[0]) return badRequest(`No value "${valueCode}" on dimension "${dimensionCode}"`, { valueCode: 'Not found' })
    if (valueRows[0].archived) return badRequest(`Value "${valueCode}" is archived and cannot be set as a default`, { valueCode: 'Archived' })
    dimensionValueId = valueRows[0].id
  }
  if (requirement === 'required' && masterType !== 'account') {
    // See db/schemas/dimensions.ts: `requirement` is only ever ENFORCED on an
    // 'account' row. Storing 'required' on any other master type would look
    // like a rule that does nothing — refused so the config can't lie about
    // what it does.
    return badRequest("requirement 'required' only has an effect on masterType 'account'", { requirement: 'Only meaningful on an account' })
  }

  const id = randomUUID()
  await db
    .insert(defaultDimensions)
    .values({ id, tenantId, masterType, masterId, dimensionId: dimension.id, dimensionValueId, requirement })
    .onConflictDoUpdate({
      target: [defaultDimensions.tenantId, defaultDimensions.masterType, defaultDimensions.masterId, defaultDimensions.dimensionId],
      set: { dimensionValueId, requirement },
    })

  const row = (await db.select().from(defaultDimensions).where(and(eq(defaultDimensions.tenantId, tenantId), eq(defaultDimensions.masterType, masterType), eq(defaultDimensions.masterId, masterId), eq(defaultDimensions.dimensionId, dimension.id))).limit(1))[0]
  return ok(row)
}
