import { NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import { asc, eq, sql } from 'drizzle-orm'
import { db } from '@/db'
import { statutoryRates } from '@/db/schemas'
import { requirePlatformCapability } from '@/lib/api-auth'
import { isStatutoryCode, sameRateSlot, STATUTORY_KINDS, STATUTORY_PAYERS, type BracketBand } from '@/lib/payroll-calc'
import { rateWindowsOverlap } from '@/lib/tax'

// GET/POST /api/admin/statutory-rates
// Platform catalogue. Capability is checked before the body is read, so an
// owner posting {} gets 403 rather than 400. No rates are seeded.

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

function readBrackets(value: unknown): BracketBand[] | { problem: string } {
  if (!Array.isArray(value) || value.length === 0) return { problem: 'A bracket rate needs at least one band.' }
  const bands: BracketBand[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') return { problem: 'A bracket band could not be read.' }
    const row = item as Record<string, unknown>
    const upTo = row.upToCents
    if (upTo != null && (typeof upTo !== 'number' || !Number.isInteger(upTo) || upTo <= 0)) {
      return { problem: 'A bracket band needs an upper amount in cents, or none for the top band.' }
    }
    if (typeof row.rateBps !== 'number' || !Number.isInteger(row.rateBps) || row.rateBps < 0 || row.rateBps > 10000) {
      return { problem: 'A bracket rate must be from 0 to 10000 basis points.' }
    }
    bands.push({ upToCents: upTo == null ? null : upTo, rateBps: row.rateBps })
  }
  const open = bands.filter((band) => band.upToCents == null)
  if (open.length > 1) return { problem: 'Only the top bracket band can be open-ended.' }
  const closed = bands.filter((band) => band.upToCents != null).map((band) => band.upToCents as number)
  const sorted = closed.slice().sort((a, b) => a - b)
  if (closed.some((value, index) => value !== sorted[index])) return { problem: 'Bracket bands must be in ascending order.' }
  if (open.length === 1 && bands[bands.length - 1].upToCents != null) return { problem: 'The open-ended band has to be last.' }
  return bands
}

export async function GET() {
  const auth = await requirePlatformCapability('catalogue.manage')
  if ('error' in auth) return auth.error
  const rates = await db.select().from(statutoryRates).orderBy(asc(statutoryRates.effectiveFrom))
  return ok(rates)
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
  const code = typeof b.code === 'string' ? b.code.trim() : ''
  if (!isStatutoryCode(code)) return badRequest('code must be PAYE, NSSF or SHIF.')
  const payer = typeof b.payer === 'string' ? b.payer : ''
  if (!(STATUTORY_PAYERS as readonly string[]).includes(payer)) return badRequest('payer must be employee or employer.')
  const kind = typeof b.kind === 'string' ? b.kind : ''
  if (!(STATUTORY_KINDS as readonly string[]).includes(kind)) return badRequest('kind must be percent, bracket or fixed.')

  let rateBps = 0
  let brackets: BracketBand[] | null = null
  if (kind === 'percent') {
    if (typeof b.rateBps !== 'number' || !Number.isInteger(b.rateBps) || b.rateBps < 0 || b.rateBps > 10000) {
      return badRequest('rateBps must be a whole number from 0 to 10000.')
    }
    rateBps = b.rateBps
  } else if (kind === 'fixed') {
    if (typeof b.amountCents !== 'number' || !Number.isInteger(b.amountCents) || b.amountCents < 0) {
      return badRequest('A fixed amount must be a whole number of cents, zero or more.')
    }
    rateBps = b.amountCents
  } else {
    const parsed = readBrackets(b.brackets)
    if (!Array.isArray(parsed)) return badRequest(parsed.problem)
    brackets = parsed
  }

  const ceilingCents = b.ceilingCents == null || b.ceilingCents === ''
    ? null
    : (typeof b.ceilingCents === 'number' && Number.isInteger(b.ceilingCents) && b.ceilingCents >= 0 ? b.ceilingCents : undefined)
  if (ceilingCents === undefined) return badRequest('The ceiling must be a whole number of cents, zero or more.')
  const floorCents = b.floorCents == null || b.floorCents === ''
    ? null
    : (typeof b.floorCents === 'number' && Number.isInteger(b.floorCents) && b.floorCents >= 0 ? b.floorCents : undefined)
  if (floorCents === undefined) return badRequest('The floor must be a whole number of cents, zero or more.')
  if (ceilingCents != null && floorCents != null && floorCents > ceilingCents) {
    return badRequest('The floor cannot be above the ceiling.')
  }

  const from = requireIsoDay(b.effectiveFrom, 'effectiveFrom')
  if (typeof from !== 'string') return badRequest(from.problem)
  let effectiveTo: string | null = null
  if (b.effectiveTo != null && b.effectiveTo !== '') {
    const to = requireIsoDay(b.effectiveTo, 'effectiveTo')
    if (typeof to !== 'string') return badRequest(to.problem)
    if (to < from) return badRequest('effectiveTo cannot be before effectiveFrom')
    effectiveTo = to
  }

  // Check and insert under one lock per scheme, as the VAT rates do: two
  // simultaneous posts would each pass the overlap check and both insert.
  const outcome = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'statutory_rates:' + code}))`)
    const existing = await tx.select().from(statutoryRates).where(eq(statutoryRates.code, code))
    if (existing.some((row) => sameRateSlot(row, { payer, kind }) && rateWindowsOverlap(from, effectiveTo, row.effectiveFrom, row.effectiveTo))) {
      return { overlap: true as const }
    }
    const [inserted] = await tx.insert(statutoryRates).values({
      id: randomUUID(),
      code,
      payer,
      kind,
      rateBps,
      brackets: brackets ? JSON.stringify(brackets) : null,
      ceilingCents,
      floorCents,
      effectiveFrom: from,
      effectiveTo,
    }).returning()
    return { overlap: false as const, row: inserted }
  })
  if (outcome.overlap) return badRequest('That rate overlaps one already configured for this scheme.')
  const row = outcome.row
  return created(row)
}
