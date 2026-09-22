// ── Support ticket DB helpers (SaaS back-office backend) ────────────────────
// Shared by every ticket route (customer + staff) so ticket numbering, the
// event timeline, and notification wiring can't drift between call sites.
import 'server-only'
import { randomUUID } from 'node:crypto'
import { and, desc, eq, sql } from 'drizzle-orm'
import { db } from '@/db'
import {
  ticketEvents,
  ticketMessages,
  supportTickets,
  type TicketCategory,
  type TicketEventKind,
  type TicketMessageAuthorKind,
  type TicketPriority,
  type TicketSource,
} from '@/db/schemas'
import { notifyCustomerOnTicketEvent, notifyStaffOnTicketEvent } from './notify'

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]
type DbOrTx = typeof db | Tx

/** Draws the next value off `support_ticket_number_seq` (drizzle/0042_*.sql)
 * and formats it as "T-1001". A real Postgres sequence — never a max()+1
 * read — so two tickets created at once can never collide. */
export async function nextTicketNumber(executor: DbOrTx = db): Promise<{ seq: number; number: string }> {
  const rows = (await executor.execute(sql`select nextval('support_ticket_number_seq') as seq`)) as unknown as Array<{
    seq: string | number
  }>
  const seq = Number(rows[0].seq)
  return { seq, number: `T-${seq}` }
}

export interface CreateTicketInput {
  tenantId: string
  raisedBy: string
  subject: string
  category: TicketCategory
  priority: TicketPriority
  source: TicketSource
  assignedTo?: string | null
  // The first message(s) on the ticket — a customer's own description, or a
  // chatbot transcript being escalated (see app/api/support/chat/escalate).
  initialMessages: { authorId: string | null; authorKind: TicketMessageAuthorKind; body: string }[]
}

export async function createTicket(input: CreateTicketInput): Promise<typeof supportTickets.$inferSelect> {
  const ticket = await db.transaction(async (tx) => {
    const { seq, number } = await nextTicketNumber(tx)
    const id = randomUUID()
    const now = new Date()

    const inserted = await tx
      .insert(supportTickets)
      .values({
        id,
        seq,
        number,
        tenantId: input.tenantId,
        raisedBy: input.raisedBy,
        subject: input.subject,
        category: input.category,
        priority: input.priority,
        status: 'open',
        assignedTo: input.assignedTo ?? null,
        source: input.source,
        createdAt: now,
        updatedAt: now,
      })
      .returning()

    await tx.insert(ticketEvents).values({
      id: randomUUID(),
      ticketId: id,
      kind: 'created' as TicketEventKind,
      fromValue: null,
      toValue: 'open',
      actorId: input.raisedBy,
      createdAt: now,
    })

    for (const m of input.initialMessages) {
      if (!m.body.trim()) continue
      await tx.insert(ticketMessages).values({
        id: randomUUID(),
        ticketId: id,
        authorId: m.authorId,
        authorKind: m.authorKind,
        body: m.body,
        isInternal: false,
        createdAt: now,
      })
    }

    return inserted[0]
  })

  await notifyStaffOnTicketEvent(ticket, 'created')
  return ticket
}

// A tenant user may access a ticket iff it belongs to their own tenant, AND
// (they are the owner OR they raised it themselves) — a non-owner never sees
// a colleague's ticket, even within the same tenant.
export function canCustomerAccessTicket(
  session: { tenantId: string | null; role: string; id: string },
  ticket: Pick<typeof supportTickets.$inferSelect, 'tenantId' | 'raisedBy'>
): boolean {
  if (session.tenantId !== ticket.tenantId) return false
  return session.role === 'owner' || ticket.raisedBy === session.id
}

export async function getTicket(id: string): Promise<typeof supportTickets.$inferSelect | null> {
  const rows = await db.select().from(supportTickets).where(eq(supportTickets.id, id)).limit(1)
  return rows[0] ?? null
}

export async function listTicketMessages(ticketId: string, opts: { includeInternal: boolean }) {
  const rows = await db
    .select()
    .from(ticketMessages)
    .where(
      opts.includeInternal
        ? eq(ticketMessages.ticketId, ticketId)
        : and(eq(ticketMessages.ticketId, ticketId), eq(ticketMessages.isInternal, false))
    )
    .orderBy(ticketMessages.createdAt)
  return rows
}

export async function listTicketEvents(ticketId: string) {
  return db.select().from(ticketEvents).where(eq(ticketEvents.ticketId, ticketId)).orderBy(ticketEvents.createdAt)
}

export interface AddMessageInput {
  ticketId: string
  authorId: string | null
  authorKind: TicketMessageAuthorKind
  body: string
  isInternal: boolean
}

