import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/auth'
import { ApprovalError, decideApproval } from '@/lib/governance'
import { canEdit, MODULES } from '@/lib/permissions'

// ── POST /api/approvals/[id]/reject (issue #243 task 2; rejection-loop task) ─
// See app/api/approvals/[id]/approve/route.ts for the session/permission
// gating rationale — identical here, just the opposite decision.
//
// `reason` is now REQUIRED, not optional. A rejection used to take no body
// at all — the worker who filed it learned only that it was rejected, with
// nothing to fix and nothing to say back. Refusing an empty one here is what
// makes every downstream piece of the rejection loop (the notification, the
// worker's "Needs another look" section, the approver's own detail panel)
// actually have something to show.
const bad = (msg: string, status = 400) => NextResponse.json({ success: false, error: msg }, { status })

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSessionUser()
  if (!session) return bad('Unauthorized', 401)
  if (!session.tenantId) return bad('Forbidden', 403)
  if (!(await canEdit(session.tenantId, session.role, MODULES.governance))) return bad('Forbidden', 403)

  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    raw = {}
  }
  const body = (raw ?? {}) as Record<string, unknown>
  const reason = typeof body.reason === 'string' ? body.reason.trim() : ''
  if (!reason) return bad('A reason is required to reject a request')

  const { id } = await params

  try {
    const result = await decideApproval(id, session.tenantId, session.id, 'rejected', session.role, reason)
    return NextResponse.json({ success: true, data: result }, { status: 200 })
  } catch (err) {
    if (err instanceof ApprovalError) return bad(err.message, err.status)
    return bad('Failed to reject request', 500)
  }
}
