// ── Feeding draws on real stock (feed-from-stock task) ──────────────────────
// Before this, a worker typed the feed's name as free text and stock never
// moved: "remaining quantity" was whatever someone last adjusted by hand, and
// per-batch feed cost had no source at all.
//
// The tests that matter here are the ones about what happens when the numbers
// don't work out — an over-issue, a split across lots, a shortfall in the
// middle of a multi-batch round. Getting those wrong doesn't throw; it just
// leaves the stock figure quietly false, which is the exact failure this
// feature exists to end.
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { and, eq, inArray } from 'drizzle-orm'

vi.mock('server-only', () => ({}))

let mockCookie: string | undefined
vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({ get: () => (mockCookie ? { value: mockCookie } : undefined) })),
}))

import { POST as recordsPOST } from '@/app/api/records/route'
import { GET as availableGET } from '@/app/api/inventory/available/route'
import { GET as costGET } from '@/app/api/batches/[id]/cost-breakdown/route'
import { db } from '@/db'
import {
  tenants, users, sessions, farms, productionUnits, batches, employees, records,
  inventoryItems, inventoryLots, inventoryConsumption,
} from '@/db/schemas'
import { createSession, hashSecret } from '@/lib/auth'

const hasDb = !!process.env.DATABASE_URL
const run = hasDb ? describe : describe.skip

