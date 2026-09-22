import { NextResponse } from 'next/server'
import { and, eq } from 'drizzle-orm'
import { db } from '@/db'
import { plans } from '@/db/schemas'
import { requireTenantSession } from '@/lib/api-auth'
import { computeQuote, type PlanPeriod } from '@/lib/billing/pricing'
import { discountRowToDiscountLike, findDiscountByCode } from '@/lib/billing/subscriptions'

// ── POST /api/billing/quote (owner only) ────────────────────────────────────
// Body: { planId, period, discountCode? }. A pure preview — nothing is
// written, no discount redemption is consumed. Billing is treated as an
// owner-level concern throughout this API (same "owner-controlled by
// default" precedent lib/permissions.ts already applies to finance/payroll),
// so every mutation AND every price-quote route here is owner-only; only
// GET /api/billing/subscription is opened to every tenant role, since that
// one is read-only status, not money.
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

  const planRows = await db.select().from(plans).where(and(eq(plans.id, planId), eq(plans.isActive, true))).limit(1)
  const plan = planRows[0]
  if (!plan) return bad('Plan not found or not available', 404)

  const discountCode = typeof body.discountCode === 'string' ? body.discountCode.trim() : ''
  let discountArg: Parameters<typeof computeQuote>[2] | undefined

  if (discountCode) {
    const discountRow = await findDiscountByCode(discountCode)
    if (!discountRow) return bad('Discount code not found', 404)
    discountArg = { discount: discountRowToDiscountLike(discountRow), ctx: { planId, period, tenantId, now: new Date() } }
  }

  const result = computeQuote(plan.prices, period, discountArg)
  if (!result.ok) return bad(result.error)

  return NextResponse.json(
    {
      success: true,
      data: {
        planId: plan.id,
        planCode: plan.code,
        period,
        currency: plan.currency,
        discountCode: discountCode || null,
        ...result.quote,
      },
    },
    { status: 200 }
  )
}
