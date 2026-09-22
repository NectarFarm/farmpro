import { NextResponse } from 'next/server'
import { requirePlatformCapability } from '@/lib/api-auth'
import { addTicketMessage, getTicket } from '@/lib/support/tickets'

// ── POST /api/admin/tickets/[id]/messages (support.handle) ──────────────────
// Body: { body, internal }. `internal: true` writes a staff-only note — it
// is inserted with the exact same `isInternal` flag the customer-facing GET
// route filters on, never returned to a customer session (see
// tests/support-tickets.test.ts's "internal notes are never returned to
// customers").
const bad = (msg: string, status = 400) => NextResponse.json({ success: false, error: msg }, { status })

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return bad('Invalid JSON body')
  }
  const b = (raw ?? {}) as Record<string, unknown>

  const auth = await requirePlatformCapability('support.handle')
  if ('error' in auth) return auth.error
  const { session } = auth

  const { id } = await params
  const ticket = await getTicket(id)
  if (!ticket) return bad('Ticket not found', 404)

  const body = typeof b.body === 'string' ? b.body.trim() : ''
  if (!body) return bad('body is required')
  const internal = b.internal === true

  const message = await addTicketMessage({ ticketId: id, authorId: session.id, authorKind: 'staff', body, isInternal: internal })
  return NextResponse.json({ success: true, data: message }, { status: 201 })
}
