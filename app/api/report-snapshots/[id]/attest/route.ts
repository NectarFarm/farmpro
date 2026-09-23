import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/auth'
import { attestReportSnapshot } from '@/lib/report-snapshots'

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSessionUser()
  if (!session || !session.tenantId) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
  if (session.role !== 'owner' && session.role !== 'manager') return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 })
  const body = await req.json().catch(() => null) as { name?: unknown; role?: unknown } | null
  if (!body || typeof body.name !== 'string' || !body.name.trim() || typeof body.role !== 'string' || !body.role.trim()) return NextResponse.json({ success: false, error: 'Name and role are required for attestation.' }, { status: 400 })
  const { id } = await params
  const snapshot = await attestReportSnapshot({ tenantId: session.tenantId, id, name: body.name.trim().slice(0, 120), role: body.role.trim().slice(0, 120) })
  if (!snapshot) return NextResponse.json({ success: false, error: 'Snapshot not found.' }, { status: 404 })
  return NextResponse.json({ success: true, data: snapshot })
}
