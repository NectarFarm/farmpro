import { NextResponse } from 'next/server'
import { and, eq } from 'drizzle-orm'
import { db } from '@/db'
import { payments } from '@/db/schemas'
import { requirePlatformCapability } from '@/lib/api-auth'
import { writeAuditLog } from '@/lib/audit'
import { advanceSubscriptionOnPayment } from '@/lib/billing/subscriptions'

// ── POST /api/admin/payments/[id]/confirm (billing.manage) ─────────────────
// Confirms a pending payment claim: the subscription becomes/stays active
// and its period is advanced from max(now, current_period_end) — see
// lib/billing/subscriptions.ts's advanceSubscriptionOnPayment for the exact
// maths. Guarded on `status = 'pending'` so two admins confirming the same
// payment at once can't both advance the period.
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

  const rows = await db.select().from(payments).where(eq(payments.id, id)).limit(1)
  const payment = rows[0]
  if (!payment) return bad('Payment not found', 404)
  if (payment.status !== 'pending') return bad(`This payment was already ${payment.status}.`, 409)

  const now = new Date()

  await db.transaction(async (tx) => {
    const updated = await tx
      .update(payments)
      .set({ status: 'confirmed', reviewedBy: session.id, reviewedAt: now, reviewNote })
      .where(and(eq(payments.id, id), eq(payments.status, 'pending')))
      .returning({ id: payments.id })
    if (updated.length === 0) return // lost the race to another confirm/reject
    await advanceSubscriptionOnPayment(tx, payment.subscriptionId, now)
  })

  await writeAuditLog({
    tenantId: payment.tenantId,
    actor: session.id,
    action: 'payment.confirm',
    entity: 'payment',
    entityId: id,
    meta: { amountCents: payment.amountCents, method: payment.method, reference: payment.reference },
  })

  return NextResponse.json({ success: true, data: { id, status: 'confirmed' } }, { status: 200 })
}
