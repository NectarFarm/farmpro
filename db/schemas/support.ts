// ── Support: tickets, complaints, chatbot (SaaS back-office backend) ────────
import { pgTable, text, timestamp, integer, boolean, bigint, index, uniqueIndex } from 'drizzle-orm/pg-core'

export type TicketCategory = 'question' | 'bug' | 'billing' | 'complaint' | 'feature_request' | 'account'
export type TicketPriority = 'low' | 'normal' | 'high' | 'urgent'
export type TicketStatus = 'open' | 'in_progress' | 'waiting_on_customer' | 'resolved' | 'closed'
export type TicketSource = 'chatbot' | 'form' | 'admin'

// `seq` backs the human-facing `number` (e.g. "T-1001") — see
// drizzle/0042_backoffice.sql for the `support_ticket_number_seq` sequence
// this column's value comes from. Kept as a real bigint column (not just
// derived from `number` at read time) so it sorts/indexes numerically.
export const supportTickets = pgTable('support_tickets', {
  id: text('id').primaryKey(),
  seq: bigint('seq', { mode: 'number' }).notNull(),
  number: text('number').notNull(),
  tenantId: text('tenant_id').notNull(),
  raisedBy: text('raised_by').notNull(),
  subject: text('subject').notNull(),
  category: text('category').notNull().default('question'), // TicketCategory
  priority: text('priority').notNull().default('normal'), // TicketPriority
  status: text('status').notNull().default('open'), // TicketStatus
  assignedTo: text('assigned_to'),
  source: text('source').notNull().default('form'), // TicketSource
  rating: integer('rating'), // 1-5, nullable
  ratingComment: text('rating_comment').notNull().default(''),
  resolvedAt: timestamp('resolved_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  uniqueIndex('idx_support_tickets_number').on(t.number),
  index('idx_support_tickets_tenant').on(t.tenantId),
  index('idx_support_tickets_status').on(t.status),
  index('idx_support_tickets_assigned').on(t.assignedTo),
  index('idx_support_tickets_raised_by').on(t.raisedBy),
])

export type TicketMessageAuthorKind = 'customer' | 'staff' | 'bot' | 'system'

// `isInternal` messages (staff-only notes) are never returned to a customer
// caller — enforced in the route (GET /api/support/tickets/[id] filters them
// out for a customer session), not by a separate table, so staff and
// customer share one ordered timeline underneath.
export const ticketMessages = pgTable('ticket_messages', {
  id: text('id').primaryKey(),
  ticketId: text('ticket_id').notNull(),
  // Nullable: a bot/system message has no human author.
  authorId: text('author_id'),
  authorKind: text('author_kind').notNull(), // TicketMessageAuthorKind
  body: text('body').notNull(),
  isInternal: boolean('is_internal').notNull().default(false),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('idx_ticket_messages_ticket').on(t.ticketId),
])

export type TicketEventKind = 'created' | 'status_changed' | 'assigned' | 'priority_changed' | 'replied' | 'rated'

// The progress timeline a customer/staff member sees on a ticket — distinct
// from `ticket_messages` (the conversation itself): an event records a state
// change ("status: open -> in_progress"), a message records something said.
export const ticketEvents = pgTable('ticket_events', {
  id: text('id').primaryKey(),
  ticketId: text('ticket_id').notNull(),
  kind: text('kind').notNull(), // TicketEventKind
  fromValue: text('from_value'),
  toValue: text('to_value'),
  // Nullable: a system-generated event (e.g. auto-created by the chatbot
  // escalation) has no acting user.
  actorId: text('actor_id'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('idx_ticket_events_ticket').on(t.ticketId),
])

// ── Per-user chat throttle (support chatbot) ────────────────────────────────
// A minimal fixed-window counter — same "DB-backed so it survives restarts
// and works across instances" reasoning as db/schemas/auth.ts's
// `loginThrottle`, but generic (identifier + window) rather than login's
// escalating-lockout shape, since a chat rate limit just needs "at most N
// messages per window", not a lockout ladder. See lib/support/chat-throttle.ts.
export const chatThrottle = pgTable('chat_throttle', {
  identifier: text('identifier').primaryKey(),
  windowStart: timestamp('window_start').notNull(),
  count: integer('count').notNull().default(0),
})
