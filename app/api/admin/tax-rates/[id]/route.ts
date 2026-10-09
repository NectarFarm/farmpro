import { NextResponse } from 'next/server'
import { and, eq, ne } from 'drizzle-orm'
import { db } from '@/db'
import { taxRates } from '@/db/schemas'
import { requirePlatformCapability } from '@/lib/api-auth'
import { rateWindowsOverlap } from '@/lib/tax'

// PATCH /api/admin/tax-rates/[id]
// Sets the last day the rate applies. The rate itself and the start date
// stay as they were recorded — editing either would change the tax an old
// document resolves.

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
  const current = rows[0]
  if (!current) return notFound()
  if (to < current.effectiveFrom) return badRequest('effectiveTo cannot be before effectiveFrom')

  const others = await db.select().from(taxRates).where(and(eq(taxRates.taxCode, current.taxCode), ne(taxRates.id, id)))
  if (others.some((row) => rateWindowsOverlap(current.effectiveFrom, to, row.effectiveFrom, row.effectiveTo))) {
    return badRequest('That rate overlaps one already configured for this code.')
  }

  const [row] = await db.update(taxRates).set({ effectiveTo: to }).where(eq(taxRates.id, id)).returning()
  return ok(row)
}
