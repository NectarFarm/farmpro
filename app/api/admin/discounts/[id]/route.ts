import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { discounts } from '@/db/schemas'
import { requirePlatformCapability } from '@/lib/api-auth'
import { isUniqueViolation } from '@/lib/db-errors'
import { validateDiscountFields } from '@/lib/billing/discount-validation'

// ── PATCH/DELETE /api/admin/discounts/[id] (billing.manage) ────────────────
// DELETE sets isActive: false rather than a hard delete — subscriptions may
// reference a discount by id (subscriptions.discountId), so removing the row
// outright would orphan that reference on any historical subscription.

const bad = (msg: string, status = 400) => NextResponse.json({ success: false, error: msg }, { status })

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePlatformCapability('billing.manage')
  if ('error' in auth) return auth.error

  const { id } = await params
  const existingRows = await db.select().from(discounts).where(eq(discounts.id, id)).limit(1)
  if (!existingRows[0]) return bad('Discount not found', 404)

  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return bad('Invalid JSON body')
  }
  const b = (raw ?? {}) as Record<string, unknown>

  const result = validateDiscountFields(b)
  if (!result.ok) return NextResponse.json({ success: false, error: Object.values(result.fields)[0], fields: result.fields }, { status: 400 })
  if (Object.keys(result.value).length === 0) return bad('No updatable fields supplied')

  try {
    const updated = await db.update(discounts).set({ ...result.value, updatedAt: new Date() }).where(eq(discounts.id, id)).returning()
    return NextResponse.json({ success: true, data: updated[0] }, { status: 200 })
  } catch (err) {
    if (isUniqueViolation(err)) {
      return NextResponse.json({ success: false, error: 'A discount with this code already exists', fields: { code: 'already in use' } }, { status: 409 })
    }
    throw err
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePlatformCapability('billing.manage')
  if ('error' in auth) return auth.error

  const { id } = await params
  const existingRows = await db.select().from(discounts).where(eq(discounts.id, id)).limit(1)
  if (!existingRows[0]) return bad('Discount not found', 404)

  const updated = await db.update(discounts).set({ isActive: false, updatedAt: new Date() }).where(eq(discounts.id, id)).returning()
  return NextResponse.json({ success: true, data: updated[0] }, { status: 200 })
}
