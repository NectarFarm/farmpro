// ── The head count is a ledger now (batch-ledger task) ──────────────────────
// What was wrong: a mortality record was filed and `batches.currentQty` did
// not move. The deaths were in the database, the count carried on as before,
// and every figure derived from it drifted away from the animals actually in
// the house. A physical count recorded what was counted and changed nothing.
// A sale changed nothing. A hand-edit changed the number and left no trace.
//
// So these tests are about two things: that the count moves, and that there
// is always something on the record saying why.
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { and, eq, inArray } from 'drizzle-orm'

vi.mock('server-only', () => ({}))

let mockCookie: string | undefined
vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({ get: () => (mockCookie ? { value: mockCookie } : undefined) })),
}))

import { POST as recordsPOST } from '@/app/api/records/route'
import { PATCH as batchPATCH } from '@/app/api/batches/[id]/route'
import { GET as movementsGET } from '@/app/api/batches/[id]/movements/route'
import { POST as salesPOST } from '@/app/api/data/sales/route'
import { POST as approvePOST } from '@/app/api/approvals/[id]/approve/route'
import { POST as rejectPOST } from '@/app/api/approvals/[id]/reject/route'
import { db } from '@/db'
import {
  tenants, users, sessions, farms, productionUnits, batches, employees, records,
  batchMovements, approvalRequests, auditLog, products, sales, rolePermissions,
  productCollections, journalEntries, journalLines,
} from '@/db/schemas'
import { createSession, hashSecret } from '@/lib/auth'

const hasDb = !!process.env.DATABASE_URL
const run = hasDb ? describe : describe.skip

