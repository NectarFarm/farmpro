import { NextResponse } from 'next/server'
import { and, eq, gte, lte, ne, sql } from 'drizzle-orm'
import { db } from '@/db'
import { payrollRuns, statutoryRates } from '@/db/schemas'
import { requirePlatformCapability } from '@/lib/api-auth'
import { sameRateSlot } from '@/lib/payroll-calc'
import { rateWindowsOverlap } from '@/lib/tax'

// PATCH /api/admin/statutory-rates/[id]
// Closes a rate by setting effectiveTo. The rate itself is not edited, so a
// payslip dated inside the old window still resolves the old row.

const ok = <T>(data: T) => NextResponse.json({ success: true, data }, { status: 200 })
const badRequest = (msg: string) => NextResponse.json({ success: false, error: msg }, { status: 400 })
const notFound = () => NextResponse.json({ success: false, error: 'That statutory rate is not in the catalogue.' }, { status: 404 })

function requireIsoDay(value: unknown): string | { problem: string } {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return { problem: 'effectiveTo must be a date' }
  const [year, month, day] = value.split('-').map(Number)
  const parsed = new Date(Date.UTC(year, month - 1, day))
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) {
    return { problem: 'effectiveTo must be a real date' }
  }
  return value
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePlatformCapability('catalogue.manage')
  if ('error' in auth) return auth.error
  const { id } = await params

  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return badRequest('Invalid JSON body')
  }
  const b = (raw ?? {}) as Record<string, unknown>
  const effectiveTo = requireIsoDay(b.effectiveTo)
  if (typeof effectiveTo !== 'string') return badRequest(effectiveTo.problem)

  const [peek] = await db.select().from(statutoryRates).where(eq(statutoryRates.id, id))
  if (!peek) return notFound()
  const outcome = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'statutory_rates:' + peek.code}))`)
    const [current] = await tx.select().from(statutoryRates).where(eq(statutoryRates.id, id))
    if (!current) return { status: 'missing' as const }
    if (effectiveTo < current.effectiveFrom) return { status: 'before' as const }
    const others = await tx.select().from(statutoryRates).where(and(eq(statutoryRates.code, current.code), ne(statutoryRates.id, id)))
    if (others.some((row) => sameRateSlot(row, current) && rateWindowsOverlap(current.effectiveFrom, effectiveTo, row.effectiveFrom, row.effectiveTo))) {
      return { status: 'overlap' as const }
    }
    const [updated] = await tx.update(statutoryRates).set({ effectiveTo }).where(eq(statutoryRates.id, id)).returning()
    return { status: 'ok' as const, row: updated }
  })
  if (outcome.status === 'missing') return notFound()
  if (outcome.status === 'before') return badRequest('effectiveTo cannot be before effectiveFrom')
  if (outcome.status === 'overlap') return badRequest('That rate overlaps one already configured for this scheme.')
  return ok(outcome.row)
}

// Removes a rate no payroll run has been calculated under, so one added by
// mistake can be taken out without SQL. A run's period end is the date its
// rates were read on; any run inside the window counts as use.
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePlatformCapability('catalogue.manage')
  if ('error' in auth) return auth.error
  const { id } = await params

  const [peek] = await db.select().from(statutoryRates).where(eq(statutoryRates.id, id))
  if (!peek) return notFound()
  const outcome = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'statutory_rates:' + peek.code}))`)
    const [current] = await tx.select().from(statutoryRates).where(eq(statutoryRates.id, id))
    if (!current) return { status: 'missing' as const }
    // period_end is a timestamp; widen a day each side for the timezone.
    const lower = sql`(${current.effectiveFrom}::date - 1)`
    const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(payrollRuns).where(and(
      gte(payrollRuns.periodEnd, sql`${lower}`),
      current.effectiveTo ? lte(payrollRuns.periodEnd, sql`(${current.effectiveTo}::date + 2)`) : undefined,
    ))
    if (n > 0) return { status: 'used' as const }
    await tx.delete(statutoryRates).where(eq(statutoryRates.id, id))
    return { status: 'ok' as const, row: current }
  })
  if (outcome.status === 'missing') return notFound()
  if (outcome.status === 'used') return badRequest('A payroll run has been calculated under this rate, so it cannot be removed. Set an end date instead.')
  return ok(outcome.row)
}
