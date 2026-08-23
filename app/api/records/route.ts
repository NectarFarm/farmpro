import { NextResponse } from 'next/server'
import { db } from '@/db'
import {
  records, batches, employees, productionUnits, approvalRequests,
  productCollections, products as productsTable,
} from '@/db/schemas'
import { randomUUID } from 'node:crypto'
import { and, desc, eq, inArray } from 'drizzle-orm'
import { batchIdsForFarm, farmNotFoundResponse, resolveFarmFilter } from '@/lib/farm-scope'
import { requireTenantSession, forbidden } from '@/lib/api-auth'
import { canEdit, needsApproval, MODULES } from '@/lib/permissions'
import { applyMovement, applyCount, BatchLedgerError } from '@/lib/batch-ledger'
import { consumeStock, InsufficientStockError, UnknownItemError, type ConsumeResult } from '@/lib/inventory-consume'
import { notifyApprovalRaised } from '@/lib/governance'

// ── GET/POST /api/records (issue #247 task 2) ───────────────────────────────
// Generic worker-submission log — feeding / mortality / physical_count today
// (see db/schemas/people.ts for why this is one table, not one per type).
//
// POST does not enforce employees.mortalityPhotoThreshold against `photoUrl`
// server-side: components/farm/worker.tsx's MortalityForm already blocks the
// submit flow client-side once the death count reaches the threshold
// (`needsPhoto` gates the Photo step before Confirm), and there is no
// deaths-count field standardized across `data` payloads yet to key a
// server-side check off (mortality's own `count` lives inside the loose
// jsonb `data` blob). Enforcing this properly needs a typed mortality
// payload — left for a follow-up rather than half-validating one field name
// out of an intentionally-loose jsonb column.
//
// Same tenant-resolution + envelope conventions as the batches/employees
// routes: session tenant wins, `tenantId` query param / body field is the
// standalone-mock-mode fallback.

const ok = <T>(data: T) => NextResponse.json({ success: true, data }, { status: 200 })
const created = <T>(data: T) => NextResponse.json({ success: true, data }, { status: 201 })
const badRequest = (msg: string) => NextResponse.json({ success: false, error: msg }, { status: 400 })
const notFound = (msg: string) => NextResponse.json({ success: false, error: msg }, { status: 404 })

// worker-routines task: the worker portal listed five more record types as
// "Coming Soon" tiles because the backend accepted only three. The greyed-out
// list was honest at the time and became the reason those jobs went
// unrecorded — so the types exist now, each mapped to the permission module
// that already governs it.
const RECORD_TYPES = new Set([
  'feeding', 'mortality', 'physical_count',
  // Eggs, milk, honey — what the batch yields while it stays intact. Also
  // writes product_collections rows (see below), because produce can later
  // be sold and therefore needs a balance, not just an activity entry.
  'production',
  // Vaccinations and treatments.
  'health',
  // Sample weights, for growth tracking.
  'weight',
  // An observation with no numbers — "water lines clear", "lights off". The
  // step of a routine that produces no data still produces the fact that
  // somebody checked.
  'check',
  // End-of-day stock count. Deliberately does NOT adjust the lots: correcting
  // stock is an audited, reason-required action an owner takes through PATCH
  // /api/inventory/lots/[id], and letting a closing count silently rewrite
  // quantities would put that correction in the one place nobody reviews.
  // What this records is the count and the variance, for someone to act on.
  'stock_count',
])

