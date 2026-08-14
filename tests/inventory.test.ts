// ── Inventory backend tests (issue #235) ────────────────────────────────────
// Integration tests that call the real route handlers against the real
// postgres when DATABASE_URL is set (local/dev); CI has no database, so the
// suite skips there — same pattern as tests/batches.test.ts /
// tests/tasks-governance.test.ts.
//
// Covers the issue's Definition of Done:
//   - a purchase creates a real item+lot (upsert-by-name-and-tenant for the
//     item, a new row for the lot)
//   - the merged stock endpoint computes 'low' and 'expiring' status
//     correctly for seeded items
//   - the variance staleness definition (lib/inventory.ts's computeVariance)
//     flags a lot with no recent reconciliation and does not flag a fresh one
//   - PATCH /api/inventory/lots/[id] requires a reason, rejects requests
//     without one, and writes a real audit_log row
//   - usage-history returns real purchase-derived data for a seeded item
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { and, eq, inArray } from 'drizzle-orm'

vi.mock('server-only', () => ({}))
vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({ get: () => undefined })),
}))

import { GET as purchasesGET, POST as purchasesPOST } from '@/app/api/purchases/route'
import { GET as itemsGET } from '@/app/api/inventory/items/route'
import { GET as usageHistoryGET } from '@/app/api/inventory/items/[id]/usage-history/route'
import { PATCH as lotPATCH } from '@/app/api/inventory/lots/[id]/route'
import { GET as varianceGET } from '@/app/api/inventory/variance/route'
import { db } from '@/db'
import { tenants, inventoryItems, inventoryLots, purchases, auditLog } from '@/db/schemas'

const hasDb = !!process.env.DATABASE_URL
const run = hasDb ? describe : describe.skip

function getRequest(url: string): Request {
  return new Request(url)
}

