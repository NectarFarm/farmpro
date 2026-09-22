// ── Subscription DB helpers (SaaS back-office backend) ──────────────────────
// Shared by the tenant billing routes, the admin billing routes, and GET
// /api/auth/session's subscription summary — one place that knows how to
// read "the tenant's current subscription" and how usage is counted against
// plan limits, so those three call sites can't drift apart on either.
import 'server-only'
import { randomUUID } from 'node:crypto'
import { and, count, eq } from 'drizzle-orm'
import { db } from '@/db'
import { discounts, farms, plans, productionUnits, subscriptions, users } from '@/db/schemas'
import { addPeriod } from './period'
import type { DiscountLike, PlanPeriod } from './pricing'
import type { SubscriptionSnapshot } from './access-state'

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]
type DbOrTx = typeof db | Tx

export interface SubscriptionWithPlan {
  id: string
  tenantId: string
  planId: string
  period: string
  status: string
  trialEndsAt: Date | null
  currentPeriodStart: Date | null
  currentPeriodEnd: Date | null
  listPriceCents: number
  discountId: string | null
  discountAmountCents: number
  amountDueCents: number
  cancelAtPeriodEnd: boolean
  createdAt: Date
  updatedAt: Date
  plan: typeof plans.$inferSelect
}

export async function getCurrentSubscription(tenantId: string, executor: DbOrTx = db): Promise<SubscriptionWithPlan | null> {
  const rows = await executor
    .select({ sub: subscriptions, plan: plans })
    .from(subscriptions)
    .innerJoin(plans, eq(plans.id, subscriptions.planId))
    .where(and(eq(subscriptions.tenantId, tenantId), eq(subscriptions.isCurrent, true)))
    .limit(1)
  const row = rows[0]
  if (!row) return null
  return { ...row.sub, plan: row.plan }
}

export function toSnapshot(sub: Pick<SubscriptionWithPlan, 'status' | 'trialEndsAt' | 'currentPeriodEnd' | 'cancelAtPeriodEnd'>): SubscriptionSnapshot {
  return {
    status: sub.status as SubscriptionSnapshot['status'],
    trialEndsAt: sub.trialEndsAt,
    currentPeriodEnd: sub.currentPeriodEnd,
    cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
  }
}

export interface UsageCounts {
  farms: number
  users: number
  units: number
}

// Counts against the same tables the rest of the app already treats as the
// source of truth for "how many farms/users/units does this tenant have" —
// no separate usage-tracking table, so usage can never drift from reality.
// `users` counts ACTIVE tenant users only (mirrors GET /api/admin/tenants'
// own userCount convention); farms/units count every row regardless of
// status — an archived farm/unit still occupies a slot until deleted.
export async function getUsage(tenantId: string): Promise<UsageCounts> {
  const [[farmRow], [userRow], [unitRow]] = await Promise.all([
    db.select({ n: count() }).from(farms).where(eq(farms.tenantId, tenantId)),
    db.select({ n: count() }).from(users).where(and(eq(users.tenantId, tenantId), eq(users.status, 'ACTIVE'))),
    db.select({ n: count() }).from(productionUnits).where(eq(productionUnits.tenantId, tenantId)),
  ])
  return { farms: farmRow.n, users: userRow.n, units: unitRow.n }
}

// Case-insensitive lookup — discounts.code is stored uppercase-trimmed at
// write time (see db/schemas/billing.ts), so normalizing the same way here
// is what makes a plain unique index give case-insensitive matching.
//
// Returns the raw row (drizzle types `kind`/etc as plain `string`, since the
// column is loosely-typed text, validated at write time — same convention as
// users.role/status). Callers that hand it to lib/billing/pricing.ts's
// DiscountLike-typed functions do `discountRowToDiscountLike` below, which
// is where that narrowing actually happens.
export async function findDiscountByCode(code: string): Promise<typeof discounts.$inferSelect | null> {
  const normalized = code.trim().toUpperCase()
  if (!normalized) return null
  const rows = await db.select().from(discounts).where(eq(discounts.code, normalized)).limit(1)
  return rows[0] ?? null
}

/** Narrows a raw `discounts` row into the shape lib/billing/pricing.ts expects. */
export function discountRowToDiscountLike(row: typeof discounts.$inferSelect): DiscountLike {
  return {
    kind: row.kind === 'fixed' ? 'fixed' : 'percent',
    value: row.value,
    appliesToPlans: row.appliesToPlans,
    appliesToPeriods: row.appliesToPeriods,
    tenantId: row.tenantId,
    validFrom: row.validFrom,
    validUntil: row.validUntil,
    maxRedemptions: row.maxRedemptions,
    redemptions: row.redemptions,
    isActive: row.isActive,
  }
}

// Marks whatever row is currently `isCurrent` for this tenant as no longer
// current — the partial unique index (idx_subscriptions_tenant_current)
// means a new current row cannot be inserted until this runs, so callers
// always do this immediately before inserting the replacement, in the same
// transaction.
export async function supersedeCurrentSubscription(tx: Tx, tenantId: string): Promise<void> {
  await tx
    .update(subscriptions)
    .set({ isCurrent: false, updatedAt: new Date() })
    .where(and(eq(subscriptions.tenantId, tenantId), eq(subscriptions.isCurrent, true)))
}

export interface NewSubscriptionInput {
  tenantId: string
  planId: string
  period: string
  status: string
  trialEndsAt: Date | null
  currentPeriodStart: Date | null
  currentPeriodEnd: Date | null
  listPriceCents: number
  discountId: string | null
  discountAmountCents: number
  amountDueCents: number
  cancelAtPeriodEnd?: boolean
}

export async function insertCurrentSubscription(tx: Tx, input: NewSubscriptionInput): Promise<string> {
  const id = randomUUID()
  await tx.insert(subscriptions).values({
    id,
    tenantId: input.tenantId,
    planId: input.planId,
    period: input.period,
    status: input.status,
    trialEndsAt: input.trialEndsAt,
    currentPeriodStart: input.currentPeriodStart,
    currentPeriodEnd: input.currentPeriodEnd,
    listPriceCents: input.listPriceCents,
    discountId: input.discountId,
    discountAmountCents: input.discountAmountCents,
    amountDueCents: input.amountDueCents,
    cancelAtPeriodEnd: input.cancelAtPeriodEnd ?? false,
    isCurrent: true,
  })
  return id
}

// ── Confirming a payment activates/extends the subscription ────────────────
// "confirm -> subscription active, period advanced from max(now, current
// period end)" (task spec, verbatim). Shared by POST
// /api/admin/payments/[id]/confirm (the only caller today) and available to
// a future PaymentProvider that can confirm synchronously, so both paths
// advance a period identically rather than two copies of this maths
// drifting apart.
export async function advanceSubscriptionOnPayment(tx: Tx, subscriptionId: string, now = new Date()): Promise<void> {
  const rows = await tx.select().from(subscriptions).where(eq(subscriptions.id, subscriptionId)).limit(1)
  const sub = rows[0]
  if (!sub) return

  const base = sub.currentPeriodEnd && sub.currentPeriodEnd > now ? sub.currentPeriodEnd : now
  const newPeriodEnd = addPeriod(base, sub.period as PlanPeriod)

  await tx
    .update(subscriptions)
    .set({
      status: 'active',
      currentPeriodStart: base,
      currentPeriodEnd: newPeriodEnd,
      amountDueCents: 0,
      updatedAt: now,
    })
    .where(eq(subscriptions.id, subscriptionId))
}
