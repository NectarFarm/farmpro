import { NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import { and, asc, eq, inArray } from 'drizzle-orm'
import { db } from '@/db'
import { batchProducts, batches, productUnits, products, productionUnits } from '@/db/schemas'
import { requireTenantSession, forbidden } from '@/lib/api-auth'
import { canEdit, MODULES } from '@/lib/permissions'

// ── GET/PUT /api/products/[id]/batches (farm-configuration task) ────────────
// The INVERSE of GET/PUT /api/batches/[id]/products, which already exists and
// is not touched here.
//
// Why the inverse needs its own endpoint: the per-batch route can only answer
// "what does THIS batch offer". The question a farmer setting up a farm
// actually asks is the other one — "which batches produce eggs?" — and
// answering it from the per-batch route means fetching every batch and
// resolving each one client-side. That is N round trips to render one screen,
// and it cannot be done at all without first knowing every batch id.
//
// ── The resolution model is unchanged ───────────────────────────────────────
// A batch normally has ZERO rows in `batch_products` and inherits its products
// from its unit's `product_units` rows (see db/schemas/dashboard.ts). So
// "does this batch offer this product" is:
//
//     inherited (product_units row for the batch's unit)
//       AND NOT excluded (batch_products EXCLUDE)
//     OR added (batch_products ADD)
//
// PUT therefore does NOT write a row per batch. It writes only the exceptions:
// a batch that should offer the product and already inherits it needs no row,
// and forcing one in would turn every inherited relationship into an explicit
// override and destroy the inheritance the whole feature exists for.

const ok = <T>(data: T) => NextResponse.json({ success: true, data }, { status: 200 })
const bad = (msg: string, status = 400) => NextResponse.json({ success: false, error: msg }, { status })
const notFound = () => NextResponse.json({ success: false, error: 'Product not found' }, { status: 404 })

interface BatchLink {
  batchId: string
  code: string
  name: string
  enterprise: string
  unitId: string
  unitName: string
  /** Does this batch offer the product right now? */
  offers: boolean
  /** Would it offer it with no override — i.e. does its unit carry it? */
  inherits: boolean
  /** How the current answer was reached, for a UI that must not present an override as a choice the farmer made. */
  via: 'inherited' | 'added' | 'excluded' | 'not-offered'
}

async function loadLinks(tenantId: string, productId: string): Promise<BatchLink[]> {
  const rows = await db
    .select({
      batchId: batches.id,
      code: batches.code,
      name: batches.name,
      enterprise: batches.enterprise,
      unitId: batches.unitId,
      unitName: productionUnits.name,
    })
    .from(batches)
    .innerJoin(productionUnits, eq(productionUnits.id, batches.unitId))
    .where(and(eq(batches.tenantId, tenantId), eq(batches.status, 'ACTIVE')))
    .orderBy(asc(batches.enterprise), asc(batches.code))

  if (rows.length === 0) return []

  // Which units carry this product (the inheritance source).
  const carryingUnits = new Set(
    (await db
      .select({ unitId: productUnits.unitId })
      .from(productUnits)
      .where(and(eq(productUnits.tenantId, tenantId), eq(productUnits.productId, productId)))
    ).map((r) => r.unitId)
  )

  // Per-batch overrides for this product only.
  const overrides = new Map(
    (await db
      .select({ batchId: batchProducts.batchId, mode: batchProducts.mode })
      .from(batchProducts)
      .where(and(
        eq(batchProducts.tenantId, tenantId),
        eq(batchProducts.productId, productId),
        inArray(batchProducts.batchId, rows.map((r) => r.batchId)),
      ))
    ).map((r) => [r.batchId, r.mode])
  )

  return rows.map((r) => {
    const inherits = carryingUnits.has(r.unitId)
    const mode = overrides.get(r.batchId)
    const offers = mode === 'ADD' ? true : mode === 'EXCLUDE' ? false : inherits
    const via: BatchLink['via'] = mode === 'ADD'
      ? 'added'
      : mode === 'EXCLUDE'
        ? 'excluded'
        : inherits ? 'inherited' : 'not-offered'
    return { ...r, inherits, offers, via }
  })
}

// GET /api/products/[id]/batches — every active batch, and whether it offers
// this product. Returns ALL batches rather than only the offering ones,
// because the screen this backs is a set of checkboxes: it has to render the
// unticked ones too.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const auth = await requireTenantSession()
  if ('error' in auth) return auth.error
  const { tenantId } = auth

  const [product] = await db
    .select({ id: products.id, name: products.name })
    .from(products)
    .where(and(eq(products.id, id), eq(products.tenantId, tenantId)))
    .limit(1)
  if (!product) return notFound()

  return ok({ product, batches: await loadLinks(tenantId, id) })
}

// PUT /api/products/[id]/batches — set which batches offer this product.
// Body: { batchIds: string[] } — the batches that SHOULD offer it. Everything
// else should not.
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const auth = await requireTenantSession()
  if ('error' in auth) return auth.error
  const { session, tenantId } = auth

  // Same gate as the per-batch route's PUT: this is batch configuration.
  if (!(await canEdit(tenantId, session.role, MODULES.batches))) {
    return forbidden('Your role does not have edit access to batches')
  }

  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return bad('Invalid JSON body')
  }
  const b = (raw ?? {}) as Record<string, unknown>
  if (!Array.isArray(b.batchIds)) return bad('batchIds must be an array')

  const [product] = await db
    .select({ id: products.id })
    .from(products)
    .where(and(eq(products.id, id), eq(products.tenantId, tenantId)))
    .limit(1)
  if (!product) return notFound()

  const wanted = new Set(
    (b.batchIds as unknown[]).map((v) => (typeof v === 'string' ? v.trim() : '')).filter(Boolean)
  )

  const links = await loadLinks(tenantId, id)
  const known = new Set(links.map((l) => l.batchId))
  for (const wantedId of wanted) {
    // A batch id this tenant does not have is a 400, not a silent no-op —
    // otherwise a typo looks like a successful save that changed nothing.
    if (!known.has(wantedId)) return bad('One of those batches is not on this farm')
  }

  // ── Only the exceptions are written ──────────────────────────────────────
  // Four cases per batch, and two of them mean "delete the override":
  //   wants + inherits  -> no row (plain inheritance; this is the common case)
  //   wants + !inherits -> ADD
  //   !wants + inherits -> EXCLUDE
  //   !wants + !inherits-> no row (it was never offered)
  // Writing a row for the first case would convert every inherited link into
  // an explicit override, so a later change to the UNIT would stop reaching
  // its batches — silently breaking the inheritance the model is built on.
  await db.transaction(async (tx) => {
    for (const link of links) {
      const wants = wanted.has(link.batchId)
      const needed: 'ADD' | 'EXCLUDE' | null = wants
        ? (link.inherits ? null : 'ADD')
        : (link.inherits ? 'EXCLUDE' : null)
      const current = link.via === 'added' ? 'ADD' : link.via === 'excluded' ? 'EXCLUDE' : null
      if (needed === current) continue

      await tx.delete(batchProducts).where(and(
        eq(batchProducts.tenantId, tenantId),
        eq(batchProducts.batchId, link.batchId),
        eq(batchProducts.productId, id),
      ))
      if (needed) {
        await tx.insert(batchProducts).values({
          id: randomUUID(), tenantId, batchId: link.batchId, productId: id, mode: needed,
        })
      }
    }
  })

  return ok({ product, batches: await loadLinks(tenantId, id) })
}
