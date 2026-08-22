import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/auth'
import { ApprovalError, decideApproval } from '@/lib/governance'
import { canEdit, MODULES } from '@/lib/permissions'

// ── POST /api/approvals/[id]/approve (issue #243 task 2) ────────────────────
// Deciding a request is a governance action, not a plain field patch — it's
// gated on a real session (no `tenantId`-query-param standalone-mode fallback
// like the read routes: an audit_log row needs a real actor, and a decision
// this branch can't verify who made isn't safe to log or act on).
//
// role-permission-enforcement task: the previous hardcoded
// `ALLOWED_ROLES = new Set(['owner', 'manager'])` gate is replaced with a
// real read of the `governance` module in the role-permission matrix
// (lib/permissions.ts) — the config screen this table backs is otherwise
// decorative. The code-defined default for `governance` is 'edit' for
// owner (bypassed outright) and manager, 'hidden' for worker/vet/auditor —
// i.e. the SAME two roles pass by default as before, so this change is a
// behaviour-preserving swap until a tenant's owner overrides the matrix via
// PUT /api/role-permissions, at which point that override is what decides.
const bad = (msg: string, status = 400) => NextResponse.json({ success: false, error: msg }, { status })

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSessionUser()
  if (!session) return bad('Unauthorized', 401)
  if (!session.tenantId) return bad('Forbidden', 403)
  if (!(await canEdit(session.tenantId, session.role, MODULES.governance))) return bad('Forbidden', 403)

  const { id } = await params

  try {
    const result = await decideApproval(id, session.tenantId, session.id, 'approved')
    return NextResponse.json({ success: true, data: result }, { status: 200 })
  } catch (err) {
    if (err instanceof ApprovalError) return bad(err.message, err.status)
    return bad('Failed to approve request', 500)
  }
}
