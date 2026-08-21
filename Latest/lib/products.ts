// ── Shared product-catalogue + inheritance logic (product-unit-inheritance
// task) ──────────────────────────────────────────────────────────────────────
// Centralizes the one non-trivial query this feature needs — "what products
// does this batch actually offer, and which of those were inherited versus
// explicitly overridden" — so every caller (the API route, tests, and any
// future UI-facing endpoint) shares one implementation instead of drifting.
//
// See db/schemas/dashboard.ts for the full inheritance-model writeup
// (products -> product_units -> batch_products). Short version: a batch
// normally has ZERO rows in `batch_products` and inherits 100% of its
// products from its unit's `product_units` rows — that's the whole point of
// the feature (the farmer configures a unit once, every batch under it just
// works). `batch_products` only ever holds the exceptions.
import 'server-only'
import { randomUUID } from 'node:crypto'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { db } from '@/db'
import { products, productUnits, batchProducts, productionUnits, batches } from '@/db/schemas'

export type ResolvedProduct = {
  id: string
  tenantId: string
  type: string
  name: string
  saleUnits: string
  status: string
  createdAt: Date | null
  inherited: boolean
  sourceUnitId: string | null
  sourceUnitName: string | null
}

// The one-query resolution: given a batch, return its full resolved product
// list in a single round trip to Postgres.
//
//   inherited candidates = product_units rows for the batch's unit
//                           MINUS anything EXCLUDEd in batch_products
//   plus                 = batch_products rows with mode = 'ADD'
//
// Returns null if the batch does not exist for this tenant (caller 404s).
export async function resolveBatchProducts(tenantId: string, batchId: string): Promise<ResolvedProduct[] | null> {
  const batchRows = await db
    .select({ id: batches.id, unitId: batches.unitId })
    .from(batches)
    .where(and(eq(batches.id, batchId), eq(batches.tenantId, tenantId)))
  const batch = batchRows[0]
  if (!batch) return null

  // A single SQL statement (CTEs + UNION ALL) — one query, one round trip,
  // computed entirely in Postgres rather than fetched-then-merged in JS.
  const result = await db.execute(sql`
    WITH excluded AS (
      SELECT product_id FROM ${batchProducts}
      WHERE ${batchProducts.batchId} = ${batchId} AND ${batchProducts.mode} = 'EXCLUDE'
    ),
    inherited_rows AS (
      SELECT p.id, p.tenant_id, p.type, p.name, p.sale_units, p.status, p.created_at,
             true AS inherited, pu.unit_id AS source_unit_id, u.name AS source_unit_name
      FROM ${productUnits} pu
      JOIN ${products} p ON p.id = pu.product_id
      JOIN ${productionUnits} u ON u.id = pu.unit_id
      WHERE pu.unit_id = ${batch.unitId}
        AND p.status = 'ACTIVE'
        AND pu.product_id NOT IN (SELECT product_id FROM excluded)
    ),
    added_rows AS (
      SELECT p.id, p.tenant_id, p.type, p.name, p.sale_units, p.status, p.created_at,
             false AS inherited, NULL::text AS source_unit_id, NULL::text AS source_unit_name
      FROM ${batchProducts} bp
      JOIN ${products} p ON p.id = bp.product_id
      WHERE bp.batch_id = ${batchId} AND bp.mode = 'ADD' AND p.status = 'ACTIVE'
    )
    SELECT * FROM inherited_rows
    UNION ALL
    SELECT * FROM added_rows
    ORDER BY name
  `)

  return (result as unknown as Array<Record<string, unknown>>).map((r) => ({
    id: r.id as string,
    tenantId: r.tenant_id as string,
    type: r.type as string,
    name: r.name as string,
    saleUnits: r.sale_units as string,
    status: r.status as string,
    createdAt: r.created_at as Date | null,
    inherited: r.inherited as boolean,
    sourceUnitId: r.source_unit_id as string | null,
    sourceUnitName: r.source_unit_name as string | null,
  }))
}

