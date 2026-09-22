import { NextResponse } from 'next/server'
import { and, asc, eq } from 'drizzle-orm'
import { db } from '@/db'
import { plans } from '@/db/schemas'
import { requireSession } from '@/lib/api-auth'

// ── GET /api/billing/plans (any authenticated user) ─────────────────────────
// The public plan catalogue — "public" meaning `is_public = true` (offered
// to new signups), not "no session required". Any signed-in user (any role,
// any tenant) can see the price book; only the mutation routes below this
// one are role-gated. Hidden plans (e.g. the `legacy` backfill plan) are
// deliberately never returned here — see db/schemas/billing.ts.
export async function GET() {
  const auth = await requireSession()
  if ('error' in auth) return auth.error

  const rows = await db
    .select()
    .from(plans)
    .where(and(eq(plans.isPublic, true), eq(plans.isActive, true)))
    .orderBy(asc(plans.sortOrder), asc(plans.createdAt))

  return NextResponse.json({ success: true, data: rows }, { status: 200 })
}
