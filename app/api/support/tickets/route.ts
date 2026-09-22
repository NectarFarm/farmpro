import { NextResponse } from 'next/server'
import { requireTenantSession } from '@/lib/api-auth'
import { TICKET_CATEGORIES, TICKET_PRIORITIES } from '@/lib/support/chatbot'
import { createTicket, listCustomerTickets } from '@/lib/support/tickets'
import type { TicketCategory, TicketPriority } from '@/db/schemas'

// ── GET/POST /api/support/tickets (any authenticated tenant user) ──────────
// A tenant user sees only their OWN tenant's tickets — and, unless they are
// the owner, only the ones THEY raised (non-owners never see a colleague's
// ticket, even within the same tenant: see tests/support-tickets.test.ts).
const bad = (msg: string, status = 400) => NextResponse.json({ success: false, error: msg }, { status })
const badFields = (fields: Record<string, string>, status = 400) => {
  const firstKey = Object.keys(fields)[0]
  return NextResponse.json({ success: false, error: fields[firstKey], fields }, { status })
}

export async function GET() {
  const auth = await requireTenantSession()
  if ('error' in auth) return auth.error
  const { tenantId, session } = auth

  const rows = await listCustomerTickets(tenantId, session.role === 'owner' ? {} : { onlySelf: session.id })
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

  const auth = await requireTenantSession()
  if ('error' in auth) return auth.error
  const { tenantId, session } = auth

  const fields: Record<string, string> = {}
  const subject = typeof b.subject === 'string' ? b.subject.trim() : ''
  if (!subject) fields.subject = 'subject is required'
  else if (subject.length > 200) fields.subject = 'subject must be at most 200 characters'

  const category = typeof b.category === 'string' ? b.category.trim() : 'question'
  if (!(TICKET_CATEGORIES as readonly string[]).includes(category)) fields.category = `category must be one of: ${TICKET_CATEGORIES.join(', ')}`

  const priority = typeof b.priority === 'string' ? b.priority.trim() : 'normal'
  if (!(TICKET_PRIORITIES as readonly string[]).includes(priority)) fields.priority = `priority must be one of: ${TICKET_PRIORITIES.join(', ')}`

  const body = typeof b.body === 'string' ? b.body.trim() : ''
  if (!body) fields.body = 'body is required — describe your question or issue'

  if (Object.keys(fields).length > 0) return badFields(fields)

  const ticket = await createTicket({
    tenantId,
    raisedBy: session.id,
    subject,
    category: category as TicketCategory,
    priority: priority as TicketPriority,
    source: 'form',
    initialMessages: [{ authorId: session.id, authorKind: 'customer', body }],
  })

  return NextResponse.json({ success: true, data: ticket }, { status: 201 })
}
