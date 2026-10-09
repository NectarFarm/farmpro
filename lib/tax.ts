// VAT arithmetic (issue #419). Integer cents, half-up. Not server-only: the
// record sheets preview with the same function the server posts with.
//
// Exclusive: tax = round(net * rateBps / 10000), gross = net + tax.
// Inclusive: tax = round(gross * rateBps / (10000 + rateBps)), net = gross - tax.
// Half-up is (numerator + floor(denominator / 2)) / denominator in integer
// arithmetic. A float Math.round is not used: the product of a large amount
// and a rate is not always a safe integer.

import { MAX_MONEY_CENTS } from '@/lib/validate-input'

export const TAX_CODE = {
  VATABLE: 'VATABLE',
  ZERO_RATED: 'ZERO_RATED',
  EXEMPT: 'EXEMPT',
  OUTSIDE_SCOPE: 'OUTSIDE_SCOPE',
} as const

export const NO_VAT_RATE_MESSAGE = 'No VAT rate is configured for this date.'
export const AMBIGUOUS_VAT_RATE_MESSAGE = 'More than one VAT rate is configured for this date.'

export type RateWindow = {
  taxCode: string
  rateBps: number
  effectiveFrom: string
  effectiveTo: string | null
}

export type TaxMath =
  | { ok: true; grossCents: number; taxCents: number; netCents: number; taxInclusive: boolean | null; rateBps: number | null }
  | { ok: false; message: string }

/** A YYYY-MM-DD prefix is kept as typed. Anything else is not a day. */
export function isoDay(value: string | Date | null | undefined): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) return trimmed.slice(0, 10)
    return null
  }
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10)
  return null
}

/** First candidate that is a calendar day, otherwise the fallback instant's UTC day. */
export function postingDayFrom(candidates: Array<string | Date | null | undefined>, fallback: Date): string {
  for (const candidate of candidates) {
    const day = isoDay(candidate)
    if (day) return day
  }
  return isoDay(fallback) ?? fallback.toISOString().slice(0, 10)
}

function halfUp(numerator: bigint, denominator: bigint): bigint {
  return (numerator + denominator / BigInt(2)) / denominator
}

/**
 * The rate in force on `day`. `effectiveTo` is inclusive. No row is null.
 * More than one covering row is ambiguous — the caller refuses rather than
 * picking one.
 */
export function pickRate(rates: RateWindow[], code: string, day: string): RateWindow | null | 'ambiguous' {
  const hits = rates.filter((rate) =>
    rate.taxCode === code
    && rate.effectiveFrom <= day
    && (rate.effectiveTo == null || rate.effectiveTo >= day),
  )
  if (hits.length === 0) return null
  if (hits.length > 1) return 'ambiguous'
  return hits[0]
}

export function rateWindowsOverlap(
  aFrom: string,
  aTo: string | null,
  bFrom: string,
  bTo: string | null,
): boolean {
  const aEnd = aTo ?? '9999-12-31'
  const bEnd = bTo ?? '9999-12-31'
  return aFrom <= bEnd && bFrom <= aEnd
}

export function computeTax(input: {
  code: string
  baseCents: number
  inclusive: boolean
  rateBps: number | null
}): TaxMath {
  if (!Number.isSafeInteger(input.baseCents) || input.baseCents < 0) {
    return { ok: false, message: 'Amount must be a non-negative integer number of cents.' }
  }
  if (input.baseCents > MAX_MONEY_CENTS) {
    return { ok: false, message: 'The amount with VAT is too large to record.' }
  }

  if (input.code !== TAX_CODE.VATABLE) {
    return {
      ok: true,
      grossCents: input.baseCents,
      taxCents: 0,
      netCents: input.baseCents,
      taxInclusive: null,
      rateBps: null,
    }
  }

  if (input.rateBps == null) return { ok: false, message: NO_VAT_RATE_MESSAGE }
  if (!Number.isSafeInteger(input.rateBps) || input.rateBps < 0 || input.rateBps > 10000) {
    return { ok: false, message: 'VAT rate is not a percentage between 0 and 100.' }
  }

  if (input.inclusive) {
    const tax = halfUp(BigInt(input.baseCents) * BigInt(input.rateBps), BigInt(10000 + input.rateBps))
    if (tax > BigInt(MAX_MONEY_CENTS)) return { ok: false, message: 'The amount with VAT is too large to record.' }
    const taxCents = Number(tax)
    const netCents = input.baseCents - taxCents
    return { ok: true, grossCents: input.baseCents, taxCents, netCents, taxInclusive: true, rateBps: input.rateBps }
  }

  const tax = halfUp(BigInt(input.baseCents) * BigInt(input.rateBps), BigInt(10000))
  if (tax > BigInt(MAX_MONEY_CENTS)) return { ok: false, message: 'The amount with VAT is too large to record.' }
  const taxCents = Number(tax)
  const grossCents = input.baseCents + taxCents
  if (grossCents > MAX_MONEY_CENTS) return { ok: false, message: 'The amount with VAT is too large to record.' }
  return { ok: true, grossCents, taxCents, netCents: input.baseCents, taxInclusive: false, rateBps: input.rateBps }
}

export type TaxPreview =
  | { status: 'none' }
  | { status: 'need-amount' }
  | { status: 'need-date'; message: string }
  | { status: 'refused'; message: string }
  | { status: 'ok'; grossCents: number; taxCents: number; netCents: number; taxInclusive: boolean | null; rateBps: number | null }

export const NEED_POSTING_DATE_MESSAGE = 'Enter the date this document posts on. The VAT rate depends on it.'

/** What the sheet shows before save. The server recomputes; this is not trusted. */
export function previewTax(input: {
  code: string
  baseCents: number | null
  inclusive: boolean
  rates: RateWindow[]
  day: string | null
}): TaxPreview {
  if (!input.code) return { status: 'none' }
  if (input.baseCents === null) return { status: 'need-amount' }
  if (input.code === TAX_CODE.VATABLE && !input.day) {
    return { status: 'need-date', message: NEED_POSTING_DATE_MESSAGE }
  }
  let rateBps: number | null = null
  if (input.code === TAX_CODE.VATABLE) {
    const picked = pickRate(input.rates, input.code, input.day as string)
    if (picked === null) return { status: 'refused', message: NO_VAT_RATE_MESSAGE }
    if (picked === 'ambiguous') return { status: 'refused', message: AMBIGUOUS_VAT_RATE_MESSAGE }
    rateBps = picked.rateBps
  }
  const math = computeTax({
    code: input.code,
    baseCents: input.baseCents,
    inclusive: input.inclusive,
    rateBps,
  })
  if (!math.ok) return { status: 'refused', message: math.message }
  return {
    status: 'ok',
    grossCents: math.grossCents,
    taxCents: math.taxCents,
    netCents: math.netCents,
    taxInclusive: math.taxInclusive,
    rateBps: math.rateBps,
  }
}

export function formatRatePercent(rateBps: number): string {
  return `${(rateBps / 100).toFixed(2)}%`
}

/** Why a chosen tax code cannot be saved yet. Null when it can, or when no code was chosen. */
export function taxBlockMessage(preview: TaxPreview): string | null {
  if (preview.status === 'ok' || preview.status === 'none') return null
  if (preview.status === 'need-amount') return 'Enter the amount to see the VAT.'
  return preview.message
}
