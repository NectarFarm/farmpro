// IFMS auth schema (issue #221). Real users + sessions powering the shell's
// session bootstrap (GET /api/auth/session). The UI role set mirrors the backend
// roles exactly — owner | manager | worker | vet | auditor | super_admin
// (issue #219): platform roles (super_admin) have no tenant; farm-scoped roles do.
import { pgTable, text, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core'

export const users = pgTable('users', {
  id: text('id').primaryKey(),
  // Farm-scoped roles carry their tenant; platform roles (super_admin) are null.
  tenantId: text('tenant_id'),
  name: text('name').notNull(),
  email: text('email').notNull(),
  role: text('role').notNull(),
  passwordHash: text('password_hash').notNull(),
  passwordSalt: text('password_salt').notNull(),
  // Workers sign in with a 4-digit PIN (hashed with the same scrypt scheme).
  pinHash: text('pin_hash'),
  status: text('status').notNull().default('ACTIVE'),
  createdAt: timestamp('created_at').defaultNow(),
}, (t) => [
  index('idx_users_tenant').on(t.tenantId),
  uniqueIndex('idx_users_email').on(t.email),
])

export const sessions = pgTable('sessions', {
  token: text('token').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id),
  createdAt: timestamp('created_at').defaultNow(),
  expiresAt: timestamp('expires_at').notNull(),
}, (t) => [
  index('idx_sessions_user').on(t.userId),
])
