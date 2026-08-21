// ── Product/unit/batch inheritance tests (product-unit-inheritance task) ──
// Integration tests that call the real route handlers directly against real
// Postgres (no HTTP server needed), same pattern as tests/farms-crud.test.ts
// / tests/admin-users.test.ts. Skips when DATABASE_URL is unset.
//
// Covers the model in db/schemas/dashboard.ts / lib/products.ts:
//   - a product attached to a unit is inherited by every batch under it
//   - the SAME product attached to two units is inherited by batches under
//     both (the sharing requirement)
//   - a batch override ADDs a product not on its unit
//   - a batch override EXCLUDEs an inherited product
//   - removing a product from a unit stops inheritance without touching
//     unrelated batch overrides
//   - tenant isolation on the join tables
//   - 401 on every new route with no session
//   - sales.productId + sales.item free text coexisting
//   - archive-vs-delete on DELETE /api/products/[id]
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { and, eq, inArray } from 'drizzle-orm'

vi.mock('server-only', () => ({}))

let mockCookie: string | undefined
vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({ get: () => (mockCookie ? { value: mockCookie } : undefined) })),
}))

import { GET as productsGET, POST as productsPOST } from '@/app/api/products/route'
import { PATCH as productPATCH, DELETE as productDELETE } from '@/app/api/products/[id]/route'
import { GET as unitProductsGET, PUT as unitProductsPUT } from '@/app/api/units/[id]/products/route'
import { GET as batchProductsGET, PUT as batchProductsPUT } from '@/app/api/batches/[id]/products/route'
import { POST as salesPOST } from '@/app/api/data/sales/route'
import { db } from '@/db'
import { tenants, users, sessions, farms, productionUnits, batches, products, productUnits, batchProducts, sales } from '@/db/schemas'
import { createSession, hashSecret } from '@/lib/auth'

const hasDb = !!process.env.DATABASE_URL
const run = hasDb ? describe : describe.skip