function jsonRequest(url: string, body: unknown): Request {
  return new Request(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
}
async function readJson(res: Response) {
  return { status: res.status, payload: await res.json() }
}

run('feeding draws on real stock', () => {
  const tenantId = `t-feed-${randomUUID()}`
  const farmAId = `f-a-${randomUUID()}`
  const farmBId = `f-b-${randomUUID()}`
  const unitAId = `u-a-${randomUUID()}`
  const unitBId = `u-b-${randomUUID()}`
  const batch1 = `b1-${randomUUID()}`
  const batch2 = `b2-${randomUUID()}`
  const batchOtherFarm = `b3-${randomUUID()}`
  const ownerId = `usr-${randomUUID()}`
  const employeeId = `emp-${randomUUID()}`
  const mashId = `item-mash-${randomUUID()}`
  const otherFarmItemId = `item-far-${randomUUID()}`
  let ownerSession: string

  beforeAll(async () => {
    await db.insert(tenants).values({ id: tenantId, name: 'Feed Co.', active: true })
    await db.insert(farms).values([
      { id: farmAId, tenantId, name: 'Farm A', location: 'Nakuru', code: 'FRM-A' },
      { id: farmBId, tenantId, name: 'Farm B', location: 'Eldoret', code: 'FRM-B' },
    ])
    await db.insert(productionUnits).values([
      { id: unitAId, tenantId, farmId: farmAId, type: 'house', name: 'House A', code: 'HSE-A' },
      { id: unitBId, tenantId, farmId: farmBId, type: 'house', name: 'House B', code: 'HSE-B' },
    ])
    await db.insert(batches).values([
      { id: batch1, tenantId, unitId: unitAId, code: 'BRO-1', name: 'Broilers 1', enterprise: 'broiler' },
      { id: batch2, tenantId, unitId: unitAId, code: 'BRO-2', name: 'Broilers 2', enterprise: 'broiler' },
      { id: batchOtherFarm, tenantId, unitId: unitBId, code: 'BRO-3', name: 'Broilers 3', enterprise: 'broiler' },
    ])
    const salt = randomUUID()
    await db.insert(users).values({
      id: ownerId, tenantId, name: 'Owner', email: `owner-${randomUUID()}@test.ifms`, role: 'owner',
      passwordHash: hashSecret('pw', salt), passwordSalt: salt, status: 'ACTIVE',
    })
    await db.insert(employees).values({ id: employeeId, tenantId, name: 'Feeder', phone: '', role: 'worker' })
    await db.insert(inventoryItems).values([
      { id: mashId, tenantId, name: 'Broiler Mash', category: 'Feed', unit: 'kg', lowStockThreshold: 20 },
      { id: otherFarmItemId, tenantId, name: 'Far Away Mash', category: 'Feed', unit: 'kg', lowStockThreshold: 0 },
    ])
    ownerSession = await createSession(ownerId)
  })

  beforeEach(async () => {
    // Fresh stock per test: two lots of the same item, the older one
    // expiring first, so FIFO has something to get right.
    await db.delete(inventoryConsumption).where(eq(inventoryConsumption.tenantId, tenantId))
    await db.delete(records).where(eq(records.tenantId, tenantId))
    await db.delete(inventoryLots).where(eq(inventoryLots.tenantId, tenantId))
    await db.insert(inventoryLots).values([
      {
        id: `lot-old-${randomUUID()}`, tenantId, itemId: mashId, lotNo: 'OLD', qtyOnHand: 30,
        unitCostCents: 5000, farmId: farmAId,
        expiryDate: new Date(2026, 8, 1), receivedDate: new Date(2026, 5, 1),
      },
      {
        id: `lot-new-${randomUUID()}`, tenantId, itemId: mashId, lotNo: 'NEW', qtyOnHand: 100,
        unitCostCents: 6000, farmId: farmAId,
        expiryDate: new Date(2026, 11, 1), receivedDate: new Date(2026, 6, 1),
      },
      {
        id: `lot-farmb-${randomUUID()}`, tenantId, itemId: otherFarmItemId, lotNo: 'B1', qtyOnHand: 500,
        unitCostCents: 4000, farmId: farmBId, receivedDate: new Date(2026, 6, 1),
      },
    ])
  })

  afterAll(async () => {
    mockCookie = undefined
    await db.delete(inventoryConsumption).where(eq(inventoryConsumption.tenantId, tenantId))
    await db.delete(records).where(eq(records.tenantId, tenantId))
    await db.delete(inventoryLots).where(eq(inventoryLots.tenantId, tenantId))
    await db.delete(inventoryItems).where(eq(inventoryItems.tenantId, tenantId))
    await db.delete(employees).where(eq(employees.tenantId, tenantId))
    await db.delete(batches).where(inArray(batches.id, [batch1, batch2, batchOtherFarm]))
    await db.delete(productionUnits).where(eq(productionUnits.tenantId, tenantId))
    await db.delete(farms).where(eq(farms.tenantId, tenantId))
    await db.delete(sessions).where(eq(sessions.userId, ownerId))
    await db.delete(users).where(eq(users.id, ownerId))
    await db.delete(tenants).where(eq(tenants.id, tenantId))
  })

  async function feed(body: Record<string, unknown>) {
    mockCookie = ownerSession
    const res = await readJson(await recordsPOST(jsonRequest('http://localhost/api/records', { tenantId, employeeId, type: 'feeding', ...body })))
    mockCookie = undefined
    return res
  }

  async function qtyLeft(itemId = mashId) {
    const lots = await db.select().from(inventoryLots).where(and(eq(inventoryLots.tenantId, tenantId), eq(inventoryLots.itemId, itemId)))
    return lots.reduce((sum, l) => sum + l.qtyOnHand, 0)
  }

  it('only offers stock that is physically at the batch’s own farm', async () => {
    mockCookie = ownerSession
    const { status, payload } = await readJson(
      await availableGET(new Request(`http://localhost/api/inventory/available?tenantId=${tenantId}&batchId=${batch1}`))
    )
    mockCookie = undefined
    expect(status).toBe(200)
    const mash = payload.data.find((i: { id: string }) => i.id === mashId)
    const far = payload.data.find((i: { id: string }) => i.id === otherFarmItemId)
    expect(mash.qtyOnHand).toBe(130)
    // The catalogue is tenant-wide, but Farm B's 500kg is not reachable from
    // a Farm A batch — showing it would send a worker looking for a bag that
    // is in another county.
    expect(far.qtyOnHand).toBe(0)
  })

  it('takes the oldest-expiring stock first and prices it from that lot', async () => {
    const res = await feed({ batchId: batch1, data: { feedItems: [{ itemId: mashId, qty: 40 }] } })
    expect(res.status).toBe(201)

    const rows = await db.select().from(inventoryConsumption).where(eq(inventoryConsumption.batchId, batch1))
    // 30 from the lot expiring in September, then 10 from December's.
    expect(rows.length).toBe(2)
    const byQty = rows.sort((a, b) => b.qty - a.qty)
    expect(byQty[0].qty).toBe(30)
    expect(byQty[0].unitCostCents).toBe(5000)
    expect(byQty[1].qty).toBe(10)
    expect(byQty[1].unitCostCents).toBe(6000)
    expect(await qtyLeft()).toBe(90)
  })

  it('refuses to issue more than exists, and moves nothing when it does', async () => {
    const res = await feed({ batchId: batch1, data: { feedItems: [{ itemId: mashId, qty: 500 }] } })
    expect(res.status).toBe(400)
    expect(String(res.payload.error)).toContain('130')

    // Neither the stock nor the record survives a refusal.
    expect(await qtyLeft()).toBe(130)
    const saved = await db.select().from(records).where(eq(records.tenantId, tenantId))
    expect(saved.length).toBe(0)
  })

  it('splits one issue across several batches, and each record holds its own share', async () => {
    const res = await feed({
      batchIds: [batch1, batch2],
      data: { feedItems: [{ itemId: mashId, qty: 80, perBatch: { [batch1]: 50, [batch2]: 30 } }] },
    })
    expect(res.status).toBe(201)
    expect(res.payload.data.records.length).toBe(2)

    expect(await qtyLeft()).toBe(50)

    const b1 = await db.select().from(inventoryConsumption).where(eq(inventoryConsumption.batchId, batch1))
    const b2 = await db.select().from(inventoryConsumption).where(eq(inventoryConsumption.batchId, batch2))
    expect(b1.reduce((s, r) => s + r.qty, 0)).toBe(50)
    expect(b2.reduce((s, r) => s + r.qty, 0)).toBe(30)

    // Each batch's own record says what THAT batch ate — not the 80 that left
    // the store, which would make every batch look like it ate the lot.
    const saved = await db.select().from(records).where(eq(records.batchId, batch2))
    const items = (saved[0].data as { feedItems: { qty: number }[] }).feedItems
    expect(items[0].qty).toBe(30)
  })

  it('rolls the whole round back when the last batch runs the store dry', async () => {
    const res = await feed({
      batchIds: [batch1, batch2],
      data: { feedItems: [{ itemId: mashId, qty: 200, perBatch: { [batch1]: 100, [batch2]: 100 } }] },
    })
    expect(res.status).toBe(400)

    // Half a feeding round saved is worse than none: the batches that DID
    // get recorded look complete, and nobody goes back to them.
    expect(await qtyLeft()).toBe(130)
    const saved = await db.select().from(records).where(eq(records.tenantId, tenantId))
    expect(saved.length).toBe(0)
  })

  it('leaves a free-text feed line alone rather than rejecting it', async () => {
    // Records written before stock existed still submit — they just move no
    // stock, which is honest about what they are.
    const res = await feed({ batchId: batch1, data: { feedItems: [{ item: 'Whatever was in the shed', qtyKg: 12 }] } })
    expect(res.status).toBe(201)
    expect(await qtyLeft()).toBe(130)
  })

  it('turns the batch’s feed cost into a real figure', async () => {
    await feed({ batchId: batch1, data: { feedItems: [{ itemId: mashId, qty: 40 }] } })

    mockCookie = ownerSession
    const { payload } = await readJson(
      await costGET(new Request(`http://localhost/api/batches/${batch1}/cost-breakdown?tenantId=${tenantId}`), { params: Promise.resolve({ id: batch1 }) })
    )
    mockCookie = undefined
    const feedCat = payload.data.categories.find((c: { key: string }) => c.key === 'feed')
    // 30 × 5000 + 10 × 6000 — the lots it actually came out of, not an
    // average and not a guessed share of the batch cost.
    expect(feedCat.amountCents).toBe(210000)
    expect(feedCat.tracked).toBe(true)
  })

  it('reports nothing issued as untracked, not as zero cost', async () => {
    mockCookie = ownerSession
    const { payload } = await readJson(
      await costGET(new Request(`http://localhost/api/batches/${batch2}/cost-breakdown?tenantId=${tenantId}`), { params: Promise.resolve({ id: batch2 }) })
    )
    mockCookie = undefined
    const feedCat = payload.data.categories.find((c: { key: string }) => c.key === 'feed')
    expect(feedCat.tracked).toBe(false)
    expect(feedCat.reason).toBeTruthy()
  })

  it('will not let a non-feeding record move stock', async () => {
    const res = await feed({ batchId: batch1, type: 'physical_count', data: { feedItems: [{ itemId: mashId, qty: 5 }] } })
    expect(res.status).toBe(400)
    expect(await qtyLeft()).toBe(130)
  })
})
