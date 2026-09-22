import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { tenants, users } from '@/db/schemas'
import { requirePlatformCapability } from '@/lib/api-auth'
import { hasCapability } from '@/lib/platform-staff'
import { TICKET_PRIORITIES } from '@/lib/support/chatbot'
import { getTicket, listTicketEvents, listTicketMessages, updateTicket } from '@/lib/support/tickets'
import type { TicketPriority } from '@/db/schemas'

// ── GET/PATCH /api/admin/tickets/[id] (support.handle) ──────────────────────
// GET includes internal staff-only notes (unlike the customer-facing GET
// /api/support/tickets/[id]) plus the tenant + raiser's name/email. PATCH
// updates status/priority/assignee — assigning the ticket to a DIFFERENT
// staff member (not yourself, not clearing it) additionally requires
// support.assign; claiming an unassigned ticket for yourself only needs
// support.handle.
const STATUSES = ['open', 'in_progress', 'waiting_on_customer', 'resolved', 'closed'] as const

const bad = (msg: string, status = 400) => NextResponse.json({ success: false, error: msg }, { status })
const badFields = (fields: Record<string, string>, status = 400) => {
  const firstKey = Object.keys(fields)[0]
  return NextResponse.json({ success: false, error: fields[firstKey], fields }, { status })
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePlatformCapability('support.handle')
  if ('error' in auth) return auth.error

  const { id } = await params
  const ticket = await getTicket(id)
  if (!ticket) return bad('Ticket not found', 404)

  const [messages, events, tenantRows, raiserRows] = await Promise.all([
    listTicketMessages(id, { includeInternal: true }),
    listTicketEvents(id),
    db.select({ id: tenants.id, name: tenants.name }).from(tenants).where(eq(tenants.id, ticket.tenantId)).limit(1),
    db.select({ id: users.id, name: users.name, email: users.email }).from(users).where(eq(users.id, ticket.raisedBy)).limit(1),
  ])

  return NextResponse.json(
    { success: true, data: { ticket, messages, events, tenant: tenantRows[0] ?? null, raiser: raiserRows[0] ?? null } },
    { status: 200 }
  )
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePlatformCapability('support.handle')
  if ('error' in auth) return auth.error
  const { session } = auth

  const { id } = await params
  const ticket = await getTicket(id)
  if (!ticket) return bad('Ticket not found', 404)

  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return bad('Invalid JSON body')
  }
  const b = (raw ?? {}) as Record<string, unknown>
  const fields: Record<string, string> = {}

  const patch: { status?: string; priority?: TicketPriority; assignedTo?: string | null } = {}

  if ('status' in b) {
    const status = typeof b.status === 'string' ? b.status.trim() : ''
    if (!(STATUSES as readonly string[]).includes(status)) fields.status = `status must be one of: ${STATUSES.join(', ')}`
    else patch.status = status
  }

  if ('priority' in b) {
    const priority = typeof b.priority === 'string' ? b.priority.trim() : ''
    if (!(TICKET_PRIORITIES as readonly string[]).includes(priority)) fields.priority = `priority must be one of: ${TICKET_PRIORITIES.join(', ')}`
    else patch.priority = priority as TicketPriority
  }

  if ('assignedTo' in b) {
    if (b.assignedTo === null) {
      patch.assignedTo = null
    } else if (typeof b.assignedTo === 'string' && b.assignedTo.trim()) {
      const target = b.assignedTo.trim()
      if (target !== session.id) {
        const canAssignOthers = await hasCapability(session.id, session.role, 'support.assign')
        if (!canAssignOthers) return NextResponse.json({ success: false, error: 'Assigning a ticket to someone else requires support.assign' }, { status: 403 })
      }
      patch.assignedTo = target
    } else {
      fields.assignedTo = 'assignedTo must be a staff user id, or null to unassign'
    }
  }

  if (Object.keys(fields).length > 0) return badFields(fields)
  if (Object.keys(patch).length === 0) return bad('No updatable fields supplied (status, priority, assignedTo)')

  const updated = await updateTicket(id, patch, session.id)
  return NextResponse.json({ success: true, data: updated }, { status: 200 })
}
