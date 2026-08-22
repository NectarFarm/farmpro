import { NextResponse } from 'next/server'
import { computeVariance } from '@/lib/inventory'
import { requireTenantSession } from '@/lib/api-auth'

// ── GET /api/inventory/variance (issue #235 task 4) ─────────────────────────
// See lib/inventory.ts's header comment above computeVariance for the full
// variance-scope decision. Short version: with no physical-counts table on
// this branch, a numeric "expected vs actual" gap would be fabricated (there
// is no independent count to diff against `qtyOnHand`). What's real: how
// stale each lot's on-hand figure is since its last confirmed event (receipt
// or a reason-audited adjustment) — flagged past
// lib/inventory.ts's VARIANCE_STALENESS_DAYS.

const ok = <T>(data: T) => NextResponse.json({ success: true, data }, { status: 200 })

export async function GET() {
  const auth = await requireTenantSession()
  if ('error' in auth) return auth.error

  const rows = await computeVariance(auth.tenantId)
  return ok(rows)
}
