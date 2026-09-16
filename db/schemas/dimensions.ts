// ── Analytical dimensions on the general ledger (dimensions-on-gl task) ────
// Before this task `journal_lines` carried NOTHING beyond
// `{ id, entryId, accountId, debitCents, creditCents }` — no farm, no batch,
// no anything — which is exactly why lib/reports.ts's P&L prints "GL totals
// are all-time and cover every farm" on every export: there was no column to
// filter by. This file implements Business Central-style Dimensions PLUS
// Default Dimensions (the vocabulary accountants already know — Dimension /
// Dimension Value / Dimension Code / a master's default dimensions), NOT
// Odoo's single free-form analytic-account axis: the owner explicitly wants
// several NAMED dimensions (Unit, Farm, Batch, Enterprise, and whatever a
// tenant adds later), each with its own levels, AND the owner's later
// instruction: "with this we can link employees and all data to dimensions
// and journal entry" — i.e. a master record (an employee, a unit, a batch, a
// farm, a product, an account) carries DEFAULT dimension values that flow
// onto any document or posting that references it, exactly BC's Default
// Dimensions mechanism (`default_dimensions` below). There is deliberately
// only ONE such mechanism in this schema — the account-level "requirement"
// rule the original brief described as a separate `account_dimension_rules`
// table is folded into `default_dimensions` with `masterType: 'account'`.
//
// ── Codes are first-class, not a hidden surrogate key ───────────────────────
// `dimensions.code` and `dimension_values.code` are what an accountant
// actually memorises and types ("FARM", "BRO-KMU-022") — `id` exists only
// because every other table in this schema keys on a text uuid, never
// because the code is secondary. Every uniqueness constraint here is on the
// code, scoped to where it must be unique (a dimension's code is unique per
// tenant; a value's code is unique within its own dimension — the same code
// "001" can mean different things under Farm vs under Department, same as a
// real chart of accounts lets "1001" and a project code overlap).
//
// ── Default ordering: UNIT first ────────────────────────────────────────────
// `sortOrder` (owner instruction, 2026-09-16): the production unit is where
// work actually happens, so it is the dimension a farm analyses by first —
// UNIT is seeded at sortOrder 1, then FARM, BATCH, ENTERPRISE. This is
// display/default-picker ordering only; it has no bearing on the master-chain
// walk lib/dimensions.ts does when resolving a posting's dimensions (that
// walk follows the REAL operational hierarchy — batch -> unit -> farm — not
// this list's order).
//
// ── Why farms/units/batches are NOT converted into dimension values ─────────
// They are live operational entities with real foreign keys from `records`,
// `sales`, `purchases`, `tasks`, `inventory_lots`, `batch_movements` and
// more (see db/schemas/index.ts). Converting them into generic dimension
// rows would mean ripping out every one of those FKs and rebuilding every
// screen that reads them — the owner said explicitly "hope it does not
// affect other screens", and separately confirmed this is the STANDARD, not
// a shortcut: in Business Central a Location, a Job, a Customer, an Employee
// are all their own master tables and are never dimension values — the
// dimension layer only REFERENCES masters and carries their defaults. So
// each operational master PROJECTS a read-only shadow into
// `dimension_values`: `sourceType`/`sourceId` point back at the real row,
// and `lib/dimensions.ts`'s project*() functions keep that shadow in step
// (write-through on create/rename, plus a reconcile pass for the migration
// backfill and for anything that drifts). A user-defined dimension (e.g.
// "Department") has `sourceType: null` — it is purely analytical, created
// and coded by the tenant with no operational table behind it at all.
//
// ── Once posted, a dimension value must never disappear ─────────────────────
// `journal_line_dimensions.valueId` / `document_dimensions.valueId` are real
// FKs into `dimension_values.id` (safe, because this file never hard-deletes
// a `dimension_values` row — see `archived` below). When a farm/unit/batch is
// deleted (not just archived — see app/api/farms/[id]/route.ts's DELETE,
// which already distinguishes a real delete from a detach for
// tasks/inventory_lots/employees/routines), its projected dimension_values
// row is marked `archived: true` instead of removed: an archived value can no
// longer be used on a NEW posting (lib/dimensions.ts's validateDimensionValue
// refuses it), but every journal_line_dimensions/document_dimensions row that
// already points at it keeps pointing at it — a posted line's analysis is
// history, and archiving a batch six months from now must not silently
// rewrite what a line posted against it in January meant.
import { pgTable, text, timestamp, integer, boolean, index, uniqueIndex } from 'drizzle-orm/pg-core'
import { accounts, journalLines } from './finance'

