import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/auth'
import { ApprovalError, decideApproval } from '@/lib/governance'

// ── POST /api/approvals/[id]/approve (issue #243 task 2) ────────────────────
// Deciding a request is a governance action, not a plain field patch — it's
// gated on a real session (no `tenantId`-query-param standalone-mode fallback
// like the read routes: an audit_log row needs a real actor, and a decision
// this branch can't verify who made isn't safe to log or act on). Role is
// checked here rather than via the new `role_permissions` table — retrofitting
// every route to read that matrix is explicitly out of scope for this issue;
// this is a narrow, hardcoded gate (owner/manager) until that follow-on lands.
const ALLOWED_ROLES = new Set(['owner', 'manager'])

const bad = (msg: string, status = 400) => NextResponse.json({ success: false, error: msg }, { status })

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSessionUser()
  if (!session) return bad('Unauthorized', 401)
  if (!session.tenantId) return bad('Forbidden', 403)
  if (!ALLOWED_ROLES.has(session.role)) return bad('Forbidden', 403)

  const { id } = await params

  try {
    const result = await decideApproval(id, session.tenantId, session.id, 'approved')
    return NextResponse.json({ success: true, data: result }, { status: 200 })
  } catch (err) {
    if (err instanceof ApprovalError) return bad(err.message, err.status)
    return bad('Failed to approve request', 500)
  }
}
