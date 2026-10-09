import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { statutoryRates } from '@/db/schemas'
import { requirePlatformCapability } from '@/lib/api-auth'

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

  const [existing] = await db.select().from(statutoryRates).where(eq(statutoryRates.id, id))
  if (!existing) return notFound()
  if (effectiveTo < existing.effectiveFrom) return badRequest('effectiveTo cannot be before effectiveFrom')

  const [row] = await db.update(statutoryRates).set({ effectiveTo }).where(eq(statutoryRates.id, id)).returning()
  return ok(row)
}
