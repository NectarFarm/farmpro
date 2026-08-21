// IFMS Tasks & Governance backend (issue #243). `tasks` already existed
// (issue #227) and was extended in place (db/schemas/dashboard.ts) rather than
// forked — this file is the genuinely-new part: an audit trail, an approvals
// queue, and a per-tenant role/permissions config store. None of these three
// tables existed anywhere on this branch before this issue (checked
// `db/schemas/*.ts` and grepped the repo, per the issue's own branch
// correction) — `photos` and a fuller `auditLog` from the reference system do
// not exist here and are not being rebuilt; this `audit_log` is a fresh,
// minimal table scoped to exactly what approve/reject need to write.
//
// ── v1 approval-scope decision (issue #243 task 3) ──────────────────────────
// The mock (components/farm/data.ts APPROVALS_DATA) implies approval gates on
// egg-collection, mortality, physical-count, harvest, milking, etc. — each of
// those is its own domain table (eggs, mortality logs, stock counts, harvest
// records) and NONE of them exist on this branch yet. Wiring an approval
// trigger to a table that doesn't exist would be fake plumbing, so v1 narrows
// to the one flow this branch can actually back end-to-end today:
//
//   Marking a task DONE, when that task's `requiresApproval` is true, creates
//   an `approval_requests` row (type: 'task_completion') instead of
//   completing the task directly — see PATCH /api/tasks/[id]. Approving flips
//   the task to DONE; rejecting flips it to REJECTED. That's the only
//   record type that creates an approval_request in this issue.
//
// Extending approval gating to egg-collection/mortality/etc. is real new
// scope for whichever issue builds those domain tables — flagged as a
// follow-on in the PR, not attempted here.
import { pgTable, text, timestamp, boolean, jsonb, index, uniqueIndex } from 'drizzle-orm/pg-core'

// Minimal, append-only audit trail. Every approve/reject decision writes one
// row here with the real actor (session user id) — that's this issue's whole
// reason to build it now rather than waiting for a fuller reference-system
// audit log. `meta` carries the free-form decision payload (e.g. the resolved
// task id/status) so a row is self-describing without joining back to a table
// that may since have changed.
export const auditLog = pgTable('audit_log', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  actor: text('actor').notNull(),
  action: text('action').notNull(),
  entity: text('entity').notNull(),
  entityId: text('entity_id').notNull(),
  meta: jsonb('meta').$type<Record<string, unknown>>(),
  at: timestamp('at').defaultNow().notNull(),
}, (t) => [
  index('idx_audit_log_tenant').on(t.tenantId),
  index('idx_audit_log_tenant_entity').on(t.tenantId, t.entity, t.entityId),
])

// A pending decision queue. Field set matches the issue's list (type, title,
// requestedBy, batchId, details, requestedAt, status, priority) with one
// addition — `entityId` — needed so approve/reject can resolve back to the
// record actually under review; v1 only ever populates it with a task id (see
// the decision note above). `batchId` is kept as a plain logical reference
// (no DB FK), same convention as users.tenantId in db/schemas/auth.ts — not
// every approval type needs a batch, and this schema shouldn't create an
// import cycle with db/schemas/index.ts for it.
export const approvalRequests = pgTable('approval_requests', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  type: text('type').notNull(),
  title: text('title').notNull(),
  requestedBy: text('requested_by').notNull(),
  batchId: text('batch_id'),
  entityId: text('entity_id').notNull(),
  details: text('details').notNull().default(''),
  requestedAt: timestamp('requested_at').defaultNow().notNull(),
  status: text('status').notNull().default('pending'),
  priority: text('priority').notNull().default('medium'),
}, (t) => [
  index('idx_approval_requests_tenant').on(t.tenantId),
  index('idx_approval_requests_tenant_status').on(t.tenantId, t.status),
  // Farm scoping resolves approvals through their batch (batch_id IN (...)),
  // and batch_id appears in no other index — tenant/status are led by
  // tenant_id, which does not help that lookup.
  index('idx_approval_requests_batch').on(t.batchId),
])

// The real backend for the UI's `OWNER_ROLES[].permissions` /
// `approvalRequired` shape (components/farm/data.ts's `OwnerRole`). One row
// per (tenant, role, module) rather than one JSON blob per role — lets
// GET/PUT touch/validate a single module without a read-modify-write race on
// a blob column, same per-row-config shape as db/schemas/onboarding.ts's
// tenant-scoped rows. `access` is loose text ('hidden' | 'view' | 'edit'),
// validated in the route — the same convention as users.role/status.
//
// Owner-only write (this issue's instruction): enforced in
// PUT /api/role-permissions, not here. Retrofitting every other API route to
// *enforce* this matrix before responding is explicitly out of scope for this
// issue (flagged as a follow-on in the PR) — this table is just the config
// store.
export const rolePermissions = pgTable('role_permissions', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  role: text('role').notNull(),
  module: text('module').notNull(),
  access: text('access').notNull().default('hidden'),
  approvalRequired: boolean('approval_required').notNull().default(false),
}, (t) => [
  index('idx_role_permissions_tenant').on(t.tenantId),
  uniqueIndex('idx_role_permissions_tenant_role_module').on(t.tenantId, t.role, t.module),
])
