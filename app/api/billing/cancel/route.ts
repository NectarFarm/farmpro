import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { subscriptions } from '@/db/schemas'
import { requireTenantSession } from '@/lib/api-auth'
import { computeCancellation } from '@/lib/billing/access-state'
import { getCurrentSubscription, toSnapshot } from '@/lib/billing/subscriptions'

// ── POST /api/billing/cancel (owner only) ───────────────────────────────────
// Mid-cycle (active with a real period end): a SOFT cancel —
// `cancelAtPeriodEnd: true`, access continues until the period runs out.
// Nothing to run out (trialing/pending_payment, or an open-ended
// subscription like the legacy backfill): cancelled immediately. See
// lib/billing/access-state.ts's computeCancellation for the exact rule.
const bad = (msg: string, status = 400) => NextResponse.json({ success: false, error: msg }, { status })

export async function POST() {
  const auth = await requireTenantSession({ roles: ['owner'] })
  if ('error' in auth) return auth.error
  const { tenantId } = auth

  const sub = await getCurrentSubscription(tenantId)
  if (!sub) return bad('No active subscription to cancel', 404)
  if (sub.status === 'cancelled' || sub.status === 'expired') {
    return bad(`Subscription is already ${sub.status}`, 409)
  }

  const decision = computeCancellation(toSnapshot(sub))

  await db
    .update(subscriptions)
    .set({ status: decision.status, cancelAtPeriodEnd: decision.cancelAtPeriodEnd, updatedAt: new Date() })
    .where(eq(subscriptions.id, sub.id))

  return NextResponse.json({ success: true, data: decision }, { status: 200 })
}
