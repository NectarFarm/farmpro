// ── Shared farm-scoping logic (farm-scoped-data task) ───────────────────────
// Until this task, the farm switcher (NavContext.activeFarm) changed a label
// and nothing else — no route read a farmId, so switching farms never
// filtered any data. This module is the one place that resolves/validates a
// caller-supplied farmId and turns it into the id sets the two REAL farm
// links in the schema can join through:
//   - production_units.farm_id (direct FK into farms.id)
//   - batches.unit_id -> production_units (one hop)
// Everything else that's farm-scopable either has its own new farm_id column
// (tasks/inventory_lots/purchases/employees — see db/schemas/*.ts and
// migration 0019) or joins through batches (records/sales via batchId).
//
// Every route that accepts a `farmId` query/body param MUST resolve it
// through `resolveFarmFilter` — see that function's contract below. This is
// what implements the "unknown/foreign farmId must 400/404, never silently
// fall back to unfiltered" requirement in exactly one place instead of once
// per route.
import 'server-only'
import { and, eq } from 'drizzle-orm'
import { db } from '@/db'
import { farms, productionUnits, batches } from '@/db/schemas'

// The sentinel NavContext already uses for "no farm filter" (the aggregate
// / all-farms view). Absent param means the same thing — both are treated
// identically so an old client that never sends `farmId` keeps working.
export const ALL_FARMS = 'ALL'

export type FarmFilter = string | undefined | null
// - undefined → no filter requested (param absent, blank, or 'ALL'). Callers
//   skip adding any farm condition — identical behaviour to before this task.
// - a real farm id → validated to belong to `tenantId`. Callers filter on it.
// - null → the param was present and non-'ALL', but did NOT resolve to a farm
//   in this tenant (unknown id, or it belongs to a different tenant). Callers
//   MUST treat this as a hard failure (400/404) — this is the one signal
//   that distinguishes "deliberately unscoped" from "the caller passed
//   garbage/another tenant's id", which must never be treated the same way.

// Resolves and validates a `farmId` request param. See FarmFilter above for
// the three-way return contract.
export async function resolveFarmFilter(tenantId: string, farmIdParam: string | null | undefined): Promise<FarmFilter> {
  const raw = farmIdParam?.trim()
  if (!raw || raw === ALL_FARMS) return undefined
  const rows = await db
    .select({ id: farms.id })
    .from(farms)
    .where(and(eq(farms.id, raw), eq(farms.tenantId, tenantId)))
    .limit(1)
  return rows.length > 0 ? raw : null
}

// Standard 404 body for a resolveFarmFilter === null result. Routes call
// this instead of inlining the message so the wording (and status) can't
// drift between endpoints.
export function farmNotFoundResponse(): { success: false; error: string } {
  return { success: false, error: 'Farm not found for this tenant' }
}

// production_units.id rows belonging to one farm — the single hop `batches`
// (and everything that joins through batches) filters on. Tenant is checked
// again here even though `farmId` is already tenant-validated by
// resolveFarmFilter — defensive, not load-bearing, and cheap.
export async function unitIdsForFarm(tenantId: string, farmId: string): Promise<string[]> {
  const rows = await db
    .select({ id: productionUnits.id })
    .from(productionUnits)
    .where(and(eq(productionUnits.farmId, farmId), eq(productionUnits.tenantId, tenantId)))
  return rows.map((r) => r.id)
}

// batches.id rows belonging to one farm (via unitId -> production_units).
// Used to join-filter `records`/`sales`/`approval_requests`, none of which
// carry a farm_id of their own. Returns [] (not an error) when the farm has
// no units yet, OR has units but no batches on them — callers must
// special-case an empty array rather than pass it to `inArray`, which
// Postgres/Drizzle can choke on for an empty list.
//
// One JOIN (scalability audit item B), not two sequential round-trips
// through unitIdsForFarm + a second query: this is called on most
// farm-scoped requests (reports, records, sales, approvals — see the
// call-site list in this module's header), so the extra round-trip cost was
// paid on nearly every farm-scoped request in the app. Both tenantId checks
// are kept (on production_units AND on batches) — defensive, not load-
// bearing, same as the two-query version before it; a batch's unitId always
// implies the same tenant in practice, but this makes that assumption
// verified rather than assumed.
export async function batchIdsForFarm(tenantId: string, farmId: string): Promise<string[]> {
  const rows = await db
    .select({ id: batches.id })
    .from(batches)
    .innerJoin(productionUnits, eq(batches.unitId, productionUnits.id))
    .where(and(
      eq(batches.tenantId, tenantId),
      eq(productionUnits.tenantId, tenantId),
      eq(productionUnits.farmId, farmId),
    ))
  return rows.map((r) => r.id)
}
