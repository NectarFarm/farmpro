// ── Analytical dimensions: core logic (dimensions-on-gl task) ──────────────
// Everything that seeds/projects/resolves/validates a tenant's dimension
// layer lives here — same convention as lib/finance.ts / lib/inventory.ts:
// one shared implementation the routes and the posting functions both call,
// instead of drifting per call site.
//
// ── The two things this module refuses to conflate ──────────────────────────
// 1. PROJECTION (project*() below): an operational master (farm/unit/batch)
//    keeps a same-named, same-coded shadow row in `dimension_values` so it
//    can be posted against and reported by, without becoming one. See
//    db/schemas/dimensions.ts's header for the full "why not convert them"
//    rationale — that decision is not repeated here.
// 2. RESOLUTION (resolveMasterDimensions / applyAccountRules below): given a
//    posting's source master (e.g. "this sale is against batch X"), walk the
//    REAL operational hierarchy (batch -> unit -> farm; employee -> farm) and
//    each master's own `default_dimensions` rows to build the full set of
//    dimension values that posting should carry, then let the target
//    account's own rules fill in anything still missing and enforce
//    required/blocked. Resolution order, most specific wins (owner
//    instruction, 2026-09-16): explicit value on the call > the source
//    master's own defaults > its ancestors' defaults, walked in order > the
//    account's own row (last resort, and the only place `requirement` is
//    actually enforced).
import 'server-only'
import { randomUUID } from 'node:crypto'
import { and, eq, inArray } from 'drizzle-orm'
import type { PgTransaction } from 'drizzle-orm/pg-core'
import { db } from '@/db'
import {
  dimensions, dimensionLevels, dimensionValues, defaultDimensions, documentDimensions,
  journalLineDimensions, accounts, farms, productionUnits, batches, employees, journalEntries, journalLines,
} from '@/db/schemas'

type Tx = PgTransaction<any, any, any>
type DbOrTx = Tx | typeof db

export type MasterType = 'employee' | 'unit' | 'batch' | 'farm' | 'product' | 'account'
export type Requirement = 'required' | 'optional' | 'blocked'
export type MasterRef = { masterType: MasterType; masterId: string }

// Shared body-parsing guard for the optional `dimensions` field every
// posting route accepts (POST /api/data/sales, /api/purchases,
// /api/payroll/runs) — `{ "DEPT": "SALES" }`, dimension code -> value code,
// both plain strings. Anything else (not an object, a non-string value) is
// treated as "not supplied" by the caller rather than thrown here — the
// route itself decides whether a malformed shape is worth a 400, and the
// real validation (does the dimension/value exist, belong to this tenant,
// isn't archived) happens in resolveMasterDimensions regardless.
export function isPlainDimensionMap(input: unknown): input is Record<string, string> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return false
  return Object.values(input as Record<string, unknown>).every((v) => typeof v === 'string')
}

// Thrown when an explicit dimension/value reference doesn't resolve, doesn't
// belong to the caller's tenant, doesn't belong to the dimension it's
// claimed for, or points at an archived value — the cross-tenant hole and
// the "archived values can't be posted to" rule both surface as this.
export class DimensionValidationError extends Error {}

// Thrown when a posting would leave an account's REQUIRED dimension with no
// value — the posting is refused (the caller's transaction rolls back)
// rather than writing an unanalysed line, per the owner's brief.
export class DimensionRequirementError extends Error {}

// Thrown by lib/reports.ts's computeDimensionPlReport when the requested
// dimension code doesn't exist for this tenant (a typo, or a tenant that
// never created it) — routes turn this into a 404, not a 500.
export class DimensionNotFoundError extends Error {}

// ── System dimensions (owner instruction, 2026-09-16: UNIT first) ──────────
export const SYSTEM_DIMENSION_CODES = { UNIT: 'UNIT', FARM: 'FARM', BATCH: 'BATCH', ENTERPRISE: 'ENTERPRISE' } as const

const SYSTEM_DIMENSIONS: { code: string; name: string; sortOrder: number }[] = [
  { code: SYSTEM_DIMENSION_CODES.UNIT, name: 'Production Unit', sortOrder: 1 },
  { code: SYSTEM_DIMENSION_CODES.FARM, name: 'Farm', sortOrder: 2 },
  { code: SYSTEM_DIMENSION_CODES.BATCH, name: 'Batch', sortOrder: 3 },
  { code: SYSTEM_DIMENSION_CODES.ENTERPRISE, name: 'Enterprise', sortOrder: 4 },
]

