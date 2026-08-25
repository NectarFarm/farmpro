import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/auth'
import { farmNotFoundResponse, resolveFarmFilter } from '@/lib/farm-scope'
import { computeProductionReport, parseDateRange, InvalidDateRangeError, REPORT_VIEWER_ROLES } from '@/lib/reports'

// ── GET /api/reports/production (issue #376 Gap 3) ──────────────────────────
// Derived from the real `records` table (`type: 'production'`) — see
// lib/reports.ts's computeProductionReport. Same role gate + session-only
// tenant contract as GET /api/reports/mortality.

const ok = <T>(data: T) => NextResponse.json({ success: true, data }, { status: 200 })
const badRequest = (msg: string) => NextResponse.json({ success: false, error: msg }, { status: 400 })
const unauthorized = () => NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
const forbidden = () => NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 })

export async function GET(req: Request) {
  const session = await getSessionUser()
  if (!session) return unauthorized()
  if (!REPORT_VIEWER_ROLES.has(session.role)) return forbidden()
  const url = new URL(req.url)
  const tenantId = session.tenantId
  if (!tenantId) return badRequest('tenantId is required')

  const farmFilter = await resolveFarmFilter(tenantId, url.searchParams.get('farmId'))
  if (farmFilter === null) return NextResponse.json(farmNotFoundResponse(), { status: 404 })

  try {
    const { from, to } = parseDateRange(url.searchParams.get('from'), url.searchParams.get('to'))
    const report = await computeProductionReport(tenantId, from, to, farmFilter ?? undefined)
    return ok(report)
  } catch (err) {
    if (err instanceof InvalidDateRangeError) return badRequest(err.message)
    throw err
  }
}
