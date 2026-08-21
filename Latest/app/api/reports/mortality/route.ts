import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/auth'
import { farmNotFoundResponse, resolveFarmFilter } from '@/lib/farm-scope'
import { computeMortalityReport, parseDateRange, InvalidDateRangeError } from '@/lib/reports'

// ── GET /api/reports/mortality (issue #263 task 3) ──────────────────────────
// Derived from the real `records` table (`type: 'mortality'`), tenant-scoped
// and filtered by `from`/`to` on `createdAt` — see lib/reports.ts's
// computeMortalityReport. Same tenant-resolution conventions as GET /api/records.

const ok = <T>(data: T) => NextResponse.json({ success: true, data }, { status: 200 })
const badRequest = (msg: string) => NextResponse.json({ success: false, error: msg }, { status: 400 })

export async function GET(req: Request) {
  const session = await getSessionUser()
  const url = new URL(req.url)
  const tenantId = session?.tenantId ?? url.searchParams.get('tenantId')?.trim()
  if (!tenantId) return badRequest('tenantId is required')

  const farmFilter = await resolveFarmFilter(tenantId, url.searchParams.get('farmId'))
  if (farmFilter === null) return NextResponse.json(farmNotFoundResponse(), { status: 404 })

  try {
    const { from, to } = parseDateRange(url.searchParams.get('from'), url.searchParams.get('to'))
    const report = await computeMortalityReport(tenantId, from, to, farmFilter ?? undefined)
    return ok(report)
  } catch (err) {
    if (err instanceof InvalidDateRangeError) return badRequest(err.message)
    throw err
  }
}
