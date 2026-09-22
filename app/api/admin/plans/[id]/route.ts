import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { plans } from '@/db/schemas'
import { requirePlatformCapability } from '@/lib/api-auth'
import { isUniqueViolation } from '@/lib/db-errors'
import { validatePlanFields } from '@/lib/billing/plan-validation'

// ── GET/PATCH/DELETE /api/admin/plans/[id] (billing.manage) ────────────────
// DELETE never issues a real SQL DELETE — subscriptions.planId references a
// plan by id with no DB-level FK (same "no cross-table FK, validated in
// application code" convention this codebase already uses elsewhere), so a
// hard delete could orphan a subscription's plan reference silently. DELETE
// here is `isActive: false` — an archive, matching how this codebase already
// treats "delete" on a row something else may reference (see
// db/schemas/dashboard.ts's products.status comment for the same pattern).

const bad = (msg: string, status = 400) => NextResponse.json({ success: false, error: msg }, { status })

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePlatformCapability('billing.manage')
  if ('error' in auth) return auth.error

  const { id } = await params
  const rows = await db.select().from(plans).where(eq(plans.id, id)).limit(1)
  if (!rows[0]) return bad('Plan not found', 404)
  return NextResponse.json({ success: true, data: rows[0] }, { status: 200 })
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePlatformCapability('billing.manage')
  if ('error' in auth) return auth.error

  const { id } = await params
  const existingRows = await db.select().from(plans).where(eq(plans.id, id)).limit(1)
  if (!existingRows[0]) return bad('Plan not found', 404)

  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return bad('Invalid JSON body')
  }
  const b = (raw ?? {}) as Record<string, unknown>

  const result = validatePlanFields(b)
  if (!result.ok) return NextResponse.json({ success: false, error: Object.values(result.fields)[0], fields: result.fields }, { status: 400 })
  if (Object.keys(result.value).length === 0) return bad('No updatable fields supplied')

  try {
    const updated = await db.update(plans).set({ ...result.value, updatedAt: new Date() }).where(eq(plans.id, id)).returning()
    return NextResponse.json({ success: true, data: updated[0] }, { status: 200 })
  } catch (err) {
    if (isUniqueViolation(err)) {
      return NextResponse.json({ success: false, error: 'A plan with this code already exists', fields: { code: 'already in use' } }, { status: 409 })
    }
    throw err
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePlatformCapability('billing.manage')
  if ('error' in auth) return auth.error

  const { id } = await params
  const existingRows = await db.select().from(plans).where(eq(plans.id, id)).limit(1)
  if (!existingRows[0]) return bad('Plan not found', 404)

  const updated = await db.update(plans).set({ isActive: false, isPublic: false, updatedAt: new Date() }).where(eq(plans.id, id)).returning()
  return NextResponse.json({ success: true, data: updated[0] }, { status: 200 })
}
