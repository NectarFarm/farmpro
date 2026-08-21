import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/auth'
import { farmNotFoundResponse, resolveFarmFilter } from '@/lib/farm-scope'
import { computeFeedConsumptionReport, parseDateRange, InvalidDateRangeError, REPORT_VIEWER_ROLES } from '@/lib/reports'

// ── GET /api/reports/feed-consumption (issue #263 task 3; role-gated +
// session-only tenant for the vet/auditor screens task) ─────────────────────
// Derived from the real `records` table (`type: 'feeding'`), tenant-scoped
// and filtered by `from`/`to` on `createdAt` — see lib/reports.ts's
// computeFeedConsumptionReport. Tenant comes from the SESSION ONLY now (see
// GET /api/reports/pl's header for why); see lib/reports.ts's
// REPORT_VIEWER_ROLES for the role allowlist (this route previously had no
// role gate at all).

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
    const report = await computeFeedConsumptionReport(tenantId, from, to, farmFilter ?? undefined)
    return ok(report)
  } catch (err) {
    if (err instanceof InvalidDateRangeError) return badRequest(err.message)
    throw err
  }
}
