import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { plans, subscriptions } from '@/db/schemas'
import { requirePlatformCapability } from '@/lib/api-auth'
import { writeAuditLog } from '@/lib/audit'
import { computeQuote, type PlanPeriod } from '@/lib/billing/pricing'
import { discountRowToDiscountLike, findDiscountByCode, findDiscountById, getCurrentSubscription } from '@/lib/billing/subscriptions'

// ── PATCH /api/admin/subscriptions/[tenantId] (billing.manage) ─────────────
// Body (all optional, applied together): { planId, period, status,
// trialEndsAt, currentPeriodEnd, extendTrialDays, extendPeriodDays,
// discountCode, cancelAtPeriodEnd }.
//
//   - planId/period: switches the tenant's plan/period and recomputes
//     listPriceCents (and, if a discount is already applied or a new
//     discountCode is given, discountAmountCents/amountDueCents) from the
//     NEW plan+period's price book.
//   - trialEndsAt/currentPeriodEnd: set an absolute date (or null to clear).
//   - extendTrialDays/extendPeriodDays: ADD N days (negative shortens) to
//     whichever of the two dates above is not also being set absolutely in
//     the same request.
//   - discountCode: string applies/replaces the discount (revalidated
//     against the resulting plan/period/tenant); null clears it.
//   - status: a direct admin override — use for "mark this back to active by
//     hand" after an off-platform arrangement; not a substitute for the
//     normal payment-confirm flow.
//   - cancelAtPeriodEnd: direct boolean set.
const VALID_STATUSES = ['trialing', 'pending_payment', 'active', 'past_due', 'cancelled', 'expired'] as const
const PERIODS: readonly PlanPeriod[] = ['monthly', 'quarterly', 'annual']
const DAY_MS = 24 * 60 * 60 * 1000

const bad = (msg: string, status = 400) => NextResponse.json({ success: false, error: msg }, { status })
const badFields = (fields: Record<string, string>, status = 400) => {
  const firstKey = Object.keys(fields)[0]
  return NextResponse.json({ success: false, error: fields[firstKey], fields }, { status })
}

function parseDateOrNullField(v: unknown, field: string, fields: Record<string, string>): Date | null | undefined {
  if (v === null) return null
  if (typeof v !== 'string') { fields[field] = `${field} must be an ISO date string or null`; return undefined }
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) { fields[field] = `${field} must be a valid date`; return undefined }
  return d
}

