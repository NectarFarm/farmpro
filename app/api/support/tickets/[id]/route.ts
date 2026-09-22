import { NextResponse } from 'next/server'
import { requireTenantSession } from '@/lib/api-auth'
import { canCustomerAccessTicket, getTicket, listTicketEvents, listTicketMessages } from '@/lib/support/tickets'

// ── GET /api/support/tickets/[id] (any authenticated tenant user) ──────────
// Returns the ticket, its messages MINUS internal staff-only notes, and its
// event timeline. 404 (not 403) for a ticket outside the caller's access —
// same "don't confirm existence to someone who shouldn't see it" reasoning
// as every other cross-tenant guard in this codebase.
const bad = (msg: string, status = 400) => NextResponse.json({ success: false, error: msg }, { status })

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireTenantSession()
  if ('error' in auth) return auth.error
  const { session } = auth

  const { id } = await params
  const ticket = await getTicket(id)
  if (!ticket || !canCustomerAccessTicket(session, ticket)) return bad('Ticket not found', 404)

  const [messages, events] = await Promise.all([
    listTicketMessages(id, { includeInternal: false }),
    listTicketEvents(id),
  ])

  return NextResponse.json({ success: true, data: { ticket, messages, events } }, { status: 200 })
}