// One named analytical axis per tenant — "UNIT", "FARM", "BATCH",
// "ENTERPRISE" (system, kept in step with the operational tables by
// lib/dimensions.ts) or a tenant's own ("DEPT", "PROJECT" — user-defined,
// `isSystem: false`). `levelCount` is how many levels this dimension's own
// values are organised into — the owner's "two levels, e.g. Batch and
// Sub-batch" — and is advisory (dimension_levels below is the source of
// truth for what each level is actually CALLED); it exists so a config
// screen can render "Level 1 of 2" without a second query.
export const dimensions = pgTable('dimensions', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  code: text('code').notNull(),
  name: text('name').notNull(),
  levelCount: integer('level_count').notNull().default(1),
  // System dimensions (UNIT/FARM/BATCH/ENTERPRISE) are seeded once per
  // tenant by lib/dimensions.ts's ensureSystemDimensions and never editable
  // as a "delete this dimension" target from a config screen — deleting the
  // Farm dimension out from under the app's own farm-scoping story is not a
  // thing a config screen should be able to do. User-defined dimensions have
  // no such protection.
  isSystem: boolean('is_system').notNull().default(false),
  // Default listing/picker order — UNIT=1, FARM=2, BATCH=3, ENTERPRISE=4 for
  // the system dimensions (owner instruction); a tenant's own dimensions get
  // the next free numbers as they're created, so they sort after the system
  // set by default rather than interleaving with it.
  sortOrder: integer('sort_order').notNull().default(100),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('idx_dimensions_tenant').on(t.tenantId),
  // A tenant's own dimension codes are unique to THAT tenant — "DEPT" for
  // tenant A and "DEPT" for tenant B are unrelated dimensions, same
  // per-tenant-unique-code convention as farms.code / batches.code.
  uniqueIndex('idx_dimensions_tenant_code').on(t.tenantId, t.code),
])

// The tenant's own name for each ordinal level of one dimension — literally
// the owner's ask: "two levels, e.g. Batch and Sub-batch, and one can type
// the name". Ordinal 1 is the outermost/parent level (e.g. "Batch");
// ordinal `levelCount` is the most granular (e.g. "Sub-batch"). A value at
// ordinal N in dimension_values rolls up to its ordinal-(N-1) ancestor via
// parentValueId, which is what makes "report at any level, rolling children
// into their parent" possible without re-deriving the tree at query time.
export const dimensionLevels = pgTable('dimension_levels', {
  id: text('id').primaryKey(),
  dimensionId: text('dimension_id').notNull().references(() => dimensions.id),
  ordinal: integer('ordinal').notNull(),
  name: text('name').notNull(),
}, (t) => [
  index('idx_dimension_levels_dimension').on(t.dimensionId),
  uniqueIndex('idx_dimension_levels_dimension_ordinal').on(t.dimensionId, t.ordinal),
])

