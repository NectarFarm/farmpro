// ── Subscription access state: status-over-time + needsPlan (pure) ─────────
// (SaaS back-office backend). A subscription row's `status` column is only
// updated by an explicit write (subscribe, admin PATCH, payment confirm/
// reject, cancel) — nothing rewrites it just because a clock ticked past
// `trialEndsAt` or `currentPeriodEnd`. This module is what makes the
// DISPLAYED status honest anyway: every reader (GET /api/auth/session, GET
// /api/billing/subscription, GET /api/admin/subscriptions) runs the stored
// row through `computeAccessState` before showing it, so "trial ended
// yesterday" is reflected the moment anyone asks, not whenever a cron
// happens to run next. app/api/cron/update-subscriptions additionally
// PERSISTS the transition once a day, purely so admin filter-by-status
// queries (a plain SQL WHERE, which cannot run this function) stay close to
// accurate — the pure computation here is still the source of truth for
// anything read through the app.
import type { SubscriptionStatus } from '@/db/schemas'

// 7 days: "trial ended without a confirmed payment" and "a payment lapsed"
// both get the same breathing room before access is actually cut off — the
// task's own instruction ("give past_due a 7-day grace before needsPlan").
export const PAST_DUE_GRACE_DAYS = 7
const GRACE_MS = PAST_DUE_GRACE_DAYS * 24 * 60 * 60 * 1000

export interface SubscriptionSnapshot {
  status: SubscriptionStatus
  trialEndsAt: Date | null
  currentPeriodEnd: Date | null
  cancelAtPeriodEnd: boolean
}

export type EffectiveStatus = SubscriptionStatus | 'none'

export interface AccessState {
  /** The status AFTER time-based transitions are applied — never a raw,
   * possibly-stale DB value. 'none' means no subscription row exists at all. */
  status: EffectiveStatus
  needsPlan: boolean
}

/**
 * Recomputes `status` for "right now", applying exactly the transitions the
 * task specifies:
 *   trialing      -> past_due  (once trialEndsAt has passed)
 *   active        -> past_due  (once currentPeriodEnd has passed, and the
 *                     tenant did NOT ask to cancel)
 *   active        -> cancelled (once currentPeriodEnd has passed AND
 *                     cancelAtPeriodEnd was set — a deliberate non-renewal,
 *                     not a payment failure, so no grace period applies)
 *   past_due      -> expired   (once PAST_DUE_GRACE_DAYS past whichever
 *                     boundary (trial end or period end) pushed it into
 *                     past_due has elapsed)
 * `pending_payment`, `cancelled` and `expired` are terminal here — nothing
 * clocks them forward on its own (a cancelled/expired subscription only
 * changes via a new subscribe/admin action).
 */
export function effectiveStatus(sub: SubscriptionSnapshot, now: Date): SubscriptionStatus {
  let status = sub.status
  let graceStart: Date | null = null

  if (status === 'trialing' && sub.trialEndsAt && now > sub.trialEndsAt) {
    status = 'past_due'
    graceStart = sub.trialEndsAt
  }

  if (status === 'active' && sub.currentPeriodEnd && now > sub.currentPeriodEnd) {
    if (sub.cancelAtPeriodEnd) {
      status = 'cancelled'
    } else {
      status = 'past_due'
      graceStart = sub.currentPeriodEnd
    }
  }

  if (status === 'past_due') {
    const start = graceStart ?? sub.currentPeriodEnd ?? sub.trialEndsAt
    if (start && now.getTime() - start.getTime() > GRACE_MS) {
      status = 'expired'
    }
  }

  return status
}

/**
 * The full access decision GET /api/auth/session's `subscription.needsPlan`
 * is built from: no subscription, a subscription that has genuinely expired
 * or been cancelled (past its period end), or one still awaiting its first
 * payment, all mean "route to plan selection before the dashboard". A
 * `past_due` subscription within its grace window is deliberately NOT
 * needsPlan — the whole point of a grace period is uninterrupted access
 * while it lasts.
 */
export function computeAccessState(sub: SubscriptionSnapshot | null, now: Date): AccessState {
  if (!sub) return { status: 'none', needsPlan: true }

  const status = effectiveStatus(sub, now)
  const needsPlan = status === 'expired' || status === 'cancelled' || status === 'pending_payment'
  return { status, needsPlan }
}

export interface CancellationResult {
  status: SubscriptionStatus
  cancelAtPeriodEnd: boolean
}

/**
 * What POST /api/billing/cancel should write. A subscription still mid-cycle
 * (active with a real currentPeriodEnd) gets a SOFT cancel — access continues
 * until the period runs out, `computeAccessState` handles the eventual
 * transition to 'cancelled' on its own. Anything with no period to run out
 * (trialing, pending_payment — never billed at all — or an open-ended
 * subscription with no currentPeriodEnd, e.g. the legacy backfill) is
 * cancelled immediately: there is nothing left to "let expire".
 */
export function computeCancellation(sub: SubscriptionSnapshot): CancellationResult {
  if (sub.status === 'active' && sub.currentPeriodEnd) {
    return { status: 'active', cancelAtPeriodEnd: true }
  }
  return { status: 'cancelled', cancelAtPeriodEnd: false }
}
