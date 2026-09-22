// ── Support ticket notifications (SaaS back-office backend) ────────────────
// Reuses the EXISTING notifications table/mechanism (db/schemas/dashboard.ts,
// lib/notification-email.ts's createAndEmailNotification) rather than
// building a second one. No schema extension was needed: a platform-staff
// notification already has a documented home — the same PLATFORM_TENANT_SENTINEL
// tenant scope POST /api/auth/forgot-password's admin notification already
// uses (see lib/audit.ts and app/api/notifications/route.ts's own comment on
// "a tenantless session resolves to PLATFORM_TENANT_SENTINEL"). Targeting a
// SPECIFIC staff member is just `userId` under that scope — exactly like
// every other targeted notification in this codebase.
import 'server-only'
import { randomUUID } from 'node:crypto'
import type { supportTickets } from '@/db/schemas'
import { PLATFORM_TENANT_SENTINEL } from '@/lib/audit'
import { createAndEmailNotification } from '@/lib/notification-email'
import { listCapableStaffUserIds } from '@/lib/platform-staff'

type Ticket = typeof supportTickets.$inferSelect

export async function notifyCustomerOnTicketEvent(
  ticket: Ticket,
  event: 'replied' | 'status_changed' | 'resolved'
): Promise<void> {
  const title =
    event === 'resolved'
      ? `${ticket.number} marked resolved — how did we do?`
      : event === 'replied'
        ? `New reply on ${ticket.number}`
        : `${ticket.number} status: ${ticket.status}`
  const message =
    event === 'resolved'
      ? `We've marked "${ticket.subject}" as resolved. Let us know if you're not satisfied, or leave a quick rating.`
      : event === 'replied'
        ? `Support replied to "${ticket.subject}".`
        : `"${ticket.subject}" is now ${ticket.status.replace('_', ' ')}.`

  await createAndEmailNotification({
    tenantId: ticket.tenantId,
    sourceType: 'support_ticket',
    sourceId: `${ticket.id}-${event}-${randomUUID()}`,
    title,
    message,
    userId: ticket.raisedBy,
  })
}

export async function notifyStaffOnTicketEvent(ticket: Ticket, event: 'created' | 'replied' | 'assigned'): Promise<void> {
  const title =
    event === 'created'
      ? `New ticket ${ticket.number}: ${ticket.subject}`
      : event === 'assigned'
        ? `You've been assigned ${ticket.number}`
        : `Customer replied on ${ticket.number}`
  const message = ticket.subject

  const recipientIds = ticket.assignedTo ? [ticket.assignedTo] : await listCapableStaffUserIds('support.handle')

  for (const userId of recipientIds) {
    await createAndEmailNotification({
      tenantId: PLATFORM_TENANT_SENTINEL,
      sourceType: 'support_ticket_staff',
      sourceId: `${ticket.id}-${event}-${userId}-${randomUUID()}`,
      title,
      message,
      userId,
    })
  }
}
