// ── Customer ticket view: quiet system lines, not the raw event log ────────
// e2e finding: SupportTicketScreen (components/portal/support.tsx) rendered
// every ticket_events row verbatim below the conversation ("status_changed:
// waiting_on_customer", "assigned: <staff id>", "priority_changed: high") —
// an internal audit trail, not something a farmer reading their own ticket
// needs. The 4-step tracker already carries the status; only a real "moved
// forward" moment (in progress / resolved / reopened) now folds into the
// conversation as a quiet inline line. The STAFF side (components/admin/
// tickets.tsx) is untouched — it still renders every event.
//
// customerSystemLineFor/mergeTicketTimeline are pure, exported functions (no
// JSX, no hooks) — same "test the extracted logic directly" convention as
// components/farm/governance.tsx's auditReason/auditChanges.
import { describe, it, expect } from 'vitest'
import { customerSystemLineFor, mergeTicketTimeline } from '@/components/portal/support'

function event(overrides: Partial<{ id: string; kind: string; fromValue: string | null; toValue: string | null; createdAt: string }>) {
  return { id: 'e1', kind: 'status_changed', fromValue: null, toValue: null, createdAt: '2026-01-01T10:00:00.000Z', ...overrides }
}
function message(overrides: Partial<{ id: string; authorKind: 'customer' | 'staff' | 'bot' | 'system'; body: string; createdAt: string }>) {
  return { id: 'm1', authorKind: 'customer' as const, body: 'hi', createdAt: '2026-01-01T09:00:00.000Z', ...overrides }
}

describe('customerSystemLineFor', () => {
  it('surfaces "Marked in progress" for a status_changed row moving to in_progress', () => {
    expect(customerSystemLineFor(event({ toValue: 'in_progress' }))).toBe('Marked in progress')
  })

  it('surfaces "Resolved" for a status_changed row moving to resolved', () => {
    expect(customerSystemLineFor(event({ toValue: 'resolved' }))).toBe('Resolved')
  })

  it('surfaces "Reopened" only for a status_changed row moving back to open FROM resolved or closed', () => {
    expect(customerSystemLineFor(event({ fromValue: 'resolved', toValue: 'open' }))).toBe('Reopened')
    expect(customerSystemLineFor(event({ fromValue: 'closed', toValue: 'open' }))).toBe('Reopened')
  })

  it('drops a ticket\'s very first "open" (no fromValue — never actually an event row, but defensive)', () => {
    expect(customerSystemLineFor(event({ fromValue: null, toValue: 'open' }))).toBeNull()
  })

  it('drops waiting_on_customer and closed transitions — not in the customer-facing list', () => {
    expect(customerSystemLineFor(event({ toValue: 'waiting_on_customer' }))).toBeNull()
    expect(customerSystemLineFor(event({ toValue: 'closed' }))).toBeNull()
  })

  it('drops assignment changes, priority changes, and anything else that names internal staff', () => {
    expect(customerSystemLineFor(event({ kind: 'assigned', toValue: 'usr-123' }))).toBeNull()
    expect(customerSystemLineFor(event({ kind: 'priority_changed', toValue: 'high' }))).toBeNull()
    expect(customerSystemLineFor(event({ kind: 'created' }))).toBeNull()
    expect(customerSystemLineFor(event({ kind: 'rated', toValue: '5' }))).toBeNull()
  })
})

describe('mergeTicketTimeline', () => {
  it('interleaves messages and customer-relevant events in chronological order', () => {
    const m1 = message({ id: 'm1', createdAt: '2026-01-01T09:00:00.000Z', body: 'It is broken' })
    const inProgress = event({ id: 'e1', createdAt: '2026-01-01T09:30:00.000Z', toValue: 'in_progress' })
    const reply = message({ id: 'm2', authorKind: 'staff', createdAt: '2026-01-01T10:00:00.000Z', body: 'Looking into it' })
    const resolved = event({ id: 'e2', createdAt: '2026-01-01T11:00:00.000Z', toValue: 'resolved' })

    const timeline = mergeTicketTimeline([m1, reply], [inProgress, resolved])
    expect(timeline.map((t) => t.id)).toEqual(['m1', 'e1', 'm2', 'e2'])
    expect(timeline.map((t) => t.kind)).toEqual(['message', 'system', 'message', 'system'])
  })

  it('drops non-customer-facing events entirely rather than rendering them with no label', () => {
    const m1 = message({})
    const assigned = event({ id: 'e1', kind: 'assigned', toValue: 'usr-123' })
    const priority = event({ id: 'e2', kind: 'priority_changed', toValue: 'high' })

    const timeline = mergeTicketTimeline([m1], [assigned, priority])
    expect(timeline).toHaveLength(1)
    expect(timeline[0].kind).toBe('message')
  })
})