// Idempotent: safe to call on every request that needs the tenant's system
// dimensions to exist, same convention as lib/finance.ts's
// ensureAccountsSeeded. Returns code -> dimensions.id.
export async function ensureSystemDimensions(tenantId: string, dbOrTx: DbOrTx = db): Promise<Map<string, string>> {
  await dbOrTx
    .insert(dimensions)
    .values(SYSTEM_DIMENSIONS.map((d) => ({
      id: randomUUID(), tenantId, code: d.code, name: d.name, levelCount: 1, isSystem: true, sortOrder: d.sortOrder,
      // Register fields (dimensions-operable task): a system dimension's
      // short name is just its code (already short and self-describing),
      // and it carries no budget policy — the register still needs to show
      // something other than a blank column for these four.
      shortName: d.code, separator: '-', budgetCheck: false, budgetControl: false,
    })))
    .onConflictDoNothing({ target: [dimensions.tenantId, dimensions.code] })

  const rows = await dbOrTx
    .select()
    .from(dimensions)
    .where(and(eq(dimensions.tenantId, tenantId), inArray(dimensions.code, SYSTEM_DIMENSIONS.map((d) => d.code))))
  const idByCode = new Map(rows.map((r) => [r.code, r.id]))

  // Every system dimension is single-level today (a farm, a unit, a batch
  // aren't sub-divided) — one dimension_levels row each, ordinal 1, named
  // after the dimension itself so a config screen has something to show.
  const levelRows = SYSTEM_DIMENSIONS
    .filter((d) => idByCode.has(d.code))
    .map((d) => ({ id: randomUUID(), dimensionId: idByCode.get(d.code)!, ordinal: 1, name: d.name }))
  if (levelRows.length > 0) {
    await dbOrTx.insert(dimensionLevels).values(levelRows).onConflictDoNothing({ target: [dimensionLevels.dimensionId, dimensionLevels.ordinal] })
  }
  return idByCode
}

async function dimensionsByCode(dbOrTx: DbOrTx, tenantId: string): Promise<Map<string, typeof dimensions.$inferSelect>> {
  const rows = await dbOrTx.select().from(dimensions).where(eq(dimensions.tenantId, tenantId))
  return new Map(rows.map((r) => [r.code, r]))
}

async function dimensionsById(dbOrTx: DbOrTx, tenantId: string): Promise<Map<string, typeof dimensions.$inferSelect>> {
  const rows = await dbOrTx.select().from(dimensions).where(eq(dimensions.tenantId, tenantId))
  return new Map(rows.map((r) => [r.id, r]))
}

async function findValueByCode(dbOrTx: DbOrTx, dimensionId: string, tenantId: string, code: string) {
  const rows = await dbOrTx
    .select()
    .from(dimensionValues)
    .where(and(eq(dimensionValues.dimensionId, dimensionId), eq(dimensionValues.tenantId, tenantId), eq(dimensionValues.code, code)))
    .limit(1)
  return rows[0]
}

async function defaultDimensionRowsFor(dbOrTx: DbOrTx, tenantId: string, masterType: MasterType, masterId: string) {
  return dbOrTx
    .select()
    .from(defaultDimensions)
    .where(and(eq(defaultDimensions.tenantId, tenantId), eq(defaultDimensions.masterType, masterType), eq(defaultDimensions.masterId, masterId)))
}

// ── Cross-tenant / cross-dimension guard ────────────────────────────────────
// The obvious hole a dimensions feature opens: nothing stops a caller naming
// another tenant's dimensionValueId, or a value that belongs to a DIFFERENT
// dimension than the one it's claimed for (posting a Batch value where a
// Farm value was asked for). Both are closed by the same query: the row must
// exist with exactly this tenantId AND exactly this dimensionId.
export async function validateDimensionValue(
  tenantId: string, dimensionId: string, valueId: string, dbOrTx: DbOrTx = db,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const rows = await dbOrTx
    .select()
    .from(dimensionValues)
    .where(and(eq(dimensionValues.id, valueId), eq(dimensionValues.dimensionId, dimensionId), eq(dimensionValues.tenantId, tenantId)))
    .limit(1)
  const row = rows[0]
  if (!row) return { ok: false, error: 'Dimension value does not belong to this tenant and dimension' }
  if (row.archived) return { ok: false, error: 'Dimension value is archived and can no longer be posted to' }
  return { ok: true }
}

