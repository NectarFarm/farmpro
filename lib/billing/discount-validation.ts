// ── Shared discount field validation (SaaS back-office backend) ────────────
import type { DiscountKind, PlanPeriod } from '@/db/schemas'

const PERIODS: readonly PlanPeriod[] = ['monthly', 'quarterly', 'annual']

export interface DiscountFieldsInput {
  code: string
  kind: DiscountKind
  value: number
  appliesToPlans: string[] | null
  appliesToPeriods: PlanPeriod[] | null
  tenantId: string | null
  validFrom: Date | null
  validUntil: Date | null
  maxRedemptions: number | null
  isActive: boolean
  note: string
}

export type DiscountValidationResult =
  | { ok: true; value: Partial<DiscountFieldsInput> }
  | { ok: false; fields: Record<string, string> }

function parseDateOrNull(v: unknown, field: string, fields: Record<string, string>): Date | null | undefined {
  if (v === null || v === undefined) return null
  if (typeof v !== 'string') { fields[field] = `${field} must be an ISO date string or null`; return undefined }
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) { fields[field] = `${field} must be a valid date`; return undefined }
  return d
}

export function validateDiscountFields(body: Record<string, unknown>, opts: { requireCode?: boolean } = {}): DiscountValidationResult {
  const fields: Record<string, string> = {}
  const value: Partial<DiscountFieldsInput> = {}

  const hasCode = 'code' in body
  if (opts.requireCode || hasCode) {
    const code = typeof body.code === 'string' ? body.code.trim().toUpperCase() : ''
    if (!code || code.length > 40) fields.code = 'code is required (max 40 chars)'
    else value.code = code
  }

  const hasKind = 'kind' in body
  if (opts.requireCode || hasKind) {
    const kind = typeof body.kind === 'string' ? body.kind.trim() : ''
    if (kind !== 'percent' && kind !== 'fixed') fields.kind = "kind must be 'percent' or 'fixed'"
    else value.kind = kind
  }

  const hasValue = 'value' in body
  if (opts.requireCode || hasValue) {
    const v = Number(body.value)
    const kind = (value.kind ?? (body.kind as string)) as string
    if (!Number.isFinite(v) || v < 0 || !Number.isInteger(v)) {
      fields.value = 'value must be a non-negative integer'
    } else if (kind === 'percent' && v > 100) {
      fields.value = 'a percent discount value cannot exceed 100'
    } else {
      value.value = v
    }
  }

  if ('appliesToPlans' in body) {
    if (body.appliesToPlans === null) value.appliesToPlans = null
    else if (Array.isArray(body.appliesToPlans) && body.appliesToPlans.every((p) => typeof p === 'string')) {
      value.appliesToPlans = body.appliesToPlans as string[]
    } else {
      fields.appliesToPlans = 'appliesToPlans must be an array of plan ids, or null for all plans'
    }
  }

  if ('appliesToPeriods' in body) {
    if (body.appliesToPeriods === null) value.appliesToPeriods = null
    else if (Array.isArray(body.appliesToPeriods) && body.appliesToPeriods.every((p) => PERIODS.includes(p as PlanPeriod))) {
      value.appliesToPeriods = body.appliesToPeriods as PlanPeriod[]
    } else {
      fields.appliesToPeriods = `appliesToPeriods must be an array drawn from ${PERIODS.join(', ')}, or null for all periods`
    }
  }

  if ('tenantId' in body) {
    if (body.tenantId === null) value.tenantId = null
    else if (typeof body.tenantId === 'string' && body.tenantId.trim()) value.tenantId = body.tenantId.trim()
    else fields.tenantId = 'tenantId must be a string, or null for any tenant'
  }

  if ('validFrom' in body) {
    const d = parseDateOrNull(body.validFrom, 'validFrom', fields)
    if (d !== undefined) value.validFrom = d
  }
  if ('validUntil' in body) {
    const d = parseDateOrNull(body.validUntil, 'validUntil', fields)
    if (d !== undefined) value.validUntil = d
  }

  if ('maxRedemptions' in body) {
    if (body.maxRedemptions === null) value.maxRedemptions = null
    else {
      const n = Number(body.maxRedemptions)
      if (!Number.isFinite(n) || n < 1 || !Number.isInteger(n)) fields.maxRedemptions = 'maxRedemptions must be a positive integer, or null for unlimited'
      else value.maxRedemptions = n
    }
  }

  if ('isActive' in body) {
    if (typeof body.isActive !== 'boolean') fields.isActive = 'isActive must be a boolean'
    else value.isActive = body.isActive
  }

  if ('note' in body) {
    value.note = typeof body.note === 'string' ? body.note.trim().slice(0, 500) : ''
  }

  if (Object.keys(fields).length > 0) return { ok: false, fields }
  return { ok: true, value }
}