// The coded tree an accountant actually posts against and reports by.
//
// `parentValueId` is a plain logical reference, not a DB FK — a
// SELF-reference (dimension_values.parent_value_id -> dimension_values.id).
// Drizzle can express a same-table FK, but leaving it unenforced means an
// archive or a re-parent never has to fight a constraint — lib/dimensions.ts
// is the one place that walks and validates this chain. It links levels
// WITHIN one dimension (Batch -> its Sub-batch) — it is NOT how a Unit
// relates to its Farm (those are different dimensions; that cross-dimension
// relationship is expressed through `default_dimensions` and the real
// operational FK chain, not through this column).
//
// `sourceType`/`sourceId` are the projection pointer described in this
// file's header — null for a purely analytical (user-defined) value, or
// 'farm' | 'unit' | 'batch' pointing at the real row for a system value.
// `code`/`name` for a projected value are kept identical to the operational
// row's own code/name by lib/dimensions.ts's project*() functions — an
// accountant who knows a batch's code "BRO-KMU-022" can post against or
// filter by that exact code with no second vocabulary to learn.
export const dimensionValues = pgTable('dimension_values', {
  id: text('id').primaryKey(),
  dimensionId: text('dimension_id').notNull().references(() => dimensions.id),
  // Denormalised alongside dimensionId so a value can be tenant-validated
  // (lib/dimensions.ts's validateDimensionValue) with no join back through
  // `dimensions` — the exact check that closes the "does this value even
  // belong to this tenant" cross-tenant hole at posting time.
  tenantId: text('tenant_id').notNull(),
  code: text('code').notNull(),
  name: text('name').notNull(),
  levelOrdinal: integer('level_ordinal').notNull().default(1),
  parentValueId: text('parent_value_id'),
  sourceType: text('source_type'), // 'farm' | 'unit' | 'batch' | null
  sourceId: text('source_id'),
  // Never hard-deleted once anything might reference it — see this file's
  // header. Set true when the source entity is deleted (not merely
  // archived/status-changed — an archived farm keeps its dimension value
  // live, since it can still be restored and posted against) or when a
  // tenant retires a user-defined value from a config screen.
  archived: boolean('archived').notNull().default(false),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('idx_dimension_values_dimension').on(t.dimensionId),
  index('idx_dimension_values_tenant').on(t.tenantId),
  // A value's code only has to be unique WITHIN its own dimension — the same
  // code under Farm and under Department are unrelated (mirrors a real
  // chart-of-accounts code space vs a project-code space never colliding).
  uniqueIndex('idx_dimension_values_dimension_code').on(t.dimensionId, t.code),
  index('idx_dimension_values_source').on(t.sourceType, t.sourceId),
  index('idx_dimension_values_parent').on(t.parentValueId),
])

// ── Default Dimensions (owner instruction, 2026-09-16) ──────────────────────
// "with this we can link employees and all data to dimensions and journal
// entry" — a master record (an employee, a unit, a batch, a farm, a product,
// or an account) carries a default value for a dimension, and that value
// flows onto any document/posting that references the master, unless
// something more specific overrides it. This is the ONE mechanism for both:
//   - a system master telling the resolver what it IS (a batch's own row
//     for the BATCH dimension, a unit's own row for the UNIT dimension —
//     written by lib/dimensions.ts's project*() functions), and
//   - an account's posting POLICY for a dimension (requirement: required /
//     optional / blocked, optionally with its own fallback default) — this
//     is what replaces a standalone `account_dimension_rules` table.
//
// Resolution order (most specific wins; see lib/dimensions.ts's
// resolveLineDimensions for the implementation): an explicit value passed to
// the posting call > the source document's own master (e.g. a sale's batch)
// > that master's ancestors walked via the REAL operational FK chain (batch
// -> unit -> farm; employee -> farm) > the account's own row (last resort,
// and the only place `requirement` is actually enforced — see below). Where
// two masters would supply the same dimension, the one encountered first in
// that walk (i.e. the more specific one) wins outright; a less specific
// master's row for an already-resolved dimension is simply skipped.
export const defaultDimensions = pgTable('default_dimensions', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  // 'employee' | 'unit' | 'batch' | 'farm' | 'product' | 'account'. No DB FK
  // to any specific master table — this column is deliberately polymorphic
  // (a real FK would have to pick one target table), same "logical
  // reference, validated in application code" convention this schema already
  // uses for cross-entity links that can't be a single FK.
  masterType: text('master_type').notNull(),
  masterId: text('master_id').notNull(),
  dimensionId: text('dimension_id').notNull().references(() => dimensions.id),
  // Nullable: a 'blocked' row needs no value (it exists purely to say "never
  // analyse this master by this dimension"), and a 'required' row on an
  // account MAY carry no default of its own — meaning every posting to that
  // account must supply the value from somewhere in the master chain, with
  // nothing to fall back on.
  dimensionValueId: text('dimension_value_id').references(() => dimensionValues.id),
  // 'required' | 'optional' | 'blocked'. Only meaningful as an ENFORCEMENT
  // instruction on an 'account' row — lib/dimensions.ts's resolver reads
  // `requirement` from every master's rows to fill in a default value, but
  // only checks required/blocked semantics on the account-level row, exactly
  // matching the original brief's "a posting to an account whose Farm
  // dimension is required must refuse without one" (never "this batch's
  // Farm dimension is required" — a batch's own row is a default value, not
  // a rule). Stored uniformly here anyway (rather than a separate column
  // only accounts have) so the schema has one shape for every master type.
  requirement: text('requirement').notNull().default('optional'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('idx_default_dimensions_tenant').on(t.tenantId),
  index('idx_default_dimensions_master').on(t.tenantId, t.masterType, t.masterId),
  // One default per (master, dimension) per tenant — configuring the same
  // pair again is an edit, not a duplicate row (lib/dimensions.ts upserts on
  // this constraint).
  uniqueIndex('idx_default_dimensions_master_dimension').on(t.tenantId, t.masterType, t.masterId, t.dimensionId),
])