function jsonRequest(url: string, method: string, body?: unknown): Request {
  return new Request(url, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
}
async function readJson(res: Response) {
  return { status: res.status, payload: await res.json() }
}

run('batch head count is a ledger', () => {
  const tenantId = `t-ledger-${randomUUID()}`
  const farmId = `f-${randomUUID()}`
  const unitId = `u-${randomUUID()}`
  const batchId = `b-${randomUUID()}`
  const ownerId = `usr-owner-${randomUUID()}`
  const workerUserId = `usr-worker-${randomUUID()}`
  const employeeId = `emp-${randomUUID()}`
  const birdProductId = `prod-bird-${randomUUID()}`
  const eggProductId = `prod-egg-${randomUUID()}`
  let ownerSession: string
  let workerSession: string

  beforeAll(async () => {
    await db.insert(tenants).values({ id: tenantId, name: 'Ledger Co.', active: true })
    await db.insert(farms).values({ id: farmId, tenantId, name: 'Farm', location: 'Nakuru', code: 'FRM-L' })
    await db.insert(productionUnits).values({ id: unitId, tenantId, farmId, type: 'house', name: 'House', code: 'HSE-L' })
    const salt = randomUUID()
    await db.insert(users).values([
      { id: ownerId, tenantId, name: 'Owner', email: `owner-${randomUUID()}@test.ifms`, role: 'owner', passwordHash: hashSecret('pw', salt), passwordSalt: salt, status: 'ACTIVE' },
      { id: workerUserId, tenantId, name: 'Worker', email: `worker-${randomUUID()}@test.ifms`, role: 'worker', passwordHash: hashSecret('pw', salt), passwordSalt: salt, status: 'ACTIVE' },
    ])
    await db.insert(employees).values({ id: employeeId, tenantId, userId: workerUserId, name: 'Worker', phone: '', role: 'worker' })
    await db.insert(products).values([
      { id: birdProductId, tenantId, type: 'poultry', name: 'Live Broiler', stockEffect: 'batch_quantity' },
      { id: eggProductId, tenantId, type: 'poultry', name: 'Tray Eggs', stockEffect: 'produce' },
    ])
    // A worker may record mortality and counts, and both need signing off.
    await db.insert(rolePermissions).values([
      { id: randomUUID(), tenantId, role: 'worker', module: 'mortality', access: 'edit', approvalRequired: true },
      { id: randomUUID(), tenantId, role: 'worker', module: 'physical-count', access: 'edit', approvalRequired: true },
      { id: randomUUID(), tenantId, role: 'worker', module: 'governance', access: 'hidden', approvalRequired: false },
    ])
    ownerSession = await createSession(ownerId)
    workerSession = await createSession(workerUserId)
  })

  beforeEach(async () => {
    await db.delete(batchMovements).where(eq(batchMovements.tenantId, tenantId))
    await db.delete(records).where(eq(records.tenantId, tenantId))
    await db.delete(approvalRequests).where(eq(approvalRequests.tenantId, tenantId))
    await db.delete(sales).where(eq(sales.tenantId, tenantId))
    await db.delete(productCollections).where(eq(productCollections.tenantId, tenantId))
    await db.delete(batches).where(eq(batches.id, batchId))
    await db.insert(batches).values({
      id: batchId, tenantId, unitId, code: 'BRO-L', name: 'Broilers', enterprise: 'broiler',
      initialQty: 500, currentQty: 500,
    })
  })

  afterAll(async () => {
    mockCookie = undefined
    // Sales post to the ledger, so the journal rows they created have to go
    // before the tenant does — lines first, they reference the entry.
    const entries = await db.select({ id: journalEntries.id }).from(journalEntries).where(eq(journalEntries.tenantId, tenantId))
    if (entries.length > 0) {
      await db.delete(journalLines).where(inArray(journalLines.entryId, entries.map((e) => e.id)))
      await db.delete(journalEntries).where(eq(journalEntries.tenantId, tenantId))
    }
    await db.delete(sales).where(eq(sales.tenantId, tenantId))
    await db.delete(productCollections).where(eq(productCollections.tenantId, tenantId))
    await db.delete(auditLog).where(eq(auditLog.tenantId, tenantId))
    await db.delete(approvalRequests).where(eq(approvalRequests.tenantId, tenantId))
    await db.delete(batchMovements).where(eq(batchMovements.tenantId, tenantId))
    await db.delete(records).where(eq(records.tenantId, tenantId))
    await db.delete(rolePermissions).where(eq(rolePermissions.tenantId, tenantId))
    await db.delete(products).where(eq(products.tenantId, tenantId))
    await db.delete(employees).where(eq(employees.tenantId, tenantId))
    await db.delete(batches).where(eq(batches.id, batchId))
    await db.delete(productionUnits).where(eq(productionUnits.tenantId, tenantId))
    await db.delete(farms).where(eq(farms.tenantId, tenantId))
    await db.delete(sessions).where(inArray(sessions.userId, [ownerId, workerUserId]))
    await db.delete(users).where(inArray(users.id, [ownerId, workerUserId]))
    await db.delete(tenants).where(eq(tenants.id, tenantId))
  })

  async function currentQty() {
    const [b] = await db.select().from(batches).where(eq(batches.id, batchId))
    return b.currentQty
  }

  async function post(body: Record<string, unknown>, cookie = ownerSession) {
    mockCookie = cookie
    const res = await readJson(await recordsPOST(jsonRequest('http://localhost/api/records', 'POST', { tenantId, batchId, employeeId, ...body })))
    mockCookie = undefined
    return res
  }

  it('a death takes birds off the batch, and says so in the history', async () => {
    const res = await post({ type: 'mortality', data: { count: 12, cause: 'Heat stress' } })
    expect(res.status).toBe(201)
    expect(await currentQty()).toBe(488)

    const [move] = await db.select().from(batchMovements).where(eq(batchMovements.batchId, batchId))
    expect(move.type).toBe('mortality')
    expect(move.qtyDelta).toBe(-12)
    expect(move.qtyAfter).toBe(488)
    expect(move.reason).toBe('Heat stress')
    expect(move.sourceType).toBe('record')
  })

  it('records more deaths than the count shows without blocking the worker', async () => {
    // Very often the head count was simply never entered. Refusing the
    // report would lose it entirely because of somebody else's omission.
    await db.update(batches).set({ currentQty: 5 }).where(eq(batches.id, batchId))
    const res = await post({ type: 'mortality', data: { count: 40, cause: 'Flood' } })
    expect(res.status).toBe(201)
    expect(await currentQty()).toBe(0)

    const [move] = await db.select().from(batchMovements).where(eq(batchMovements.batchId, batchId))
    // Nothing is hidden: the reason carries what was reported against what
    // was actually on the books.
    expect(move.reason).toContain('40 reported')
    expect(move.reason).toContain('only 5')
  })

  it('a physical count records the variance it found, not the new total', async () => {
    const res = await post({ type: 'physical_count', data: { systemCount: 500, physicalCount: 470, varianceReason: 'Sold at the gate, never recorded' } })
    expect(res.status).toBe(201)
    expect(await currentQty()).toBe(470)

    const [move] = await db.select().from(batchMovements).where(eq(batchMovements.batchId, batchId))
    expect(move.type).toBe('count_adjustment')
    // -30, not 470: the point of counting is the difference.
    expect(move.qtyDelta).toBe(-30)
    expect(move.reason).toContain('Sold at the gate')
  })

  it('writes nothing when a count finds exactly what was expected', async () => {
    const res = await post({ type: 'physical_count', data: { physicalCount: 500 } })
    expect(res.status).toBe(201)
    const moves = await db.select().from(batchMovements).where(eq(batchMovements.batchId, batchId))
    // A ledger full of "counted, no change" buries the counts that found
    // something.
    expect(moves.length).toBe(0)
  })

  it('holds the count still until a worker’s mortality is approved', async () => {
    const res = await post({ type: 'mortality', data: { count: 20, cause: 'Disease' } }, workerSession)
    expect(res.status).toBe(201)
    expect(res.payload.data.pendingApproval).toBe(true)
    // Filed, but the batch has not moved: the tenant marked mortality as
    // needing approval for this role, and nothing read that column before.
    expect(await currentQty()).toBe(500)

    const approvalId = res.payload.data.approvalRequestId
    mockCookie = ownerSession
    const decided = await readJson(await approvePOST(new Request('http://localhost', { method: 'POST' }), { params: Promise.resolve({ id: approvalId }) }))
    mockCookie = undefined
    expect(decided.status).toBe(200)

    expect(await currentQty()).toBe(480)
    const [record] = await db.select().from(records).where(eq(records.tenantId, tenantId))
    expect((record.data as Record<string, unknown>).pendingApproval).toBeUndefined()
    expect((record.data as Record<string, unknown>).approvalDecision).toBe('approved')
  })

  it('leaves the count alone when the mortality is rejected', async () => {
    const res = await post({ type: 'mortality', data: { count: 20, cause: 'Wrong batch' } }, workerSession)
    const approvalId = res.payload.data.approvalRequestId

    mockCookie = ownerSession
    await rejectPOST(new Request('http://localhost', { method: 'POST' }), { params: Promise.resolve({ id: approvalId }) })
    mockCookie = undefined

    expect(await currentQty()).toBe(500)
    const moves = await db.select().from(batchMovements).where(eq(batchMovements.batchId, batchId))
    expect(moves.length).toBe(0)
    // And it no longer claims to be waiting for anything.
    const [record] = await db.select().from(records).where(eq(records.tenantId, tenantId))
    expect((record.data as Record<string, unknown>).approvalDecision).toBe('rejected')
  })

  it('applies an owner’s own mortality immediately — they cannot approve themselves', async () => {
    const res = await post({ type: 'mortality', data: { count: 3 } })
    expect(res.payload.data.pendingApproval).toBeUndefined()
    expect(await currentQty()).toBe(497)
  })

  it('selling birds takes them off the batch; selling eggs does not', async () => {
    mockCookie = ownerSession
    const birds = await readJson(await salesPOST(jsonRequest('http://localhost/api/data/sales', 'POST', {
      tenantId, batchId, productId: birdProductId, qty: 50, amountCents: 2500000,
    })))
    mockCookie = undefined
    expect(birds.status).toBe(201)
    expect(await currentQty()).toBe(450)

    // Eggs have to exist before they can be sold — produce is sold out of
    // what was collected (worker-routines task), so collect some first.
    mockCookie = ownerSession
    await recordsPOST(jsonRequest('http://localhost/api/records', 'POST', {
      tenantId, batchId, employeeId, type: 'production', data: { items: [{ productId: eggProductId, qty: 30 }] },
    }))
    const eggs = await readJson(await salesPOST(jsonRequest('http://localhost/api/data/sales', 'POST', {
      tenantId, batchId, productId: eggProductId, qty: 30, amountCents: 900000,
    })))
    mockCookie = undefined
    expect(eggs.status).toBe(201)
    // The hens are still there.
    expect(await currentQty()).toBe(450)
  })

  it('refuses to sell more birds than the batch has', async () => {
    mockCookie = ownerSession
    const res = await readJson(await salesPOST(jsonRequest('http://localhost/api/data/sales', 'POST', {
      tenantId, batchId, productId: birdProductId, qty: 900, amountCents: 100,
    })))
    mockCookie = undefined
    // Unlike a death, this is a data-entry error with money attached —
    // recording revenue against an impossible head count is worse than
    // making someone fix the number.
    expect(res.status).toBe(400)
    expect(await currentQty()).toBe(500)
    const saved = await db.select().from(sales).where(eq(sales.tenantId, tenantId))
    expect(saved.length).toBe(0)
  })

  it('asks how many when the product is one that comes out of the batch', async () => {
    mockCookie = ownerSession
    const res = await readJson(await salesPOST(jsonRequest('http://localhost/api/data/sales', 'POST', {
      tenantId, batchId, productId: birdProductId, amountCents: 100000,
    })))
    mockCookie = undefined
    expect(res.status).toBe(400)
    expect(String(res.payload.error)).toContain('how many')
  })

  it('records a hand-edited head count as a movement with a reason', async () => {
    mockCookie = ownerSession
    const res = await readJson(await batchPATCH(
      jsonRequest(`http://localhost/api/batches/${batchId}`, 'PATCH', { tenantId, currentQty: 460, reason: 'Recount after transfer' }),
      { params: Promise.resolve({ id: batchId }) }
    ))
    mockCookie = undefined
    expect(res.status).toBe(200)
    expect(await currentQty()).toBe(460)

    const [move] = await db.select().from(batchMovements).where(eq(batchMovements.batchId, batchId))
    expect(move.type).toBe('manual_adjustment')
    expect(move.qtyDelta).toBe(-40)
    expect(move.reason).toBe('Recount after transfer')
    expect(move.actor).toBeTruthy()
  })

  it('serves the history newest first, and refuses another tenant’s batch', async () => {
    await post({ type: 'mortality', data: { count: 2 } })
    await post({ type: 'mortality', data: { count: 3 } })

    mockCookie = ownerSession
    const { status, payload } = await readJson(await movementsGET(
      new Request(`http://localhost/api/batches/${batchId}/movements?tenantId=${tenantId}`),
      { params: Promise.resolve({ id: batchId }) }
    ))
    const missing = await readJson(await movementsGET(
      new Request('http://localhost/api/batches/nope/movements'),
      { params: Promise.resolve({ id: 'nope' }) }
    ))
    mockCookie = undefined

    expect(status).toBe(200)
    expect(payload.data.length).toBe(2)
    expect(payload.data[0].qtyAfter).toBe(495)
    // 404 rather than an empty ledger, which would read as "nothing ever
    // happened" instead of "not your batch".
    expect(missing.status).toBe(404)
  })
})
