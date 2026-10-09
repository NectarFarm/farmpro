// Server-side VAT catalogue (issue #419). The arithmetic lives in lib/tax.ts
// so a sheet can preview it. This file is the only place that reads the
// tables and decides whether a document may be posted.
import 'server-only'
import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { taxCodes, taxRates } from '@/db/schemas'
import {
  TAX_CODE, AMBIGUOUS_VAT_RATE_MESSAGE, computeTax, pickRate,
  type RateWindow,
} from '@/lib/tax'

export const SEEDED_TAX_CODES = [
  { id: 'taxcode-vatable', code: TAX_CODE.VATABLE, name: 'VATable' },
  { id: 'taxcode-zero-rated', code: TAX_CODE.ZERO_RATED, name: 'Zero-rated' },
  { id: 'taxcode-exempt', code: TAX_CODE.EXEMPT, name: 'Exempt' },
  { id: 'taxcode-outside-scope', code: TAX_CODE.OUTSIDE_SCOPE, name: 'Outside scope' },
] as const

// Idempotent. Does not revive a code an admin has deactivated, and does not
// insert a rate.
export async function ensureTaxCodes(dbOrTx: typeof db = db) {
  await dbOrTx
    .insert(taxCodes)
    .values(SEEDED_TAX_CODES.map((row) => ({ ...row, active: true })))
    .onConflictDoNothing({ target: taxCodes.code })
}

export type DocumentTaxColumns = {
  taxCode: string | null
  taxInclusive: boolean | null
  grossCents: number | null
  taxCents: number | null
  netCents: number | null
}

export type ResolvedDocumentTax = {
  settledCents: number
  columns: DocumentTaxColumns
}

const EMPTY_COLUMNS: DocumentTaxColumns = {
  taxCode: null,
  taxInclusive: null,
  grossCents: null,
  taxCents: null,
  netCents: null,
}

/**
 * `baseCents` is the figure the user typed: the goods amount. Exclusive VAT
 * makes the settled amount larger than that. No code leaves every tax column
 * null and settles the typed figure, which is what every document did before
 * this issue.
 */
export async function resolveDocumentTax(input: {
  taxCode: unknown
  taxInclusive: unknown
  baseCents: number
  postingDay: string
}): Promise<ResolvedDocumentTax | { refused: string }> {
  const raw = input.taxCode
  if (raw == null || raw === '') {
    return { settledCents: input.baseCents, columns: EMPTY_COLUMNS }
  }
  if (typeof raw !== 'string' || !raw.trim()) {
    return { refused: 'taxCode must be one of the tax codes.' }
  }
  const code = raw.trim()
  if (input.taxInclusive != null && typeof input.taxInclusive !== 'boolean') {
    return { refused: 'taxInclusive must be true or false.' }
  }

  await ensureTaxCodes()
  const codeRows = await db.select().from(taxCodes).where(eq(taxCodes.code, code))
  const catalogue = codeRows[0]
  if (!catalogue) return { refused: 'That tax code is not in the catalogue.' }
  if (!catalogue.active) return { refused: 'That tax code is not in use.' }

  let rateBps: number | null = null
  let inclusive = false
  if (code === TAX_CODE.VATABLE) {
    if (typeof input.taxInclusive !== 'boolean') {
      return { refused: 'Say whether the amount includes VAT.' }
    }
    inclusive = input.taxInclusive
    const rateRows = await db.select().from(taxRates).where(eq(taxRates.taxCode, code))
    const windows: RateWindow[] = rateRows.map((row) => ({
      taxCode: row.taxCode,
      rateBps: row.rateBps,
      effectiveFrom: row.effectiveFrom,
      effectiveTo: row.effectiveTo,
    }))
    const picked = pickRate(windows, code, input.postingDay)
    if (picked === null) return { refused: 'No VAT rate is configured for this date.' }
    if (picked === 'ambiguous') return { refused: AMBIGUOUS_VAT_RATE_MESSAGE }
    rateBps = picked.rateBps
  }

  const math = computeTax({ code, baseCents: input.baseCents, inclusive, rateBps })
  if (!math.ok) return { refused: math.message }
  return {
    settledCents: math.grossCents,
    columns: {
      taxCode: code,
      taxInclusive: math.taxInclusive,
      grossCents: math.grossCents,
      taxCents: math.taxCents,
      netCents: math.netCents,
    },
  }
}
