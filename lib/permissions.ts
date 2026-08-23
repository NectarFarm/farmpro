import { db } from '@/db'
import { rolePermissions } from '@/db/schemas'
import { and, eq } from 'drizzle-orm'

export type AccessLevel = 'hidden' | 'view' | 'edit'

const OWNER = 'owner'

// super_admin is a platform role with no tenant of its own (db/schemas/auth.ts
// — `tenantId: null`) — it only ever touches a tenant's data when a route
// deliberately opts in via `explicitTenantId` (lib/api-auth.ts), the same
// audited-by-the-route-author decision that already governs its cross-tenant
// reach elsewhere (admin routes, impersonation, cross-tenant /api/settings —
// tests/role-screens.test.ts's "super_admin: cross-tenant settings access").
// `role_permissions` is a per-TENANT config store (one matrix per tenant,
// edited by that tenant's own owner) — it has no row space for a role that
// belongs to no tenant, and a tenant owner configuring their own matrix has
// no way to reach in and restrict platform support staff anyway. So
// super_admin bypasses the matrix the same way `owner` does, deliberately,
// rather than falling through to a module it happens not to have a row for.
const BYPASS_ROLES = new Set([OWNER, 'super_admin'])

// ── Code-defined defaults, overridden by a DB row when one exists ──────────
// Before this, `getRoleAccess` ended `?? 'edit'` — with an empty
// `role_permissions` table (true in production today: 0 rows) every role
// resolved to `edit` on every module, which makes the whole matrix
// decorative. Fail-closed instead (defaulting an unknown role/module
// combination to 'hidden') would lock every tenant out of everything on day
// one, since the table really is empty. This grid is the middle path: a
// sensible per-role default that a tenant's own owner can still override in
// either direction via PUT /api/role-permissions (checked first, in
// getRoleAccess below — a DB row always wins over the default it's replacing).
//
// Grid rationale (module list: lib/permissions.ts's own MODULES):
//   - manager: edit on every day-to-day OPERATIONAL module, plus the
//     governance approve/reject decision (matches the hardcoded
//     owner/manager gate POST /api/approvals/[id]/approve|reject used
//     before this task, so replacing that hardcode with this matrix changes
//     nothing by default). NOT edit on the two money modules — payroll (the
//     one explicit "must not" the task brief calls out) and finance
//     (recording a sale/purchase is a financial commitment, not a day-to-day
//     operational record; kept owner-controlled by default, same as
//     payroll) — view on both, so a manager still sees the numbers.
//     tests/role-permission-enforcement.test.ts's "manager refused a
//     payroll/finance write" is this line, verified for real.
//   - worker: edit only on the recording modules the Worker Home screen
//     actually submits (feeding/mortality/egg-collection/milking/
//     physical-count), plus `tasks` — tests/worker-tasks-today.test.ts's
//     worker session both creates and PATCHes (marks done) its own tasks,
//     and tests/tasks-governance.test.ts's worker session PATCHes a task to
//     DONE too, so `tasks` is real, load-bearing worker behaviour today, not
//     an assumption. No finance/payroll/governance edit; batches/inventory
//     are view-only (a worker reads stock/batch context but doesn't manage
//     either).
//   - vet: edit on health + mortality (tests/role-screens.test.ts's vet
//     session POSTs a mortality record and expects 201) plus tasks (their
//     own health-round tasks); everything else view-or-hidden, no finance/
//     payroll — matches the task brief exactly.
//   - auditor: view at most, edit nowhere — this role is read-only
//     elsewhere already (REPORT_VIEWER_ROLES in lib/reports.ts includes it
//     for read access; POST /api/records's role allowlist excludes it
//     entirely). This grid agrees: 'view' on every module, never 'edit'.
const DEFAULT_MATRIX: Record<string, Partial<Record<string, AccessLevel>>> = {
  manager: {
    feeding: 'edit', 'egg-collection': 'edit', milking: 'edit', mortality: 'edit',
    health: 'view', 'physical-count': 'edit', harvest: 'edit', tasks: 'edit',
    inventory: 'edit', batches: 'edit', governance: 'edit', 'delete-record': 'edit',
    finance: 'view', payroll: 'view',
  },
  worker: {
    feeding: 'edit', 'egg-collection': 'edit', milking: 'edit', mortality: 'edit',
    'physical-count': 'edit', tasks: 'edit',
    health: 'hidden', harvest: 'view', inventory: 'view', batches: 'view',
    finance: 'hidden', payroll: 'hidden', governance: 'hidden', 'delete-record': 'hidden',
  },
  vet: {
    health: 'edit', mortality: 'edit', tasks: 'edit',
    feeding: 'view', 'physical-count': 'view', inventory: 'view', batches: 'view',
    'egg-collection': 'hidden', milking: 'hidden', harvest: 'hidden',
    finance: 'hidden', payroll: 'hidden', governance: 'hidden', 'delete-record': 'hidden',
  },
  auditor: {
    feeding: 'view', 'egg-collection': 'view', milking: 'view', mortality: 'view',
    health: 'view', 'physical-count': 'view', harvest: 'view', tasks: 'view',
    inventory: 'view', batches: 'view', finance: 'view', payroll: 'view',
    governance: 'view', 'delete-record': 'view',
  },
}

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

export const MODULES = {
  feeding: 'feeding', eggCollection: 'egg-collection', milking: 'milking', mortality: 'mortality',
  health: 'health', physicalCount: 'physical-count', harvest: 'harvest', tasks: 'tasks',
  inventory: 'inventory', batches: 'batches', finance: 'finance', payroll: 'payroll',
  governance: 'governance', deleteRecord: 'delete-record',
} as const

// ── Does this role's submission need signing off? ──────────────────────────
// `role_permissions.approvalRequired` has been configurable in the Governance
// screen since it was built, and enforced nowhere — the same gap `access` had
// before the role-permission-enforcement task closed it. This is the read
// that makes it mean something: a worker's mortality entry can be set to wait
// for approval before it changes the batch's headcount.
//
// Owner and super_admin bypass, for the same reason they bypass `access`:
// an owner cannot meaningfully require their own approval, and a config row
// that made them queue behind themselves would deadlock their own farm.
export async function needsApproval(tenantId: string, role: string, module: string): Promise<boolean> {
  if (role === 'owner' || role === 'super_admin') return false
  const rows = await db
    .select({ approvalRequired: rolePermissions.approvalRequired })
    .from(rolePermissions)
    .where(and(
      eq(rolePermissions.tenantId, tenantId),
      eq(rolePermissions.role, role),
      eq(rolePermissions.module, module),
    ))
    .limit(1)
  return rows[0]?.approvalRequired ?? false
}
