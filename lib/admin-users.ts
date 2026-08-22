// ── Shared pieces for the admin user-management routes ─────────────────────
// Kept out of any single route file so GET (list), GET (one) and PATCH all
// select the exact same safe column set and validate role/status against the
// exact same real value sets — a second, slightly-different copy in each
// route is how a field silently starts leaking a secret column.
import 'server-only'
import { users } from '@/db/schemas'

// Never widen this to `users.*` / a bare `select()` — passwordHash,
// passwordSalt, pinHash and pinPrefilter must never leave this process.
export const SAFE_USER_COLUMNS = {
  id: users.id,
  tenantId: users.tenantId,
  name: users.name,
  email: users.email,
  phone: users.phone,
  role: users.role,
  status: users.status,
  createdAt: users.createdAt,
}

// The UI role set mirrors the backend exactly (components/farm/navigation.tsx's
// `Role` type / issue #219) — kept as a plain literal list here rather than
// importing that 'use client' module from server route code.
export const VALID_ROLES = ['owner', 'manager', 'worker', 'vet', 'auditor', 'super_admin'] as const
export type AdminRole = (typeof VALID_ROLES)[number]

// The real status values this codebase already uses (grepped: tests/admin.test.ts,
// tests/auth.test.ts, lib/auth.ts, app/api/auth/login/route.ts) — 'ACTIVE' is the
// default and the only value getSessionUser()/login accept as usable; 'SUSPENDED'
// is the one other real value seeded/tested against. Not inventing a third.
export const VALID_STATUSES = ['ACTIVE', 'SUSPENDED'] as const
export type AdminUserStatus = (typeof VALID_STATUSES)[number]

// Strips the credential columns off a full `users` row — used after an
// UPDATE ... RETURNING (which returns the whole row) instead of relying on
// `.returning()` accepting a column-selection object, so the safety guarantee
// doesn't depend on that drizzle call shape actually being supported.
export function toSafeUser(u: typeof users.$inferSelect) {
  return {
    id: u.id,
    tenantId: u.tenantId,
    name: u.name,
    email: u.email,
    phone: u.phone,
    role: u.role,
    status: u.status,
    createdAt: u.createdAt,
  }
}

// Unique-violation detection lives in lib/db-errors.ts: drizzle wraps the
// driver error, so the SQLSTATE sits on `.cause`, not on the error itself.
// Re-exported here so existing importers of this module keep working.
export { isUniqueViolation } from './db-errors'
