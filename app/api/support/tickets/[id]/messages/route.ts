import { NextResponse } from 'next/server'
import { requireTenantSession } from '@/lib/api-auth'
import { addTicketMessage, canCustomerAccessTicket, getTicket } from '@/lib/support/tickets'

// ── POST /api/support/tickets/[id]/messages (any authenticated tenant user) ─
// Adds a customer-side reply. Never `isInternal` — that flag only exists on
// the staff route (POST /api/admin/tickets/[id]/messages).
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

  const body = typeof b.body === 'string' ? b.body.trim() : ''
  if (!body) return bad('body is required')

  const message = await addTicketMessage({ ticketId: id, authorId: session.id, authorKind: 'customer', body, isInternal: false })
  return NextResponse.json({ success: true, data: message }, { status: 201 })
}
