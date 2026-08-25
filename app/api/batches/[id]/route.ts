import { NextResponse } from 'next/server'
import { db } from '@/db'
import { batches, productionUnits } from '@/db/schemas'
import { and, eq } from 'drizzle-orm'
import { requireTenantSession, forbidden } from '@/lib/api-auth'
import { canEdit, MODULES } from '@/lib/permissions'
import { applyMovement, BatchLedgerError } from '@/lib/batch-ledger'
import { checkStage } from '@/lib/stages'

// ── GET/PATCH /api/batches/[id] (issue #231; auth fix: fix/authenticate-all-apis) ─
// PATCH is the single update endpoint for a batch's mutable lifecycle fields
// — this is deliberately where "advance stage" lives instead of a dedicated
// `/api/batches/advance` endpoint (the issue explicitly leaves that choice to
// the implementer and asks it be documented: folding it into PATCH here,
// rather than a separate action route, since every field it touches — stage,
// currentQty, status, endDate, harvestDate — is a plain column update with no
// extra side effects yet). "Advance stage" from the UI's "Advance Stage"
// button (components/farm/crops.tsx) is just `PATCH { stage: "<next stage>" }`
// optionally alongside a `currentQty` change (e.g. after a mortality count).
//
// Tenant-scoped: an id only updates/reads when its tenantId matches the
// caller's session tenant — a super_admin session (tenantId === null) may
// name one explicitly via `?tenantId=`, checked here rather than trusted
// outright: a bad/foreign id still 404s, so this can't probe another
// tenant's batch ids. Same conventions as GET/PATCH /api/notifications/[id].

const ok = <T>(data: T) => NextResponse.json({ success: true, data }, { status: 200 })
const badRequest = (msg: string) => NextResponse.json({ success: false, error: msg }, { status: 400 })
const notFound = () => NextResponse.json({ success: false, error: 'Batch not found' }, { status: 404 })

// GET /api/batches/[id] — read a single batch back (used by BatchDetailScreen
// and by the create->read round trip in tests).
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const auth = await requireTenantSession({ explicitTenantId: new URL(req.url).searchParams.get('tenantId') })
  if ('error' in auth) return auth.error
  const { tenantId } = auth

  const rows = await db
    .select()
    .from(batches)
    .where(and(eq(batches.id, id), eq(batches.tenantId, tenantId)))
  if (rows.length === 0) return notFound()
  return ok(rows[0])
}

