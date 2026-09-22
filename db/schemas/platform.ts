// ── Platform staff & capabilities (SaaS back-office backend) ────────────────
// `super_admin` stays the ONLY platform role value in `users.role` — every
// other part of the app already treats an unrecognized role as
// unauthenticated (see db/schemas/auth.ts's own comment on the UI role set),
// so adding a second platform role would be a much bigger blast radius than
// this feature needs. Instead, a super_admin's *capabilities* are layered on
// top via this table.
//
// Backward compatibility (the load-bearing rule): a super_admin user with NO
// row here has ALL capabilities. That is what keeps the existing founder
// account (created long before this table existed, or any admin nobody has
// gotten around to configuring) working exactly as it does today — see
// lib/platform-staff.ts's `resolveCapabilities`, and
// tests/platform-staff.test.ts's "no-row super_admin = all capabilities"
// case for the pure-function proof.
//
// `active: false` is how a staff member's access is revoked WITHOUT deleting
// the row — deleting it would fall back to "no row = all capabilities",
// which is the opposite of revoking someone's access. See
// app/api/admin/staff/[id]/route.ts's DELETE handler for why it never issues
// a real SQL DELETE against this table.
import { pgTable, text, boolean, timestamp, index } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { users } from './auth'

export const platformStaff = pgTable('platform_staff', {
  userId: text('user_id').primaryKey().references(() => users.id),
  title: text('title').notNull().default(''),
  // One of lib/platform-staff.ts's CAPABILITIES list, validated in the route
  // (same "loose text/array, validated in application code" convention this
  // codebase already uses for users.role/status).
  capabilities: text('capabilities').array().notNull().default(sql`'{}'::text[]`),
  active: boolean('active').notNull().default(true),
  createdBy: text('created_by').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('idx_platform_staff_active').on(t.active),
])

// Free-text admin notes on a tenant (admin tenant-overview feature). Not a
// single `notes` column on `tenants` — a note is an append-only, authored,
// timestamped remark ("called them about the overdue invoice on 3/2"), and a
// tenant can accumulate many of these over its lifetime; a single column
// would force every admin to edit the same blob and lose who-said-what-when.
export const tenantAdminNotes = pgTable('tenant_admin_notes', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  authorId: text('author_id').notNull(),
  note: text('note').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('idx_tenant_admin_notes_tenant').on(t.tenantId),
])
