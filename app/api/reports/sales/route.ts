import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/auth'
import { farmNotFoundResponse, resolveFarmFilter } from '@/lib/farm-scope'
import { computeSalesRegisterReport, InvalidDateRangeError, parseDateRange, REPORT_VIEWER_ROLES, withReportCache } from '@/lib/reports'

export async function GET(req: Request) {
  const session = await getSessionUser()
  if (!session) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
  if (!REPORT_VIEWER_ROLES.has(session.role) || !session.tenantId) return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 })
  const url = new URL(req.url)
  const farmId = await resolveFarmFilter(session.tenantId, url.searchParams.get('farmId'))
  if (farmId === null) return NextResponse.json(farmNotFoundResponse(), { status: 404 })
  try {
    const { from, to } = parseDateRange(url.searchParams.get('from'), url.searchParams.get('to'))
    const report = await withReportCache('sales-register', session.tenantId, from, to, farmId ?? undefined, () => computeSalesRegisterReport(session.tenantId!, from, to, farmId ?? undefined))
    return NextResponse.json({ success: true, data: report })
  } catch (error) {
    if (error instanceof InvalidDateRangeError) return NextResponse.json({ success: false, error: error.message }, { status: 400 })
    throw error
  }
}
