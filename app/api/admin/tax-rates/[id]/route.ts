import { NextResponse } from 'next/server'
import { and, eq, ne, sql, gte, lt } from 'drizzle-orm'
import { db } from '@/db'
import { taxRates, sales, purchases, expenses } from '@/db/schemas'
import { requirePlatformCapability } from '@/lib/api-auth'
import { rateWindowsOverlap } from '@/lib/tax'

// PATCH /api/admin/tax-rates/[id]
// Sets the last day the rate applies, whether or not one is already set, so a
// wrong end date can be corrected. The rate itself and the start date stay as
// they were recorded — editing either would change the tax an old document
// resolves.
// DELETE removes a rate no document has been posted against, so a rate added
// by mistake (including one overlapping another) can be removed without SQL.

const ok = <T>(data: T) => NextResponse.json({ success: true, data }, { status: 200 })
const badRequest = (msg: string) => NextResponse.json({ success: false, error: msg }, { status: 400 })
const notFound = () => NextResponse.json({ success: false, error: 'VAT rate not found' }, { status: 404 })

function requireIsoDay(value: unknown, field: string): string | { problem: string } {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return { problem: `${field} must be a date` }
  const [year, month, day] = value.split('-').map(Number)
  const parsed = new Date(Date.UTC(year, month - 1, day))
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) {
    return { problem: `${field} must be a real date` }
  }
  return value
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const auth = await requirePlatformCapability('catalogue.manage')
  if ('error' in auth) return auth.error

  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return badRequest('Invalid JSON body')
  }
  const b = (raw ?? {}) as Record<string, unknown>
  if ('percent' in b || 'rateBps' in b || 'effectiveFrom' in b) {
    return badRequest('A rate cannot be edited. Set an end date and add a new rate.')
  }

  const to = requireIsoDay(b.effectiveTo, 'effectiveTo')
  if (typeof to !== 'string') return badRequest(to.problem)

  const rows = await db.select().from(taxRates).where(eq(taxRates.id, id))
  if (!rows[0]) return notFound()
  const taxCode = rows[0].taxCode

  const outcome = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'tax_rates:' + taxCode}))`)
    const [current] = await tx.select().from(taxRates).where(eq(taxRates.id, id))
    if (!current) return { status: 'missing' as const }
    if (to < current.effectiveFrom) return { status: 'before' as const }
    const others = await tx.select().from(taxRates).where(and(eq(taxRates.taxCode, current.taxCode), ne(taxRates.id, id)))
    if (others.some((r) => rateWindowsOverlap(current.effectiveFrom, to, r.effectiveFrom, r.effectiveTo))) return { status: 'overlap' as const }
    const [updated] = await tx.update(taxRates).set({ effectiveTo: to }).where(eq(taxRates.id, id)).returning()
    return { status: 'ok' as const, row: updated }
  })
  if (outcome.status === 'missing') return notFound()
  if (outcome.status === 'before') return badRequest('effectiveTo cannot be before effectiveFrom')
  if (outcome.status === 'overlap') return badRequest('That rate overlaps one already configured for this code.')
  return ok(outcome.row)
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const auth = await requirePlatformCapability('catalogue.manage')
  if ('error' in auth) return auth.error

  const outcome = await db.transaction(async (tx) => {
    const [peek] = await tx.select().from(taxRates).where(eq(taxRates.id, id))
    if (!peek) return { status: 'missing' as const }
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'tax_rates:' + peek.taxCode}))`)
    const [current] = await tx.select().from(taxRates).where(eq(taxRates.id, id))
    if (!current) return { status: 'missing' as const }
    // A document stores its computed tax, not a rate id, so "used" means a
    // document of this code posted inside the rate's window. The window is
    // widened by a day each side: the posting day is read in the farm's
    // timezone, the column is a UTC instant.
    const lower = sql`(${current.effectiveFrom}::date - 1)`
    const upper = current.effectiveTo ? sql`(${current.effectiveTo}::date + 2)` : null
    let used = 0
    for (const t of [sales, purchases, expenses]) {
      const where = and(
        eq(t.taxCode, current.taxCode),
        gte(t.postingDate, sql`${lower}`),
        upper ? lt(t.postingDate, sql`${upper}`) : undefined,
      )
      const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(t).where(where)
      used += n
    }
    if (used > 0) return { status: 'used' as const }
    await tx.delete(taxRates).where(eq(taxRates.id, id))
    return { status: 'ok' as const, row: current }
  })
  if (outcome.status === 'missing') return notFound()
  if (outcome.status === 'used') return badRequest('Documents have been posted against this rate, so it cannot be removed. Set an end date instead.')
  return ok(outcome.row)
}
