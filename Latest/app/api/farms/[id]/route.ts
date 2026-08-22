import { NextResponse } from 'next/server'
import { and, eq, inArray } from 'drizzle-orm'
import { db } from '@/db'
import { farms, productionUnits, batches } from '@/db/schemas'
import { getSessionUser } from '@/lib/auth'
import { isUniqueViolation } from '@/lib/db-errors'
import { writeAuditLog } from '@/lib/audit'
import { validateLocation } from '@/lib/validation'

// ── PATCH /api/farms/[id] (farms CRUD) ──────────────────────────────────────
// Completes farms CRUD: GET/POST /api/farms already existed with no
// edit/archive path. One route handles both plain field edits (name,
// location, code) and archive/restore (status), same shape as
// PATCH /api/onboard-requests/[id] treating status and non-status fields as
// independent, optional changes on the same body.
//
// Tenant scope is session-derived only — never a body/query tenantId taken
// on faith. owner/manager write within their own session tenant; a
// super_admin (session.tenantId === null) has no tenant of its own, so it
// must name one explicitly in the body, and that id is still used to filter
// the existence check below rather than trusted outright — a bad/foreign id
// gets a 404, never a cross-tenant write.
//
// Archive, never delete: production_units.farm_id is a real FK into
// farms.id, so a hard DELETE would fail once a unit exists, or orphan
// production history if the FK were ever dropped. `status` models this
// instead — ARCHIVED rows are hidden from the default GET /api/farms list
// and the switcher, but never removed, and can be restored.

const bad = (msg: string, status = 400) =>
  NextResponse.json({ success: false, error: msg }, { status })

const badFields = (fields: Record<string, string>, status = 400) => {
  const firstKey = Object.keys(fields)[0]
  return NextResponse.json({ success: false, error: fields[firstKey], fields }, { status })
}

const VALID_FARM_STATUSES = new Set(['ACTIVE', 'ARCHIVED'])