// role-permission-enforcement task: each writable record `type` maps to
// exactly one governance module (see lib/permissions.ts's MODULES) — this is
// the "map each record type to its module" instruction, done honestly rather
// than inventing a module `records` itself doesn't have.
const RECORD_TYPE_MODULES: Record<string, string> = {
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

// GET /api/records?tenantId=&batchId=&type=&employeeId=&farmId= — activity
// feed / worker's own history, newest first.
//
// `farmId` is a two-hop JOIN filter (farm-scoped-data task):
// records.batchId -> batches.unitId -> production_units.farmId. `records`
// has no farm_id of its own — same "don't denormalise a fact reachable
// through an existing FK chain" reasoning as GET /api/batches's farmId.
export async function GET(req: Request) {
  const auth = await requireTenantSession()
  if ('error' in auth) return auth.error
  const { tenantId } = auth

  const url = new URL(req.url)
  const batchId = url.searchParams.get('batchId')?.trim()
  const type = url.searchParams.get('type')?.trim()
  const employeeId = url.searchParams.get('employeeId')?.trim()

  const farmFilter = await resolveFarmFilter(tenantId, url.searchParams.get('farmId'))
  if (farmFilter === null) return NextResponse.json(farmNotFoundResponse(), { status: 404 })

  const conditions = [eq(records.tenantId, tenantId)]
  if (batchId) conditions.push(eq(records.batchId, batchId))
  if (type) conditions.push(eq(records.type, type))
  if (employeeId) conditions.push(eq(records.employeeId, employeeId))
  if (farmFilter) {
    const batchIds = await batchIdsForFarm(tenantId, farmFilter)
    if (batchIds.length === 0) return ok([])
    conditions.push(inArray(records.batchId, batchIds))
  }

  const rows = await db
    .select()
    .from(records)
    .where(and(...conditions))
    .orderBy(desc(records.createdAt), desc(records.id))

  return ok(rows)
}

// POST /api/records — create a feeding/mortality/physical_count submission.
// Body: { tenantId?, batchId | batchIds[], employeeId, type, data?, photoUrl? }
//
// ── Feeding draws on real stock (feed-from-stock task) ──────────────────────
// A feeding line that names an `itemId` deducts that quantity from the
// tenant's lots — oldest-expiring first — and writes an inventory_consumption
// row per lot it drew from (lib/inventory-consume.ts). Before this, the feed
// was free text in the `data` blob and stock never moved, so "remaining
// quantity" only ever changed when someone adjusted a lot by hand.
//
// ── One issue, several batches ──────────────────────────────────────────────
// The same bag feeds more than one batch, so `batchIds` records the round in
// one call: one `records` row per batch (each holding that batch's own
// share), all deductions in ONE transaction. A shortfall on the last batch
// rolls back the whole round rather than leaving the first few looking fed.
// `batchId` and `employeeId` must belong to the same tenant — checked here
// (not just left to the FK) so a bad/foreign id gets a clean 400/404 instead
// of a bare constraint-violation 500, same convention POST /api/batches uses
// for `unitId`.
export async function POST(req: Request) {
  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return badRequest('Invalid JSON body')
  }
  const b = (raw ?? {}) as Record<string, unknown>
  // Auditor is strictly read-only (vet/auditor screens task) — refused here
  // with a real 403 rather than relying on the UI simply not offering a
  // write form. Session is required for every other role too (auth fix:
  // fix/authenticate-all-apis) — this used to fall back to a body `tenantId`
  // for a session-less caller.
  const auth = await requireTenantSession({
    roles: ['owner', 'manager', 'worker', 'vet', 'super_admin'],
    explicitTenantId: typeof b.tenantId === 'string' ? b.tenantId : undefined,
  })
  if ('error' in auth) return auth.error
  const { session, tenantId } = auth
  const batchId = typeof b.batchId === 'string' ? b.batchId.trim() : ''
  const employeeId = typeof b.employeeId === 'string' ? b.employeeId.trim() : ''
  const type = typeof b.type === 'string' ? b.type.trim() : ''

  // Either form is enough: `batchId` for one batch, `batchIds` for a round
  // that covered several. Requiring the singular even when the plural was
  // sent is what the first draft of this got wrong.
  const hasBatchIds = Array.isArray(b.batchIds) && b.batchIds.length > 0
  if (!batchId && !hasBatchIds) return badRequest('batchId is required')
  if (!employeeId) return badRequest('employeeId is required')
  if (!RECORD_TYPES.has(type)) {
    return badRequest(`type must be one of: ${Array.from(RECORD_TYPES).join(', ')}`)
  }

  // Role-permission matrix (role-permission-enforcement task): the roles
  // allowlist above only says who MAY submit records at all — this is the
  // per-module edit check the Governance screen's matrix actually configures.
  if (!(await canEdit(tenantId, session.role, RECORD_TYPE_MODULES[type]))) {
    return forbidden(`Your role does not have edit access to ${RECORD_TYPE_MODULES[type]}`)
  }

  // One feeding often covers several batches out of the same bag — see the
  // multi-batch note above. `batchIds` is the multi form of `batchId`; both
  // are validated identically and the single form stays the default so no
  // existing caller changes shape.
  const targetBatchIds = hasBatchIds
    ? Array.from(new Set((b.batchIds as unknown[]).map((v) => (typeof v === 'string' ? v.trim() : '')).filter(Boolean)))
    : [batchId]
  if (targetBatchIds.length === 0) return badRequest('batchId is required')
  if (targetBatchIds.length > 50) return badRequest('At most 50 batches can be recorded at once')

  const batchRows = await db
    .select({ id: batches.id, farmId: productionUnits.farmId })
    .from(batches)
    .innerJoin(productionUnits, eq(productionUnits.id, batches.unitId))
    .where(and(inArray(batches.id, targetBatchIds), eq(batches.tenantId, tenantId)))
  if (batchRows.length !== targetBatchIds.length) return notFound('Batch not found for this tenant')
  const farmOfBatch = new Map(batchRows.map((r) => [r.id, r.farmId]))

  const employeeRows = await db
    .select({ id: employees.id })
    .from(employees)
    .where(and(eq(employees.id, employeeId), eq(employees.tenantId, tenantId)))
  if (employeeRows.length === 0) return notFound('Employee not found for this tenant')

  const data = (b.data && typeof b.data === 'object' && !Array.isArray(b.data)) ? (b.data as Record<string, unknown>) : {}
  const photoUrl = typeof b.photoUrl === 'string' && b.photoUrl.trim() ? b.photoUrl.trim() : null

  // ── What this record does to the batch's headcount ────────────────────────
  // A mortality entry used to leave `batches.currentQty` untouched: the death
  // was filed, the count carried on as before, and every figure derived from
  // it — dashboard KPIs, reports, the batch card — drifted away from the
  // birds actually in the house. A physical count was the same: it recorded
  // what was counted and changed nothing.
  //
  // Whether it applies NOW or waits is the tenant's own decision, read from
  // the approval_required column their Governance screen has always written
  // and nothing has ever read (lib/permissions.ts#needsApproval). With it
  // set, the record is filed and an approval raised; the headcount moves when
  // someone approves it (lib/governance.ts), not before.
  const deaths = type === 'mortality' ? Math.trunc(Number(data.count ?? data.deaths ?? 0)) : 0
  if (type === 'mortality' && (!Number.isFinite(deaths) || deaths <= 0)) {
    return badRequest('A mortality record needs how many died')
  }
  // `physicalCount` is what the worker form has always sent (see
  // components/farm/worker.tsx's PhysicalCountForm); `counted` is the name
  // the rest of this file uses. Both are accepted rather than renaming a
  // field that existing clients post.
  const counted = type === 'physical_count'
    ? Math.trunc(Number(data.counted ?? data.physicalCount ?? data.count ?? NaN))
    : NaN
  const hasCount = type === 'physical_count' && Number.isFinite(counted)
  if (type === 'physical_count' && !hasCount) {
    return badRequest('A physical count needs the number you counted')
  }

  const movesHeadcount = type === 'mortality' || hasCount
  const deferred = movesHeadcount && await needsApproval(tenantId, session.role, RECORD_TYPE_MODULES[type])

  // ── What was collected (worker-routines task) ─────────────────────────────
  // A production record carries { items: [{ productId, qty }] }. Each line
  // becomes a product_collections row so the produce has a BALANCE that a
  // later sale can draw down — the activity-feed record alone could never
  // answer "how many trays are unsold".
  const collectedLines = type === 'production' ? parseCollectionLines(data) : []
  if (type === 'production' && collectedLines.length === 0) {
    return badRequest('A collection needs at least one product and quantity')
  }

  // Which lines name real stock. A line with an `itemId` moves inventory; a
  // line with only free text does not, which is how records written before
  // this existed keep working rather than being rejected retroactively.
  const stockLines = parseStockLines(data)
  const badLine = stockLines.find((l) => !(l.qty > 0) || !Number.isFinite(l.qty))
  if (badLine) return badRequest('Each feed line needs a quantity greater than zero')
  if (type !== 'feeding' && stockLines.length > 0) {
    return badRequest('Only a feeding record can draw from stock')
  }

  try {
    const result = await db.transaction(async (tx) => {
      const inserted: (typeof records.$inferSelect)[] = []
      const consumed: ConsumeResult[] = []
      // Full rows, not just ids: notifyApprovalRaised (called AFTER this
      // transaction resolves — see the comment where it's called) needs the
      // title/assignedApproverId, and re-querying them post-commit would be
      // more code for data already sitting right here.
      const approvals: (typeof approvalRequests.$inferSelect)[] = []

      for (const targetId of targetBatchIds) {
        const id = crypto.randomUUID()
        const [row] = await tx
          .insert(records)
          .values({
            id, tenantId, batchId: targetId, employeeId, type,
            // The record carries its own pending flag, so a worker's history
            // can say "waiting for approval" instead of looking applied.
            data: deferred ? { ...dataFor(data, targetId), pendingApproval: true } : dataFor(data, targetId),
            photoUrl,
          })
          .returning()
        inserted.push(row)

        if (movesHeadcount && deferred) {
          const [approval] = await tx.insert(approvalRequests).values({
            id: randomUUID(),
            tenantId,
            type: type === 'mortality' ? 'mortality' : 'physical_count',
            title: type === 'mortality' ? `Mortality: ${deaths} head` : `Physical count: ${counted} head`,
            requestedBy: session.id,
            batchId: targetId,
            entityId: id,
            details: typeof data.cause === 'string' ? data.cause : '',
            status: 'pending',
            priority: 'medium',
          }).returning()
          approvals.push(approval)
        } else if (movesHeadcount) {
          if (type === 'mortality') {
            await applyMovement(tx, {
              tenantId, batchId: targetId, type: 'mortality', qtyDelta: -deaths,
              reason: typeof data.cause === 'string' && data.cause ? String(data.cause) : 'Mortality recorded',
              // A death report is never blocked by a headcount nobody
              // entered — see lib/batch-ledger.ts#applyMovement.
              allowClamp: true,
              sourceType: 'record', sourceId: id, actor: session.email,
            })
          } else {
            await applyCount(tx, {
              tenantId, batchId: targetId, counted,
              reason: typeof data.varianceReason === 'string' && data.varianceReason.trim()
                ? String(data.varianceReason).trim()
                : undefined,
              sourceType: 'record', sourceId: id, actor: session.email,
            })
          }
        }

        for (const line of collectedLines) {
          const [product] = await tx
            .select({ id: productsTable.id })
            .from(productsTable)
            .where(and(eq(productsTable.id, line.productId), eq(productsTable.tenantId, tenantId)))
            .limit(1)
          if (!product) throw new UnknownProductError()
          await tx.insert(productCollections).values({
            id: randomUUID(),
            tenantId,
            batchId: targetId,
            productId: line.productId,
            employeeId,
            recordId: id,
            qty: line.qty,
          })
        }

        for (const line of stockLines) {
          const qty = qtyForBatch(line, targetId)
          if (qty <= 0) continue
          consumed.push(await consumeStock(tx, {
            tenantId,
            itemId: line.itemId,
            qty,
            batchId: targetId,
            farmId: farmOfBatch.get(targetId) ?? null,
            recordId: id,
            employeeId,
          }))
        }
      }

      return { inserted, consumed, approvals }
    })

    // Notify AFTER the transaction has committed, not from inside it: an
    // approval raised mid-transaction could still be rolled back by a later
    // batch in the same round failing (e.g. insufficient stock on batch 2 of
    // 3) — creating the notification/email in there would leave an approver
    // told about a record that no longer exists. `assignedApproverId` is
    // never set on a record-raised approval (unlike task_completion, records
    // carry no approver field), so this always broadcasts to owner/manager —
    // see notifyApprovalRaised (lib/governance.ts) for that targeting choice.
    for (const approval of result.approvals) {
      await notifyApprovalRaised(approval)
    }

    // The single-batch response keeps its original shape — one record object,
    // with the stock it moved attached when there was any.
    if (targetBatchIds.length === 1) {
      const extras = {
        ...(result.consumed.length > 0 ? { consumed: result.consumed } : {}),
        ...(result.approvals.length > 0 ? { approvalRequestId: result.approvals[0].id, pendingApproval: true } : {}),
      }
      return created(Object.keys(extras).length > 0 ? { ...result.inserted[0], ...extras } : result.inserted[0])
    }
    return created({
      records: result.inserted,
      consumed: result.consumed,
      approvalRequestIds: result.approvals.map((a) => a.id),
    })
  } catch (err) {
    // A shortfall rolls back every record in the submission, not just the
    // line that ran out: half a feeding round saved is worse than none,
    // because the batches that did get recorded look complete.
    if (err instanceof InsufficientStockError) return badRequest(err.message)
    if (err instanceof UnknownItemError) return badRequest(err.message)
    if (err instanceof UnknownProductError) return badRequest(err.message)
    if (err instanceof BatchLedgerError) {
      return NextResponse.json({ success: false, error: err.message }, { status: err.status })
    }
    throw err
  }
}

