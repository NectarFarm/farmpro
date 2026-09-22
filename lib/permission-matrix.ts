// ── Pure permission data, safe to import from a client component ───────────
// Split out of lib/permissions.ts (which imports `@/db`, itself
// `import 'server-only'`-guarded) so a 'use client' screen can read the exact
// same module list, code-default matrix, and record-type→module mapping the
// server enforces, instead of maintaining a second copy that can silently
// drift. lib/permissions.ts re-exports everything here for backward
// compatibility with its existing server-side callers.
//
// Nothing in this file may import `@/db`, `drizzle-orm`, or anything else
// server-only — that is the entire point of its existence (see e2e finding:
// components/farm/worker.tsx's record-type picker used to let a worker fill
// in an entire Health or Weight form before the server's canEdit() check
// refused it at Save; the picker now reads this same matrix up front).

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
export const BYPASS_ROLES = new Set([OWNER, 'super_admin'])

// ── Code-defined defaults, overridden by a DB row when one exists ──────────
// Before this, `getRoleAccess` ended `?? 'edit'` — with an empty
// `role_permissions` table (true in production today: 0 rows) every role
// resolved to `edit` on every module, which makes the whole matrix
// decorative. Fail-closed instead (defaulting an unknown role/module
// combination to 'hidden') would lock every tenant out of everything on day
// one, since the table really is empty. This grid is the middle path: a
// sensible per-role default that a tenant's own owner can still override in
// either direction via PUT /api/role-permissions (checked first, in
// lib/permissions.ts's getRoleAccess — a DB row always wins over the default
// it's replacing).
//
// Grid rationale (module list: MODULES below):
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
export const DEFAULT_MATRIX: Record<string, Partial<Record<string, AccessLevel>>> = {
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

export const MODULES = {
  feeding: 'feeding', eggCollection: 'egg-collection', milking: 'milking', mortality: 'mortality',
  health: 'health', physicalCount: 'physical-count', harvest: 'harvest', tasks: 'tasks',
  inventory: 'inventory', batches: 'batches', finance: 'finance', payroll: 'payroll',
  governance: 'governance', deleteRecord: 'delete-record',
} as const

// ── Code-defined approval defaults, overridden by a DB row ─────────────────
// See lib/permissions.ts's needsApproval/defaultApprovalFor for how this is
// read. Duplicated rationale kept there, not here, to avoid two copies of
// the same essay drifting apart.
export const DEFAULT_APPROVAL: Record<string, Partial<Record<string, boolean>>> = {
  worker: { mortality: true, 'physical-count': true },
  vet: { mortality: true, 'physical-count': true },
}

// role-permission-enforcement task: each writable `records.type` maps to
// exactly one governance module above — done honestly rather than inventing
// a module `records` itself doesn't have. Read by app/api/records/route.ts
// (the enforcement) and components/farm/worker.tsx (the picker that now
// reflects that enforcement before the worker ever opens the form).
export const RECORD_TYPE_MODULES: Record<string, string> = {
  feeding: MODULES.feeding,
  mortality: MODULES.mortality,
  physical_count: MODULES.physicalCount,
  // Collecting eggs/milk is the egg-collection module the matrix already
  // has; there is no separate 'production' module to invent.
  production: MODULES.eggCollection,
  health: MODULES.health,
  // Weighing and observing are part of doing the round, and the matrix has
  // no module of their own — they ride with the batch module rather than
  // getting a fabricated one the Governance screen cannot configure.
  weight: MODULES.batches,
  check: MODULES.batches,
  stock_count: MODULES.inventory,
}
