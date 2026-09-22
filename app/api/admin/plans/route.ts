import { NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import { asc, eq } from 'drizzle-orm'
import { db } from '@/db'
import { plans } from '@/db/schemas'
import { requirePlatformCapability } from '@/lib/api-auth'
import { isUniqueViolation } from '@/lib/db-errors'
import { validatePlanFields } from '@/lib/billing/plan-validation'

// ── GET/POST /api/admin/plans (billing.manage) ──────────────────────────────
// GET returns EVERY plan (public or not, active or not) — the admin screen
// needs to see the hidden `legacy` plan too. POST creates a new plan; every
// field this table has is caller-supplied/validated (see
// lib/billing/plan-validation.ts, shared with PATCH so create/update can't
// drift on what counts as a valid plan).

export async function GET() {
  const auth = await requirePlatformCapability('billing.manage')
  if ('error' in auth) return auth.error

  const rows = await db.select().from(plans).orderBy(asc(plans.sortOrder), asc(plans.createdAt))
  return NextResponse.json({ success: true, data: rows }, { status: 200 })
}

export async function POST(req: Request) {
  const auth = await requirePlatformCapability('billing.manage')
  if ('error' in auth) return auth.error

  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 })
  }
  const b = (raw ?? {}) as Record<string, unknown>

  const result = validatePlanFields(b, { requireCode: true })
  if (!result.ok) return NextResponse.json({ success: false, error: Object.values(result.fields)[0], fields: result.fields }, { status: 400 })

  const id = randomUUID()
  // Cast: validatePlanFields returns a Partial (PATCH reuses it for partial
  // updates), but `{ requireCode: true }` above already guarantees `code`/
  // `name` are present at runtime for this POST path.
  const insertValue = { id, ...result.value } as typeof plans.$inferInsert
  try {
    await db.insert(plans).values(insertValue)
  } catch (err) {
    if (isUniqueViolation(err)) {
      return NextResponse.json({ success: false, error: 'A plan with this code already exists', fields: { code: 'already in use' } }, { status: 409 })
    }
    throw err
  }

  const rows = await db.select().from(plans).where(eq(plans.id, id)).limit(1)
  return NextResponse.json({ success: true, data: rows[0] }, { status: 201 })
}