// ── Reading the feed lines out of the record payload ────────────────────────
// `records.data` is a free-form jsonb blob, and the feeding form has always
// written `feedItems: [{ item, qtyKg }]` into it. The stock-backed form
// writes `{ itemId, qty }` — and, when one issue is split across batches,
// `perBatch: { <batchId>: qty }` so 80kg can go 50/30 rather than 80 to each.
interface StockLine {
  itemId: string
  qty: number
  perBatch: Record<string, number> | null
}

function parseStockLines(data: Record<string, unknown>): StockLine[] {
  const raw = data.feedItems
  if (!Array.isArray(raw)) return []
  const lines: StockLine[] = []
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue
    const line = entry as Record<string, unknown>
    const itemId = typeof line.itemId === 'string' ? line.itemId.trim() : ''
    if (!itemId) continue // free-text line: recorded, but moves no stock
    const qty = Number(line.qty ?? line.qtyKg)
    const perBatch = line.perBatch && typeof line.perBatch === 'object' && !Array.isArray(line.perBatch)
      ? Object.fromEntries(Object.entries(line.perBatch as Record<string, unknown>).map(([k, v]) => [k, Number(v)]))
      : null
    lines.push({ itemId, qty, perBatch })
  }
  return lines
}

function qtyForBatch(line: StockLine, batchId: string): number {
  if (!line.perBatch) return line.qty
  const specific = line.perBatch[batchId]
  return Number.isFinite(specific) ? specific : 0
}