// ── Projection: keep a system dimension's values in step with the real table
async function upsertDimensionValue(dbOrTx: DbOrTx, input: {
  dimensionId: string; tenantId: string; code: string; name: string; levelOrdinal: number
  parentValueId: string | null; sourceType: string | null; sourceId: string | null
}) {
  const rows = await dbOrTx
    .insert(dimensionValues)
    .values({ id: randomUUID(), archived: false, ...input })
    .onConflictDoUpdate({
      target: [dimensionValues.dimensionId, dimensionValues.code],
      // Re-projecting un-archives: a farm/unit/batch that comes back (e.g.
      // restored from archive, or simply saved again) must be postable again
      // — see db/schemas/dimensions.ts's header on why `archived` exists at
      // all (only a genuine delete sets it, and only archive*() below does).
      set: { name: input.name, levelOrdinal: input.levelOrdinal, parentValueId: input.parentValueId, sourceType: input.sourceType, sourceId: input.sourceId, archived: false },
    })
    .returning()
  return rows[0]
}

async function upsertDefaultDimension(dbOrTx: DbOrTx, input: {
  tenantId: string; masterType: MasterType; masterId: string; dimensionId: string
  dimensionValueId: string | null; requirement: Requirement
}) {
  await dbOrTx
    .insert(defaultDimensions)
    .values({ id: randomUUID(), ...input })
    .onConflictDoUpdate({
      target: [defaultDimensions.tenantId, defaultDimensions.masterType, defaultDimensions.masterId, defaultDimensions.dimensionId],
      set: { dimensionValueId: input.dimensionValueId, requirement: input.requirement },
    })
}

// Write-through on create/rename: call this wherever a farm is inserted or
// its name/code changes (app/api/farms/route.ts, app/api/farms/[id]/route.ts
// PATCH). Also the unit of work `reconcileSystemDimensions` below repeats
// for every farm in a tenant, so a tenant that predates this feature (or
// whose projection drifted) can be brought back into step on demand.
export async function projectFarm(dbOrTx: DbOrTx, tenantId: string, farm: { id: string; code: string; name: string }) {
  const idByCode = await ensureSystemDimensions(tenantId, dbOrTx)
  const dimensionId = idByCode.get(SYSTEM_DIMENSION_CODES.FARM)!
  const value = await upsertDimensionValue(dbOrTx, {
    dimensionId, tenantId, code: farm.code, name: farm.name, levelOrdinal: 1, parentValueId: null, sourceType: 'farm', sourceId: farm.id,
  })
  await upsertDefaultDimension(dbOrTx, { tenantId, masterType: 'farm', masterId: farm.id, dimensionId, dimensionValueId: value.id, requirement: 'optional' })
  return value
}

export async function projectUnit(dbOrTx: DbOrTx, tenantId: string, unit: { id: string; code: string; name: string }) {
  const idByCode = await ensureSystemDimensions(tenantId, dbOrTx)
  const dimensionId = idByCode.get(SYSTEM_DIMENSION_CODES.UNIT)!
  const value = await upsertDimensionValue(dbOrTx, {
    dimensionId, tenantId, code: unit.code, name: unit.name, levelOrdinal: 1, parentValueId: null, sourceType: 'unit', sourceId: unit.id,
  })
  await upsertDefaultDimension(dbOrTx, { tenantId, masterType: 'unit', masterId: unit.id, dimensionId, dimensionValueId: value.id, requirement: 'optional' })
  return value
}

function titleCase(key: string): string {
  return key.split('_').filter(Boolean).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ') || key
}

export async function projectBatch(dbOrTx: DbOrTx, tenantId: string, batch: { id: string; code: string; name: string; enterprise: string }) {
  const idByCode = await ensureSystemDimensions(tenantId, dbOrTx)
  const batchDimId = idByCode.get(SYSTEM_DIMENSION_CODES.BATCH)!
  const enterpriseDimId = idByCode.get(SYSTEM_DIMENSION_CODES.ENTERPRISE)!

  const batchValue = await upsertDimensionValue(dbOrTx, {
    dimensionId: batchDimId, tenantId, code: batch.code, name: batch.name, levelOrdinal: 1, parentValueId: null, sourceType: 'batch', sourceId: batch.id,
  })
  await upsertDefaultDimension(dbOrTx, { tenantId, masterType: 'batch', masterId: batch.id, dimensionId: batchDimId, dimensionValueId: batchValue.id, requirement: 'optional' })

  // ENTERPRISE is keyed on the enterprise subtype itself ("broiler", "maize")
  // — one dimension value per subtype, shared across every batch of that
  // subtype (unlike FARM/UNIT/BATCH, which are 1:1 with an operational row).
  // No `sourceId` pointing at a single batch would make sense here, so this
  // value carries `sourceType: null` even though it IS system-managed —
  // "system" here means lib/dimensions.ts owns writing it, not that it
  // shadows exactly one operational row.
  const enterpriseValue = await upsertDimensionValue(dbOrTx, {
    dimensionId: enterpriseDimId, tenantId, code: batch.enterprise, name: titleCase(batch.enterprise), levelOrdinal: 1, parentValueId: null, sourceType: null, sourceId: null,
  })
  await upsertDefaultDimension(dbOrTx, { tenantId, masterType: 'batch', masterId: batch.id, dimensionId: enterpriseDimId, dimensionValueId: enterpriseValue.id, requirement: 'optional' })

  return { batchValue, enterpriseValue }
}

