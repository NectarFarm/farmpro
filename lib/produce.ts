// ── Unsold produce (worker-routines task) ───────────────────────────────────
// Collected minus sold, for one product. Shared by the sale route (which must
// refuse selling more eggs than were ever collected) and by the read endpoint
// the sale form uses to show the figure, so the number a user is shown and
// the number enforced on submit come from the same query.
import 'server-only'
import { and, eq, sum } from 'drizzle-orm'
import { db } from '@/db'
import { productCollections, sales } from '@/db/schemas'

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

export async function availableProduce(
  tenantId: string,
  productId: string,
  batchId: string | null,
  tx?: Tx
): Promise<number> {
  const conn = tx ?? db

  const collectedConditions = [
    eq(productCollections.tenantId, tenantId),
    eq(productCollections.productId, productId),
  ]
  if (batchId) collectedConditions.push(eq(productCollections.batchId, batchId))
  const [collected] = await conn
    .select({ qty: sum(productCollections.qty) })
    .from(productCollections)
    .where(and(...collectedConditions))

  const soldConditions = [eq(sales.tenantId, tenantId), eq(sales.productId, productId)]
  if (batchId) soldConditions.push(eq(sales.batchId, batchId))
  const [sold] = await conn
    .select({ qty: sum(sales.qty) })
    .from(sales)
    .where(and(...soldConditions))

  return Number(collected?.qty ?? 0) - Number(sold?.qty ?? 0)
}

export class ProduceShortfallError extends Error {
  constructor(public productName: string, public requested: number, public available: number) {
    super(
      available <= 0
        ? `No ${productName} has been collected yet — record the collection before selling it`
        : `Only ${available} of ${productName} collected and unsold — you entered ${requested}`
    )
  }
}
