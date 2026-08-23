import { NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import { asc, eq, inArray } from 'drizzle-orm'
import { db } from '@/db'
import { routines, routineSteps } from '@/db/schemas'
import { requireTenantSession, forbidden } from '@/lib/api-auth'
import { canEdit, MODULES } from '@/lib/permissions'
import { farmNotFoundResponse, resolveFarmFilter } from '@/lib/farm-scope'

// ── GET/POST /api/routines (worker-routines task) ───────────────────────────
// A routine is the owner's answer to "what is a morning round here". The
// worker portal had the tile and no definition behind it, because what a
// round consists of is a property of the farm, not of the software: one
// farm's morning round is feed, water check, egg collection and a mortality
// sweep; another's is milking and a temperature reading.
//
// GET is readable by anyone who can see the app — a worker has to be able to
// read the round they are being asked to do. Writing is gated on the batches
// module, which is the closest thing the matrix has to "how this farm is set
// up"; inventing a `routines` module the Governance screen cannot configure
// would put the permission somewhere nobody could find it.

export const STEP_KINDS = new Set(['feeding', 'mortality', 'physical_count', 'production', 'health', 'weight', 'check'])
export const TIMES_OF_DAY = new Set(['morning', 'midday', 'evening', 'weekly', 'any'])

const ok = <T>(data: T, status = 200) => NextResponse.json({ success: true, data }, { status })
const badRequest = (error: string) => NextResponse.json({ success: false, error }, { status: 400 })

export async function GET(req: Request) {
  const url = new URL(req.url)
  const auth = await requireTenantSession({ explicitTenantId: url.searchParams.get('tenantId') })
  if ('error' in auth) return auth.error
  const { tenantId } = auth

  const farmFilter = await resolveFarmFilter(tenantId, url.searchParams.get('farmId'))
  if (farmFilter === null) return NextResponse.json(farmNotFoundResponse(), { status: 404 })

  const rows = await db
    .select()
    .from(routines)
    .where(eq(routines.tenantId, tenantId))
    .orderBy(asc(routines.sortOrder), asc(routines.createdAt))

  // A tenant-wide routine (farmId null) applies everywhere, so a farm filter
  // narrows to that farm's own routines PLUS the shared ones — the same rule
  // GET /api/approvals uses for tenant-level approvals, and for the same
  // reason: filtering must not hide work that genuinely applies here.
  const visible = farmFilter ? rows.filter((r) => r.farmId === farmFilter || r.farmId === null) : rows

  if (visible.length === 0) return ok([])

  const steps = await db
    .select()
    .from(routineSteps)
    .where(inArray(routineSteps.routineId, visible.map((r) => r.id)))
    .orderBy(asc(routineSteps.sortOrder))

  const byRoutine = new Map<string, typeof steps>()
  for (const step of steps) {
    const list = byRoutine.get(step.routineId) ?? []
    list.push(step)
    byRoutine.set(step.routineId, list)
  }

  return ok(visible.map((r) => ({ ...r, steps: byRoutine.get(r.id) ?? [] })))
}

// POST /api/routines — create one, optionally with its steps in the same call
// so an owner adding "Morning round: feed, water, eggs" is one request rather
// than four.
export async function POST(req: Request) {
  let raw: unknown
  try { raw = await req.json() } catch { return badRequest('Invalid JSON body') }
  const b = (raw ?? {}) as Record<string, unknown>

  const auth = await requireTenantSession({ explicitTenantId: typeof b.tenantId === 'string' ? b.tenantId : undefined })
  if ('error' in auth) return auth.error
  const { session, tenantId } = auth
  if (!(await canEdit(tenantId, session.role, MODULES.batches))) {
    return forbidden('Your role cannot change how this farm records work')
  }

  const name = typeof b.name === 'string' ? b.name.trim() : ''
  if (!name) return badRequest('A routine needs a name')
  if (name.length > 80) return badRequest('Name must be 80 characters or fewer')

  const timeOfDay = typeof b.timeOfDay === 'string' && TIMES_OF_DAY.has(b.timeOfDay) ? b.timeOfDay : 'any'

  let farmId: string | null = null
  if (typeof b.farmId === 'string' && b.farmId.trim() && b.farmId !== 'ALL') {
    const resolved = await resolveFarmFilter(tenantId, b.farmId)
    if (!resolved) return NextResponse.json(farmNotFoundResponse(), { status: 404 })
    farmId = resolved
  }

  const steps = Array.isArray(b.steps) ? b.steps : []
  const parsed = parseSteps(steps)
  if (parsed === null) return badRequest(`Each step needs a label and a kind from: ${Array.from(STEP_KINDS).join(', ')}`)

  const id = randomUUID()
  const created = await db.transaction(async (tx) => {
    const [routine] = await tx.insert(routines).values({
      id, tenantId, farmId, name, timeOfDay,
      sortOrder: Number.isFinite(Number(b.sortOrder)) ? Math.trunc(Number(b.sortOrder)) : 0,
    }).returning()

    if (parsed.length > 0) {
      await tx.insert(routineSteps).values(parsed.map((step, i) => ({
        id: randomUUID(), tenantId, routineId: id, kind: step.kind, label: step.label,
        required: step.required, sortOrder: i,
      })))
    }
    return routine
  })

  return ok({ ...created, steps: parsed }, 201)
}

export function parseSteps(raw: unknown[]): { kind: string; label: string; required: boolean }[] | null {
  const out: { kind: string; label: string; required: boolean }[] = []
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') return null
    const step = entry as Record<string, unknown>
    const kind = typeof step.kind === 'string' ? step.kind.trim() : ''
    const label = typeof step.label === 'string' ? step.label.trim() : ''
    if (!STEP_KINDS.has(kind) || !label || label.length > 120) return null
    out.push({ kind, label, required: step.required !== false })
  }
  return out
}