// ── Dimensions ride on the document, not only on the ledger line ───────────
// Owner instruction: "all data" linked to dimensions, not just journal_lines
// — a sale, a purchase or a payroll run is analysable in its own right,
// before and independently of the journal entry it posts (a document can be
// edited/voided pre-posting in a real ERP; the analysis on it should not
// only exist on the ledger side). This table is the document-side twin of
// `journal_line_dimensions` below, sharing the same
// tenantId/dimensionId/valueId shape; `docType`/`docId` name the row instead
// of `lineId`. Scope: the three GL-relevant documents this task's posting
// sites actually cover (sales, purchases, payroll_runs) — NOT every
// operational table in the app (records/tasks/inventory_lots are out of
// scope for this pass; see this task's final report for why).
export const documentDimensions = pgTable('document_dimensions', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  docType: text('doc_type').notNull(), // 'sale' | 'purchase' | 'payroll_run'
  docId: text('doc_id').notNull(),
  dimensionId: text('dimension_id').notNull().references(() => dimensions.id),
  valueId: text('value_id').notNull().references(() => dimensionValues.id),
}, (t) => [
  index('idx_document_dimensions_doc').on(t.docType, t.docId),
  index('idx_document_dimensions_tenant').on(t.tenantId),
  uniqueIndex('idx_document_dimensions_doc_dimension').on(t.docType, t.docId, t.dimensionId),
])

// The actual analysis carried on one posted line — one row per
// (journal line, dimension) pair, e.g. a line posted to Sales Revenue for a
// broiler sale carries four rows here: UNIT, FARM, BATCH, ENTERPRISE.
//
// Existing journal_lines (posted before this task) have NO rows here at
// all — see lib/reports.ts's computeDimensionPlReport, which reports that
// gap honestly as an "Unanalysed" bucket rather than guessing a dimension
// for history that was posted before any of this existed.
export const journalLineDimensions = pgTable('journal_line_dimensions', {
  id: text('id').primaryKey(),
  lineId: text('line_id').notNull().references(() => journalLines.id),
  dimensionId: text('dimension_id').notNull().references(() => dimensions.id),
  valueId: text('value_id').notNull().references(() => dimensionValues.id),
}, (t) => [
  index('idx_journal_line_dimensions_line').on(t.lineId),
  index('idx_journal_line_dimensions_dimension_value').on(t.dimensionId, t.valueId),
  // A line can carry at most ONE value per dimension — "which farm" cannot
  // have two answers on the same line.
  uniqueIndex('idx_journal_line_dimensions_line_dimension').on(t.lineId, t.dimensionId),
])
