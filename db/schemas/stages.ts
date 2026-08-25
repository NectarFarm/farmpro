// ── A farm's own stage vocabulary, per enterprise ───────────────────────────
// What was wrong: `batches.stage` is `text('stage').notNull().default('')` and
// the only thing that ever wrote it was a free-text input on the batch detail
// screen ("Advance Stage", components/farm/crops.tsx). So "Finisher",
// "finisher" and "Finishr" all became distinct stages on the same farm, and any
// report or KPI that ever buckets by stage fragments silently — the same typo
// problem the mortality cause and health treatment fields had, on the most
// structural field a batch carries.
//
// Nothing anywhere knew how long a stage was supposed to last, either. That is
// the "stage life" this table adds.
//
// ── Why per (tenant, enterprise) and not global ─────────────────────────────
// A broiler house and a maize plot do not share a stage list, and two farms do
// not agree on one either — one runs Starter/Grower/Finisher, another adds a
// Pre-Starter. A global list would be wrong for everybody, and a per-tenant
// list that ignored enterprise would offer "Peak Lay" when advancing a batch of
// pigs. `enterprise` holds the same lowercase-snake key `batches.enterprise`
// does, so the two join directly.
//
// The tenant's set of enterprises comes from `tenant_enterprises`
// (db/schemas/enterprises.ts, migration 0035) — that table exists, so the
// config screen offers exactly what the farm is approved to farm rather than
// the whole registry. Note the EMPTY-SET RULE documented in lib/enterprises.ts:
// a tenant with no rows there is unrestricted, not locked out, so the screen
// falls back to the enterprises its own batches actually use.
//
// ── Why a table and not a constant ─────────────────────────────────────────
// Unlike the mortality causes in lib/record-vocabulary.ts, this genuinely
// varies per farm and the farmer is expected to edit it — that is the whole
// request ("a place for configuring some of these farm things like stages...
// things that can be permanent like stage life"). A constant could not carry a
// per-farm duration.
import { pgTable, text, integer, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core'

export const batchStages = pgTable('batch_stages', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  // Matches `batches.enterprise` exactly (lowercase snake, e.g. 'broiler',
  // 'dairy_cow') — normalised in the route so a typed 'Broiler' cannot create
  // a near-duplicate the unique index treats as distinct.
  enterprise: text('enterprise').notNull(),
  // What the farmer calls it. Stored as typed for display; uniqueness is
  // enforced case-insensitively in the route, since Postgres cannot express a
  // lower() unique index through Drizzle's builder here.
  name: text('name').notNull(),
  // Position in the progression. This is what makes "advance to the next
  // stage" a defined operation rather than a guess — the batch detail screen
  // defaults to the next stage by this order.
  sortOrder: integer('sort_order').notNull().default(0),
  // ── The stage life ────────────────────────────────────────────────────────
  // Typical duration in days. NULLABLE on purpose: migration 0036 backfills
  // every tenant's existing stage names from the values their batches already
  // use, and the duration for those is genuinely unknown. Inventing a number
  // would put a fabricated figure into the one field a farmer would trust
  // most, so the UI renders "not set" instead — the same honest-empty-state
  // convention reports.tsx and dashboard.tsx follow.
  typicalDays: integer('typical_days'),
  createdAt: timestamp('created_at').defaultNow(),
}, (t) => [
  index('idx_batch_stages_tenant').on(t.tenantId),
  // The lookup every read does: this tenant's stages for one enterprise, in
  // order.
  index('idx_batch_stages_tenant_enterprise').on(t.tenantId, t.enterprise),
  // One row per stage name per enterprise per tenant. Case-insensitive
  // collision ('Grower' vs 'grower') is caught in the route before insert.
  uniqueIndex('idx_batch_stages_unique').on(t.tenantId, t.enterprise, t.name),
])
