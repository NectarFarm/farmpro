import { NextResponse } from 'next/server'
import { requireTenantSession } from '@/lib/api-auth'
import { normalizeMessages } from '@/lib/ai-advisor'
import { TICKET_CATEGORIES, TICKET_PRIORITIES } from '@/lib/support/chatbot'
import { createTicket } from '@/lib/support/tickets'
import type { TicketCategory, TicketPriority } from '@/db/schemas'

// ── POST /api/support/chat/escalate (any authenticated tenant user) ────────
// Body: { messages: [...], subject?, category?, priority? } — normally the
// exact `messages` the chat conversation built up, plus the `suggestTicket`
// fields POST /api/support/chat returned. Creates a ticket with
// source: 'chatbot' and the transcript as its opening messages (each
// `user` turn recorded as a customer message, each `assistant` turn as a
// bot message), then returns the new ticket's human-facing number.
const bad = (msg: string, status = 400) => NextResponse.json({ success: false, error: msg }, { status })

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

  const messages = normalizeMessages(b.messages)
  if (!messages) return bad('messages must be a non-empty array of { role: "user"|"assistant", content: string }.')

  const lastUserMessage = [...messages].reverse().find((m) => m.role === 'user')?.content ?? ''
  const subject = typeof b.subject === 'string' && b.subject.trim() ? b.subject.trim().slice(0, 200) : lastUserMessage.slice(0, 200) || 'Support request from chat'
  const category = typeof b.category === 'string' && (TICKET_CATEGORIES as readonly string[]).includes(b.category) ? (b.category as TicketCategory) : 'question'
  const priority = typeof b.priority === 'string' && (TICKET_PRIORITIES as readonly string[]).includes(b.priority) ? (b.priority as TicketPriority) : 'normal'

  const ticket = await createTicket({
    tenantId,
    raisedBy: session.id,
    subject,
    category,
    priority,
    source: 'chatbot',
    initialMessages: messages.map((m) => ({
      authorId: m.role === 'user' ? session.id : null,
      authorKind: m.role === 'user' ? 'customer' : 'bot',
      body: m.content,
    })),
  })

  return NextResponse.json({ success: true, data: { ticketId: ticket.id, ticketNumber: ticket.number } }, { status: 201 })
}
