import { NextResponse } from 'next/server'
import { requireTenantSession } from '@/lib/api-auth'

// ── GET /api/charts/production (issue #228) ─────────────────────────────────
// New, minimal endpoint. There is no production data source anywhere on this
// branch — no `batches` and no `productionRecords` table (Epic: Crops &
// Batches hasn't landed) — so there is nothing real to chart yet.
//
// Per this issue's own instruction ("don't fabricate a chart... return an
// explicitly-empty/zero series with a note"), this always returns
// `available: false` with an empty `series` and a `reason` string. It does
// NOT invent plausible-looking bars. The frontend renders an explicit
// "production chart not available yet" state off `available`, never a fake
// graph.
//
// Revisit once a real production/batches table lands: replace the empty
// series with a real per-day (or per-product) aggregate query scoped to
// tenantId, and flip `available` to true. tenantId is still required today
// (same convention as every other route here) so the contract doesn't need to
// change shape when that lands.

const ok = <T>(data: T) => NextResponse.json({ success: true, data }, { status: 200 })

export interface ProductionSeriesPoint {
  date: string
  value: number
}

export async function GET() {
  const auth = await requireTenantSession()
  if ('error' in auth) return auth.error

  return ok({
    available: false,
    reason: 'No production data source exists yet (Epic: Crops & Batches has not landed).',
    series: [] as ProductionSeriesPoint[],
  })
}