export async function PATCH(req: Request, { params }: { params: Promise<{ tenantId: string }> }) {
  const auth = await requirePlatformCapability('billing.manage')
  if ('error' in auth) return auth.error
  const { session } = auth

  const { tenantId } = await params
  const current = await getCurrentSubscription(tenantId)
  if (!current) return bad('This tenant has no current subscription', 404)

  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return bad('Invalid JSON body')
  }
  const b = (raw ?? {}) as Record<string, unknown>
  const fields: Record<string, string> = {}
  const now = new Date()

  // ── Plan / period ──
  const nextPlanId = typeof b.planId === 'string' && b.planId.trim() ? b.planId.trim() : current.planId
  let nextPeriod: PlanPeriod = current.period as PlanPeriod
  if ('period' in b) {
    const p = typeof b.period === 'string' ? b.period.trim() : ''
    if (!PERIODS.includes(p as PlanPeriod)) fields.period = `period must be one of: ${PERIODS.join(', ')}`
    else nextPeriod = p as PlanPeriod
  }

  const planOrPeriodChanged = nextPlanId !== current.planId || nextPeriod !== current.period
  let planRow = current.plan
  if (planOrPeriodChanged) {
    const rows = await db.select().from(plans).where(eq(plans.id, nextPlanId)).limit(1)
    if (!rows[0]) fields.planId = 'Plan not found'
    else planRow = rows[0]
  }

  // ── Discount ──
  let discountId: string | null | undefined
  if ('discountCode' in b) {
    if (b.discountCode === null) {
      discountId = null
    } else if (typeof b.discountCode === 'string' && b.discountCode.trim()) {
      const row = await findDiscountByCode(b.discountCode)
      if (!row) fields.discountCode = 'Discount code not found'
      else discountId = row.id
    } else {
      fields.discountCode = 'discountCode must be a string, or null to clear it'
    }
  }

  // ── Dates ──
  let trialEndsAt = current.trialEndsAt
  if ('trialEndsAt' in b) {
    const d = parseDateOrNullField(b.trialEndsAt, 'trialEndsAt', fields)
    if (d !== undefined) trialEndsAt = d
  } else if (typeof b.extendTrialDays === 'number' && Number.isFinite(b.extendTrialDays)) {
    trialEndsAt = new Date((trialEndsAt ?? now).getTime() + b.extendTrialDays * DAY_MS)
  }

  let currentPeriodEnd = current.currentPeriodEnd
  if ('currentPeriodEnd' in b) {
    const d = parseDateOrNullField(b.currentPeriodEnd, 'currentPeriodEnd', fields)
    if (d !== undefined) currentPeriodEnd = d
  } else if (typeof b.extendPeriodDays === 'number' && Number.isFinite(b.extendPeriodDays)) {
    currentPeriodEnd = new Date((currentPeriodEnd ?? now).getTime() + b.extendPeriodDays * DAY_MS)
  }

  // ── Status / cancelAtPeriodEnd ──
  let status = current.status
  if ('status' in b) {
    const s = typeof b.status === 'string' ? b.status.trim() : ''
    if (!(VALID_STATUSES as readonly string[]).includes(s)) fields.status = `status must be one of: ${VALID_STATUSES.join(', ')}`
    else status = s
  }
  let cancelAtPeriodEnd = current.cancelAtPeriodEnd
  if ('cancelAtPeriodEnd' in b) {
    if (typeof b.cancelAtPeriodEnd !== 'boolean') fields.cancelAtPeriodEnd = 'cancelAtPeriodEnd must be a boolean'
    else cancelAtPeriodEnd = b.cancelAtPeriodEnd
  }

  if (Object.keys(fields).length > 0) return badFields(fields)

  // ── Recompute money whenever the plan/period/discount actually changed ──
  let listPriceCents = current.listPriceCents
  let discountAmountCents = current.discountAmountCents
  let amountDueCents = current.amountDueCents
  const effectiveDiscountId = discountId !== undefined ? discountId : current.discountId

  if (planOrPeriodChanged || discountId !== undefined) {
    let discountArg: Parameters<typeof computeQuote>[2] | undefined
    if (effectiveDiscountId) {
      const discountRow = await findDiscountById(effectiveDiscountId)
      if (!discountRow) return bad('Discount not found', 404)
      discountArg = {
        discount: discountRowToDiscountLike(discountRow),
        ctx: { planId: planRow.id, period: nextPeriod, tenantId, now },
      }
    }
    const result = computeQuote(planRow.prices, nextPeriod, discountArg)
    if (!result.ok) return bad(result.error)
    listPriceCents = result.quote.listPriceCents
    discountAmountCents = result.quote.discountAmountCents
    amountDueCents = result.quote.amountDueCents
  }

  const changes: Record<string, unknown> = {}
  const patch: Partial<typeof subscriptions.$inferInsert> = { updatedAt: now }
  if (nextPlanId !== current.planId) { patch.planId = nextPlanId; changes.planId = { from: current.planId, to: nextPlanId } }
  if (nextPeriod !== current.period) { patch.period = nextPeriod; changes.period = { from: current.period, to: nextPeriod } }
  if (status !== current.status) { patch.status = status; changes.status = { from: current.status, to: status } }
  if (trialEndsAt?.getTime() !== current.trialEndsAt?.getTime()) { patch.trialEndsAt = trialEndsAt; changes.trialEndsAt = { from: current.trialEndsAt, to: trialEndsAt } }
  if (currentPeriodEnd?.getTime() !== current.currentPeriodEnd?.getTime()) { patch.currentPeriodEnd = currentPeriodEnd; changes.currentPeriodEnd = { from: current.currentPeriodEnd, to: currentPeriodEnd } }
  if (cancelAtPeriodEnd !== current.cancelAtPeriodEnd) { patch.cancelAtPeriodEnd = cancelAtPeriodEnd; changes.cancelAtPeriodEnd = cancelAtPeriodEnd }
  if (listPriceCents !== current.listPriceCents) patch.listPriceCents = listPriceCents
  if (discountAmountCents !== current.discountAmountCents) patch.discountAmountCents = discountAmountCents
  if (amountDueCents !== current.amountDueCents) patch.amountDueCents = amountDueCents
  if (effectiveDiscountId !== current.discountId) { patch.discountId = effectiveDiscountId; changes.discountId = { from: current.discountId, to: effectiveDiscountId } }

  if (Object.keys(changes).length === 0) return bad('No changes supplied')

  const updated = await db.update(subscriptions).set(patch).where(eq(subscriptions.id, current.id)).returning()

  await writeAuditLog({
    tenantId,
    actor: session.id,
    action: 'subscription.update',
    entity: 'subscription',
    entityId: current.id,
    meta: { changes },
  })

  return NextResponse.json({ success: true, data: updated[0] }, { status: 200 })
}