// A real delete (never an archive/status change — see this file's header and
// app/api/farms/[id]/route.ts's DELETE) marks the projected value archived.
// Never called for a farm/unit going ARCHIVED via PATCH status, since that
// entity can still be restored and posted against.
export async function archiveProjectedDimensionValue(dbOrTx: DbOrTx, sourceType: 'farm' | 'unit' | 'batch', sourceId: string) {
  await dbOrTx.update(dimensionValues).set({ archived: true }).where(and(eq(dimensionValues.sourceType, sourceType), eq(dimensionValues.sourceId, sourceId)))
}

// Full reconcile for one tenant — what the migration backfill calls once per
// existing tenant, and what a repair script/admin action can call on demand
// if projection ever drifts (a manual DB edit, a bug fixed after the fact).
// Idempotent throughout (every project*() call upserts), so calling it twice
// is a no-op the second time.
export async function reconcileSystemDimensions(tenantId: string, dbOrTx: DbOrTx = db) {
  await ensureSystemDimensions(tenantId, dbOrTx)
  const farmRows = await dbOrTx.select().from(farms).where(eq(farms.tenantId, tenantId))
  for (const f of farmRows) await projectFarm(dbOrTx, tenantId, f)
  const unitRows = await dbOrTx.select().from(productionUnits).where(eq(productionUnits.tenantId, tenantId))
  for (const u of unitRows) await projectUnit(dbOrTx, tenantId, u)
  const batchRows = await dbOrTx.select().from(batches).where(eq(batches.tenantId, tenantId))
  for (const b of batchRows) await projectBatch(dbOrTx, tenantId, b)
}

// ── Editing / archiving a user-defined dimension (dimensions-operable task) ─
// A system dimension (UNIT/FARM/BATCH/ENTERPRISE) is never editable or
// archivable through this path — its name/levels are load-bearing for the
// app's own farm-scoping story, and its values are kept in step with the
// real farm/unit/batch tables, not hand-edited. Callers (the PATCH route)
// must check `isSystem` and refuse before calling this; these two functions
// re-check anyway so a future call site can't skip the guard by accident.
export class SystemDimensionEditError extends Error {}

export async function updateDimension(
  dbOrTx: DbOrTx, tenantId: string, id: string,
  patch: { name?: string; shortName?: string; separator?: string; budgetCheck?: boolean; budgetControl?: boolean },
): Promise<typeof dimensions.$inferSelect> {
  const rows = await dbOrTx.select().from(dimensions).where(and(eq(dimensions.id, id), eq(dimensions.tenantId, tenantId))).limit(1)
  const row = rows[0]
  if (!row) throw new DimensionNotFoundError(`No dimension ${id} for this tenant`)
  if (row.isSystem) throw new SystemDimensionEditError(`${row.name} is a system dimension and cannot be edited`)
  const updated = await dbOrTx.update(dimensions).set(patch).where(eq(dimensions.id, id)).returning()
  return updated[0]
}

export async function archiveDimension(dbOrTx: DbOrTx, tenantId: string, id: string, archived: boolean): Promise<typeof dimensions.$inferSelect> {
  const rows = await dbOrTx.select().from(dimensions).where(and(eq(dimensions.id, id), eq(dimensions.tenantId, tenantId))).limit(1)
  const row = rows[0]
  if (!row) throw new DimensionNotFoundError(`No dimension ${id} for this tenant`)
  if (row.isSystem) throw new SystemDimensionEditError(`${row.name} is a system dimension and cannot be archived`)
  const updated = await dbOrTx.update(dimensions).set({ archived }).where(eq(dimensions.id, id)).returning()
  return updated[0]
}

