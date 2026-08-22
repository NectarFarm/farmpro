import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/auth'
import { farmNotFoundResponse, resolveFarmFilter } from '@/lib/farm-scope'
import { computePlReport, parseDateRange, InvalidDateRangeError, REPORT_VIEWER_ROLES } from '@/lib/reports'

// ── GET /api/reports/pl (issue #263 task 1; role-gated + session-only tenant
// for the vet/auditor screens task) ─────────────────────────────────────────
// Tenant-scoped, `from`/`to` date-range filtered. See lib/reports.ts's
// computePlReport for the full shape rationale (GL totals vs period
// breakdown). Tenant comes from the SESSION ONLY now — this route used to
// fall back to a `?tenantId=` query param for a session-less caller, which
// meant P&L data for any tenant was readable by anyone who guessed its id.
// See lib/reports.ts's REPORT_VIEWER_ROLES for the role allowlist (this
// route previously had no role gate at all).

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
    const report = await computePlReport(tenantId, from, to, farmFilter ?? undefined)
    return ok(report)
  } catch (err) {
    if (err instanceof InvalidDateRangeError) return badRequest(err.message)
    throw err
  }
}
