// ── What a tenant actually farms (enterprise scoping) ──────────────────────
// A registering farmer picks their enterprises on step 3 of the sign-up wizard
// ("Broilers", "Layers", "Maize"), it is validated, and it is stored on
// `onboard_requests.enterprises`. And then it was thrown away: approving a
// request called lib/tenant-provisioning.ts, which never received the field at
// all, so a broiler farmer's brand-new account offered them dairy, goats, fish
// and every crop in the registry, and POST /api/batches would happily create a
// dairy batch for them. The selection was a form field that changed nothing.
//
// These two tables close that. `tenant_enterprises` is the tenant's real set,
// written at provisioning from the approved request; `enterprise_requests` is
// the only way to widen it — the farmer asks, a super_admin grants. That
// direction is deliberate: enterprise scope decides which forms, batch types,
// report shapes and code prefixes a tenant gets, so letting an owner
// self-serve their way into an enterprise means an account can quietly grow
// past whatever was approved.
//
// EMPTY SET MEANS UNRESTRICTED. Read lib/enterprises.ts before changing that:
// tenants provisioned before this existed have no rows, and the 0035 migration
// backfills them from the enterprises their own batches already use. A tenant
// with genuinely zero batches and zero rows stays unrestricted rather than
// being locked out of creating its first batch — being wrong in that direction
// is recoverable, the other direction bricks the account.
import { sql } from 'drizzle-orm'
import { pgTable, text, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core'

export const tenantEnterprises = pgTable('tenant_enterprises', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  // Same free-form key space as `onboard_requests.enterprises` and
  // `batches.enterprise` ("broiler", "layer", "dairy_cow") — components/farm/
  // data.ts's ENTERPRISE_REGISTRY is the display/config lookup for known keys,
  // and lib/codes.ts already falls back gracefully for an unknown one. This
  // column deliberately does not enumerate them: a new enterprise type should
  // not need a migration.
  enterprise: text('enterprise').notNull(),
  // 'onboarding'   — came from the approved application (the farmer's own pick)
  // 'admin-grant'  — a super_admin granted it later, via an enterprise request
  // 'backfill'     — inferred by migration 0035 from batches that already existed
  source: text('source').notNull().default('onboarding'),
  // Null for 'onboarding' and 'backfill' — nobody decided those individually.
  grantedByUserId: text('granted_by_user_id'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('idx_tenant_enterprises_tenant').on(t.tenantId),
  // One row per enterprise per tenant. This is what makes granting idempotent:
  // a second grant of the same enterprise conflicts instead of silently
  // duplicating, so the set can never disagree with itself.
  uniqueIndex('idx_tenant_enterprises_tenant_enterprise').on(t.tenantId, t.enterprise),
])

export const enterpriseRequests = pgTable('enterprise_requests', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  enterprise: text('enterprise').notNull(),
  // The owner/manager who asked. Kept even after a decision so the queue can
  // say who wants it, the same way password_reset_requests names its requester.
  requestedByUserId: text('requested_by_user_id').notNull(),
  // Free text from the requester ("we're adding 200 layers in March"). Gives
  // the reviewing admin something to decide on besides a bare enterprise key.
  reason: text('reason').notNull().default(''),
  // pending | approved | rejected
  status: text('status').notNull().default('pending'),
  // What the admin wrote back — shown to the requester on a rejection, so a
  // 'no' arrives with a reason instead of just disappearing from the queue.
  decisionNote: text('decision_note').notNull().default(''),
  decidedByUserId: text('decided_by_user_id'),
  decidedAt: timestamp('decided_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('idx_enterprise_requests_tenant').on(t.tenantId),
  index('idx_enterprise_requests_status').on(t.status),
  // Only ONE pending request per tenant+enterprise. Without this, a farmer
  // tapping "request" twice puts two identical rows in the admin queue and
  // the second approve hits the unique index above as a hard error. Postgres
  // partial index: resolved rows don't participate, so the same enterprise can
  // be re-requested after a rejection.
  uniqueIndex('idx_enterprise_requests_one_pending')
    .on(t.tenantId, t.enterprise)
    .where(sql`status = 'pending'`),
])
