// Onboarding-request queue (issue #251). A person with no account submits a
// public request (POST /api/onboard-requests); a super_admin reviews the
// queue (GET) and decides (PATCH). Approving provisions a real tenant via
// lib/tenant-provisioning.ts's shared transaction — see that file's header
// for why it exists instead of calling POST /api/admin/tenants directly (that
// route does not exist in this branch yet; confirmed by grep, issue #250
// epic notes).
//
// Column set matches components/farm/data.ts's OnboardRequest shape exactly
// (farmerName, email, phone, farmName, location, enterprises, status, notes,
// requestedAt) — the mock UI this backend is replacing.
import { pgTable, text, timestamp, index } from 'drizzle-orm/pg-core'

export const onboardRequests = pgTable('onboard_requests', {
  id: text('id').primaryKey(),
  farmerName: text('farmer_name').notNull(),
  email: text('email').notNull(),
  phone: text('phone').notNull(),
  farmName: text('farm_name').notNull(),
  location: text('location').notNull(),
  // Enterprise keys the applicant selected (e.g. "layer", "dairy_cow") — free-form
  // strings, validated against a fixed list client-side; this table just stores
  // whatever the applicant sent.
  enterprises: text('enterprises').array().notNull().default([]),
  // pending | approved | rejected | info-needed (components/farm/data.ts).
  // Not a DB enum: the same "loose text, validated in the route" choice this
  // codebase already makes for users.role / users.status (db/schemas/auth.ts).
  status: text('status').notNull().default('pending'),
  notes: text('notes'),
  requestedAt: timestamp('requested_at').defaultNow().notNull(),
  // Set once approved — the tenant this request provisioned. Lets the admin
  // queue (and tests) confirm a request really produced a tenant, and stops a
  // second PATCH ...approve from provisioning twice.
  tenantId: text('tenant_id'),
}, (t) => [
  index('idx_onboard_requests_status').on(t.status),
])
