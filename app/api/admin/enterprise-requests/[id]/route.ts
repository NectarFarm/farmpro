import { NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { db } from '@/db'
import { enterpriseRequests, notifications } from '@/db/schemas'
import { requireRole } from '@/lib/api-auth'
import { grantEnterprises } from '@/lib/enterprises'
import { notifyRecipientsByEmail } from '@/lib/notification-email'
import { writeAuditLog } from '@/lib/audit'

// ── PATCH /api/admin/enterprise-requests/[id] (super_admin) ────────────────
// Body: { status: 'approved' | 'rejected', decisionNote? }
//
// Approving is what actually widens a tenant's scope — the ONLY path that
// does, besides provisioning from an approved application. It is audited for
// that reason: an enterprise appearing on an account months later should be
// traceable to a person and a moment, not just present.
const VALID = new Set(['approved', 'rejected'])

const bad = (msg: string, status = 400) =>
  NextResponse.json({ success: false, error: msg }, { status })

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    raw = {}
  }
  const body = (raw ?? {}) as Record<string, unknown>

  const auth = await requireRole(['super_admin'])
  if ('error' in auth) return auth.error
  const { session } = auth

  const { id } = await params
  const status = typeof body.status === 'string' ? body.status.trim() : ''
  if (!VALID.has(status)) return bad('status must be one of: approved, rejected')
  const decisionNote = typeof body.decisionNote === 'string' ? body.decisionNote.trim().slice(0, 500) : ''

  const rows = await db.select().from(enterpriseRequests).where(eq(enterpriseRequests.id, id)).limit(1)
  const request = rows[0]
  if (!request) return bad('Request not found.', 404)

  // Only a pending request is decidable. Without this guard a second approve
  // would re-grant and re-notify, and a reject-after-approve would leave the
  // tenant holding an enterprise its own request says was refused.
  if (request.status !== 'pending') {
    return bad(`This request was already ${request.status}.`, 409)
  }

  if (status === 'approved') {
    // Idempotent by the unique index — see lib/enterprises.ts.
    await grantEnterprises(request.tenantId, [request.enterprise], {
      source: 'admin-grant',
      grantedByUserId: session.id,
    })
  }

  const [updated] = await db
    .update(enterpriseRequests)
    // Guarded on status again: two admins deciding the same request at the
    // same moment must not both apply. The loser updates zero rows.
    .set({ status, decisionNote, decidedByUserId: session.id, decidedAt: new Date() })
    .where(and(eq(enterpriseRequests.id, id), eq(enterpriseRequests.status, 'pending')))
    .returning()

  if (!updated) return bad('This request was decided by someone else just now.', 409)

  await writeAuditLog({
    tenantId: request.tenantId,
    actor: session.id,
    action: status === 'approved' ? 'enterprise.granted' : 'enterprise.refused',
    entity: 'enterprise',
    entityId: request.enterprise,
    meta: { requestId: id, decisionNote },
  })

  // Tell the farm, in its OWN tenant scope this time — this decision is about
  // them and they are the ones waiting on it. Owner-targeted rather than
  // tenant-wide broadcast: it names what the account may now do.
  const notificationId = randomUUID()
  await db.insert(notifications).values({
    id: notificationId,
    tenantId: request.tenantId,
    sourceType: 'enterprise_request',
    sourceId: id,
    title: status === 'approved'
      ? `"${request.enterprise}" added to your farm`
      : `Request for "${request.enterprise}" was not approved`,
    message: status === 'approved'
      ? `You can now create batches and units for "${request.enterprise}".${decisionNote ? ` ${decisionNote}` : ''}`
      : decisionNote || 'Contact your administrator if you need this enterprise.',
    role: 'owner',
  })
  await notifyRecipientsByEmail(notificationId)

  return NextResponse.json({ success: true, data: updated }, { status: 200 })
}
