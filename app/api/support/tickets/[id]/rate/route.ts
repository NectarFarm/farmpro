import { NextResponse } from 'next/server'
import { requireTenantSession } from '@/lib/api-auth'
import { canCustomerAccessTicket, getTicket, rateTicket } from '@/lib/support/tickets'

// ── POST /api/support/tickets/[id]/rate (any authenticated tenant user) ────
// Only while resolved/closed — rating an in-progress ticket doesn't mean
// anything yet.
const bad = (msg: string, status = 400) => NextResponse.json({ success: false, error: msg }, { status })

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return bad('Invalid JSON body')
  }
  const b = (raw ?? {}) as Record<string, unknown>

  const auth = await requireTenantSession()
  if ('error' in auth) return auth.error
  const { session } = auth

  const { id } = await params
  const ticket = await getTicket(id)
  if (!ticket || !canCustomerAccessTicket(session, ticket)) return bad('Ticket not found', 404)
  if (ticket.status !== 'resolved' && ticket.status !== 'closed') {
    return bad('This ticket can only be rated once it is resolved or closed', 409)
  }

  const rating = Number(b.rating)
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) return bad('rating must be an integer from 1 to 5')
  const comment = typeof b.comment === 'string' ? b.comment.trim().slice(0, 1000) : ''

  const updated = await rateTicket(id, rating, comment, session.id)
  return NextResponse.json({ success: true, data: updated }, { status: 200 })
}