// A projected value (sourceType 'farm' | 'unit' | 'batch', or the
// system-managed ENTERPRISE value with sourceType null under an isSystem
// dimension) mirrors a real operational row or is otherwise system-written —
// see db/schemas/dimensions.ts's header on why a second place to rename one
// is how a ledger and a farm stop agreeing. Only a value with no source at
// all, under a user-defined (non-system) dimension, is hand-editable.
export async function updateDimensionValue(
  dbOrTx: DbOrTx, tenantId: string, dimensionId: string, valueId: string, patch: { name?: string },
): Promise<typeof dimensionValues.$inferSelect> {
  const rows = await dbOrTx
    .select({ value: dimensionValues, dimension: dimensions })
    .from(dimensionValues)
    .innerJoin(dimensions, eq(dimensionValues.dimensionId, dimensions.id))
    .where(and(eq(dimensionValues.id, valueId), eq(dimensionValues.dimensionId, dimensionId), eq(dimensionValues.tenantId, tenantId)))
    .limit(1)
  const row = rows[0]
  if (!row) throw new DimensionNotFoundError(`No value ${valueId} on this dimension for this tenant`)
  if (row.dimension.isSystem || row.value.sourceType) {
    throw new SystemDimensionEditError('This value follows a real farm/unit/batch and cannot be renamed here')
  }
  const updated = await dbOrTx.update(dimensionValues).set(patch).where(eq(dimensionValues.id, valueId)).returning()
  return updated[0]
}

export async function archiveDimensionValue(
  dbOrTx: DbOrTx, tenantId: string, dimensionId: string, valueId: string, archived: boolean,
): Promise<typeof dimensionValues.$inferSelect> {
  const rows = await dbOrTx
    .select({ value: dimensionValues, dimension: dimensions })
    .from(dimensionValues)
    .innerJoin(dimensions, eq(dimensionValues.dimensionId, dimensions.id))
    .where(and(eq(dimensionValues.id, valueId), eq(dimensionValues.dimensionId, dimensionId), eq(dimensionValues.tenantId, tenantId)))
    .limit(1)
  const row = rows[0]
  if (!row) throw new DimensionNotFoundError(`No value ${valueId} on this dimension for this tenant`)
  if (row.dimension.isSystem || row.value.sourceType) {
    throw new SystemDimensionEditError('This value follows a real farm/unit/batch — archive the farm/unit/batch itself instead')
  }
  const updated = await dbOrTx.update(dimensionValues).set({ archived }).where(eq(dimensionValues.id, valueId)).returning()
  return updated[0]
}

// ── Reporting support (lib/reports.ts's computeDimensionPlReport) ──────────
export async function dimensionByCode(tenantId: string, code: string, dbOrTx: DbOrTx = db) {
  const rows = await dbOrTx.select().from(dimensions).where(and(eq(dimensions.tenantId, tenantId), eq(dimensions.code, code))).limit(1)
  return rows[0]
}

export async function dimensionValuesFor(tenantId: string, dimensionId: string, dbOrTx: DbOrTx = db) {
  return dbOrTx.select().from(dimensionValues).where(and(eq(dimensionValues.dimensionId, dimensionId), eq(dimensionValues.tenantId, tenantId)))
}

// Rolls a value up to its ancestor at `targetLevel` by walking
// `parentValueId` (a WITHIN-dimension level link — see
// db/schemas/dimensions.ts). A value shallower than the target level (its
// own levelOrdinal < targetLevel) can't be split any further down, so it
// rolls up to itself. Bounded walk (a dimension has at most a handful of
// levels; 10 is generous headroom against a corrupt/cyclic parent chain).
export function ancestorAtLevel(
  valuesById: Map<string, typeof dimensionValues.$inferSelect>, valueId: string, targetLevel: number,
): string {
  let current = valuesById.get(valueId)
  if (!current) return valueId
  let steps = 0
  while (current.levelOrdinal > targetLevel && current.parentValueId && steps < 10) {
    const parent = valuesById.get(current.parentValueId)
    if (!parent) break
    current = parent
    steps++
  }
  return current.id
}

// ── Resolution: source master -> real operational ancestors ────────────────
// Walks the REAL foreign-key chain (never `dimension_values.parentValueId`,
// which is a within-dimension level link — see db/schemas/dimensions.ts).
// batch -> unit -> farm; employee -> farm (employees have no unit of their
// own — db/schemas/people.ts's `employees` carries `farmId` only). farm /
// product / account are terminal. Bounded to a handful of hops; there is no
// cycle in this schema for these master types.
async function masterChain(dbOrTx: DbOrTx, tenantId: string, sourceMaster: MasterRef | null): Promise<MasterRef[]> {
  if (!sourceMaster) return []
  const chain: MasterRef[] = [sourceMaster]
  let current: MasterRef | null = sourceMaster
  for (let hop = 0; hop < 4 && current; hop++) {
    if (current.masterType === 'batch') {
      const rows = await dbOrTx.select({ unitId: batches.unitId }).from(batches).where(and(eq(batches.id, current.masterId), eq(batches.tenantId, tenantId))).limit(1)
      current = rows[0] ? { masterType: 'unit', masterId: rows[0].unitId } : null
    } else if (current.masterType === 'unit') {
      const rows = await dbOrTx.select({ farmId: productionUnits.farmId }).from(productionUnits).where(and(eq(productionUnits.id, current.masterId), eq(productionUnits.tenantId, tenantId))).limit(1)
      current = rows[0] ? { masterType: 'farm', masterId: rows[0].farmId } : null
    } else if (current.masterType === 'employee') {
      const rows = await dbOrTx.select({ farmId: employees.farmId }).from(employees).where(and(eq(employees.id, current.masterId), eq(employees.tenantId, tenantId))).limit(1)
      current = rows[0]?.farmId ? { masterType: 'farm', masterId: rows[0].farmId } : null
    } else {
      current = null // farm / product / account: terminal
    }
    if (current) chain.push(current)
  }
  return chain
}

