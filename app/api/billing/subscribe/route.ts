import { NextResponse } from 'next/server'
import { eq, sql } from 'drizzle-orm'
import { db } from '@/db'
import { discounts, plans } from '@/db/schemas'
import { requireTenantSession } from '@/lib/api-auth'
import { computeAccessState } from '@/lib/billing/access-state'
import { computeQuote, type PlanPeriod } from '@/lib/billing/pricing'
import {
  discountRowToDiscountLike,
  findDiscountByCode,
  getCurrentSubscription,
  insertCurrentSubscription,
  supersedeCurrentSubscription,
  toSnapshot,
} from '@/lib/billing/subscriptions'

// ── POST /api/billing/subscribe (owner only) ────────────────────────────────
// Body: { planId, period, discountCode? }. Starts a trial when the plan's
// trialDays > 0, otherwise goes straight to pending_payment — the tenant
// then submits a reference via POST /api/billing/payments for an admin to
// confirm. Any existing current subscription is superseded (kept as
// history, `isCurrent: false`), never deleted — see db/schemas/billing.ts.
const PERIODS: readonly PlanPeriod[] = ['monthly', 'quarterly', 'annual']

const bad = (msg: string, status = 400) => NextResponse.json({ success: false, error: msg }, { status })

export async function POST(req: Request) {
  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    raw = {}
  }
  const body = (raw ?? {}) as Record<string, unknown>

  const auth = await requireTenantSession({ roles: ['owner'] })
  if ('error' in auth) return auth.error
  const { tenantId } = auth

  const planId = typeof body.planId === 'string' ? body.planId.trim() : ''
  const periodRaw = typeof body.period === 'string' ? body.period.trim() : ''
  if (!planId) return bad('planId is required')
  if (!PERIODS.includes(periodRaw as PlanPeriod)) return bad(`period must be one of: ${PERIODS.join(', ')}`)
  const period = periodRaw as PlanPeriod

  const planRows = await db.select().from(plans).where(eq(plans.id, planId)).limit(1)
  const plan = planRows[0]
  if (!plan || !plan.isActive) return bad('Plan not found or not available', 404)

  const discountCode = typeof body.discountCode === 'string' ? body.discountCode.trim() : ''
  let discount: Awaited<ReturnType<typeof findDiscountByCode>> = null
  let discountArg: Parameters<typeof computeQuote>[2] | undefined
  const now = new Date()

  if (discountCode) {
    discount = await findDiscountByCode(discountCode)
    if (!discount) return bad('Discount code not found', 404)
    discountArg = { discount: discountRowToDiscountLike(discount), ctx: { planId, period, tenantId, now } }
  }

  const result = computeQuote(plan.prices, period, discountArg)
  if (!result.ok) return bad(result.error)
  const { quote } = result

  const trialing = plan.trialDays > 0
  const trialEndsAt = trialing ? new Date(now.getTime() + plan.trialDays * 24 * 60 * 60 * 1000) : null

  const newSubId = await db.transaction(async (tx) => {
    await supersedeCurrentSubscription(tx, tenantId)
    const id = await insertCurrentSubscription(tx, {
      tenantId,
      planId: plan.id,
      period,
      status: trialing ? 'trialing' : 'pending_payment',
      trialEndsAt,
      currentPeriodStart: trialing ? now : null,
      currentPeriodEnd: null,
      listPriceCents: quote.listPriceCents,
      discountId: discount?.id ?? null,
      discountAmountCents: quote.discountAmountCents,
      amountDueCents: quote.amountDueCents,
    })
    if (discount) {
      await tx.update(discounts).set({ redemptions: sql`${discounts.redemptions} + 1` }).where(eq(discounts.id, discount.id))
    }
    return id
  })

  const sub = await getCurrentSubscription(tenantId)
  const access = sub ? computeAccessState(toSnapshot(sub), now) : computeAccessState(null, now)

  return NextResponse.json(
    { success: true, data: { subscriptionId: newSubId, status: access.status, trialEndsAt, amountDueCents: quote.amountDueCents } },
    { status: 201 }
  )
}
