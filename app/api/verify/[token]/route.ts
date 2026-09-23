import { NextResponse } from 'next/server'
import { getPublicReportSnapshot, hashReportPayload } from '@/lib/report-snapshots'

export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const snapshot = await getPublicReportSnapshot(token)
  if (!snapshot) return NextResponse.json({ success: false, error: 'Document not found.' }, { status: 404 })
  return NextResponse.json({ success: true, data: {
    reportType: snapshot.reportType, title: snapshot.payload.title, period: String(snapshot.payload.meta.periodLabel ?? ''),
    status: snapshot.status, purpose: snapshot.purpose, createdAt: snapshot.createdAt, attestedBy: snapshot.attestedBy,
    attestedRole: snapshot.attestedRole, attestedAt: snapshot.attestedAt, hash: snapshot.payloadHash,
    hashMatches: hashReportPayload(snapshot.payload) === snapshot.payloadHash,
  } })
}
