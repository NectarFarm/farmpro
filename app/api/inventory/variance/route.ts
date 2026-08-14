import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/auth'
import { computeVariance } from '@/lib/inventory'

// ── GET /api/inventory/variance (issue #235 task 4) ─────────────────────────
// See lib/inventory.ts's header comment above computeVariance for the full
// variance-scope decision. Short version: with no physical-counts table on
// this branch, a numeric "expected vs actual" gap would be fabricated (there
// is no independent count to diff against `qtyOnHand`). What's real: how
// stale each lot's on-hand figure is since its last confirmed event (receipt
// or a reason-audited adjustment) — flagged past
// lib/inventory.ts's VARIANCE_STALENESS_DAYS.

const ok = <T>(data: T) => NextResponse.json({ success: true, data }, { status: 200 })
const badRequest = (msg: string) => NextResponse.json({ success: false, error: msg }, { status: 400 })

export async function GET(req: Request) {
  const session = await getSessionUser()
  const tenantId = session?.tenantId ?? new URL(req.url).searchParams.get('tenantId')?.trim()
  if (!tenantId) return badRequest('tenantId is required')

  const rows = await computeVariance(tenantId)
  return ok(rows)
}