// Resolves the dimension set a DOCUMENT carries — no account involved yet.
// `explicit` is a caller-supplied override, keyed by dimension CODE (what an
// accountant types), e.g. `{ DEPT: 'SALES' }` — highest priority, and
// validated (tenant/dimension/archived) via the same rules
// validateDimensionValue enforces.
export async function resolveMasterDimensions(
  dbOrTx: DbOrTx, tenantId: string, sourceMaster: MasterRef | null, explicit: Record<string, string> = {},
): Promise<Map<string, string>> {
  const dims = await dimensionsByCode(dbOrTx, tenantId)
  const resolved = new Map<string, string>() // dimensionId -> valueId

  for (const [code, valueCode] of Object.entries(explicit)) {
    const dim = dims.get(code)
    if (!dim) throw new DimensionValidationError(`Unknown dimension code "${code}"`)
    if (dim.archived) throw new DimensionValidationError(`Dimension "${code}" is archived and cannot be posted to`)
    const value = await findValueByCode(dbOrTx, dim.id, tenantId, valueCode)
    if (!value) throw new DimensionValidationError(`Unknown value "${valueCode}" for dimension "${code}"`)
    if (value.archived) throw new DimensionValidationError(`Dimension value "${valueCode}" for "${code}" is archived and cannot be posted to`)
    resolved.set(dim.id, value.id)
  }

  // Keyed by id too (dims above is keyed by code) so the master-chain loop
  // below can skip an ARCHIVED dimension (dimensions-operable task item 4) —
  // once a user-defined dimension is archived it should stop being applied
  // to new postings, same as an archived VALUE already refuses at the
  // explicit-map check above; already-posted journal_line_dimensions rows
  // keep pointing at it regardless (see db/schemas/dimensions.ts's header).
  const dimsById = new Map([...dims.values()].map((d) => [d.id, d]))

  const chain = await masterChain(dbOrTx, tenantId, sourceMaster)
  for (const master of chain) {
    const rows = await defaultDimensionRowsFor(dbOrTx, tenantId, master.masterType, master.masterId)
    for (const row of rows) {
      if (resolved.has(row.dimensionId)) continue // a more specific master (or explicit) already won
      if (dimsById.get(row.dimensionId)?.archived) continue
      if (row.dimensionValueId) resolved.set(row.dimensionId, row.dimensionValueId)
    }
  }
  return resolved
}

export type RequiredMissing = { dimensionId: string; dimensionCode: string; dimensionName: string }

// Applies ONE account's own default_dimensions rows on top of a document's
// already-resolved base set — the only place `requirement` is enforced (see
// db/schemas/dimensions.ts's comment on why). Two different lines of the
// SAME document (e.g. a purchase's Expense debit and its Cash credit) can
// legitimately end up with different final dimension sets if their accounts
// have different rules — that's why this is applied per LINE, not once per
// document.
export async function applyAccountRules(
  dbOrTx: DbOrTx, tenantId: string, accountId: string, base: Map<string, string>,
): Promise<{ resolved: Map<string, string>; requiredMissing: RequiredMissing[] }> {
  const resolved = new Map(base)
  const accountRows = await defaultDimensionRowsFor(dbOrTx, tenantId, 'account', accountId)
  const dims = await dimensionsById(dbOrTx, tenantId)
  const requiredMissing: RequiredMissing[] = []

  for (const row of accountRows) {
    // An archived dimension's account rule is inert — see
    // resolveMasterDimensions' matching guard above for why.
    if (dims.get(row.dimensionId)?.archived) continue
    if (row.requirement === 'blocked') {
      // An account explicitly not analysed by this dimension — drop it even
      // if a more specific master supplied one (e.g. Owner's Equity has no
      // meaningful Farm dimension regardless of what a document derived).
      resolved.delete(row.dimensionId)
      continue
    }
    if (!resolved.has(row.dimensionId) && row.dimensionValueId) resolved.set(row.dimensionId, row.dimensionValueId)
    if (row.requirement === 'required' && !resolved.has(row.dimensionId)) {
      const dim = dims.get(row.dimensionId)
      requiredMissing.push({ dimensionId: row.dimensionId, dimensionCode: dim?.code ?? row.dimensionId, dimensionName: dim?.name ?? row.dimensionId })
    }
  }
  return { resolved, requiredMissing }
}