// Each batch's own record stores the quantity that batch actually got, not
// the whole issue — otherwise every batch in a split feeding would read as
// having eaten the full amount.
function dataFor(data: Record<string, unknown>, batchId: string): Record<string, unknown> {
  const raw = data.feedItems
  if (!Array.isArray(raw)) return data
  const feedItems = raw
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return entry
      const line = entry as Record<string, unknown>
      const perBatch = line.perBatch as Record<string, unknown> | undefined
      if (!perBatch || typeof perBatch !== 'object') return line
      const rest = { ...line }
      delete rest.perBatch
      return { ...rest, qty: Number(perBatch[batchId] ?? 0) }
    })
    .filter((entry) => {
      if (!entry || typeof entry !== 'object') return true
      const qty = Number((entry as Record<string, unknown>).qty ?? (entry as Record<string, unknown>).qtyKg)
      return !Number.isFinite(qty) || qty > 0
    })
  return { ...data, feedItems }
}


class UnknownProductError extends Error {
  constructor() {
    super('That product is not in this farm’s catalogue')
  }
}

// A production record's lines: { productId, qty }. A line with no product or
// a non-positive quantity is dropped rather than stored as a collection of
// nothing — an empty submission is refused above, so this cannot silently
// swallow the whole thing.
function parseCollectionLines(data: Record<string, unknown>): { productId: string; qty: number }[] {
  const raw = data.items
  if (!Array.isArray(raw)) return []
  const out: { productId: string; qty: number }[] = []
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue
    const line = entry as Record<string, unknown>
    const productId = typeof line.productId === 'string' ? line.productId.trim() : ''
    const qty = Math.trunc(Number(line.qty))
    if (!productId || !Number.isFinite(qty) || qty <= 0) continue
    out.push({ productId, qty })
  }
  return out
}
