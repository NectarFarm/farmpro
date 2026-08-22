// Onboarding-request queue (issue #251). A person with no account submits a
// public request (POST /api/onboard-requests); a super_admin reviews the
// queue (GET) and decides (PATCH). Approving provisions a real tenant via
// lib/tenant-provisioning.ts's shared transaction — see that file's header
// for why it exists instead of calling POST /api/admin/tenants directly (that
// route does not exist in this branch yet; confirmed by grep, issue #250
// epic notes).
//
// Column set matches components/farm/data.ts's OnboardRequest shape, which
// also carries address/lat/lng (issues #251/#252: RegisterScreen collects
// GPS + a reverse-geocoded address, and AdminOnboardingScreen's LocationEditor
// lets a super_admin set/correct them). All three are nullable — GPS is
// genuinely optional, so a request with no coordinates must still be valid.
import { pgTable, text, timestamp, index, doublePrecision } from 'drizzle-orm/pg-core'

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
  // Optional location detail (issue #252): the applicant's GPS pin and its
  // reverse-geocoded address, or coordinates a super_admin fills in later via
  // the admin LocationEditor. `location` above stays required/free-text
  // (e.g. "Nakuru, Kenya"); these are the precise, all-or-nothing pair.
  address: text('address'),
  latitude: doublePrecision('latitude'),
  longitude: doublePrecision('longitude'),
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
  // Applicant's consent to this request being submitted/processed. Recorded
  // server-side (never client-supplied) so it's provable, not just checked in
  // the browser. Nullable because rows that predate this column can't
  // retroactively acquire consent — every *new* row populates both on POST,
  // and PATCH never touches them (an admin can't grant/backdate consent on
  // the applicant's behalf).
  consentAt: timestamp('consent_at'),
  consentVersion: text('consent_version'),
}, (t) => [
  index('idx_onboard_requests_status').on(t.status),
])
