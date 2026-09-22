// ── Shared plan field validation (SaaS back-office backend) ─────────────────
// Used by both POST /api/admin/plans and PATCH /api/admin/plans/[id] so
// create and update can't validate the same fields two slightly different
// ways — same reasoning as lib/admin-users.ts's shared SAFE_USER_COLUMNS.
import type { PlanLimits, PlanPeriod, PlanPrices } from '@/db/schemas'

const PERIODS: readonly PlanPeriod[] = ['monthly', 'quarterly', 'annual']

export interface PlanFieldsInput {
  code: string
  name: string
  tagline: string
  description: string
  features: string[]
  limits: PlanLimits
  prices: PlanPrices
  currency: string
  trialDays: number
  isPublic: boolean
  isActive: boolean
  sortOrder: number
}

export type PlanValidationResult =
  | { ok: true; value: Partial<PlanFieldsInput> }
  | { ok: false; fields: Record<string, string> }

function isNonNegNumberOrNull(v: unknown): v is number | null {
  return v === null || (typeof v === 'number' && Number.isFinite(v) && v >= 0)
}

/**
 * Validates whichever of PlanFieldsInput's keys are present in `body`.
 * `opts.requireCode` makes `code`/`name` mandatory (POST); PATCH omits it so
 * a partial update only touches the fields it names.
 */
export function validatePlanFields(body: Record<string, unknown>, opts: { requireCode?: boolean } = {}): PlanValidationResult {
  const fields: Record<string, string> = {}
  const value: Partial<PlanFieldsInput> = {}

  const hasCode = 'code' in body
  if (opts.requireCode || hasCode) {
    const code = typeof body.code === 'string' ? body.code.trim().toLowerCase() : ''
    if (!code || !/^[a-z0-9][a-z0-9-]{1,63}$/.test(code)) {
      fields.code = 'code must be lowercase letters, numbers and hyphens (2-64 chars)'
    } else {
      value.code = code
    }
  }

  const hasName = 'name' in body
  if (opts.requireCode || hasName) {
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    if (!name) fields.name = 'name is required'
    else value.name = name
  }

  if ('tagline' in body) {
    value.tagline = typeof body.tagline === 'string' ? body.tagline.trim().slice(0, 200) : ''
  }
  if ('description' in body) {
    value.description = typeof body.description === 'string' ? body.description.trim().slice(0, 2000) : ''
  }

  if ('features' in body) {
    if (!Array.isArray(body.features) || !body.features.every((f) => typeof f === 'string')) {
      fields.features = 'features must be an array of strings'
    } else {
      value.features = (body.features as string[]).map((f) => f.trim()).filter(Boolean)
    }
  }

  if ('limits' in body) {
    const l = (body.limits ?? {}) as Record<string, unknown>
    if (
      typeof l !== 'object' ||
      !('maxFarms' in l) || !('maxUsers' in l) || !('maxUnits' in l) ||
      !isNonNegNumberOrNull(l.maxFarms) || !isNonNegNumberOrNull(l.maxUsers) || !isNonNegNumberOrNull(l.maxUnits)
    ) {
      fields.limits = 'limits must be { maxFarms, maxUsers, maxUnits }, each a non-negative number or null (unlimited)'
    } else {
      value.limits = { maxFarms: l.maxFarms as number | null, maxUsers: l.maxUsers as number | null, maxUnits: l.maxUnits as number | null }
    }
  }

  if ('prices' in body) {
    const p = (body.prices ?? {}) as Record<string, unknown>
    if (typeof p !== 'object' || p === null) {
      fields.prices = 'prices must be an object keyed by period'
    } else {
      const prices: PlanPrices = {}
      let priceError = false
      for (const [key, v] of Object.entries(p)) {
        if (!PERIODS.includes(key as PlanPeriod)) { priceError = true; break }
        if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) { priceError = true; break }
        prices[key as PlanPeriod] = Math.round(v)
      }
      if (priceError) {
        fields.prices = `prices keys must be one of ${PERIODS.join(', ')}, each a non-negative integer (cents)`
      } else {
        value.prices = prices
      }
    }
  }

  if ('currency' in body) {
    const currency = typeof body.currency === 'string' ? body.currency.trim().toUpperCase() : ''
    if (!currency || currency.length > 8) fields.currency = 'currency is required (e.g. KSh, UGX)'
    else value.currency = currency
  }

  if ('trialDays' in body) {
    const trialDays = Number(body.trialDays)
    if (!Number.isFinite(trialDays) || trialDays < 0 || !Number.isInteger(trialDays)) {
      fields.trialDays = 'trialDays must be a non-negative integer'
    } else {
      value.trialDays = trialDays
    }
  }

  if ('isPublic' in body) {
    if (typeof body.isPublic !== 'boolean') fields.isPublic = 'isPublic must be a boolean'
    else value.isPublic = body.isPublic
  }
  if ('isActive' in body) {
    if (typeof body.isActive !== 'boolean') fields.isActive = 'isActive must be a boolean'
    else value.isActive = body.isActive
  }
  if ('sortOrder' in body) {
    const sortOrder = Number(body.sortOrder)
    if (!Number.isFinite(sortOrder) || !Number.isInteger(sortOrder)) fields.sortOrder = 'sortOrder must be an integer'
    else value.sortOrder = sortOrder
  }

  if (Object.keys(fields).length > 0) return { ok: false, fields }
  return { ok: true, value }
}
