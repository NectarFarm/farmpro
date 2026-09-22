import { NextResponse } from 'next/server'
import { and, desc, eq, ilike, isNull } from 'drizzle-orm'
import { db } from '@/db'
import { supportTickets, tenants } from '@/db/schemas'
import { requirePlatformCapability } from '@/lib/api-auth'
import { TICKET_CATEGORIES, TICKET_PRIORITIES } from '@/lib/support/chatbot'
import { createTicket } from '@/lib/support/tickets'
import type { TicketCategory, TicketPriority } from '@/db/schemas'

// ── GET/POST /api/admin/tickets (support.handle) ────────────────────────────
// GET filters: status, priority, category, tenant (tenantId), q (subject
// substring), assignee = 'me' | 'unassigned' | a specific staff user id.
// POST lets staff open a ticket ON BEHALF OF a tenant (source: 'admin') -
// e.g. logging a phone call.
const bad = (msg: string, status = 400) => NextResponse.json({ success: false, error: msg }, { status })
const badFields = (fields: Record<string, string>, status = 400) => {
  const firstKey = Object.keys(fields)[0]
  return NextResponse.json({ success: false, error: fields[firstKey], fields }, { status })
}

export async function GET(req: Request) {
  const auth = await requirePlatformCapability('support.handle')
  if ('error' in auth) return auth.error
  const { session } = auth

  const url = new URL(req.url)
  const status = url.searchParams.get('status')?.trim() || ''
  const priority = url.searchParams.get('priority')?.trim() || ''
  const category = url.searchParams.get('category')?.trim() || ''
  const tenantId = url.searchParams.get('tenant')?.trim() || ''
  const q = url.searchParams.get('q')?.trim() || ''
  const assignee = url.searchParams.get('assignee')?.trim() || ''

  const conditions = []
  if (status) conditions.push(eq(supportTickets.status, status))
  if (priority) conditions.push(eq(supportTickets.priority, priority))
  if (category) conditions.push(eq(supportTickets.category, category))
  if (tenantId) conditions.push(eq(supportTickets.tenantId, tenantId))
  if (q) conditions.push(ilike(supportTickets.subject, `%${q}%`))
  if (assignee === 'me') conditions.push(eq(supportTickets.assignedTo, session.id))
  else if (assignee === 'unassigned') conditions.push(isNull(supportTickets.assignedTo))
  else if (assignee) conditions.push(eq(supportTickets.assignedTo, assignee))

  const rows = await db
    .select({ ticket: supportTickets, tenantName: tenants.name })
    .from(supportTickets)
    .innerJoin(tenants, eq(tenants.id, supportTickets.tenantId))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(supportTickets.createdAt))
    .limit(200)

  const data = rows.map(({ ticket, tenantName }) => ({ ...ticket, tenantName }))
  return NextResponse.json({ success: true, data }, { status: 200 })
}

export async function POST(req: Request) {
  const auth = await requirePlatformCapability('support.handle')
  if ('error' in auth) return auth.error
  const { session } = auth

  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return bad('Invalid JSON body')
  }
  const b = (raw ?? {}) as Record<string, unknown>

  const fields: Record<string, string> = {}
  const tenantId = typeof b.tenantId === 'string' ? b.tenantId.trim() : ''
  if (!tenantId) fields.tenantId = 'tenantId is required'

  const raisedBy = typeof b.raisedBy === 'string' ? b.raisedBy.trim() : ''
  if (!raisedBy) fields.raisedBy = 'raisedBy (the tenant user this ticket is opened for) is required'

  const subject = typeof b.subject === 'string' ? b.subject.trim() : ''
  if (!subject) fields.subject = 'subject is required'

  const body = typeof b.body === 'string' ? b.body.trim() : ''
  if (!body) fields.body = 'body is required'

  const category = typeof b.category === 'string' ? b.category.trim() : 'question'
  if (!(TICKET_CATEGORIES as readonly string[]).includes(category)) fields.category = `category must be one of: ${TICKET_CATEGORIES.join(', ')}`

  const priority = typeof b.priority === 'string' ? b.priority.trim() : 'normal'
  if (!(TICKET_PRIORITIES as readonly string[]).includes(priority)) fields.priority = `priority must be one of: ${TICKET_PRIORITIES.join(', ')}`

  if (Object.keys(fields).length > 0) return badFields(fields)

  const ticket = await createTicket({
    tenantId,
    raisedBy,
    subject,
    category: category as TicketCategory,
    priority: priority as TicketPriority,
    source: 'admin',
    assignedTo: session.id,
    initialMessages: [{ authorId: session.id, authorKind: 'staff', body }],
  })

  return NextResponse.json({ success: true, data: ticket }, { status: 201 })
}
