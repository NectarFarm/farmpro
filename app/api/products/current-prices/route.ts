import { NextResponse } from 'next/server'
import { db } from '@/db'
import { products } from '@/db/schemas'
import { getSessionUser } from '@/lib/auth'
import { asc, eq } from 'drizzle-orm'

// ── GET /api/products/current-prices (issue #227 task 1) ──────────────────
// Backs the dashboard's price strip: current sale price per product, read
// from `products.saleUnits` (see db/schemas/dashboard.ts for why that column
// is named `saleUnits` — it's the reference contract's field name for this
// endpoint's price value).
//
// `products` didn't exist on this branch before this issue — built minimal
// here (tenantId/type/name/saleUnits only). A fuller product catalogue
// (SKUs, units-of-measure, isMainProduct/isCostDriver) is Epic: Crops &
// Batches' job (#230/#231/#232); extend this table in place when that lands.
//
// Same tenant-resolution + response-envelope conventions as GET /api/farms:
// session tenant wins, `tenantId` query param is the standalone-mock-mode
// fallback. No CORS headers — same-origin SPA only (matches the auth routes'
// convention, not the older wildcard-CORS routes).

const ok = <T>(data: T) => NextResponse.json({ success: true, data }, { status: 200 })
const badRequest = (msg: string) => NextResponse.json({ success: false, error: msg }, { status: 400 })

export async function GET(req: Request) {
  const session = await getSessionUser()
  const tenantId = session?.tenantId ?? new URL(req.url).searchParams.get('tenantId')?.trim()
  if (!tenantId) return badRequest('tenantId is required')

  const rows = await db
    .select()
    .from(products)
    .where(eq(products.tenantId, tenantId))
    .orderBy(asc(products.type), asc(products.name))

  return ok(
    rows.map((p) => ({
      id: p.id,
      type: p.type,
      name: p.name,
      currentPrice: Number(p.saleUnits),
    }))
  )
}
