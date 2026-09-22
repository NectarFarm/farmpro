import { NextResponse } from 'next/server'
import { requireTenantSession } from '@/lib/api-auth'
import { canCustomerAccessTicket, getTicket, reopenTicket } from '@/lib/support/tickets'

// ── POST /api/support/tickets/[id]/reopen (any authenticated tenant user) ──
// Only from resolved/closed — reopening an already-open ticket is a no-op
// state the caller shouldn't need to request.
const bad = (msg: string, status = 400) => NextResponse.json({ success: false, error: msg }, { status })

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireTenantSession()
  if ('error' in auth) return auth.error
  const { session } = auth

  const { id } = await params
  const ticket = await getTicket(id)
  if (!ticket || !canCustomerAccessTicket(session, ticket)) return bad('Ticket not found', 404)
  if (ticket.status !== 'resolved' && ticket.status !== 'closed') {
    return bad('Only a resolved or closed ticket can be reopened', 409)
  }

  const updated = await reopenTicket(id, session.id)
  return NextResponse.json({ success: true, data: updated }, { status: 200 })
}
