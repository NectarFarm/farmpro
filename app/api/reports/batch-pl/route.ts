import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/auth'
import { computeBatchPlReport, parseDateRange, InvalidDateRangeError } from '@/lib/reports'

// ── GET /api/reports/batch-pl (issue #263 task 2) ───────────────────────────
// Per-batch P&L: composes GET /api/batches (list) + each batch's real
// cost-breakdown, server-side, in one shot — see lib/reports.ts's
// computeBatchPlReport for the full composition + date-range caveat.
// Same tenant-resolution conventions as GET /api/batches.

const ok = <T>(data: T) => NextResponse.json({ success: true, data }, { status: 200 })
const badRequest = (msg: string) => NextResponse.json({ success: false, error: msg }, { status: 400 })

export async function GET(req: Request) {
  const session = await getSessionUser()
  const url = new URL(req.url)
  const tenantId = session?.tenantId ?? url.searchParams.get('tenantId')?.trim()
  if (!tenantId) return badRequest('tenantId is required')

  try {
    const { from, to } = parseDateRange(url.searchParams.get('from'), url.searchParams.get('to'))
    const report = await computeBatchPlReport(tenantId, from, to)
    return ok(report)
  } catch (err) {
    if (err instanceof InvalidDateRangeError) return badRequest(err.message)
    throw err
  }
}