// Writes one journal line's final, per-account-ruled dimension set. Throws
// DimensionRequirementError (naming the account and every missing
// dimension) rather than posting an unanalysed line — the caller's
// transaction (lib/finance.ts's post*Journal, itself inside the domain
// write's own transaction) rolls back whole, so a sale/purchase/payroll run
// can never exist half-posted.
export async function attachLineDimensions(
  dbOrTx: DbOrTx, input: { tenantId: string; lineId: string; accountId: string; base: Map<string, string> },
): Promise<void> {
  const { resolved, requiredMissing } = await applyAccountRules(dbOrTx, input.tenantId, input.accountId, input.base)
  if (requiredMissing.length > 0) {
    const accountRows = await dbOrTx.select().from(accounts).where(eq(accounts.id, input.accountId)).limit(1)
    const accountLabel = accountRows[0] ? `${accountRows[0].code} ${accountRows[0].name}` : input.accountId
    const dimList = requiredMissing.map((m) => m.dimensionName).join(', ')
    throw new DimensionRequirementError(`Posting to ${accountLabel} requires a value for: ${dimList}`)
  }
  if (resolved.size === 0) return
  await dbOrTx.insert(journalLineDimensions).values(
    [...resolved].map(([dimensionId, valueId]) => ({ id: randomUUID(), lineId: input.lineId, dimensionId, valueId })),
  )
}

// Writes the DOCUMENT-level dimension set (owner instruction: "all data"
// linked to dimensions, not only the ledger line) — the base resolved set,
// with no account/enforcement involved, so a document is analysable on its
// own even before its journal lines apply their own accounts' rules on top.
export async function attachDocumentDimensions(
  dbOrTx: DbOrTx, input: { tenantId: string; docType: 'sale' | 'purchase' | 'payroll_run'; docId: string; base: Map<string, string> },
): Promise<void> {
  if (input.base.size === 0) return
  await dbOrTx.insert(documentDimensions).values(
    [...input.base].map(([dimensionId, valueId]) => ({ id: randomUUID(), tenantId: input.tenantId, docType: input.docType, docId: input.docId, dimensionId, valueId })),
  )
}

// ── Preview, before a form submits (dimensions-operable task) ──────────────
// A sale/purchase/payroll form should show the dimensions a posting will
// carry — most already derivable through the real batch -> unit -> farm
// chain — and ask for anything a target account marks `required` that
// nothing in that chain supplied, BEFORE the user submits and hits
// DimensionRequirementError blind. This reuses the exact same
// resolveMasterDimensions/applyAccountRules the real posting path runs
// (lib/finance.ts's captureDimensions) — a preview that used different logic
// could show "all good" and then have the real post refuse anyway.
export type ResolvedDimensionView = { dimensionId: string; dimensionCode: string; dimensionName: string; valueId: string; valueCode: string; valueName: string }

async function describeResolved(dbOrTx: DbOrTx, tenantId: string, resolved: Map<string, string>): Promise<ResolvedDimensionView[]> {
  if (resolved.size === 0) return []
  const dims = await dimensionsById(dbOrTx, tenantId)
  const valueRows = await dbOrTx.select().from(dimensionValues).where(inArray(dimensionValues.id, [...resolved.values()]))
  const valuesById = new Map(valueRows.map((v) => [v.id, v]))
  const out: ResolvedDimensionView[] = []
  for (const [dimensionId, valueId] of resolved) {
    const dim = dims.get(dimensionId)
    const value = valuesById.get(valueId)
    if (!dim || !value) continue
    out.push({ dimensionId, dimensionCode: dim.code, dimensionName: dim.name, valueId, valueCode: value.code, valueName: value.name })
  }
  return out
}

export type AccountDimensionPreview = {
  accountId: string; accountCode: string; accountName: string
  resolved: ResolvedDimensionView[]
  requiredMissing: RequiredMissing[]
}

