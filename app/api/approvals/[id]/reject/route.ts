import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/auth'
import { ApprovalError, decideApproval } from '@/lib/governance'
import { canEdit, MODULES } from '@/lib/permissions'

// ── POST /api/approvals/[id]/reject (issue #243 task 2) ─────────────────────
// See app/api/approvals/[id]/approve/route.ts for the session/permission
// gating rationale — identical here, just the opposite decision.
const bad = (msg: string, status = 400) => NextResponse.json({ success: false, error: msg }, { status })

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSessionUser()
  if (!session) return bad('Unauthorized', 401)
  if (!session.tenantId) return bad('Forbidden', 403)
  if (!(await canEdit(session.tenantId, session.role, MODULES.governance))) return bad('Forbidden', 403)

  const { id } = await params

  try {
    const result = await decideApproval(id, session.tenantId, session.id, 'rejected')
    return NextResponse.json({ success: true, data: result }, { status: 200 })
  } catch (err) {
    if (err instanceof ApprovalError) return bad(err.message, err.status)
    return bad('Failed to reject request', 500)
  }
}
