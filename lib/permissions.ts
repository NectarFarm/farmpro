// ── Role-permission enforcement (follow-on to issue #243 task 4) ────────────
// The `role_permissions` table was built as a per-tenant config store in
// issue #243, but no other route enforced it — the matrix persisted and
// nothing checked it. This module is that enforcement layer: a tiny helper
// write routes call before performing an owner/manager-scoped mutation, so a
// role the owner set to "View only" on a module is actually blocked from
// editing it, and "hidden" blocks reads too.
//
// Rules (deliberately simple, matching how the UI's Role Builder behaves):
//   - The owner is never restricted (they configure the matrix; locking
//     them out of their own tenant is a footgun, and the Role Builder is
//     already owner-only).
//   - Everyone else (manager, vet, auditor, worker) is checked against the
//     tenant's matrix for their role.
//   - No matrix row for (role, module) = NOT restricted. The matrix is a
//     per-role config store; a role the owner never configured keeps the
//     historical behavior (full access). Only explicitly-set rows restrict.
//     (This also keeps every existing seeded tenant working unchanged until
//     an owner actually saves a Role Builder change.)
//
// This is intentionally NOT retrofitted onto every read route — reads stay
// tenant-scoped as they are today. It gates the write routes where an
// "edit" permission actually means something: task/batch/employee mutations,
// inventory adjustments, and finance entries. See each call site.

import { db } from '@/db'
import { rolePermissions } from '@/db/schemas'
import { and, eq } from 'drizzle-orm'

export type AccessLevel = 'hidden' | 'view' | 'edit'

const OWNER = 'owner'

// Resolves the access level a (role, module) pair has in `tenantId`'s matrix.
// Returns the stored value, or 'edit' when no row exists (unconfigured role =
// unrestricted — see the header comment).
export async function getRoleAccess(tenantId: string, role: string, module: string): Promise<AccessLevel> {
  if (role === OWNER) return 'edit'
  const rows = await db
    .select({ access: rolePermissions.access })
    .from(rolePermissions)
    .where(and(eq(rolePermissions.tenantId, tenantId), eq(rolePermissions.role, role), eq(rolePermissions.module, module)))
    .limit(1)
  return (rows[0]?.access as AccessLevel) ?? 'edit'
}

// True when the role may perform a write on `module` (access = 'edit').
export async function canEdit(tenantId: string, role: string, module: string): Promise<boolean> {
  return (await getRoleAccess(tenantId, role, module)) === 'edit'
}

// True when the role may at least view `module` (access = 'view' or 'edit').
export async function canView(tenantId: string, role: string, module: string): Promise<boolean> {
  const level = await getRoleAccess(tenantId, role, module)
  return level === 'view' || level === 'edit'
}

// Module keys the Role Builder exposes (components/farm/governance.tsx's
// FEATURE_GROUPS) — kept here so route call sites share one spelling instead
// of duplicating strings.
export const MODULES = {
  feeding: 'feeding',
  eggCollection: 'egg-collection',
  milking: 'milking',
  mortality: 'mortality',
  health: 'health',
  physicalCount: 'physical-count',
  harvest: 'harvest',
  tasks: 'tasks',
  inventory: 'inventory',
  batches: 'batches',
  finance: 'finance',
  payroll: 'payroll',
  governance: 'governance',
  deleteRecord: 'delete-record',
} as const