// `accountsToCheck` is deliberately passed in by the caller (the route),
// which already knows which account(s) a sale/purchase/payroll_run posts to
// (lib/finance.ts's ACCOUNT_CODES) — this module stays agnostic of which
// document type maps to which account so it doesn't have to be kept in sync
// with lib/finance.ts's posting rules from two directions.
export async function previewDocumentDimensions(
  dbOrTx: DbOrTx, tenantId: string, sourceMaster: MasterRef | null, explicit: Record<string, string>,
  accountsToCheck: { id: string; code: string; name: string }[],
): Promise<{ base: ResolvedDimensionView[]; perAccount: AccountDimensionPreview[] }> {
  const base = await resolveMasterDimensions(dbOrTx, tenantId, sourceMaster, explicit)
  const baseView = await describeResolved(dbOrTx, tenantId, base)
  const perAccount: AccountDimensionPreview[] = []
  for (const account of accountsToCheck) {
    const { resolved, requiredMissing } = await applyAccountRules(dbOrTx, tenantId, account.id, base)
    const resolvedView = await describeResolved(dbOrTx, tenantId, resolved)
    perAccount.push({ accountId: account.id, accountCode: account.code, accountName: account.name, resolved: resolvedView, requiredMissing })
  }
  return { base: baseView, perAccount }
}

// ── Reading dimensions back (dimensions-operable task) ──────────────────────
// `journal_line_dimensions`/`document_dimensions` have been populated since
// the original dimensions-on-gl task — nothing has read them back until now.
// This is what a sale/purchase detail view or a journal-entry view calls to
// show how a posting was actually analysed. `docType`/`docId` name the
// SOURCE document (a sale, a purchase, a payroll run) — its journal entry is
// found via `journal_entries.sourceType`/`sourceId`, same lookup
// lib/finance.ts's posting functions use in reverse.
export type JournalLineDimensionView = {
  lineId: string; accountId: string; accountCode: string; accountName: string
  debitCents: number; creditCents: number; dimensions: ResolvedDimensionView[]
}
export type DocumentDimensionsView = {
  document: ResolvedDimensionView[]
  entry: { id: string; memo: string; entryDate: Date; lines: JournalLineDimensionView[] } | null
}

export async function getDocumentDimensions(
  dbOrTx: DbOrTx, tenantId: string, docType: 'sale' | 'purchase' | 'payroll_run', docId: string,
): Promise<DocumentDimensionsView> {
  const docRows = await dbOrTx
    .select({ dimensionId: documentDimensions.dimensionId, valueId: documentDimensions.valueId })
    .from(documentDimensions)
    .where(and(eq(documentDimensions.tenantId, tenantId), eq(documentDimensions.docType, docType), eq(documentDimensions.docId, docId)))
  const document = await describeResolved(dbOrTx, tenantId, new Map(docRows.map((r) => [r.dimensionId, r.valueId])))

  const entryRows = await dbOrTx
    .select()
    .from(journalEntries)
    .where(and(eq(journalEntries.tenantId, tenantId), eq(journalEntries.sourceType, docType), eq(journalEntries.sourceId, docId)))
    .limit(1)
  const entry = entryRows[0]
  if (!entry) return { document, entry: null }

  const lineRows = await dbOrTx
    .select({ line: journalLines, account: accounts })
    .from(journalLines)
    .innerJoin(accounts, eq(journalLines.accountId, accounts.id))
    .where(eq(journalLines.entryId, entry.id))
  const lineIds = lineRows.map((r) => r.line.id)
  const lineDimRows = lineIds.length > 0
    ? await dbOrTx.select().from(journalLineDimensions).where(inArray(journalLineDimensions.lineId, lineIds))
    : []
  const dims = await dimensionsById(dbOrTx, tenantId)
  const valueRows = lineDimRows.length > 0
    ? await dbOrTx.select().from(dimensionValues).where(inArray(dimensionValues.id, lineDimRows.map((r) => r.valueId)))
    : []
  const valuesById = new Map(valueRows.map((v) => [v.id, v]))

  const lines: JournalLineDimensionView[] = lineRows.map(({ line, account }) => ({
    lineId: line.id, accountId: account.id, accountCode: account.code, accountName: account.name,
    debitCents: line.debitCents, creditCents: line.creditCents,
    dimensions: lineDimRows
      .filter((d) => d.lineId === line.id)
      .map((d) => {
        const dim = dims.get(d.dimensionId)
        const value = valuesById.get(d.valueId)
        return dim && value
          ? { dimensionId: d.dimensionId, dimensionCode: dim.code, dimensionName: dim.name, valueId: d.valueId, valueCode: value.code, valueName: value.name }
          : null
      })
      .filter((v): v is ResolvedDimensionView => v !== null),
  }))

  return { document, entry: { id: entry.id, memo: entry.memo, entryDate: entry.entryDate, lines } }
}
