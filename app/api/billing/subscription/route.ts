import { NextResponse } from 'next/server'
import { requireTenantSession } from '@/lib/api-auth'
import { computeAccessState } from '@/lib/billing/access-state'
import { getCurrentSubscription, getUsage, toSnapshot } from '@/lib/billing/subscriptions'

// ── GET /api/billing/subscription (any tenant-scoped role, read-only) ──────
// Managers etc. may read subscription status even though only an owner can
// change it (see the mutation routes in this same directory) — a manager
// needs to see "we're on a 3-day trial" without being able to act on it.
export async function GET() {
  const auth = await requireTenantSession()
  if ('error' in auth) return auth.error
  const { tenantId } = auth

  const sub = await getCurrentSubscription(tenantId)
  const usage = await getUsage(tenantId)

  if (!sub) {
    return NextResponse.json(
      { success: true, data: { subscription: null, plan: null, usage, access: computeAccessState(null, new Date()) } },
      { status: 200 }
    )
  }

  const access = computeAccessState(toSnapshot(sub), new Date())

  return NextResponse.json(
    {
      success: true,
      data: {
        subscription: {
          id: sub.id,
          planId: sub.planId,
          period: sub.period,
          status: access.status,
          trialEndsAt: sub.trialEndsAt,
          currentPeriodStart: sub.currentPeriodStart,
          currentPeriodEnd: sub.currentPeriodEnd,
          listPriceCents: sub.listPriceCents,
          discountAmountCents: sub.discountAmountCents,
          amountDueCents: sub.amountDueCents,
          cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
        },
        plan: {
          id: sub.plan.id,
          code: sub.plan.code,
          name: sub.plan.name,
          tagline: sub.plan.tagline,
          features: sub.plan.features,
          limits: sub.plan.limits,
          currency: sub.plan.currency,
        },
        usage,
        access,
      },
    },
    { status: 200 }
  )
}
