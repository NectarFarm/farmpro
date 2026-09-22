// ── Support ticket notifications reach both sides ───────────────────────────
// e2e finding: a tester raised a ticket and saw no notification on either
// side — no bell for the staff who should triage it, none for the customer
// when staff replied or changed its status. lib/support/notify.ts's two
// functions (notifyStaffOnTicketEvent / notifyCustomerOnTicketEvent) already
// existed and were already wired into lib/support/tickets.ts's
// createTicket/addTicketMessage/updateTicket — so this suite proves the
// WHOLE chain end to end through the real routes and real Postgres: a row is
// actually written, GET /api/notifications actually returns it to the right
// session (tenant-scoped for the customer, PLATFORM_TENANT_SENTINEL-scoped
// for staff), and components/farm/navigation.tsx's
// `ticketIdFromNotificationSource` actually recovers the ticket id back out
// of the sourceId it was given.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { eq, inArray } from 'drizzle-orm'

vi.mock('server-only', () => ({}))

let mockCookie: string | undefined
vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({ get: () => (mockCookie ? { value: mockCookie } : undefined) })),
}))

import { POST as ticketsPOST } from '@/app/api/support/tickets/route'
import { POST as customerMessagePOST } from '@/app/api/support/tickets/[id]/messages/route'
import { POST as adminMessagePOST } from '@/app/api/admin/tickets/[id]/messages/route'
import { PATCH as adminTicketPATCH } from '@/app/api/admin/tickets/[id]/route'
import { GET as notificationsGET } from '@/app/api/notifications/route'
import { ticketIdFromNotificationSource } from '@/components/farm/navigation'
import { db } from '@/db'
import { platformStaff, sessions, supportTickets, ticketEvents, ticketMessages, notifications, tenants, users } from '@/db/schemas'
import { createSession, hashSecret } from '@/lib/auth'
import { PLATFORM_TENANT_SENTINEL } from '@/lib/audit'

const hasDb = !!process.env.DATABASE_URL
const run = hasDb ? describe : describe.skip