// Products directly attached to a unit (no inheritance involved — this IS
// the unit's own configuration). Used by GET /api/units/[id]/products to
// prefill the picker, and internally by resolveBatchProducts' callers that
// need the unit's raw list rather than a batch's resolved one.
export async function getUnitProducts(tenantId: string, unitId: string) {
  return db
    .select({
      id: products.id,
      type: products.type,
      name: products.name,
      saleUnits: products.saleUnits,
      status: products.status,
    })
    .from(productUnits)
    .innerJoin(products, eq(products.id, productUnits.productId))
    .where(and(eq(productUnits.tenantId, tenantId), eq(productUnits.unitId, unitId)))
}

// Validates that every id in `ids` is a real, active-or-any-status product
// belonging to `tenantId`. Returns the deduped, trimmed list on success, or
// null if any id doesn't resolve — same "400/404 instead of a bare
// FK-violation 500" shape validateBatchIds (app/api/employees/route.ts) uses.
export async function validateProductIds(tenantId: string, ids: string[]): Promise<string[] | null> {
  const unique = Array.from(new Set(ids.map((id) => id.trim()).filter(Boolean)))
  if (unique.length === 0) return []
  const rows = await db
    .select({ id: products.id })
    .from(products)
    .where(and(eq(products.tenantId, tenantId), inArray(products.id, unique)))
  if (rows.length !== unique.length) return null
  return unique
}

// Replaces the FULL set of products a unit offers with exactly `productIds`
// — inserts what's missing, deletes what's no longer wanted. Callers must
// have already validated every id against the tenant (validateProductIds).
// Removing a product from a unit here does NOT touch batch_products —
// existing overrides on batches under this unit are left exactly as they
// are (an EXCLUDE row for a product the unit no longer offers is simply
// inert; an ADD row is unaffected either way since it doesn't depend on the
// unit's list at all).
export async function setUnitProducts(tenantId: string, unitId: string, productIds: string[]) {
  await db.transaction(async (tx) => {
    const existing = await tx
      .select({ productId: productUnits.productId })
      .from(productUnits)
      .where(and(eq(productUnits.tenantId, tenantId), eq(productUnits.unitId, unitId)))
    const existingIds = new Set(existing.map((r) => r.productId))
    const wantedIds = new Set(productIds)

    const toRemove = [...existingIds].filter((id) => !wantedIds.has(id))
    const toAdd = [...wantedIds].filter((id) => !existingIds.has(id))

    if (toRemove.length > 0) {
      await tx
        .delete(productUnits)
        .where(and(eq(productUnits.tenantId, tenantId), eq(productUnits.unitId, unitId), inArray(productUnits.productId, toRemove)))
    }
    if (toAdd.length > 0) {
      await tx.insert(productUnits).values(
        toAdd.map((productId) => ({ id: randomUUID(), tenantId, productId, unitId }))
      )
    }
  })
}

// Replaces the FULL set of batch-level overrides. `adds`/`excludes` are the
// desired final sets; anything currently in batch_products but absent from
// BOTH goes back to plain inheritance (row deleted). A product id present in
// both `adds` and `excludes` is rejected by the route before this is called
// — this function trusts its caller already resolved that conflict.
export async function setBatchOverrides(
  tenantId: string,
  batchId: string,
  adds: string[],
  excludes: string[]
) {
  await db.transaction(async (tx) => {
    await tx.delete(batchProducts).where(and(eq(batchProducts.tenantId, tenantId), eq(batchProducts.batchId, batchId)))
    const rows = [
      ...adds.map((productId) => ({ id: randomUUID(), tenantId, batchId, productId, mode: 'ADD' as const })),
      ...excludes.map((productId) => ({ id: randomUUID(), tenantId, batchId, productId, mode: 'EXCLUDE' as const })),
    ]
    if (rows.length > 0) await tx.insert(batchProducts).values(rows)
  })
}