export async function addTicketMessage(input: AddMessageInput): Promise<typeof ticketMessages.$inferSelect> {
  const now = new Date()
  const message = await db.transaction(async (tx) => {
    const inserted = await tx
      .insert(ticketMessages)
      .values({
        id: randomUUID(),
        ticketId: input.ticketId,
        authorId: input.authorId,
        authorKind: input.authorKind,
        body: input.body,
        isInternal: input.isInternal,
        createdAt: now,
      })
      .returning()

    if (!input.isInternal) {
      await tx.insert(ticketEvents).values({
        id: randomUUID(),
        ticketId: input.ticketId,
        kind: 'replied' as TicketEventKind,
        fromValue: null,
        toValue: input.authorKind,
        actorId: input.authorId,
        createdAt: now,
      })
    }

    await tx.update(supportTickets).set({ updatedAt: now }).where(eq(supportTickets.id, input.ticketId))
    return inserted[0]
  })

  // Internal notes are staff-only by definition — never notify the customer
  // about one. A staff reply notifies the customer; a customer reply
  // notifies staff.
  if (!input.isInternal) {
    const ticket = await getTicket(input.ticketId)
    if (ticket) {
      if (input.authorKind === 'customer') await notifyStaffOnTicketEvent(ticket, 'replied')
      else if (input.authorKind === 'staff' || input.authorKind === 'bot') await notifyCustomerOnTicketEvent(ticket, 'replied')
    }
  }

  return message
}

export interface UpdateTicketInput {
  status?: string
  priority?: TicketPriority
  assignedTo?: string | null
}

export async function updateTicket(
  ticketId: string,
  patch: UpdateTicketInput,
  actorId: string
): Promise<typeof supportTickets.$inferSelect | null> {
  const current = await getTicket(ticketId)
  if (!current) return null

  const now = new Date()
  const set: Partial<typeof supportTickets.$inferInsert> = { updatedAt: now }
  const events: (typeof ticketEvents.$inferInsert)[] = []

  if (patch.status !== undefined && patch.status !== current.status) {
    set.status = patch.status
    if (patch.status === 'resolved' || patch.status === 'closed') set.resolvedAt = now
    events.push({
      id: randomUUID(), ticketId, kind: 'status_changed', fromValue: current.status, toValue: patch.status, actorId, createdAt: now,
    })
  }
  if (patch.priority !== undefined && patch.priority !== current.priority) {
    set.priority = patch.priority
    events.push({
      id: randomUUID(), ticketId, kind: 'priority_changed', fromValue: current.priority, toValue: patch.priority, actorId, createdAt: now,
    })
  }
  if (patch.assignedTo !== undefined && patch.assignedTo !== current.assignedTo) {
    set.assignedTo = patch.assignedTo
    events.push({
      id: randomUUID(), ticketId, kind: 'assigned', fromValue: current.assignedTo, toValue: patch.assignedTo, actorId, createdAt: now,
    })
  }

  if (Object.keys(set).length === 1) return current // only updatedAt -> nothing real changed

  const updated = await db.transaction(async (tx) => {
    const rows = await tx.update(supportTickets).set(set).where(eq(supportTickets.id, ticketId)).returning()
    for (const e of events) await tx.insert(ticketEvents).values(e)
    return rows[0]
  })

  if (patch.status !== undefined && patch.status !== current.status) {
    await notifyCustomerOnTicketEvent(updated, patch.status === 'resolved' ? 'resolved' : 'status_changed')
  }
  if (patch.assignedTo !== undefined && patch.assignedTo && patch.assignedTo !== current.assignedTo) {
    await notifyStaffOnTicketEvent(updated, 'assigned')
  }

  return updated
}

export async function rateTicket(ticketId: string, rating: number, comment: string, actorId: string) {
  const now = new Date()
  const updated = await db.transaction(async (tx) => {
    const rows = await tx
      .update(supportTickets)
      .set({ rating, ratingComment: comment, updatedAt: now })
      .where(eq(supportTickets.id, ticketId))
      .returning()
    await tx.insert(ticketEvents).values({
      id: randomUUID(), ticketId, kind: 'rated', fromValue: null, toValue: String(rating), actorId, createdAt: now,
    })
    return rows[0]
  })
  return updated
}

export async function reopenTicket(ticketId: string, actorId: string) {
  return updateTicket(ticketId, { status: 'open' }, actorId)
}

export async function listCustomerTickets(tenantId: string, opts: { onlySelf?: string } = {}) {
  return db
    .select()
    .from(supportTickets)
    .where(
      opts.onlySelf
        ? and(eq(supportTickets.tenantId, tenantId), eq(supportTickets.raisedBy, opts.onlySelf))
        : eq(supportTickets.tenantId, tenantId)
    )
    .orderBy(desc(supportTickets.createdAt))
}
