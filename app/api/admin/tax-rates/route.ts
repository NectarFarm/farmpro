import { NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import { asc, eq, sql } from 'drizzle-orm'
import { db } from '@/db'
import { taxCodes, taxRates } from '@/db/schemas'
import { requirePlatformCapability } from '@/lib/api-auth'
import { ensureTaxCodes } from '@/lib/tax-catalogue'
import { TAX_CODE, rateWindowsOverlap } from '@/lib/tax'
import { parseMoneyToCents } from '@/lib/money'

// GET/POST /api/admin/tax-rates
// Platform catalogue. Capability is checked before the body is read, same
// as expense categories, so an owner posting {} gets 403 rather than 400.
// rate_bps is not editable after insert. A change of rate is a new row.

const ok = <T>(data: T) => NextResponse.json({ success: true, data }, { status: 200 })
const created = <T>(data: T) => NextResponse.json({ success: true, data }, { status: 201 })
const badRequest = (msg: string) => NextResponse.json({ success: false, error: msg }, { status: 400 })

function requireIsoDay(value: unknown, field: string): string | { problem: string } {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return { problem: `${field} must be a date` }
  const [year, month, day] = value.split('-').map(Number)
  const parsed = new Date(Date.UTC(year, month - 1, day))
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) {
    return { problem: `${field} must be a real date` }
  }
  return value
}

export async function GET() {
  const auth = await requirePlatformCapability('catalogue.manage')
  if ('error' in auth) return auth.error

  const codes = await db.select().from(taxCodes).orderBy(asc(taxCodes.name))
  const rates = await db.select().from(taxRates).orderBy(asc(taxRates.effectiveFrom))
  return ok({ codes, rates })
}

export async function POST(req: Request) {
  const auth = await requirePlatformCapability('catalogue.manage')
  if ('error' in auth) return auth.error

  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return badRequest('Invalid JSON body')
  }
  const b = (raw ?? {}) as Record<string, unknown>

  await ensureTaxCodes()
  const code = typeof b.taxCode === 'string' ? b.taxCode.trim() : ''
  if (!code) return badRequest('taxCode must be VATABLE.')
  if (code !== TAX_CODE.VATABLE) {
    return badRequest('Only VATable uses a rate. Zero-rated, exempt and outside scope compute no tax.')
  }
  const codeRows = await db.select().from(taxCodes).where(eq(taxCodes.code, code))
  if (!codeRows[0] || !codeRows[0].active) return badRequest('That tax code is not in use.')

  const rateBps = parseMoneyToCents(b.percent)
  if (rateBps === null || rateBps < 0 || rateBps > 10000) return badRequest('percent must be from 0 to 100')

  const from = requireIsoDay(b.effectiveFrom, 'effectiveFrom')
  if (typeof from !== 'string') return badRequest(from.problem)
  let effectiveTo: string | null = null
  if (b.effectiveTo != null && b.effectiveTo !== '') {
    const to = requireIsoDay(b.effectiveTo, 'effectiveTo')
    if (typeof to !== 'string') return badRequest(to.problem)
    if (to < from) return badRequest('effectiveTo cannot be before effectiveFrom')
    effectiveTo = to
  }

  // The overlap check and the insert run under one per-code advisory lock, so
  // two concurrent POSTs queue up and the second sees the first. The lock is
  // taken in PATCH too (see [id]/route.ts). An exclusion constraint would
  // need the btree_gist extension, which a migration cannot assume.
  const row = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'tax_rates:' + code}))`)
    const existing = await tx.select().from(taxRates).where(eq(taxRates.taxCode, code))
    if (existing.some((r) => rateWindowsOverlap(from, effectiveTo, r.effectiveFrom, r.effectiveTo))) return null
    const [inserted] = await tx.insert(taxRates).values({
      id: randomUUID(),
      taxCode: code,
      rateBps,
      effectiveFrom: from,
      effectiveTo,
    }).returning()
    return inserted
  })
  if (!row) return badRequest('That rate overlaps one already configured for this code.')
  return created(row)
}
