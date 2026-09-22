// ── SaaS back-office: support ticket access-control DB integration tests ───
// Real Postgres (skips with no DATABASE_URL). Covers: a customer can't read
// another tenant's ticket, a non-owner can't read a colleague's ticket,
// internal notes are never returned to customers, and a staff member
// without support.handle gets 403.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'

vi.mock('server-only', () => ({}))

let mockCookie: string | undefined
vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({ get: () => (mockCookie ? { value: mockCookie } : undefined) })),
}))

import { GET as ticketGET, } from '@/app/api/support/tickets/[id]/route'
import { POST as ticketsPOST } from '@/app/api/support/tickets/route'
import { GET as adminTicketGET } from '@/app/api/admin/tickets/[id]/route'
import { GET as adminTicketsGET } from '@/app/api/admin/tickets/route'
import { POST as adminMessagePOST } from '@/app/api/admin/tickets/[id]/messages/route'
import { db } from '@/db'
import { platformStaff, sessions, supportTickets, ticketEvents, ticketMessages, tenants, users } from '@/db/schemas'
import { createSession, hashSecret } from '@/lib/auth'

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

run('SaaS back-office: support ticket access control', () => {
  const tenantAId = `t-support-a-${randomUUID()}`
  const tenantBId = `t-support-b-${randomUUID()}`
  const ownerAId = randomUUID()
  const workerAId = randomUUID()
  const ownerBId = randomUUID()
  const supportStaffId = randomUUID() // platform_staff row WITH support.handle
  const noCapStaffId = randomUUID() // platform_staff row with NO capabilities

  let ownerAToken: string, workerAToken: string, ownerBToken: string, supportStaffToken: string, noCapStaffToken: string
  let ticketId: string

  beforeAll(async () => {
    const salt = randomUUID()
    await db.insert(tenants).values([
      { id: tenantAId, name: 'Support Test Tenant A', active: true },
      { id: tenantBId, name: 'Support Test Tenant B', active: true },
    ])
    await db.insert(users).values([
      { id: ownerAId, tenantId: tenantAId, name: 'Owner A', email: `support-owner-a-${randomUUID()}@test.ifms`, role: 'owner', passwordHash: hashSecret('pw', salt), passwordSalt: salt, status: 'ACTIVE' },
      { id: workerAId, tenantId: tenantAId, name: 'Worker A', email: `support-worker-a-${randomUUID()}@test.ifms`, role: 'worker', passwordHash: hashSecret('pw', salt), passwordSalt: salt, status: 'ACTIVE' },
      { id: ownerBId, tenantId: tenantBId, name: 'Owner B', email: `support-owner-b-${randomUUID()}@test.ifms`, role: 'owner', passwordHash: hashSecret('pw', salt), passwordSalt: salt, status: 'ACTIVE' },
      { id: supportStaffId, tenantId: null, name: 'Support Staff', email: `support-staff-${randomUUID()}@test.ifms`, role: 'super_admin', passwordHash: hashSecret('pw', salt), passwordSalt: salt, status: 'ACTIVE' },
      { id: noCapStaffId, tenantId: null, name: 'No Cap Staff', email: `no-cap-staff-${randomUUID()}@test.ifms`, role: 'super_admin', passwordHash: hashSecret('pw', salt), passwordSalt: salt, status: 'ACTIVE' },
    ])
    await db.insert(platformStaff).values([
      { userId: supportStaffId, title: 'Support', capabilities: ['support.handle', 'support.assign'], active: true, createdBy: supportStaffId },
      { userId: noCapStaffId, title: 'No caps', capabilities: [], active: true, createdBy: noCapStaffId },
    ])

    ownerAToken = await createSession(ownerAId)
    workerAToken = await createSession(workerAId)
    ownerBToken = await createSession(ownerBId)
    supportStaffToken = await createSession(supportStaffId)
    noCapStaffToken = await createSession(noCapStaffId)

    // Worker A raises a ticket.
    mockCookie = workerAToken
    const { payload } = await readJson(
      await ticketsPOST(req('http://localhost/api/support/tickets', 'POST', { subject: 'My batch page is blank', category: 'bug', priority: 'high', body: 'It shows nothing when I open batch details.' }))
    )
    ticketId = payload.data.id
  })

  afterAll(async () => {
    await db.delete(ticketMessages).where(eq(ticketMessages.ticketId, ticketId))
    await db.delete(ticketEvents).where(eq(ticketEvents.ticketId, ticketId))
    await db.delete(supportTickets).where(eq(supportTickets.id, ticketId))
    await db.delete(platformStaff).where(eq(platformStaff.userId, supportStaffId))
    await db.delete(platformStaff).where(eq(platformStaff.userId, noCapStaffId))
    for (const id of [ownerAId, workerAId, ownerBId, supportStaffId, noCapStaffId]) {
      await db.delete(sessions).where(eq(sessions.userId, id))
      await db.delete(users).where(eq(users.id, id))
    }
    await db.delete(tenants).where(eq(tenants.id, tenantAId))
    await db.delete(tenants).where(eq(tenants.id, tenantBId))
  })

  it('the raiser (worker A) can read their own ticket', async () => {
    mockCookie = workerAToken
    const { status, payload } = await readJson(await ticketGET(req(`http://localhost/api/support/tickets/${ticketId}`, 'GET'), { params: Promise.resolve({ id: ticketId }) }))
    expect(status).toBe(200)
    expect(payload.data.ticket.id).toBe(ticketId)
  })

  it('the tenant owner (owner A) can read a ticket raised by a colleague', async () => {
    mockCookie = ownerAToken
    const { status } = await readJson(await ticketGET(req(`http://localhost/api/support/tickets/${ticketId}`, 'GET'), { params: Promise.resolve({ id: ticketId }) }))
    expect(status).toBe(200)
  })

  it('a customer cannot read another TENANT\'s ticket (404, not 403)', async () => {
    mockCookie = ownerBToken
    const { status } = await readJson(await ticketGET(req(`http://localhost/api/support/tickets/${ticketId}`, 'GET'), { params: Promise.resolve({ id: ticketId }) }))
    expect(status).toBe(404)
  })

  it('a non-owner cannot read a COLLEAGUE\'s ticket within the same tenant', async () => {
    // Raise a second ticket as owner A, then a different non-owner (a fresh
    // worker) in the same tenant must not be able to read it.
    const otherWorkerId = randomUUID()
    const salt = randomUUID()
    await db.insert(users).values({ id: otherWorkerId, tenantId: tenantAId, name: 'Other Worker A', email: `other-worker-a-${randomUUID()}@test.ifms`, role: 'worker', passwordHash: hashSecret('pw', salt), passwordSalt: salt, status: 'ACTIVE' })
    const otherWorkerToken = await createSession(otherWorkerId)

    mockCookie = otherWorkerToken
    const { status } = await readJson(await ticketGET(req(`http://localhost/api/support/tickets/${ticketId}`, 'GET'), { params: Promise.resolve({ id: ticketId }) }))
    expect(status).toBe(404)

    await db.delete(sessions).where(eq(sessions.userId, otherWorkerId))
    await db.delete(users).where(eq(users.id, otherWorkerId))
  })

  it('internal notes are never returned to the customer, but ARE returned to staff', async () => {
    mockCookie = supportStaffToken
    const internalResult = await readJson(
      await adminMessagePOST(
        req(`http://localhost/api/admin/tickets/${ticketId}/messages`, 'POST', { body: 'Internal: escalate to engineering', internal: true }),
        { params: Promise.resolve({ id: ticketId }) }
      )
    )
    expect(internalResult.status).toBe(201)

    mockCookie = workerAToken
    const { payload: customerView } = await readJson(await ticketGET(req(`http://localhost/api/support/tickets/${ticketId}`, 'GET'), { params: Promise.resolve({ id: ticketId }) }))
    expect(customerView.data.messages.some((m: { body: string }) => m.body.includes('escalate to engineering'))).toBe(false)

    mockCookie = supportStaffToken
    const { payload: staffView } = await readJson(await adminTicketGET(req(`http://localhost/api/admin/tickets/${ticketId}`, 'GET'), { params: Promise.resolve({ id: ticketId }) }))
    expect(staffView.data.messages.some((m: { body: string; isInternal: boolean }) => m.body.includes('escalate to engineering') && m.isInternal)).toBe(true)
  })

  it('a staff member without support.handle gets 403 on the staff ticket queue', async () => {
    mockCookie = noCapStaffToken
    const { status } = await readJson(await adminTicketsGET(req('http://localhost/api/admin/tickets', 'GET')))
    expect(status).toBe(403)
  })

  it('a staff member WITH support.handle can read the ticket queue', async () => {
    mockCookie = supportStaffToken
    const { status } = await readJson(await adminTicketsGET(req('http://localhost/api/admin/tickets', 'GET')))
    expect(status).toBe(200)
  })
})
