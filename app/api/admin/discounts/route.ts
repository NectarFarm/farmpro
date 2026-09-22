import { NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import { desc, eq } from 'drizzle-orm'
import { db } from '@/db'
import { discounts } from '@/db/schemas'
import { requirePlatformCapability } from '@/lib/api-auth'
import { isUniqueViolation } from '@/lib/db-errors'
import { validateDiscountFields } from '@/lib/billing/discount-validation'

// ── GET/POST /api/admin/discounts (billing.manage) ──────────────────────────
export async function GET() {
  const auth = await requirePlatformCapability('billing.manage')
  if ('error' in auth) return auth.error

  const rows = await db.select().from(discounts).orderBy(desc(discounts.createdAt))
  return NextResponse.json({ success: true, data: rows }, { status: 200 })
}

export async function POST(req: Request) {
  const auth = await requirePlatformCapability('billing.manage')
  if ('error' in auth) return auth.error
  const { session } = auth

  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 })
  }
  const b = (raw ?? {}) as Record<string, unknown>

  const result = validateDiscountFields(b, { requireCode: true })
  if (!result.ok) return NextResponse.json({ success: false, error: Object.values(result.fields)[0], fields: result.fields }, { status: 400 })

  const id = randomUUID()
  // Cast: validateDiscountFields returns a Partial (PATCH reuses it), but
  // `{ requireCode: true }` above guarantees code/kind/value are present at
  // runtime for this POST path.
  const insertValue = { id, createdBy: session.id, ...result.value } as typeof discounts.$inferInsert
  try {
    await db.insert(discounts).values(insertValue)
  } catch (err) {
    if (isUniqueViolation(err)) {
      return NextResponse.json({ success: false, error: 'A discount with this code already exists', fields: { code: 'already in use' } }, { status: 409 })
    }
    throw err
  }

  const rows = await db.select().from(discounts).where(eq(discounts.id, id)).limit(1)
  return NextResponse.json({ success: true, data: rows[0] }, { status: 201 })
}
