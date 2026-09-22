import { NextResponse } from 'next/server'
import { and, eq } from 'drizzle-orm'
import { db } from '@/db'
import { payments } from '@/db/schemas'
import { requirePlatformCapability } from '@/lib/api-auth'
import { writeAuditLog } from '@/lib/audit'

// ── POST /api/admin/payments/[id]/reject (billing.manage) ──────────────────
// Rejects a pending claim — the subscription is left exactly as it was
// (still pending_payment/past_due), so the tenant can submit a corrected
// reference via POST /api/billing/payments again.
const bad = (msg: string, status = 400) => NextResponse.json({ success: false, error: msg }, { status })

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePlatformCapability('billing.manage')
  if ('error' in auth) return auth.error
  const { session } = auth

  const { id } = await params

  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    raw = {}
  }
  const body = (raw ?? {}) as Record<string, unknown>
  const reviewNote = typeof body.reviewNote === 'string' ? body.reviewNote.trim().slice(0, 500) : ''
  if (!reviewNote) return bad('reviewNote is required when rejecting a payment')

  const rows = await db.select().from(payments).where(eq(payments.id, id)).limit(1)
  const payment = rows[0]
  if (!payment) return bad('Payment not found', 404)
  if (payment.status !== 'pending') return bad(`This payment was already ${payment.status}.`, 409)

  const updated = await db
    .update(payments)
    .set({ status: 'rejected', reviewedBy: session.id, reviewedAt: new Date(), reviewNote })
    .where(and(eq(payments.id, id), eq(payments.status, 'pending')))
    .returning()

  if (updated.length === 0) return bad('This payment was decided by someone else just now.', 409)

  await writeAuditLog({
    tenantId: payment.tenantId,
    actor: session.id,
    action: 'payment.reject',
    entity: 'payment',
    entityId: id,
    meta: { reviewNote },
  })

  return NextResponse.json({ success: true, data: updated[0] }, { status: 200 })
}