async function readJson(res: Response) {
  return { status: res.status, payload: await res.json() }
}
function req(url: string, method: string, body?: unknown): Request {
  return new Request(url, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
}

describe('ticketIdFromNotificationSource (pure, no DB needed)', () => {
  it('recovers the leading uuid for both a customer and a staff source type', () => {
    const id = randomUUID()
    expect(ticketIdFromNotificationSource('support_ticket', `${id}-replied-${randomUUID()}`)).toBe(id)
    expect(ticketIdFromNotificationSource('support_ticket_staff', `${id}-created-${randomUUID()}`)).toBe(id)
  })

  it('returns null for any other sourceType, or a missing/malformed sourceId', () => {
    const id = randomUUID()
    expect(ticketIdFromNotificationSource('task', `${id}-replied-${randomUUID()}`)).toBeNull()
    expect(ticketIdFromNotificationSource('support_ticket', null)).toBeNull()
    expect(ticketIdFromNotificationSource('support_ticket', 'not-a-uuid')).toBeNull()
  })
})

run('support ticket notifications reach both sides (real DB)', () => {
  const tenantId = `t-ticket-notif-${randomUUID()}`
  const ownerId = randomUUID()
  const supportStaffId = randomUUID()
  let ownerToken: string, supportStaffToken: string
  let ticketId: string

  beforeAll(async () => {
    const salt = randomUUID()
    await db.insert(tenants).values({ id: tenantId, name: 'Ticket Notif Test Co.', active: true })
    await db.insert(users).values([
      { id: ownerId, tenantId, name: 'Notif Owner', email: `notif-owner-${randomUUID()}@test.ifms`, role: 'owner', passwordHash: hashSecret('pw', salt), passwordSalt: salt, status: 'ACTIVE' },
      { id: supportStaffId, tenantId: null, name: 'Notif Support Staff', email: `notif-support-${randomUUID()}@test.ifms`, role: 'super_admin', passwordHash: hashSecret('pw', salt), passwordSalt: salt, status: 'ACTIVE' },
    ])
    await db.insert(platformStaff).values({ userId: supportStaffId, title: 'Support', capabilities: ['support.handle'], active: true, createdBy: supportStaffId })
    ownerToken = await createSession(ownerId)
    supportStaffToken = await createSession(supportStaffId)
  })

  afterAll(async () => {
    mockCookie = undefined
    await db.delete(notifications).where(inArray(notifications.tenantId, [tenantId, PLATFORM_TENANT_SENTINEL]))
    if (ticketId) {
      await db.delete(ticketMessages).where(eq(ticketMessages.ticketId, ticketId))
      await db.delete(ticketEvents).where(eq(ticketEvents.ticketId, ticketId))
      await db.delete(supportTickets).where(eq(supportTickets.id, ticketId))
    }
    await db.delete(platformStaff).where(eq(platformStaff.userId, supportStaffId))
    await db.delete(sessions).where(inArray(sessions.userId, [ownerId, supportStaffId]))
    await db.delete(users).where(inArray(users.id, [ownerId, supportStaffId]))
    await db.delete(tenants).where(eq(tenants.id, tenantId))
  })

  it('raising a ticket writes a real notification row a support.handle staff session can actually see', async () => {
    mockCookie = ownerToken
    const created = await readJson(
      await ticketsPOST(req('http://localhost/api/support/tickets', 'POST', {
        subject: 'Cannot see my batches', category: 'bug', priority: 'high', body: 'The batch list is blank.',
      }))
    )
    expect(created.status).toBe(201)
    ticketId = created.payload.data.id

    // (a) a row genuinely exists for THIS staff member — not just "the route
    // returned 201". Every support.handle-capable staff account in this
    // shared dev DB gets its own row (lib/support/notify.ts's
    // notifyStaffOnTicketEvent loops every id from listCapableStaffUserIds),
    // so this filters to the one addressed to the fixture staff created
    // above rather than assuming it's the only row for this ticket.
    const rows = await db.select().from(notifications).where(eq(notifications.tenantId, PLATFORM_TENANT_SENTINEL))
    const createdRow = rows.find((n) => n.sourceType === 'support_ticket_staff' && n.sourceId?.startsWith(ticketId) && n.userId === supportStaffId)
    expect(createdRow).toBeTruthy()

    // (b) GET /api/notifications actually returns it to the intended staff
    // recipient (tenantId null -> PLATFORM_TENANT_SENTINEL scope).
    mockCookie = supportStaffToken
    const { status, payload } = await readJson(await notificationsGET())
    expect(status).toBe(200)
    const staffNotif = payload.data.find((n: { sourceId: string }) => n.sourceId?.startsWith(ticketId))
    expect(staffNotif).toBeTruthy()
    expect(staffNotif.title).toContain(created.payload.data.number)

    // The staff notification's sourceId round-trips back to this exact ticket.
    expect(ticketIdFromNotificationSource(staffNotif.sourceType, staffNotif.sourceId)).toBe(ticketId)
  })

  it('a staff reply writes a customer-visible notification, scoped to the customer\'s own tenant', async () => {
    mockCookie = supportStaffToken
    const replyRes = await readJson(
      await adminMessagePOST(req(`http://localhost/api/admin/tickets/${ticketId}/messages`, 'POST', { body: 'Looking into it now.' }), { params: Promise.resolve({ id: ticketId }) })
    )
    expect(replyRes.status).toBe(201)

    mockCookie = ownerToken
    const { status, payload } = await readJson(await notificationsGET())
    expect(status).toBe(200)
    const replyNotif = payload.data.find((n: { sourceType: string; sourceId: string }) => n.sourceType === 'support_ticket' && n.sourceId?.startsWith(ticketId))
    expect(replyNotif).toBeTruthy()
    expect(replyNotif.read).toBe(false)
    expect(ticketIdFromNotificationSource(replyNotif.sourceType, replyNotif.sourceId)).toBe(ticketId)
  })

  it('a customer reply notifies staff again (not the customer themself)', async () => {
    mockCookie = ownerToken
    const replyRes = await readJson(
      await customerMessagePOST(req(`http://localhost/api/support/tickets/${ticketId}/messages`, 'POST', { body: 'Any update?' }), { params: Promise.resolve({ id: ticketId }) })
    )
    expect(replyRes.status).toBe(201)

    mockCookie = supportStaffToken
    const { payload } = await readJson(await notificationsGET())
    const staffReplyNotifs = payload.data.filter((n: { sourceType: string; sourceId: string; title: string }) => n.sourceType === 'support_ticket_staff' && n.sourceId?.startsWith(ticketId) && n.title.includes('Customer replied'))
    expect(staffReplyNotifs.length).toBeGreaterThan(0)
  })

  it('resolving the ticket notifies the customer', async () => {
    mockCookie = supportStaffToken
    const patchRes = await readJson(
      await adminTicketPATCH(req(`http://localhost/api/admin/tickets/${ticketId}`, 'PATCH', { status: 'resolved' }), { params: Promise.resolve({ id: ticketId }) })
    )
    expect(patchRes.status).toBe(200)

    mockCookie = ownerToken
    const { payload } = await readJson(await notificationsGET())
    const resolvedNotif = payload.data.find((n: { sourceType: string; sourceId: string; title: string }) => n.sourceType === 'support_ticket' && n.sourceId?.startsWith(ticketId) && n.title.includes('resolved'))
    expect(resolvedNotif).toBeTruthy()
  })
})
