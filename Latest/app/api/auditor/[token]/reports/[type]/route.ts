import { NextResponse } from 'next/server'
import { resolveAuditorTenantId } from '@/lib/auditor'
import {
  computeBatchPlReport,
  computeFeedConsumptionReport,
  computeMortalityReport,
  computePlReport,
  InvalidDateRangeError,
  parseDateRange,
} from '@/lib/reports'

// ── GET /api/auditor/[token]/reports/[type] (issue #313) ────────────────────
// Token-gated read-only twin of GET /api/reports/* (issue #295): same
// lib/reports.ts compute functions, same ReportPayload envelope, same
// `from`/`to` query params — no forked report logic, just a different gate.
// `token` replaces the session/tenantId that the real routes use to resolve
// a tenant: resolveAuditorTenantId only returns a tenant id for a token that
// exists, hasn't expired, and hasn't been revoked (lib/auditor.ts) — an
// invalid/expired/revoked token gets a flat 401, never a fallback to some
// other tenant-resolution path.
//
// Read-only by construction, not just by convention: this file defines no
// POST/PUT/PATCH/DELETE handler, so any write attempt against this path
// 405s in the framework before a single line of this module runs.
const COMPUTE = {
  pl: computePlReport,
  'batch-pl': computeBatchPlReport,
  mortality: computeMortalityReport,
  feed: computeFeedConsumptionReport,
} satisfies Record<string, (tenantId: string, from: Date | null, to: Date | null) => Promise<unknown>>

type ReportType = keyof typeof COMPUTE

function isReportType(v: string): v is ReportType {
  return Object.prototype.hasOwnProperty.call(COMPUTE, v)
}

const ok = <T>(data: T) => NextResponse.json({ success: true, data }, { status: 200 })
const bad = (msg: string, status = 400) => NextResponse.json({ success: false, error: msg }, { status })

export async function GET(req: Request, { params }: { params: Promise<{ token: string; type: string }> }) {
  const { token, type } = await params

  const tenantId = await resolveAuditorTenantId(token)
  if (!tenantId) return bad('This link is invalid, expired, or has been revoked.', 401)

  if (!isReportType(type)) return bad(`Unknown report type "${type}"`, 404)

  const url = new URL(req.url)
  try {
    const { from, to } = parseDateRange(url.searchParams.get('from'), url.searchParams.get('to'))
    const report = await COMPUTE[type](tenantId, from, to)
    return ok(report)
  } catch (err) {
    if (err instanceof InvalidDateRangeError) return bad(err.message)
    throw err
  }
}