// Batch statuses that still count as "in use" for the archive-guard check —
// mirrors components/farm/data.ts's Batch.status union ('ACTIVE' |
// 'QUARANTINE' | 'CLOSED' | 'HARVESTED'): a CLOSED/HARVESTED batch is done
// and doesn't block archiving the farm underneath it the way a live one does.
const OPEN_BATCH_STATUSES = ['ACTIVE', 'QUARANTINE']

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = await getSessionUser()
  if (!session) return bad('Unauthorized', 401)

  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return bad('Invalid JSON body')
  }
  const b = (raw ?? {}) as Record<string, unknown>

  let tenantId: string
  if (session.role === 'super_admin') {
    tenantId = typeof b.tenantId === 'string' ? b.tenantId.trim() : ''
    if (!tenantId) return bad('tenantId is required for a platform admin')
  } else if (session.role === 'owner' || session.role === 'manager') {
    tenantId = session.tenantId ?? ''
    if (!tenantId) return bad('Forbidden', 403)
  } else {
    return bad('Forbidden', 403)
  }

  const existingRows = await db
    .select()
    .from(farms)
    .where(and(eq(farms.id, id), eq(farms.tenantId, tenantId)))
    .limit(1)
  const existing = existingRows[0]
  if (!existing) return bad('Farm not found', 404)

  const fields: Record<string, string> = {}
  const patch: Partial<typeof farms.$inferInsert> = {}

  // GPS pin (ui-polish-theme-weather): owner/manager set this from the
  // Weather screen's empty state, super_admin from the farm edit sheet.
  // Same all-or-nothing pair + range validation as onboard_requests' pin
  // (lib/validation.ts#validateLocation) — a lone coordinate is rejected
  // rather than silently stored as a half pin GET /api/weather can't use.
  const hasLocationInput = 'latitude' in b || 'longitude' in b
  if (hasLocationInput) {
    const loc = validateLocation({ latitude: b.latitude, longitude: b.longitude })
    Object.assign(fields, loc.fields)
    if (Object.keys(loc.fields).length === 0) {
      patch.latitude = loc.latitude
      patch.longitude = loc.longitude
    }
  }

  const hasFieldEdit = 'name' in b || 'location' in b || 'code' in b
  if (hasFieldEdit) {
    if ('name' in b) {
      const name = typeof b.name === 'string' ? b.name.trim() : ''
      if (name.length < 2 || name.length > 120) fields.name = 'name must be 2-120 characters'
      else patch.name = name
    }
    if ('location' in b) {
      const location = typeof b.location === 'string' ? b.location.trim() : ''
      if (location.length > 120) fields.location = 'location must be at most 120 characters'
      else patch.location = location
    }
    if ('code' in b) {
      // Trimmed only — no case-normalisation. POST /api/farms doesn't
      // uppercase a caller-supplied code either (only its own auto-generated
      // fallback is uppercased), so PATCH matches that instead of inventing
      // a stricter format.
      const code = typeof b.code === 'string' ? b.code.trim() : ''
      if (!code) fields.code = 'code is required'
      else patch.code = code
    }
  }

  if ('status' in b) {
    const status = typeof b.status === 'string' ? b.status.trim() : ''
    if (!VALID_FARM_STATUSES.has(status)) {
      fields.status = `status must be one of: ${[...VALID_FARM_STATUSES].join(', ')}`
    } else if (status !== existing.status && status === 'ARCHIVED') {
      // Don't silently archive over live production — name what's still
      // attached so an admin has to deal with it deliberately.
      const units = await db
        .select({ id: productionUnits.id, name: productionUnits.name })
        .from(productionUnits)
        .where(and(eq(productionUnits.farmId, id), eq(productionUnits.status, 'ACTIVE')))
      const unitIds = units.map((u) => u.id)
      const openBatches = unitIds.length
        ? await db
            .select({ id: batches.id, name: batches.name })
            .from(batches)
            .where(and(inArray(batches.unitId, unitIds), inArray(batches.status, OPEN_BATCH_STATUSES)))
        : []
      if (units.length > 0 || openBatches.length > 0) {
        const parts: string[] = []
        if (units.length > 0) {
          const names = units.map((u) => u.name).slice(0, 3).join(', ') + (units.length > 3 ? ', …' : '')
          parts.push(`${units.length} active production unit${units.length === 1 ? '' : 's'} (${names})`)
        }
        if (openBatches.length > 0) {
          const names = openBatches.map((batch) => batch.name).slice(0, 3).join(', ') + (openBatches.length > 3 ? ', …' : '')
          parts.push(`${openBatches.length} open batch${openBatches.length === 1 ? '' : 'es'} (${names})`)
        }
        fields.status = `Cannot archive — still has ${parts.join(' and ')}`
      } else {
        patch.status = status
      }
    } else if (status !== existing.status) {
      patch.status = status
    }
  }

  if (Object.keys(fields).length > 0) {
    const onlyArchiveBlock = Object.keys(fields).length === 1 && fields.status?.startsWith('Cannot archive')
    return badFields(fields, onlyArchiveBlock ? 409 : 400)
  }
  if (Object.keys(patch).length === 0) return bad('No updatable fields provided')

  const changes: Record<string, { old: unknown; new: unknown }> = {}
  for (const key of Object.keys(patch)) {
    const oldValue = (existing as Record<string, unknown>)[key]
    const newValue = (patch as Record<string, unknown>)[key]
    if (oldValue !== newValue) changes[key] = { old: oldValue, new: newValue }
  }
  if (Object.keys(changes).length === 0) {
    return NextResponse.json({ success: true, data: existing }, { status: 200 })
  }

  let updated
  try {
    const result = await db.update(farms).set(patch).where(and(eq(farms.id, id), eq(farms.tenantId, tenantId))).returning()
    updated = result[0]
  } catch (err) {
    if (isUniqueViolation(err)) {
      return badFields({ code: 'A farm with this code already exists for this tenant' }, 409)
    }
    return bad('Failed to update farm', 500)
  }

  const isArchiveTransition = 'status' in changes
  await writeAuditLog({
    tenantId,
    actor: session.id,
    action: isArchiveTransition ? (changes.status.new === 'ARCHIVED' ? 'farm.archived' : 'farm.restored') : 'farm.updated',
    entity: 'farm',
    entityId: id,
    meta: { changes },
  })

  return NextResponse.json({ success: true, data: updated }, { status: 200 })
}