function postRequest(url: string, body: unknown): Request {
  return new Request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function patchRequest(url: string, body: unknown): Request {
  return new Request(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

async function readJson(res: Response) {
  return { status: res.status, payload: await res.json() }
}

run('inventory: items/lots/purchases, merged stock, variance, adjust (issue #235)', () => {
  const tenantId = `t-inv-${randomUUID()}`
  const actorId = `u-inv-${randomUUID()}`

  beforeAll(async () => {
    await db.insert(tenants).values({ id: tenantId, name: 'Inventory Test Co.', active: true })
  })

  afterAll(async () => {
    await db.delete(auditLog).where(eq(auditLog.tenantId, tenantId))
    await db.delete(purchases).where(eq(purchases.tenantId, tenantId))
    await db.delete(inventoryLots).where(eq(inventoryLots.tenantId, tenantId))
    await db.delete(inventoryItems).where(eq(inventoryItems.tenantId, tenantId))
    await db.delete(tenants).where(inArray(tenants.id, [tenantId]))
  })

  describe('POST /api/purchases: creates a real item + lot', () => {
    it('creates a new item and lot on first purchase', async () => {
      const { status, payload } = await readJson(
        await purchasesPOST(
          postRequest('http://localhost/api/purchases', {
            tenantId,
            supplier: 'Unga Ltd',
            itemName: 'Broiler Starter Mash',
            category: 'Feed',
            unit: 'kg',
            lowStockThreshold: 500,
            quantity: 1000,
            unitCostCents: 4800,
          })
        )
      )
      expect(status).toBe(201)
      expect(payload.data.item.name).toBe('Broiler Starter Mash')
      expect(payload.data.item.tenantId).toBe(tenantId)
      expect(payload.data.lot.qtyOnHand).toBe(1000)
      expect(payload.data.lot.itemId).toBe(payload.data.item.id)
      expect(payload.data.purchase.quantity).toBe(1000)
      expect(payload.data.purchase.totalCostCents).toBe(1000 * 4800)

      const itemRows = await db.select().from(inventoryItems).where(eq(inventoryItems.tenantId, tenantId))
      expect(itemRows.length).toBe(1)
    })

    it('a second purchase of the same item name (different case) reuses the item and adds a new lot', async () => {
      const before = await db.select().from(inventoryItems).where(eq(inventoryItems.tenantId, tenantId))
      expect(before.length).toBe(1)

      const { status, payload } = await readJson(
        await purchasesPOST(
          postRequest('http://localhost/api/purchases', {
            tenantId,
            supplier: 'Unga Ltd',
            itemName: 'broiler starter mash',
            unit: 'kg',
            quantity: 500,
            unitCostCents: 4900,
          })
        )
      )
      expect(status).toBe(201)
      expect(payload.data.item.id).toBe(before[0].id)

      const items = await db.select().from(inventoryItems).where(eq(inventoryItems.tenantId, tenantId))
      expect(items.length).toBe(1)
      const lots = await db.select().from(inventoryLots).where(eq(inventoryLots.itemId, before[0].id))
      expect(lots.length).toBe(2)
    })

    it('rejects a purchase with no supplier/itemName/unit (400)', async () => {
      const res = await purchasesPOST(postRequest('http://localhost/api/purchases', { tenantId, quantity: 10, unitCostCents: 100 }))
      expect(res.status).toBe(400)
    })

    it('GET /api/purchases lists the tenant\'s purchases', async () => {
      const { status, payload } = await readJson(await purchasesGET(getRequest(`http://localhost/api/purchases?tenantId=${tenantId}`)))
      expect(status).toBe(200)
      expect(payload.data.length).toBeGreaterThanOrEqual(2)
      expect(payload.data.every((p: { tenantId: string }) => p.tenantId === tenantId)).toBe(true)
    })
  })

  describe('GET /api/inventory/items: merged stock list + computed status', () => {
    it('flags an item under its low-stock threshold as "low"', async () => {
      await purchasesPOST(
        postRequest('http://localhost/api/purchases', {
          tenantId,
          supplier: 'Bidco',
          itemName: 'Layer Mash Premium',
          category: 'Feed',
          unit: 'kg',
          lowStockThreshold: 500,
          quantity: 320,
          unitCostCents: 5200,
        })
      )

      const { status, payload } = await readJson(await itemsGET(getRequest(`http://localhost/api/inventory/items?tenantId=${tenantId}`)))
      expect(status).toBe(200)
      const layerMash = payload.data.find((i: { name: string }) => i.name === 'Layer Mash Premium')
      expect(layerMash.qtyOnHand).toBe(320)
      expect(layerMash.status).toBe('low')
    })

    it('flags an item with a lot past its expiry date as "expiring"', async () => {
      const past = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
      await purchasesPOST(
        postRequest('http://localhost/api/purchases', {
          tenantId,
          supplier: 'Agrovet',
          itemName: 'Oxymav B',
          category: 'Medicine',
          unit: 'g',
          lowStockThreshold: 200,
          quantity: 1500,
          unitCostCents: 1500,
          expiryDate: past,
        })
      )

      const { payload } = await readJson(await itemsGET(getRequest(`http://localhost/api/inventory/items?tenantId=${tenantId}`)))
      const oxymav = payload.data.find((i: { name: string }) => i.name === 'Oxymav B')
      expect(oxymav.status).toBe('expiring')
    })

    it('does not flag a well-stocked, unexpired item', async () => {
      await purchasesPOST(
        postRequest('http://localhost/api/purchases', {
          tenantId,
          supplier: 'Kenchic',
          itemName: 'Newcastle Vaccine',
          category: 'Vaccine',
          unit: 'doses',
          lowStockThreshold: 500,
          quantity: 2000,
          unitCostCents: 250,
        })
      )
      const { payload } = await readJson(await itemsGET(getRequest(`http://localhost/api/inventory/items?tenantId=${tenantId}`)))
      const vaccine = payload.data.find((i: { name: string }) => i.name === 'Newcastle Vaccine')
      expect(vaccine.status).toBe('ok')
    })
  })

  describe('GET /api/inventory/variance: staleness-based definition', () => {
    it('flags a lot whose only reconciliation event is old, and does not flag a freshly received one', async () => {
      const staleTenant = `t-inv-stale-${randomUUID()}`
      await db.insert(tenants).values({ id: staleTenant, name: 'Stale Variance Co.', active: true })

      const oldDate = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString()
      await purchasesPOST(
        postRequest('http://localhost/api/purchases', {
          tenantId: staleTenant,
          supplier: 'Old Supplier',
          itemName: 'Stale Feed',
          unit: 'kg',
          quantity: 100,
          unitCostCents: 100,
          receivedDate: oldDate,
        })
      )
      await purchasesPOST(
        postRequest('http://localhost/api/purchases', {
          tenantId: staleTenant,
          supplier: 'Fresh Supplier',
          itemName: 'Fresh Feed',
          unit: 'kg',
          quantity: 100,
          unitCostCents: 100,
        })
      )

      const { status, payload } = await readJson(await varianceGET(getRequest(`http://localhost/api/inventory/variance?tenantId=${staleTenant}`)))
      expect(status).toBe(200)
      const stale = payload.data.find((r: { itemName: string }) => r.itemName === 'Stale Feed')
      const fresh = payload.data.find((r: { itemName: string }) => r.itemName === 'Fresh Feed')
      expect(stale.flagged).toBe(true)
      expect(stale.daysSinceReconciliation).toBeGreaterThan(30)
      expect(fresh.flagged).toBe(false)

      await db.delete(inventoryLots).where(eq(inventoryLots.tenantId, staleTenant))
      await db.delete(purchases).where(eq(purchases.tenantId, staleTenant))
      await db.delete(inventoryItems).where(eq(inventoryItems.tenantId, staleTenant))
      await db.delete(tenants).where(eq(tenants.id, staleTenant))
    })
  })

  describe('PATCH /api/inventory/lots/[id]: reason-required quantity adjust, audited', () => {
    it('rejects an adjustment with no reason (400)', async () => {
      const items = await db.select().from(inventoryItems).where(eq(inventoryItems.tenantId, tenantId))
      const lots = await db.select().from(inventoryLots).where(eq(inventoryLots.itemId, items[0].id))
      const res = await lotPATCH(
        patchRequest(`http://localhost/api/inventory/lots/${lots[0].id}?tenantId=${tenantId}`, { qtyOnHand: 900 }),
        { params: Promise.resolve({ id: lots[0].id }) }
      )
      expect(res.status).toBe(400)
    })

    it('rejects an adjustment with no actor (400)', async () => {
      const items = await db.select().from(inventoryItems).where(eq(inventoryItems.tenantId, tenantId))
      const lots = await db.select().from(inventoryLots).where(eq(inventoryLots.itemId, items[0].id))
      const res = await lotPATCH(
        patchRequest(`http://localhost/api/inventory/lots/${lots[0].id}?tenantId=${tenantId}`, { qtyOnHand: 900, reason: 'Recount' }),
        { params: Promise.resolve({ id: lots[0].id }) }
      )
      expect(res.status).toBe(400)
    })

    it('applies the adjustment and writes a real audit_log row with before/after/reason', async () => {
      const items = await db.select().from(inventoryItems).where(eq(inventoryItems.tenantId, tenantId))
      const lots = await db.select().from(inventoryLots).where(eq(inventoryLots.itemId, items[0].id))
      const target = lots[0]
      const before = target.qtyOnHand

      const { status, payload } = await readJson(
        await lotPATCH(
          patchRequest(`http://localhost/api/inventory/lots/${target.id}?tenantId=${tenantId}`, {
            qtyOnHand: before - 40,
            reason: 'Physical recount found shortage',
            actorId,
          }),
          { params: Promise.resolve({ id: target.id }) }
        )
      )
      expect(status).toBe(200)
      expect(payload.data.qtyOnHand).toBe(before - 40)

      const auditRows = await db
        .select()
        .from(auditLog)
        .where(and(eq(auditLog.tenantId, tenantId), eq(auditLog.entityId, target.id), eq(auditLog.action, 'inventory.adjust')))
      expect(auditRows.length).toBe(1)
      expect(auditRows[0].actor).toBe(actorId)
      expect(auditRows[0].meta).toMatchObject({ before, after: before - 40, reason: 'Physical recount found shortage' })
    })

    it('404s for a lot id belonging to a different tenant', async () => {
      const items = await db.select().from(inventoryItems).where(eq(inventoryItems.tenantId, tenantId))
      const lots = await db.select().from(inventoryLots).where(eq(inventoryLots.itemId, items[0].id))
      const res = await lotPATCH(
        patchRequest(`http://localhost/api/inventory/lots/${lots[0].id}?tenantId=nonexistent-tenant`, { qtyOnHand: 1, reason: 'x', actorId }),
        { params: Promise.resolve({ id: lots[0].id }) }
      )
      expect(res.status).toBe(404)
    })
  })

  describe('GET /api/inventory/items/[id]/usage-history: purchase-derived', () => {
    it('returns real purchase-derived receipt history for a seeded item', async () => {
      const items = await db.select().from(inventoryItems).where(eq(inventoryItems.tenantId, tenantId))
      const target = items.find((i) => i.name === 'Broiler Starter Mash')!

      const { status, payload } = await readJson(
        await usageHistoryGET(getRequest(`http://localhost/api/inventory/items/${target.id}/usage-history?tenantId=${tenantId}`), {
          params: Promise.resolve({ id: target.id }),
        })
      )
      expect(status).toBe(200)
      expect(payload.data.length).toBe(2)
      expect(payload.data.every((p: { itemId: string }) => p.itemId === target.id)).toBe(true)
      expect(payload.data[0].quantity).toBeDefined()
      expect(payload.data[0].supplier).toBe('Unga Ltd')
    })

    it('404s for an item id belonging to a different tenant', async () => {
      const items = await db.select().from(inventoryItems).where(eq(inventoryItems.tenantId, tenantId))
      const res = await usageHistoryGET(
        getRequest(`http://localhost/api/inventory/items/${items[0].id}/usage-history?tenantId=nonexistent-tenant`),
        { params: Promise.resolve({ id: items[0].id }) }
      )
      expect(res.status).toBe(404)
    })
  })
})