// PATCH /api/batches/[id] — partial update. Every field is optional; only
// fields present in the body are changed. Supported fields:
//   stage, status, currentQty, initialQty, acquisitionCostCents, name,
//   species, endDate, harvestDate, unitId
// "Advance stage" is just this endpoint with a new `stage` value (and
// typically a new `currentQty` alongside it, e.g. after a mortality count).
// "Unit Transfer" (issue #232 task 5) is just this endpoint with a new
// `unitId` — there is no separate transfer/lifecycle endpoint or a
// transfers/history table; the batch's unit assignment simply moves in place,
// same as POST /api/batches validates `unitId` against the caller's tenant
// before accepting it (400/404 instead of a bare FK-violation 500 for a
// bad/foreign unit id).
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const auth = await requireTenantSession({ explicitTenantId: new URL(req.url).searchParams.get('tenantId') })
  if ('error' in auth) return auth.error
  const { session, tenantId } = auth

  if (!(await canEdit(tenantId, session.role, MODULES.batches))) {
    return forbidden('Your role does not have edit access to batches')
  }

  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return badRequest('Invalid JSON body')
  }
  const b = (raw ?? {}) as Record<string, unknown>

  const patch: Partial<typeof batches.$inferInsert> = {}
  if (typeof b.status === 'string') patch.status = b.status.trim()
  if (typeof b.name === 'string' && b.name.trim()) patch.name = b.name.trim()
  if (typeof b.species === 'string') patch.species = b.species.trim()
  // currentQty is deliberately NOT patched here any more — see the ledger
  // block after the update. Overwriting it directly is what let the number
  // drift with no explanation attached.
  const requestedQty = b.currentQty !== undefined && Number.isFinite(Number(b.currentQty))
    ? Math.max(0, Math.trunc(Number(b.currentQty)))
    : null
  if (b.initialQty !== undefined && Number.isFinite(Number(b.initialQty))) {
    patch.initialQty = Math.max(0, Math.trunc(Number(b.initialQty)))
  }
  if (b.acquisitionCostCents !== undefined && Number.isFinite(Number(b.acquisitionCostCents))) {
    patch.acquisitionCostCents = Math.max(0, Math.trunc(Number(b.acquisitionCostCents)))
  }
  if (typeof b.endDate === 'string') patch.endDate = b.endDate ? new Date(b.endDate) : null
  if (typeof b.harvestDate === 'string') patch.harvestDate = b.harvestDate ? new Date(b.harvestDate) : null

  if (typeof b.unitId === 'string' && b.unitId.trim()) {
    const newUnitId = b.unitId.trim()
    const unitRows = await db
      .select()
      .from(productionUnits)
      .where(and(eq(productionUnits.id, newUnitId), eq(productionUnits.tenantId, tenantId)))
    if (!unitRows[0]) return notFound()
    patch.unitId = newUnitId
  }

  // ── `stage` is validated against the farm's own configured stages ────────
  // It used to be `if (typeof b.stage === 'string') patch.stage = b.stage.trim()`
  // — any string at all, straight from a free-text input. So "Finisher",
  // "finisher" and "Finishr" all became distinct stages on the same farm, and
  // anything that ever buckets by stage fragments silently. The dropdown on the
  // batch screen is the courtesy; this is the authority.
  //
  // Three outcomes, and the third is the one that matters:
  //   - a configured stage: stored using the FARM'S OWN SPELLING, not the
  //     caller's, so a stale client sending 'grower' cannot add a second
  //     spelling of a stage that already exists.
  //   - an unconfigured stage when the farm HAS a list: refused, naming the
  //     stages that do exist so the message is actionable.
  //   - an unconfigured stage when the farm has NO list for this enterprise:
  //     allowed through. Migration 0036 backfills from existing batches, but a
  //     brand-new tenant, or one starting a new enterprise, legitimately has no
  //     rows yet — refusing there would make the first batch of every new
  //     enterprise un-advanceable with no way out from inside the app. The
  //     Farm Configuration screen is how a farm graduates out of this state.
  //
  // Clearing the stage ('') stays allowed: every batch created before this
  // existed has an empty stage, and "not staged yet" is a real value.
  if (typeof b.stage === 'string') {
    const requested = b.stage.trim()
    if (requested === '') {
      patch.stage = ''
    } else {
      const [existing] = await db
        .select({ enterprise: batches.enterprise })
        .from(batches)
        .where(and(eq(batches.id, id), eq(batches.tenantId, tenantId)))
        .limit(1)
      if (!existing) return notFound()
      const check = await checkStage(tenantId, existing.enterprise, requested)
      if (check.ok) {
        patch.stage = check.name
      } else if (check.reason === 'none-configured') {
        patch.stage = requested
      } else {
        return badRequest(
          `"${requested}" is not one of this farm's stages for ${existing.enterprise}. `
          + `Configured stages: ${check.configured.join(', ')}. `
          + 'Add it in Settings › Farm Configuration first.'
        )
      }
    }
  }

  if (Object.keys(patch).length === 0 && requestedQty === null) {
    return badRequest('No updatable fields provided')
  }

  let rows: (typeof batches.$inferSelect)[] = []
  try {
    rows = await db.transaction(async (tx) => {
      let current = await tx
        .select()
        .from(batches)
        .where(and(eq(batches.id, id), eq(batches.tenantId, tenantId)))
        .limit(1)
      if (!current[0]) return []

      if (Object.keys(patch).length > 0) {
        current = await tx
          .update(batches)
          .set(patch)
          .where(and(eq(batches.id, id), eq(batches.tenantId, tenantId)))
          .returning()
      }

      // A hand-edited headcount goes through the ledger like everything else
      // (batch-ledger task). An owner correcting a number is a legitimate
      // thing to do — silently is not, because the next person to ask why the
      // count changed has nothing to read.
      if (requestedQty !== null && requestedQty !== current[0].currentQty) {
        const updated = await applyMovement(tx, {
          tenantId,
          batchId: id,
          type: 'manual_adjustment',
          qtyDelta: requestedQty - current[0].currentQty,
          reason: typeof b.reason === 'string' && b.reason.trim() ? b.reason.trim() : 'Edited by hand',
          sourceType: 'user',
          sourceId: session.id,
          actor: session.email,
        })
        return [updated]
      }

      return current
    })
  } catch (err) {
    if (err instanceof BatchLedgerError) {
      return NextResponse.json({ success: false, error: err.message }, { status: err.status })
    }
    throw err
  }

  if (rows.length === 0) return notFound()
  return ok(rows[0])
}
