import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/auth'
import { createReportSnapshot, listReportSnapshots } from '@/lib/report-snapshots'
import type { ReportPayload } from '@/lib/report-types'

function ownerOrManager(role: string) { return role === 'owner' || role === 'manager' }

export async function GET() {
  const session = await getSessionUser()
  if (!session || !session.tenantId) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
  if (!ownerOrManager(session.role)) return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 })
  return NextResponse.json({ success: true, data: { snapshots: await listReportSnapshots(session.tenantId) } })
}

export async function POST(req: Request) {
  const session = await getSessionUser()
  if (!session || !session.tenantId) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
  if (!ownerOrManager(session.role)) return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 })
  const body = await req.json().catch(() => null) as { reportType?: unknown; farmId?: unknown; purpose?: unknown; payload?: unknown } | null
  if (!body || typeof body.reportType !== 'string' || !body.reportType || !body.payload || typeof body.payload !== 'object') return NextResponse.json({ success: false, error: 'Report type and payload are required.' }, { status: 400 })
  const snapshot = await createReportSnapshot({
    tenantId: session.tenantId, reportType: body.reportType, farmId: typeof body.farmId === 'string' && body.farmId !== 'ALL' ? body.farmId : undefined,
    purpose: typeof body.purpose === 'string' ? body.purpose.slice(0, 80) : 'Internal', payload: body.payload as ReportPayload, createdBy: session.name,
  })
  return NextResponse.json({ success: true, data: snapshot }, { status: 201 })
}
