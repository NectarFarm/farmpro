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

// ── Code-defined approval defaults, overridden by a DB row ─────────────────
// The asymmetry this fixes: `getRoleAccess` above has a code default
// (DEFAULT_MATRIX), and `needsApproval` below had none — it ended
// `?? false`. `role_permissions` rows are only ever written when a tenant's
// owner explicitly saves the Governance grid (PUT /api/role-permissions is
// the sole writer; lib/tenant-provisioning.ts does NOT seed the table), so
// every freshly provisioned farm has an empty matrix. The result: a worker
// picked up `mortality: 'edit'` from DEFAULT_MATRIX and their death report
// went straight onto the owner's headcount, unreviewed, on day one. The
// approval machinery in POST /api/records was built and correct; nothing
// ever told it to switch on.
//
// The safe default for someone else's headcount is "ask first". A tenant
// that wants the old immediate behaviour unticks the box and gets a DB row
// saying so — the same "a configured row always wins in EITHER direction"
// contract getRoleAccess documents, including the row that turns this OFF.
//
// ── Why this grid lists only mortality and physical-count ──────────────────
// `needsApproval` has exactly one call site: POST /api/records, which reads
// it as `movesHeadcount && await needsApproval(...)`. `movesHeadcount` is
// true only for a `mortality` record or a `physical_count` that carried a
// number. So a `true` here on any other module would be enforced by
// nothing — decorative config of exactly the kind that made
// `approvalRequired` meaningless in the first place, and this file's history
// is a record of that mistake. The modules deliberately NOT listed:
//   - health, harvest: no record type defers on them. `harvest` has no
//     RECORD_TYPES entry at all, and a health record moves neither headcount
//     nor stock (POST /api/records refuses stock lines on a non-feeding
//     type), so there is nothing for an approval to hold back. Wiring them
//     up is a real feature, not a default.
//   - finance, payroll: worker/vet cannot write them at all under
//     DEFAULT_MATRIX ('hidden'), and the finance write paths never consult
//     this helper — lib/finance.ts calls applyMovement directly.
//   - manager: left absent, i.e. false, ON PURPOSE. A manager already
//     passes the governance module and so decides these approvals; making
//     them queue behind themselves would add friction with no reviewer
//     above them, and silently slowing down every manager's day-to-day
//     recording is a regression, not a hardening.
//
// vet is included alongside worker: a vet's mortality report moves the
// owner's headcount by exactly the same mechanism, and a vet is typically an
// outside contractor, so "the owner sees it before it lands" applies at
// least as strongly.
const DEFAULT_APPROVAL: Record<string, Partial<Record<string, boolean>>> = {
  worker: { mortality: true, 'physical-count': true },
  vet: { mortality: true, 'physical-count': true },
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
