// ── Billing backend: plans, subscriptions, discounts, payments ─────────────
// (SaaS back-office backend). Money columns follow this codebase's existing
// convention (db/schemas/finance.ts, lib/money.ts): every amount is an
// integer number of minor units (cents), always suffixed `_cents` — no
// exceptions, so this schema never introduces a second money representation
// for lib/money.ts's helpers to not know about.
//
// No real payment gateway exists anywhere in this codebase. The flow this
// schema backs is: a tenant submits a payment reference (mobile-money
// transaction id, bank slip number, etc.), a platform admin with
// `billing.manage` confirms or rejects it, and confirming is what actually
// activates/extends the subscription. See lib/billing/provider.ts for the
// `PaymentProvider` seam a real gateway slots into later.
import { pgTable, text, timestamp, integer, bigint, boolean, jsonb, index, uniqueIndex } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'

export type PlanPeriod = 'monthly' | 'quarterly' | 'annual'
export type PlanLimits = { maxFarms: number | null; maxUsers: number | null; maxUnits: number | null }
export type PlanPrices = Partial<Record<PlanPeriod, number>> // cents, per period

// A sellable (or hidden/legacy) plan. `code` is the stable machine key routes
// and the migration backfill use to find "the legacy plan" or "the
// smallholder plan" — never the DB id, which is only assigned at insert time.
//
// `isPublic` vs `isActive`: a plan can be active (usable, can be subscribed
// to or kept by an existing subscriber) without being public (offered on the
// pricing page) — that's exactly what the `legacy` "Founding farm" plan is:
// active for the tenants already on it, never shown to a new signup.
export const plans = pgTable('plans', {
  id: text('id').primaryKey(),
  code: text('code').notNull(),
  name: text('name').notNull(),
  tagline: text('tagline').notNull().default(''),
  description: text('description').notNull().default(''),
  features: jsonb('features').$type<string[]>().notNull().default([]),
  limits: jsonb('limits').$type<PlanLimits>().notNull().default({ maxFarms: null, maxUsers: null, maxUnits: null }),
  prices: jsonb('prices').$type<PlanPrices>().notNull().default({}),
  currency: text('currency').notNull().default('KSh'),
  trialDays: integer('trial_days').notNull().default(14),
  isPublic: boolean('is_public').notNull().default(true),
  isActive: boolean('is_active').notNull().default(true),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  uniqueIndex('idx_plans_code').on(t.code),
  index('idx_plans_public_active').on(t.isPublic, t.isActive),
])

export type SubscriptionStatus = 'trialing' | 'pending_payment' | 'active' | 'past_due' | 'cancelled' | 'expired'

// One row per subscription "cycle" for a tenant. A tenant can accumulate
// several rows over its lifetime (a cancelled subscription, later resubscribed
// on a different plan) — `isCurrent` marks the one that actually governs the
// tenant's access today; the rest are history, kept rather than overwritten
// so "what plan were they on in March" stays answerable. The partial unique
// index enforces "at most one current subscription per tenant" at the DB
// level, matching this schema's existing per-tenant-uniqueness convention
// (idx_farms_tenant_code etc).
//
// Status transitions that depend on wall-clock time (trialing -> past_due ->
// expired) are computed on READ by a pure function (lib/billing/access-state.ts)
// so a subscription's displayed status is never stale just because nothing
// wrote to the row today; app/api/cron/update-subscriptions additionally
// persists the transition once a day so admin list/filter-by-status queries
// (which run a plain WHERE, not the pure function) stay accurate too.
export const subscriptions = pgTable('subscriptions', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  planId: text('plan_id').notNull(),
  period: text('period').notNull(), // 'monthly' | 'quarterly' | 'annual'
  status: text('status').notNull(), // SubscriptionStatus
  trialEndsAt: timestamp('trial_ends_at'),
  currentPeriodStart: timestamp('current_period_start'),
  // Null = no end date (the legacy backfill's "Founding farm" grandfathering,
  // and any plan an admin deliberately makes open-ended).
  currentPeriodEnd: timestamp('current_period_end'),
  listPriceCents: bigint('list_price_cents', { mode: 'number' }).notNull().default(0),
  discountId: text('discount_id'),
  discountAmountCents: bigint('discount_amount_cents', { mode: 'number' }).notNull().default(0),
  amountDueCents: bigint('amount_due_cents', { mode: 'number' }).notNull().default(0),
  cancelAtPeriodEnd: boolean('cancel_at_period_end').notNull().default(false),
  isCurrent: boolean('is_current').notNull().default(true),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('idx_subscriptions_tenant').on(t.tenantId),
  index('idx_subscriptions_status').on(t.status),
  uniqueIndex('idx_subscriptions_tenant_current').on(t.tenantId).where(sql`${t.isCurrent} = true`),
])

export type DiscountKind = 'percent' | 'fixed'

// `code` is stored UPPERCASE-trimmed at write time (same normalize-at-write
// convention as users.email being lowercased — see lib/validation.ts) so a
// plain unique index gives case-insensitive uniqueness without a functional
// index.
//
// `appliesToPlans`/`appliesToPeriods`: NULL (not an empty array) means "all"
// — an empty array would mean "applies to nothing", a real but different
// state a caller could otherwise never express once a plan/period is later
// removed from an array that started non-empty.
export const discounts = pgTable('discounts', {
  id: text('id').primaryKey(),
  code: text('code').notNull(),
  kind: text('kind').notNull(), // 'percent' | 'fixed'
  // percent: 0-100 (whole points, e.g. 10 = 10%). fixed: minor units (cents).
  value: bigint('value', { mode: 'number' }).notNull(),
  appliesToPlans: text('applies_to_plans').array(),
  appliesToPeriods: text('applies_to_periods').array(),
  // NULL = any tenant may redeem it. Set = a targeted one-tenant offer.
  tenantId: text('tenant_id'),
  validFrom: timestamp('valid_from'),
  validUntil: timestamp('valid_until'),
  maxRedemptions: integer('max_redemptions'),
  redemptions: integer('redemptions').notNull().default(0),
  isActive: boolean('is_active').notNull().default(true),
  createdBy: text('created_by').notNull(),
  note: text('note').notNull().default(''),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  uniqueIndex('idx_discounts_code').on(t.code),
  index('idx_discounts_tenant').on(t.tenantId),
])

export type PaymentMethod = 'mobile_money' | 'bank' | 'card' | 'cash' | 'other'
export type PaymentStatus = 'pending' | 'confirmed' | 'rejected'

// A tenant-submitted, admin-reviewed payment claim — see this file's header
// for why there is no real gateway integration here.
export const payments = pgTable('payments', {
  id: text('id').primaryKey(),
  subscriptionId: text('subscription_id').notNull(),
  tenantId: text('tenant_id').notNull(),
  amountCents: bigint('amount_cents', { mode: 'number' }).notNull(),
  currency: text('currency').notNull().default('KSh'),
  method: text('method').notNull(), // PaymentMethod
  reference: text('reference').notNull().default(''),
  payerNote: text('payer_note').notNull().default(''),
  status: text('status').notNull().default('pending'), // PaymentStatus
  submittedBy: text('submitted_by').notNull(),
  reviewedBy: text('reviewed_by'),
  reviewedAt: timestamp('reviewed_at'),
  reviewNote: text('review_note').notNull().default(''),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('idx_payments_tenant').on(t.tenantId),
  index('idx_payments_subscription').on(t.subscriptionId),
  index('idx_payments_status').on(t.status),
])
