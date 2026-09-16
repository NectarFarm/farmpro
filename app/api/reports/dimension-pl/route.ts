import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/auth'
import { computeDimensionPlReport, parseDateRange, InvalidDateRangeError, REPORT_VIEWER_ROLES, withReportCache } from '@/lib/reports'
import { DimensionNotFoundError } from '@/lib/dimensions'

// ── GET /api/reports/dimension-pl (dimensions-on-gl task) ───────────────────
// The owner's main reporting ask: a P&L grouped by a chosen dimension, at a
// chosen level, rolling child values up into their parent — see
// lib/reports.ts's computeDimensionPlReport for the full shape. Same auth/
// role-gate/cache conventions as GET /api/reports/pl (this route is its
// sibling, not a replacement — computePlReport's all-farm/all-time GL
// caveat stays honest for tenants that haven't set up dimensions yet).
//
// Query params: `dimension` (code, required — e.g. "FARM"), `level`
// (1-based ordinal, defaults to 1), `from`/`to` (optional date range).

const ok = <T>(data: T) => NextResponse.json({ success: true, data }, { status: 200 })
const badRequest = (msg: string) => NextResponse.json({ success: false, error: msg }, { status: 400 })
const notFound = (msg: string) => NextResponse.json({ success: false, error: msg }, { status: 404 })
const unauthorized = () => NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
const forbidden = () => NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 })

export async function GET(req: Request) {
  const session = await getSessionUser()
  if (!session) return unauthorized()
  if (!REPORT_VIEWER_ROLES.has(session.role)) return forbidden()
  const url = new URL(req.url)
  const tenantId = session.tenantId
  if (!tenantId) return badRequest('tenantId is required')

  const dimensionCode = url.searchParams.get('dimension')?.trim().toUpperCase()
  if (!dimensionCode) return badRequest('dimension is required (e.g. "FARM")')
  const levelParam = url.searchParams.get('level')
  const level = levelParam ? Math.trunc(Number(levelParam)) : 1
  if (levelParam && (!Number.isFinite(level) || level < 1)) return badRequest('level must be a positive integer')

  try {
    const { from, to } = parseDateRange(url.searchParams.get('from'), url.searchParams.get('to'))
    const report = await withReportCache(
      `dimension-pl:${dimensionCode}:${level}`, tenantId, from, to, undefined,
      () => computeDimensionPlReport(tenantId, dimensionCode, level, from, to),
    )
    return ok(report)
  } catch (err) {
    if (err instanceof InvalidDateRangeError) return badRequest(err.message)
    if (err instanceof DimensionNotFoundError) return notFound(err.message)
    throw err
  }
}
