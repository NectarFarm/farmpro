// ── Reading and validating a farm's stage vocabulary ────────────────────────
// See db/schemas/stages.ts for why the table exists. This module is the single
// place that answers "is this a stage this farm actually has", so the batch
// route and the config route cannot disagree about it.
import 'server-only'
import { and, asc, eq } from 'drizzle-orm'
import { db } from '@/db'
import { batchStages, batches, tenantEnterprises } from '@/db/schemas'

export interface StageRow {
  id: string
  enterprise: string
  name: string
  sortOrder: number
  typicalDays: number | null
}

/**
 * Normalised the same way `lib/enterprises.ts#normalizeEnterprise` does, and
 * for the same reason: the key crosses a boundary (a typed grant, a query
 * param, a batch row) and 'Broiler' must not become a second enterprise
 * alongside 'broiler'.
 */
export function normalizeEnterprise(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim().toLowerCase() : ''
}

/** Stage names are compared case- and whitespace-insensitively. */
export function stageKey(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim().toLowerCase() : ''
}

export const MAX_STAGE_NAME_CHARS = 60
export const MAX_STAGES_PER_ENTERPRISE = 30
// A stage measured in years is a mistyped figure, not a growth phase.
export const MAX_TYPICAL_DAYS = 3650

/** One enterprise's stages, in progression order. */
export async function stagesForEnterprise(tenantId: string, enterprise: string): Promise<StageRow[]> {
  return db
    .select({
      id: batchStages.id,
      enterprise: batchStages.enterprise,
      name: batchStages.name,
      sortOrder: batchStages.sortOrder,
      typicalDays: batchStages.typicalDays,
    })
    .from(batchStages)
    .where(and(eq(batchStages.tenantId, tenantId), eq(batchStages.enterprise, normalizeEnterprise(enterprise))))
    .orderBy(asc(batchStages.sortOrder), asc(batchStages.name))
}

/** Every stage the tenant has configured, across all enterprises. */
export async function allStages(tenantId: string): Promise<StageRow[]> {
  return db
    .select({
      id: batchStages.id,
      enterprise: batchStages.enterprise,
      name: batchStages.name,
      sortOrder: batchStages.sortOrder,
      typicalDays: batchStages.typicalDays,
    })
    .from(batchStages)
    .where(eq(batchStages.tenantId, tenantId))
    .orderBy(asc(batchStages.enterprise), asc(batchStages.sortOrder), asc(batchStages.name))
}

export type StageCheck =
  | { ok: true; name: string }
  | { ok: false; reason: 'unconfigured'; configured: string[] }
  | { ok: false; reason: 'none-configured' }

/**
 * Is `candidate` a stage this tenant has configured for this enterprise?
 *
 * Returns the CONFIGURED spelling on success, so a batch saved from a stale
 * client ('grower') stores the farm's own casing ('Grower') rather than adding
 * a second spelling of a stage that already exists — which is the entire point
 * of having the table.
 *
 * ── Why `none-configured` is a distinct answer ─────────────────────────────
 * A farm that has configured nothing must not be locked out of advancing a
 * live batch: migration 0036 backfills from existing batches, but a brand-new
 * tenant, or a tenant starting a NEW enterprise, legitimately has no rows yet.
 * Refusing there would make the first batch of every new enterprise
 * un-advanceable with no way out from inside the app. The caller decides what
 * to do with that (PATCH /api/batches/[id] lets the value through and says so
 * in a comment); it is not this function's call to make.
 */
export async function checkStage(
  tenantId: string,
  enterprise: string,
  candidate: string
): Promise<StageCheck> {
  const configured = await stagesForEnterprise(tenantId, enterprise)
  if (configured.length === 0) return { ok: false, reason: 'none-configured' }
  const match = configured.find((s) => stageKey(s.name) === stageKey(candidate))
  if (match) return { ok: true, name: match.name }
  return { ok: false, reason: 'unconfigured', configured: configured.map((s) => s.name) }
}

/**
 * The stage that follows `current` in the configured order — what "Advance
 * Stage" defaults to. `null` when the batch is already at the last stage, or
 * when its current stage is not in the list (so the UI offers the first stage
 * rather than guessing a position that does not exist).
 */
export function nextStageAfter(stages: StageRow[], current: string): StageRow | null {
  if (stages.length === 0) return null
  const key = stageKey(current)
  const i = stages.findIndex((s) => stageKey(s.name) === key)
  if (i === -1) return stages[0]
  return stages[i + 1] ?? null
}

/**
 * Which enterprises this tenant's config screen should offer.
 *
 * Primary source is `tenant_enterprises` (migration 0035) — what the farm is
 * approved to farm. But lib/enterprises.ts documents the EMPTY-SET RULE: a
 * tenant with no rows there is UNRESTRICTED, not locked out. For those, fall
 * back to the enterprises their own batches demonstrably use, so the screen is
 * never empty for a working farm.
 */
export async function configurableEnterprises(tenantId: string): Promise<string[]> {
  const approved = await db
    .select({ enterprise: tenantEnterprises.enterprise })
    .from(tenantEnterprises)
    .where(eq(tenantEnterprises.tenantId, tenantId))
    .orderBy(asc(tenantEnterprises.enterprise))
  if (approved.length > 0) {
    return approved.map((r) => r.enterprise).filter(Boolean)
  }

  const used = await db
    .selectDistinct({ enterprise: batches.enterprise })
    .from(batches)
    .where(eq(batches.tenantId, tenantId))
  return used
    .map((r) => normalizeEnterprise(r.enterprise))
    .filter(Boolean)
    .sort()
}
