import { db } from '@/db'
import { rolePermissions } from '@/db/schemas'
import { and, eq } from 'drizzle-orm'
import { BYPASS_ROLES, DEFAULT_MATRIX, DEFAULT_APPROVAL, MODULES, type AccessLevel } from './permission-matrix'

// The module list, code-default access matrix, code-default approval matrix,
// and the BYPASS_ROLES set all now live in lib/permission-matrix.ts (a
// server-only-free module) so components/farm/worker.tsx — a client
// component — can read the exact same data instead of a second, driftable
// copy. Re-exported here so every existing server-side caller of these names
// keeps working unchanged.
export type { AccessLevel }
export { MODULES }

export async function getRoleAccess(tenantId: string, role: string, module: string): Promise<AccessLevel> {
  // Owner and super_admin bypass the matrix outright — an owner must never
  // be able to lock themselves out of their own farm (a stray DB row must
  // not change that), and super_admin has no tenant-scoped row to read in
  // the first place (see BYPASS_ROLES above).
  if (BYPASS_ROLES.has(role)) return 'edit'

  const rows = await db
    .select({ access: rolePermissions.access })
    .from(rolePermissions)
    .where(and(eq(rolePermissions.tenantId, tenantId), eq(rolePermissions.role, role), eq(rolePermissions.module, module)))
    .limit(1)
  // A configured DB row always wins over the code default — in EITHER
  // direction (granting edit a role lacks by default, or revoking edit a
  // role has by default) — that override is the whole point of the
  // Governance screen's config store.
  if (rows.length > 0) return rows[0].access as AccessLevel

  return DEFAULT_MATRIX[role]?.[module] ?? 'hidden'
}

export async function canEdit(tenantId: string, role: string, module: string): Promise<boolean> {
  return (await getRoleAccess(tenantId, role, module)) === 'edit'
}

export async function canView(tenantId: string, role: string, module: string): Promise<boolean> {
  const level = await getRoleAccess(tenantId, role, module)
  return level === 'view' || level === 'edit'
}

/**
 * The code default for (role, module), before any DB row is consulted.
 * Exported so it can be tested without a database — `needsApproval` itself
 * needs one, and the whole point of this map is what happens when the table
 * is EMPTY, which is the state a fresh tenant is in.
 */
export function defaultApprovalFor(role: string, module: string): boolean {
  if (BYPASS_ROLES.has(role)) return false
  return DEFAULT_APPROVAL[role]?.[module] ?? false
}

// ── Does this role's submission need signing off? ──────────────────────────
// `role_permissions.approvalRequired` has been configurable in the Governance
// screen since it was built, and enforced nowhere — the same gap `access` had
// before the role-permission-enforcement task closed it. This is the read
// that makes it mean something: a worker's mortality entry waits for approval
// before it changes the batch's headcount.
//
// Owner and super_admin bypass, for the same reason they bypass `access`:
// an owner cannot meaningfully require their own approval, and a config row
// that made them queue behind themselves would deadlock their own farm.
export async function needsApproval(tenantId: string, role: string, module: string): Promise<boolean> {
  if (BYPASS_ROLES.has(role)) return false
  const rows = await db
    .select({ approvalRequired: rolePermissions.approvalRequired })
    .from(rolePermissions)
    .where(and(
      eq(rolePermissions.tenantId, tenantId),
      eq(rolePermissions.role, role),
      eq(rolePermissions.module, module),
    ))
    .limit(1)
  // A configured row wins in either direction — including the one that turns
  // an approval requirement OFF. PUT /api/role-permissions writes a row for
  // every module the saved grid mentions, so an owner who unticks the box
  // does produce a row with `false`, and it is respected here rather than
  // being overridden back to true by the default below.
  if (rows.length > 0) return rows[0].approvalRequired

  return defaultApprovalFor(role, module)
}
