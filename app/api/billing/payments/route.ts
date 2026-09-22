import { NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import { desc, eq } from 'drizzle-orm'
import { db } from '@/db'
import { payments } from '@/db/schemas'
import { requireTenantSession } from '@/lib/api-auth'
import { parseMoneyToCents } from '@/lib/money'
import { getPaymentProvider } from '@/lib/billing/provider'
import { advanceSubscriptionOnPayment, getCurrentSubscription } from '@/lib/billing/subscriptions'

// ── GET/POST /api/billing/payments (owner only) ─────────────────────────────
// POST is the tenant side of the manual payment flow: submit a reference for
// an admin to review (see lib/billing/provider.ts's header for why there is
// no real gateway here). GET lists this tenant's submission history —
// pending/confirmed/rejected all included, newest first.
const METHODS = ['mobile_money', 'bank', 'card', 'cash', 'other'] as const

const bad = (msg: string, status = 400) => NextResponse.json({ success: false, error: msg }, { status })
const badFields = (fields: Record<string, string>, status = 400) => {
  const firstKey = Object.keys(fields)[0]
  return NextResponse.json({ success: false, error: fields[firstKey], fields }, { status })
}

export async function GET() {
  const auth = await requireTenantSession({ roles: ['owner'] })
  if ('error' in auth) return auth.error
  const { tenantId } = auth

  const rows = await db.select().from(payments).where(eq(payments.tenantId, tenantId)).orderBy(desc(payments.createdAt))
  return NextResponse.json({ success: true, data: rows }, { status: 200 })
}

export async function POST(req: Request) {
  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return bad('Invalid JSON body')
  }
  const b = (raw ?? {}) as Record<string, unknown>

  const auth = await requireTenantSession({ roles: ['owner'] })
  if ('error' in auth) return auth.error
  const { tenantId, session } = auth

  const sub = await getCurrentSubscription(tenantId)
  if (!sub) return bad('No subscription to pay against. Choose a plan first.', 404)

  const fields: Record<string, string> = {}
  const amountCents = parseMoneyToCents(b.amount)
  if (amountCents === null || amountCents <= 0) fields.amount = 'amount must be a positive number'

  const method = typeof b.method === 'string' ? b.method.trim() : ''
  if (!(METHODS as readonly string[]).includes(method)) fields.method = `method must be one of: ${METHODS.join(', ')}`

  const reference = typeof b.reference === 'string' ? b.reference.trim() : ''
  if (!reference) fields.reference = 'reference is required'

  const note = typeof b.note === 'string' ? b.note.trim().slice(0, 500) : ''

  if (Object.keys(fields).length > 0) return badFields(fields)

  const provider = getPaymentProvider()
  const result = await provider.submitPayment({
    subscriptionId: sub.id,
    tenantId,
    amountCents: amountCents as number,
    currency: sub.plan.currency,
    method,
    reference,
    payerNote: note,
    submittedBy: session.id,
  })

  const id = randomUUID()
  const now = new Date()

  await db.transaction(async (tx) => {
    await tx.insert(payments).values({
      id,
      subscriptionId: sub.id,
      tenantId,
      amountCents: amountCents as number,
      currency: sub.plan.currency,
      method,
      reference,
      payerNote: note,
      status: result.status,
      submittedBy: session.id,
      reviewedAt: result.status === 'confirmed' ? now : null,
      reviewNote: result.status === 'confirmed' ? `Auto-confirmed by ${provider.name} provider` : '',
    })
    // Only reachable once a real gateway provider exists — ManualPaymentProvider
    // always returns 'pending'. Kept so a future synchronous provider doesn't
    // need a second code path to activate the subscription it just confirmed.
    if (result.status === 'confirmed') {
      await advanceSubscriptionOnPayment(tx, sub.id, now)
    }
  })

  return NextResponse.json({ success: true, data: { id, status: result.status } }, { status: 201 })
}
