import { NextResponse } from 'next/server'
import { requireTenantSession } from '@/lib/api-auth'
import { farmNotFoundResponse, resolveFarmFilter } from '@/lib/farm-scope'
import { computeVatReport, parseDateRange, InvalidDateRangeError, withReportCache } from '@/lib/reports'

// GET /api/reports/vat?from&to — a bookkeeper's VAT summary for a period.
// Not a return. Same viewer roles as the other financial reports.

const ok = <T>(data: T) => NextResponse.json({ success: true, data }, { status: 200 })
const badRequest = (msg: string) => NextResponse.json({ success: false, error: msg }, { status: 400 })

const VIEWERS = ['owner', 'manager', 'super_admin', 'auditor'] as const

export async function GET(req: Request) {
  const url = new URL(req.url)
  const auth = await requireTenantSession({
    roles: [...VIEWERS],
    explicitTenantId: url.searchParams.get('tenantId'),
  })
  if ('error' in auth) return auth.error
  const { tenantId } = auth

  const farmFilter = await resolveFarmFilter(tenantId, url.searchParams.get('farmId'))
  if (farmFilter === null) return NextResponse.json(farmNotFoundResponse(), { status: 404 })

  try {
    const { from, to } = parseDateRange(url.searchParams.get('from'), url.searchParams.get('to'))
    const report = await withReportCache('vat', tenantId, from, to, farmFilter ?? undefined, () =>
      computeVatReport(tenantId, from, to, farmFilter ?? undefined),
    )
    return ok(report)
  } catch (err) {
    if (err instanceof InvalidDateRangeError) return badRequest(err.message)
    throw err
  }
}