function getRequest(url: string): Request {
  return new Request(url)
}
function jsonRequest(url: string, method: string, body: unknown): Request {
  return new Request(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
}
async function readJson(res: Response) {
  return { status: res.status, payload: await res.json() }
}

run('product/unit/batch inheritance (product-unit-inheritance task)', () => {
  const tenantId = `t-prod-${randomUUID()}`
  const otherTenantId = `t-prod-other-${randomUUID()}`

  const ownerId = `usr-prod-owner-${randomUUID()}`
  let ownerSession: string

  const farmId = `f-prod-${randomUUID()}`
  const unit1Id = `u-prod-1-${randomUUID()}`
  const unit2Id = `u-prod-2-${randomUUID()}`
  const batch1Id = `b-prod-1-${randomUUID()}` // under unit1
  const batch2Id = `b-prod-2-${randomUUID()}` // under unit1 (sibling)
  const batch3Id = `b-prod-3-${randomUUID()}` // under unit2

  const eggsId = `p-eggs-${randomUUID()}`      // attached to unit1 + unit2 (shared)
  const manureId = `p-manure-${randomUUID()}`  // attached to unit1 only
  const cullId = `p-cull-${randomUUID()}`      // attached to nothing; batch-level ADD only

  const otherTenantProductId = `p-other-${randomUUID()}`

  const allUserIds = [ownerId]

  beforeAll(async () => {
    await db.insert(tenants).values([
      { id: tenantId, name: 'Product Inheritance Co', active: true },
      { id: otherTenantId, name: 'Other Tenant Co', active: true },
    ])
    const salt = randomUUID()
    await db.insert(users).values([
      { id: ownerId, tenantId, name: 'Product Owner', email: `prod-owner-${randomUUID()}@test.ifms`, role: 'owner', passwordHash: hashSecret('pw', salt), passwordSalt: salt, status: 'ACTIVE' },
    ])
    ownerSession = await createSession(ownerId)

    await db.insert(farms).values([{ id: farmId, tenantId, name: 'Prod Farm', location: 'Nakuru', code: 'FRM-PI-001' }])
    await db.insert(productionUnits).values([
      { id: unit1Id, tenantId, farmId, type: 'house', name: 'Layer Pen A', code: 'HSE-PI-001', status: 'ACTIVE' },
      { id: unit2Id, tenantId, farmId, type: 'house', name: 'Layer Pen B', code: 'HSE-PI-002', status: 'ACTIVE' },
    ])
    await db.insert(batches).values([
      { id: batch1Id, tenantId, unitId: unit1Id, code: 'LYR-PI-001', name: 'Pen A Batch 1', enterprise: 'layer', status: 'ACTIVE' },
      { id: batch2Id, tenantId, unitId: unit1Id, code: 'LYR-PI-002', name: 'Pen A Batch 2', enterprise: 'layer', status: 'ACTIVE' },
      { id: batch3Id, tenantId, unitId: unit2Id, code: 'LYR-PI-003', name: 'Pen B Batch 1', enterprise: 'layer', status: 'ACTIVE' },
    ])
    await db.insert(products).values([
      { id: eggsId, tenantId, type: 'egg', name: 'Tray Eggs (30)', saleUnits: '480' },
      { id: manureId, tenantId, type: 'byproduct', name: 'Manure (bag)', saleUnits: '50' },
      { id: cullId, tenantId, type: 'livebird', name: 'Cull Bird', saleUnits: '300' },
      { id: otherTenantProductId, tenantId: otherTenantId, type: 'egg', name: 'Other Tenant Eggs', saleUnits: '400' },
    ])
  })

  afterAll(async () => {
    await db.delete(sales).where(eq(sales.tenantId, tenantId))
    await db.delete(batchProducts).where(eq(batchProducts.tenantId, tenantId))
    await db.delete(productUnits).where(inArray(productUnits.tenantId, [tenantId, otherTenantId]))
    await db.delete(products).where(inArray(products.tenantId, [tenantId, otherTenantId]))
    await db.delete(batches).where(eq(batches.tenantId, tenantId))
    await db.delete(productionUnits).where(eq(productionUnits.tenantId, tenantId))
    await db.delete(farms).where(eq(farms.tenantId, tenantId))
    await db.delete(sessions).where(inArray(sessions.userId, allUserIds))
    await db.delete(users).where(inArray(users.id, allUserIds))
    await db.delete(tenants).where(inArray(tenants.id, [tenantId, otherTenantId]))
  })

  afterEach(() => { mockCookie = undefined })

  // ── 401 on every new route with no session ────────────────────────────────
  describe('unauthenticated access', () => {
    it('401s on GET/POST /api/products', async () => {
      expect((await productsGET(getRequest('http://localhost/api/products'))).status).toBe(401)
      expect((await productsPOST(jsonRequest('http://localhost/api/products', 'POST', { name: 'X', type: 'egg' }))).status).toBe(401)
    })
    it('401s on PATCH/DELETE /api/products/[id]', async () => {
      const params = { params: Promise.resolve({ id: eggsId }) }
      expect((await productPATCH(jsonRequest(`http://localhost/api/products/${eggsId}`, 'PATCH', { name: 'Y' }), params)).status).toBe(401)
      expect((await productDELETE(getRequest(`http://localhost/api/products/${eggsId}`), params)).status).toBe(401)
    })
    it('401s on GET/PUT /api/units/[id]/products', async () => {
      const params = { params: Promise.resolve({ id: unit1Id }) }
      expect((await unitProductsGET(getRequest(`http://localhost/api/units/${unit1Id}/products`), params)).status).toBe(401)
      expect((await unitProductsPUT(jsonRequest(`http://localhost/api/units/${unit1Id}/products`, 'PUT', { productIds: [] }), params)).status).toBe(401)
    })
    it('401s on GET/PUT /api/batches/[id]/products', async () => {
      const params = { params: Promise.resolve({ id: batch1Id }) }
      expect((await batchProductsGET(getRequest(`http://localhost/api/batches/${batch1Id}/products`), params)).status).toBe(401)
      expect((await batchProductsPUT(jsonRequest(`http://localhost/api/batches/${batch1Id}/products`, 'PUT', { adds: [], excludes: [] }), params)).status).toBe(401)
    })
  })

  // ── Products catalogue CRUD ────────────────────────────────────────────────
  describe('GET/POST /api/products', () => {
    it('creates and lists products scoped to the session tenant', async () => {
      mockCookie = ownerSession
      const { status, payload } = await readJson(await productsGET(getRequest('http://localhost/api/products')))
      expect(status).toBe(200)
      const ids = payload.data.map((p: { id: string }) => p.id)
      expect(ids).toEqual(expect.arrayContaining([eggsId, manureId, cullId]))
      expect(ids).not.toContain(otherTenantProductId)
    })

    it('collects all field errors at once', async () => {
      mockCookie = ownerSession
      const { status, payload } = await readJson(await productsPOST(jsonRequest('http://localhost/api/products', 'POST', { name: '', type: '' })))
      expect(status).toBe(400)
      expect(payload.success).toBe(false)
      expect(payload.fields.name).toBeTruthy()
      expect(payload.fields.type).toBeTruthy()
    })
  })

  // ── Tenant isolation on the join tables ────────────────────────────────────
  describe('tenant isolation', () => {
    it('a unit cannot be given a product from another tenant', async () => {
      mockCookie = ownerSession
      const { status, payload } = await readJson(
        await unitProductsPUT(
          jsonRequest(`http://localhost/api/units/${unit1Id}/products`, 'PUT', { productIds: [otherTenantProductId] }),
          { params: Promise.resolve({ id: unit1Id }) }
        )
      )
      expect(status).toBe(400)
      expect(payload.success).toBe(false)
      expect(payload.fields.productIds).toBeTruthy()

      // Confirm nothing was actually written.
      const rows = await db.select().from(productUnits).where(and(eq(productUnits.tenantId, tenantId), eq(productUnits.unitId, unit1Id)))
      expect(rows).toHaveLength(0)
    })
  })

  // ── The core inheritance model ────────────────────────────────────────────
  describe('unit -> batch inheritance', () => {
    it('attaching a product to a unit is inherited by every batch under it, flagged inherited with the source unit named', async () => {
      mockCookie = ownerSession
      const putRes = await readJson(
        await unitProductsPUT(jsonRequest(`http://localhost/api/units/${unit1Id}/products`, 'PUT', { productIds: [eggsId, manureId] }), { params: Promise.resolve({ id: unit1Id }) })
      )
      expect(putRes.status).toBe(200)

      for (const batchId of [batch1Id, batch2Id]) {
        const { status, payload } = await readJson(await batchProductsGET(getRequest(`http://localhost/api/batches/${batchId}/products`), { params: Promise.resolve({ id: batchId }) }))
        expect(status).toBe(200)
        const eggsRow = payload.data.find((r: { id: string }) => r.id === eggsId)
        expect(eggsRow).toBeTruthy()
        expect(eggsRow.inherited).toBe(true)
        expect(eggsRow.sourceUnitId).toBe(unit1Id)
        expect(eggsRow.sourceUnitName).toBe('Layer Pen A')
      }
    })

    it('the same product attached to two different units is inherited by batches under both', async () => {
      mockCookie = ownerSession
      await unitProductsPUT(jsonRequest(`http://localhost/api/units/${unit2Id}/products`, 'PUT', { productIds: [eggsId] }), { params: Promise.resolve({ id: unit2Id }) })

      const { payload: p1 } = await readJson(await batchProductsGET(getRequest(`http://localhost/api/batches/${batch1Id}/products`), { params: Promise.resolve({ id: batch1Id }) }))
      const { payload: p3 } = await readJson(await batchProductsGET(getRequest(`http://localhost/api/batches/${batch3Id}/products`), { params: Promise.resolve({ id: batch3Id }) }))

      const eggsInB1 = p1.data.find((r: { id: string }) => r.id === eggsId)
      const eggsInB3 = p3.data.find((r: { id: string }) => r.id === eggsId)
      expect(eggsInB1.inherited).toBe(true)
      expect(eggsInB1.sourceUnitId).toBe(unit1Id)
      expect(eggsInB3.inherited).toBe(true)
      expect(eggsInB3.sourceUnitId).toBe(unit2Id)
    })

    it('a batch override ADDs a product not on its unit', async () => {
      mockCookie = ownerSession
      const { status, payload } = await readJson(
        await batchProductsPUT(jsonRequest(`http://localhost/api/batches/${batch1Id}/products`, 'PUT', { adds: [cullId], excludes: [] }), { params: Promise.resolve({ id: batch1Id }) })
      )
      expect(status).toBe(200)
      const cullRow = payload.data.find((r: { id: string }) => r.id === cullId)
      expect(cullRow).toBeTruthy()
      expect(cullRow.inherited).toBe(false)
      expect(cullRow.sourceUnitId).toBeNull()

      // Sibling batch2 (same unit) must NOT see the ADD — it's batch-specific.
      const { payload: p2 } = await readJson(await batchProductsGET(getRequest(`http://localhost/api/batches/${batch2Id}/products`), { params: Promise.resolve({ id: batch2Id }) }))
      expect(p2.data.find((r: { id: string }) => r.id === cullId)).toBeUndefined()
    })

    it('a batch override EXCLUDEs an inherited product', async () => {
      mockCookie = ownerSession
      const { status, payload } = await readJson(
        await batchProductsPUT(jsonRequest(`http://localhost/api/batches/${batch2Id}/products`, 'PUT', { adds: [], excludes: [manureId] }), { params: Promise.resolve({ id: batch2Id }) })
      )
      expect(status).toBe(200)
      expect(payload.data.find((r: { id: string }) => r.id === manureId)).toBeUndefined()

      // batch1 (sibling, same unit) still inherits manure normally.
      const { payload: p1 } = await readJson(await batchProductsGET(getRequest(`http://localhost/api/batches/${batch1Id}/products`), { params: Promise.resolve({ id: batch1Id }) }))
      const manureInB1 = p1.data.find((r: { id: string }) => r.id === manureId)
      expect(manureInB1).toBeTruthy()
      expect(manureInB1.inherited).toBe(true)
    })

    it('rejects a product id present in both adds and excludes', async () => {
      mockCookie = ownerSession
      const { status, payload } = await readJson(
        await batchProductsPUT(jsonRequest(`http://localhost/api/batches/${batch1Id}/products`, 'PUT', { adds: [manureId], excludes: [manureId] }), { params: Promise.resolve({ id: batch1Id }) })
      )
      expect(status).toBe(400)
      expect(payload.success).toBe(false)
    })

    it('removing a product from a unit stops inheritance without deleting unrelated batch overrides', async () => {
      mockCookie = ownerSession
      // unit1 currently offers [eggs, manure]; drop manure.
      await unitProductsPUT(jsonRequest(`http://localhost/api/units/${unit1Id}/products`, 'PUT', { productIds: [eggsId] }), { params: Promise.resolve({ id: unit1Id }) })

      const { payload: p1 } = await readJson(await batchProductsGET(getRequest(`http://localhost/api/batches/${batch1Id}/products`), { params: Promise.resolve({ id: batch1Id }) }))
      expect(p1.data.find((r: { id: string }) => r.id === manureId)).toBeUndefined()
      // batch1's unrelated ADD override (cull) must survive untouched.
      expect(p1.data.find((r: { id: string }) => r.id === cullId)).toBeTruthy()

      // batch2's EXCLUDE-manure override row still exists in the DB, even
      // though it's now moot (manure isn't inherited there anymore either).
      const overrideRows = await db.select().from(batchProducts).where(and(eq(batchProducts.batchId, batch2Id), eq(batchProducts.productId, manureId)))
      expect(overrideRows).toHaveLength(1)
      expect(overrideRows[0].mode).toBe('EXCLUDE')
    })
  })

  // ── Sales wiring ───────────────────────────────────────────────────────────
  describe('sales.productId + free-text item', () => {
    it('a sale can reference a product (item auto-filled from the product name)', async () => {
      mockCookie = ownerSession
      const { status, payload } = await readJson(
        await salesPOST(jsonRequest('http://localhost/api/data/sales', 'POST', { tenantId, productId: eggsId, amountCents: 48000, batchId: batch1Id }))
      )
      expect(status).toBe(201)
      expect(payload.data.productId).toBe(eggsId)
      expect(payload.data.item).toBe('Tray Eggs (30)')
    })

    it('sales.item free text still works for a sale with no product', async () => {
      mockCookie = ownerSession
      const { status, payload } = await readJson(
        await salesPOST(jsonRequest('http://localhost/api/data/sales', 'POST', { tenantId, item: 'One-off firewood sale', amountCents: 20000 }))
      )
      expect(status).toBe(201)
      expect(payload.data.productId).toBeNull()
      expect(payload.data.item).toBe('One-off firewood sale')
    })
  })

  // ── Archive-vs-delete ──────────────────────────────────────────────────────
  describe('DELETE /api/products/[id]', () => {
    it('archives (does not delete) a product referenced by a sale', async () => {
      mockCookie = ownerSession
      const { status, payload } = await readJson(
        await productDELETE(getRequest(`http://localhost/api/products/${eggsId}`), { params: Promise.resolve({ id: eggsId }) })
      )
      expect(status).toBe(200)
      expect(payload.data.archived).toBe(true)
      const rows = await db.select().from(products).where(eq(products.id, eggsId))
      expect(rows).toHaveLength(1)
      expect(rows[0].status).toBe('ARCHIVED')

      // Archived product drops out of the default list.
      const { payload: listPayload } = await readJson(await productsGET(getRequest('http://localhost/api/products')))
      expect(listPayload.data.find((p: { id: string }) => p.id === eggsId)).toBeUndefined()
    })

    it('genuinely deletes a product with no references at all', async () => {
      mockCookie = ownerSession
      const freeId = `p-free-${randomUUID()}`
      await db.insert(products).values({ id: freeId, tenantId, type: 'misc', name: 'Unused Product', saleUnits: '0' })

      const { status, payload } = await readJson(
        await productDELETE(getRequest(`http://localhost/api/products/${freeId}`), { params: Promise.resolve({ id: freeId }) })
      )
      expect(status).toBe(200)
      expect(payload.data.deleted).toBe(true)
      const rows = await db.select().from(products).where(eq(products.id, freeId))
      expect(rows).toHaveLength(0)
    })
  })
})
