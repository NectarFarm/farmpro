import { NextResponse } from 'next/server'
import { desc, eq } from 'drizzle-orm'
import { db } from '@/db'
import { plans, subscriptions, tenants } from '@/db/schemas'
import { requirePlatformCapability } from '@/lib/api-auth'
import { computeAccessState } from '@/lib/billing/access-state'
import { toSnapshot } from '@/lib/billing/subscriptions'

// ── GET /api/admin/subscriptions (billing.manage) ───────────────────────────
// Every tenant's CURRENT subscription (isCurrent = true), joined to the
// tenant name and plan. `?status=` filters on the EFFECTIVE status (run
// through lib/billing/access-state.ts, same as every other reader) rather
// than the raw stored column — an admin filtering "past_due" must see a
// trial that quietly ran out 8 days ago as 'expired', not still 'trialing'
// just because nothing has written to the row since.
export async function GET(req: Request) {
  const auth = await requirePlatformCapability('billing.manage')
  if ('error' in auth) return auth.error

  const statusFilter = new URL(req.url).searchParams.get('status')?.trim() || ''
  const now = new Date()

  const rows = await db
    .select({ sub: subscriptions, plan: plans, tenant: tenants })
    .from(subscriptions)
    .innerJoin(plans, eq(plans.id, subscriptions.planId))
    .innerJoin(tenants, eq(tenants.id, subscriptions.tenantId))
    .where(eq(subscriptions.isCurrent, true))
    .orderBy(desc(subscriptions.updatedAt))

  const data = rows
    .map(({ sub, plan, tenant }) => {
      const access = computeAccessState(toSnapshot(sub), now)
      return {
        tenantId: sub.tenantId,
        tenantName: tenant.name,
        tenantActive: tenant.active,
        subscriptionId: sub.id,
        planId: plan.id,
        planCode: plan.code,
        planName: plan.name,
        planCurrency: plan.currency,
        period: sub.period,
        status: access.status,
        needsPlan: access.needsPlan,
        trialEndsAt: sub.trialEndsAt,
        currentPeriodStart: sub.currentPeriodStart,
        currentPeriodEnd: sub.currentPeriodEnd,
        listPriceCents: sub.listPriceCents,
        discountAmountCents: sub.discountAmountCents,
        amountDueCents: sub.amountDueCents,
        cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
      }
    })
    .filter((row) => !statusFilter || row.status === statusFilter)

  return NextResponse.json({ success: true, data }, { status: 200 })
}
