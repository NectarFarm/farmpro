import { NextResponse } from 'next/server'
import { and, eq, sum } from 'drizzle-orm'
import { db } from '@/db'
import { batches, productCollections, products, sales } from '@/db/schemas'
import { requireTenantSession } from '@/lib/api-auth'

// ── GET /api/produce/available (worker-routines task) ───────────────────────
// How much of each product has been collected and not yet sold.
//
// Derived rather than stored as a running column: the two sides of it —
// collections and sales — are both already recorded, and a cached balance is
// one more number that can silently disagree with the events beneath it. The
// volumes here are per-batch daily counts, so summing them is cheap; if that
// ever stops being true the fix is a materialised total, not a second source
// of truth maintained by hand.
//
// `batchId` narrows it to one batch; without it the answer is the tenant's
// whole unsold produce, which is what a sale from the Finance screen needs.

const ok = <T>(data: T) => NextResponse.json({ success: true, data }, { status: 200 })

export async function GET(req: Request) {
  const url = new URL(req.url)
  const auth = await requireTenantSession({ explicitTenantId: url.searchParams.get('tenantId') })
  if ('error' in auth) return auth.error
  const { tenantId } = auth

  const batchId = url.searchParams.get('batchId')?.trim() || null
  if (batchId) {
    const [batch] = await db
      .select({ id: batches.id })
      .from(batches)
      .where(and(eq(batches.id, batchId), eq(batches.tenantId, tenantId)))
      .limit(1)
    if (!batch) return NextResponse.json({ success: false, error: 'Batch not found' }, { status: 404 })
  }

  const collectedConditions = [eq(productCollections.tenantId, tenantId)]
  if (batchId) collectedConditions.push(eq(productCollections.batchId, batchId))
  const collected = await db
    .select({ productId: productCollections.productId, qty: sum(productCollections.qty) })
    .from(productCollections)
    .where(and(...collectedConditions))
    .groupBy(productCollections.productId)

  // Only sales that named a quantity can be netted off. One that didn't
  // (every sale recorded before sales.qty existed, and any bulk lot entered
  // as an amount alone) is left out rather than guessed at — an invented
  // quantity here would understate the produce on hand and block real sales.
  const soldConditions = [eq(sales.tenantId, tenantId)]
  if (batchId) soldConditions.push(eq(sales.batchId, batchId))
  const sold = await db
    .select({ productId: sales.productId, qty: sum(sales.qty) })
    .from(sales)
    .where(and(...soldConditions))
    .groupBy(sales.productId)

  const soldByProduct = new Map(sold.map((r) => [r.productId, Number(r.qty ?? 0)]))

  const catalogue = await db
    .select({ id: products.id, name: products.name, stockEffect: products.stockEffect })
    .from(products)
    .where(eq(products.tenantId, tenantId))
  const byId = new Map(catalogue.map((p) => [p.id, p]))

  return ok(collected.map((row) => {
    const product = byId.get(row.productId)
    const collectedQty = Number(row.qty ?? 0)
    const soldQty = soldByProduct.get(row.productId) ?? 0
    return {
      productId: row.productId,
      name: product?.name ?? 'Unknown product',
      stockEffect: product?.stockEffect ?? 'produce',
      collected: collectedQty,
      sold: soldQty,
      available: collectedQty - soldQty,
    }
  }))
}
