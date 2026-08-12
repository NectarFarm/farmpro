// IFMS auth schema (issue #221). Real users + sessions powering the shell's
// session bootstrap (GET /api/auth/session). The UI role set mirrors the backend
// roles exactly — owner | manager | worker | vet | auditor | super_admin
// (issue #219): platform roles (super_admin) have no tenant; farm-scoped roles do.
import { pgTable, text, timestamp, boolean, integer, index, uniqueIndex } from 'drizzle-orm/pg-core'

// A tenant is the account/billing scope. `active` gates logins for every
// tenant-scoped role (issue #223): workers and owners at a suspended tenant
// must not receive a session.
export const tenants = pgTable('tenants', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at').defaultNow(),
})

export const users = pgTable('users', {
  id: text('id').primaryKey(),
  // Farm-scoped roles carry their tenant; platform roles (super_admin) are null.
  // Logical reference to tenants.id (no DB FK): an ALTER-added FK would fail on
  // pre-existing rows whose tenant is only seeded after migrate, and gating is a
  // lookup (isTenantActive), not a join. Seed inserts tenants before users.
  tenantId: text('tenant_id'),
  name: text('name').notNull(),
  email: text('email').notNull(),
  role: text('role').notNull(),
  passwordHash: text('password_hash').notNull(),
  passwordSalt: text('password_salt').notNull(),
  // Workers sign in with a 4-digit PIN (hashed with the same scrypt scheme).
  pinHash: text('pin_hash'),
  // O(1) PIN lookup key: HMAC-SHA256(pepper, pin) — see lib/auth.ts pinPrefilter.
  // Indexed so PIN login narrows to a single candidate row before the scrypt
  // verify, instead of scanning every worker row per attempt.
  pinPrefilter: text('pin_prefilter'),
  status: text('status').notNull().default('ACTIVE'),
  createdAt: timestamp('created_at').defaultNow(),
}, (t) => [
  index('idx_users_tenant').on(t.tenantId),
  uniqueIndex('idx_users_email').on(t.email),
  index('idx_users_pin_prefilter').on(t.pinPrefilter),
])

export const sessions = pgTable('sessions', {
  token: text('token').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id),
  createdAt: timestamp('created_at').defaultNow(),
  expiresAt: timestamp('expires_at').notNull(),
}, (t) => [
  index('idx_sessions_user').on(t.userId),
])

// Login throttling / lockout (issue #221 review): per-identifier failed-attempt
// counter with escalating lockout (email:x / pin:x). DB-backed so it survives
// restarts and isolates. Checked before any credential work; cleared on success.
export const loginThrottle = pgTable('login_throttle', {
  identifier: text('identifier').primaryKey(),
  failedCount: integer('failed_count').notNull().default(0),
  lockedUntil: timestamp('locked_until'),
  updatedAt: timestamp('updated_at').defaultNow(),
})
