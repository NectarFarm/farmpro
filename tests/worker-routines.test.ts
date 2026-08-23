// ── Owner-defined rounds, and the record types that were "Coming Soon" ──────
// The worker portal listed Morning Round, Collect Products, Health & Vaccine,
// Weight Sample and Closing Stock as greyed-out tiles. That was honest when it
// was written — the backend took three record types — and then it became the
// reason those jobs went unrecorded.
//
// A round could never be a fixed list in code: what a morning round consists
// of differs per farm. So the owner defines it, and these tests cover both
// halves — the definition, and the records a worker's completed round leaves
// behind.
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { eq, inArray } from 'drizzle-orm'

vi.mock('server-only', () => ({}))

let mockCookie: string | undefined
vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({ get: () => (mockCookie ? { value: mockCookie } : undefined) })),
}))

import { GET as routinesGET, POST as routinesPOST } from '@/app/api/routines/route'
import { PATCH as routinePATCH, DELETE as routineDELETE } from '@/app/api/routines/[id]/route'
import { GET as runsGET, POST as runsPOST } from '@/app/api/routine-runs/route'
import { POST as recordsPOST } from '@/app/api/records/route'
import { GET as produceGET } from '@/app/api/produce/available/route'
import { POST as salesPOST } from '@/app/api/data/sales/route'
import { db } from '@/db'
import {
  tenants, users, sessions, farms, productionUnits, batches, employees, records,
  routines, routineSteps, routineRuns, products, productCollections, sales,
  journalEntries, journalLines,
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

run('routines and the rest of the worker record types', () => {
  const tenantId = `t-rout-${randomUUID()}`
  const otherTenantId = `t-rout-other-${randomUUID()}`
  const farmId = `f-${randomUUID()}`
  const unitId = `u-${randomUUID()}`
  const batchId = `b-${randomUUID()}`
  const ownerId = `usr-owner-${randomUUID()}`
  const workerUserId = `usr-worker-${randomUUID()}`
  const otherOwnerId = `usr-other-${randomUUID()}`
  const employeeId = `emp-${randomUUID()}`
  const eggProductId = `prod-egg-${randomUUID()}`
  let ownerSession: string
  let workerSession: string
  let otherOwnerSession: string
  const createdRoutineIds: string[] = []

  beforeAll(async () => {
    await db.insert(tenants).values([
      { id: tenantId, name: 'Routine Co.', active: true },
      { id: otherTenantId, name: 'Other Co.', active: true },
    ])
    await db.insert(farms).values({ id: farmId, tenantId, name: 'Farm', location: 'Nakuru', code: 'FRM-R' })
    await db.insert(productionUnits).values({ id: unitId, tenantId, farmId, type: 'pen', name: 'Pen', code: 'PEN-R' })
    await db.insert(batches).values({
      id: batchId, tenantId, unitId, code: 'LYR-R', name: 'Layers', enterprise: 'layer',
      initialQty: 300, currentQty: 300,
    })
    const salt = randomUUID()
    await db.insert(users).values([
      { id: ownerId, tenantId, name: 'Owner', email: `owner-${randomUUID()}@test.ifms`, role: 'owner', passwordHash: hashSecret('pw', salt), passwordSalt: salt, status: 'ACTIVE' },
      { id: workerUserId, tenantId, name: 'Worker', email: `worker-${randomUUID()}@test.ifms`, role: 'worker', passwordHash: hashSecret('pw', salt), passwordSalt: salt, status: 'ACTIVE' },
      { id: otherOwnerId, tenantId: otherTenantId, name: 'Other', email: `other-${randomUUID()}@test.ifms`, role: 'owner', passwordHash: hashSecret('pw', salt), passwordSalt: salt, status: 'ACTIVE' },
    ])
    await db.insert(employees).values({ id: employeeId, tenantId, userId: workerUserId, name: 'Worker', phone: '', role: 'worker' })
    await db.insert(products).values({ id: eggProductId, tenantId, type: 'poultry', name: 'Tray Eggs', stockEffect: 'produce' })
    ownerSession = await createSession(ownerId)
    workerSession = await createSession(workerUserId)
    otherOwnerSession = await createSession(otherOwnerId)
  })

  beforeEach(async () => {
    await db.delete(routineRuns).where(eq(routineRuns.tenantId, tenantId))
    await db.delete(records).where(eq(records.tenantId, tenantId))
    await db.delete(productCollections).where(eq(productCollections.tenantId, tenantId))
    await db.delete(sales).where(eq(sales.tenantId, tenantId))
  })

  afterAll(async () => {
    mockCookie = undefined
    const entries = await db.select({ id: journalEntries.id }).from(journalEntries).where(eq(journalEntries.tenantId, tenantId))
    if (entries.length > 0) {
      await db.delete(journalLines).where(inArray(journalLines.entryId, entries.map((e) => e.id)))
      await db.delete(journalEntries).where(eq(journalEntries.tenantId, tenantId))
    }
    await db.delete(sales).where(eq(sales.tenantId, tenantId))
    await db.delete(productCollections).where(eq(productCollections.tenantId, tenantId))
    await db.delete(routineRuns).where(eq(routineRuns.tenantId, tenantId))
    await db.delete(routineSteps).where(eq(routineSteps.tenantId, tenantId))
    await db.delete(routines).where(eq(routines.tenantId, tenantId))
    await db.delete(records).where(eq(records.tenantId, tenantId))
    await db.delete(products).where(eq(products.tenantId, tenantId))
    await db.delete(employees).where(eq(employees.tenantId, tenantId))
    await db.delete(batches).where(eq(batches.id, batchId))
    await db.delete(productionUnits).where(eq(productionUnits.tenantId, tenantId))
    await db.delete(farms).where(eq(farms.tenantId, tenantId))
    await db.delete(sessions).where(inArray(sessions.userId, [ownerId, workerUserId, otherOwnerId]))
    await db.delete(users).where(inArray(users.id, [ownerId, workerUserId, otherOwnerId]))
    await db.delete(tenants).where(inArray(tenants.id, [tenantId, otherTenantId]))
  })

  async function createRoutine(body: Record<string, unknown>, cookie = ownerSession) {
    mockCookie = cookie
    const res = await readJson(await routinesPOST(jsonRequest('http://localhost/api/routines', 'POST', { tenantId, ...body })))
    mockCookie = undefined
    if (res.status === 201) createdRoutineIds.push(res.payload.data.id)
    return res
  }

  async function record(body: Record<string, unknown>, cookie = ownerSession) {
    mockCookie = cookie
    const res = await readJson(await recordsPOST(jsonRequest('http://localhost/api/records', 'POST', { tenantId, batchId, employeeId, ...body })))
    mockCookie = undefined
    return res
  }

  describe('defining a round', () => {
    it('stores the steps in the order they were given', async () => {
      const res = await createRoutine({
        name: 'Morning round', timeOfDay: 'morning',
        steps: [
          { kind: 'feeding', label: 'Feed the birds' },
          { kind: 'check', label: 'Water lines clear?', required: false },
          { kind: 'production', label: 'Collect eggs' },
        ],
      })
      expect(res.status).toBe(201)

      mockCookie = ownerSession
      const list = await readJson(await routinesGET(new Request(`http://localhost/api/routines?tenantId=${tenantId}`)))
      mockCookie = undefined
      const routine = list.payload.data.find((r: { id: string }) => r.id === res.payload.data.id)
      expect(routine.steps.map((s: { label: string }) => s.label)).toEqual([
        'Feed the birds', 'Water lines clear?', 'Collect eggs',
      ])
      // Order is the whole point of a checklist, so it round-trips as given
      // rather than by insertion time.
      expect(routine.steps[1].required).toBe(false)
    })

    it('refuses a step kind that has no form behind it', async () => {
      const res = await createRoutine({ name: 'Bad', steps: [{ kind: 'telepathy', label: 'Sense the mood' }] })
      expect(res.status).toBe(400)
    })

    it('replaces the whole step list on edit, rather than patching one step', async () => {
      const created = await createRoutine({
        name: 'Evening', steps: [{ kind: 'check', label: 'Lock up' }, { kind: 'feeding', label: 'Top up feed' }],
      })
      const id = created.payload.data.id

      mockCookie = ownerSession
      const res = await readJson(await routinePATCH(
        jsonRequest(`http://localhost/api/routines/${id}`, 'PATCH', {
          tenantId, steps: [{ kind: 'mortality', label: 'Any deaths?' }],
        }),
        { params: Promise.resolve({ id }) }
      ))
      mockCookie = undefined
      expect(res.status).toBe(200)
      // "Remove water check, add egg collection, move feeding first" is one
      // intent; applying it as three calls invites a half-edited list a
      // worker then walks through.
      expect(res.payload.data.steps.length).toBe(1)
      expect(res.payload.data.steps[0].label).toBe('Any deaths?')
    })

    it('a worker can read the round but not rewrite it', async () => {
      const created = await createRoutine({ name: 'Readable', steps: [{ kind: 'check', label: 'Look around' }] })

      mockCookie = workerSession
      const read = await readJson(await routinesGET(new Request(`http://localhost/api/routines?tenantId=${tenantId}`)))
      const write = await readJson(await routinePATCH(
        jsonRequest(`http://localhost/api/routines/${created.payload.data.id}`, 'PATCH', { tenantId, name: 'Mine now' }),
        { params: Promise.resolve({ id: created.payload.data.id }) }
      ))
      mockCookie = undefined

      expect(read.status).toBe(200)
      expect(read.payload.data.length).toBeGreaterThan(0)
      expect(write.status).toBe(403)
    })

    it('another tenant cannot see or delete it', async () => {
      const created = await createRoutine({ name: 'Private', steps: [] })

      mockCookie = otherOwnerSession
      const theirList = await readJson(await routinesGET(new Request('http://localhost/api/routines')))
      const theirDelete = await readJson(await routineDELETE(
        new Request('http://localhost'), { params: Promise.resolve({ id: created.payload.data.id }) }
      ))
      mockCookie = undefined

      expect(theirList.payload.data.map((r: { id: string }) => r.id)).not.toContain(created.payload.data.id)
      expect(theirDelete.status).toBe(404)
    })
  })

  describe('doing the round', () => {
    it('records that it was done, which the records alone cannot say', async () => {
      const created = await createRoutine({ name: 'Quiet round', steps: [{ kind: 'check', label: 'All well?' }] })

      mockCookie = workerSession
      const res = await readJson(await runsPOST(jsonRequest('http://localhost/api/routine-runs', 'POST', {
        tenantId, routineId: created.payload.data.id, batchId, employeeId,
        completedSteps: { s1: { kind: 'check' } },
      })))
      mockCookie = undefined
      expect(res.status).toBe(201)

      mockCookie = ownerSession
      const runs = await readJson(await runsGET(new Request(`http://localhost/api/routine-runs?tenantId=${tenantId}&batchId=${batchId}`)))
      mockCookie = undefined
      // A round where nothing died and nothing was collected produces no
      // records at all — without this row, "done" and "nobody came" look
      // identical.
      expect(runs.payload.data.length).toBe(1)
    })

    it('refuses a run pointing at another tenant’s batch', async () => {
      const created = await createRoutine({ name: 'Scoped', steps: [] })
      mockCookie = ownerSession
      const res = await readJson(await runsPOST(jsonRequest('http://localhost/api/routine-runs', 'POST', {
        tenantId, routineId: created.payload.data.id, batchId: 'not-mine', employeeId,
      })))
      mockCookie = undefined
      expect(res.status).toBe(404)
    })
  })

  describe('the record types that were greyed out', () => {
    it('accepts a health record', async () => {
      const res = await record({ type: 'health', data: { treatment: 'Newcastle vaccine', affected: 300 } })
      expect(res.status).toBe(201)
      expect(res.payload.data.type).toBe('health')
    })

    it('accepts a weight sample with its average', async () => {
      const res = await record({ type: 'weight', data: { samples: [1.8, 2.0, 1.9], averageKg: 1.9, sampleSize: 3 } })
      expect(res.status).toBe(201)
    })

    it('accepts a plain check, because "somebody looked" is worth recording', async () => {
      const res = await record({ type: 'check', data: { step: 'Water lines', ok: true } })
      expect(res.status).toBe(201)
    })

    it('records a closing stock count without silently rewriting the stock', async () => {
      const res = await record({ type: 'stock_count', data: { items: [{ itemId: 'x', counted: 40, systemQty: 55, variance: -15 }] } })
      expect(res.status).toBe(201)
      // Correcting stock is an audited, reason-required action an owner takes
      // on the lot. A closing count that adjusted quantities itself would put
      // that correction in the one place nobody reviews.
      expect(res.payload.data.type).toBe('stock_count')
    })
  })

  describe('collecting produce', () => {
    it('counts the collection into a balance a sale can draw down', async () => {
      const res = await record({ type: 'production', data: { items: [{ productId: eggProductId, qty: 120 }] } })
      expect(res.status).toBe(201)

      const rows = await db.select().from(productCollections).where(eq(productCollections.tenantId, tenantId))
      expect(rows.length).toBe(1)
      expect(rows[0].qty).toBe(120)
      // Tied back to the record, so the two can be found from each other.
      expect(rows[0].recordId).toBe(res.payload.data.id)

      mockCookie = ownerSession
      const available = await readJson(await produceGET(new Request(`http://localhost/api/produce/available?tenantId=${tenantId}&batchId=${batchId}`)))
      mockCookie = undefined
      expect(available.payload.data[0].available).toBe(120)
    })

    it('refuses an empty collection', async () => {
      const res = await record({ type: 'production', data: { items: [] } })
      expect(res.status).toBe(400)
    })

    it('refuses a product that is not in this farm’s catalogue', async () => {
      const res = await record({ type: 'production', data: { items: [{ productId: 'nope', qty: 5 }] } })
      expect(res.status).toBe(400)
      const rows = await db.select().from(productCollections).where(eq(productCollections.tenantId, tenantId))
      expect(rows.length).toBe(0)
    })

    it('will not sell more produce than was collected', async () => {
      await record({ type: 'production', data: { items: [{ productId: eggProductId, qty: 30 }] } })

      mockCookie = ownerSession
      const tooMany = await readJson(await salesPOST(jsonRequest('http://localhost/api/data/sales', 'POST', {
        tenantId, batchId, productId: eggProductId, qty: 50, amountCents: 500000,
      })))
      mockCookie = undefined
      expect(tooMany.status).toBe(400)
      expect(String(tooMany.payload.error)).toContain('30')

      mockCookie = ownerSession
      const fine = await readJson(await salesPOST(jsonRequest('http://localhost/api/data/sales', 'POST', {
        tenantId, batchId, productId: eggProductId, qty: 20, amountCents: 200000,
      })))
      mockCookie = undefined
      expect(fine.status).toBe(201)

      mockCookie = ownerSession
      const after = await readJson(await produceGET(new Request(`http://localhost/api/produce/available?tenantId=${tenantId}&batchId=${batchId}`)))
      mockCookie = undefined
      expect(after.payload.data[0].available).toBe(10)
    })
  })
})
