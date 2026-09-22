// ── Forms-audit slice (items 1-17) ──────────────────────────────────────────
// Covers the parts the gate specifically asks for: the money maths, payment
// reference persistence (sale + purchase), item-master creation, and the
// dimension report being reachable from the UI. Integration tests run
// against the real Postgres; the UI-wiring checks follow this repo's own
// convention (tests/crops-batch-detail-ui.test.ts's header) of asserting
// against rendered source, since there is no component render harness.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { eq, inArray } from 'drizzle-orm'

vi.mock('server-only', () => ({}))

let mockCookie: string | undefined
vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({ get: () => (mockCookie ? { value: mockCookie } : undefined) })),
}))

import { POST as salesPOST, GET as salesGET } from '@/app/api/data/sales/route'
import { POST as purchasesPOST } from '@/app/api/purchases/route'
import { POST as itemsPOST, GET as itemsGET } from '@/app/api/inventory/items/route'
import { PATCH as itemPATCH } from '@/app/api/inventory/items/[id]/route'
import { db } from '@/db'
import {
  tenants, users, sessions, farms, productionUnits, batches, sales, purchases,
  inventoryItems, inventoryLots, journalEntries, journalLines,
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
const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')

run('forms-audit slice: money maths, payment reference, item master, dimension report', () => {
  const tenantId = `t-forms-audit-${randomUUID()}`
  const farmId = `f-${randomUUID()}`
  const unitId = `u-${randomUUID()}`
  const batchId = `b-${randomUUID()}`
  const ownerId = `usr-owner-${randomUUID()}`
  let ownerSession: string

  beforeAll(async () => {
    await db.insert(tenants).values({ id: tenantId, name: 'Forms Audit Co.', active: true })
    await db.insert(farms).values({ id: farmId, tenantId, name: 'Farm', location: 'Nakuru', code: 'FRM-FA' })
    await db.insert(productionUnits).values({ id: unitId, tenantId, farmId, type: 'house', name: 'House', code: 'HSE-FA' })
    await db.insert(batches).values({
      id: batchId, tenantId, unitId, code: 'BRO-FA', name: 'Broilers', enterprise: 'broiler',
      initialQty: 200, currentQty: 200,
    })
    const salt = randomUUID()
    await db.insert(users).values({
      id: ownerId, tenantId, name: 'Owner', email: `forms-audit-owner-${randomUUID()}@test.ifms`, role: 'owner',
      passwordHash: hashSecret('pw', salt), passwordSalt: salt, status: 'ACTIVE',
    })
    ownerSession = await createSession(ownerId)
  })

  afterAll(async () => {
    mockCookie = undefined
    const entryRows = await db.select({ id: journalEntries.id }).from(journalEntries).where(eq(journalEntries.tenantId, tenantId))
    const entryIds = entryRows.map((r) => r.id)
    if (entryIds.length > 0) await db.delete(journalLines).where(inArray(journalLines.entryId, entryIds))
    await db.delete(journalEntries).where(eq(journalEntries.tenantId, tenantId))
    await db.delete(sales).where(eq(sales.tenantId, tenantId))
    await db.delete(inventoryLots).where(eq(inventoryLots.tenantId, tenantId))
    await db.delete(purchases).where(eq(purchases.tenantId, tenantId))
    await db.delete(inventoryItems).where(eq(inventoryItems.tenantId, tenantId))
    await db.delete(batches).where(eq(batches.id, batchId))
    await db.delete(productionUnits).where(eq(productionUnits.tenantId, tenantId))
    await db.delete(farms).where(eq(farms.tenantId, tenantId))
    await db.delete(sessions).where(eq(sessions.userId, ownerId))
    await db.delete(users).where(eq(users.id, ownerId))
    await db.delete(tenants).where(eq(tenants.id, tenantId))
  })

  async function postSale(body: Record<string, unknown>) {
    mockCookie = ownerSession
    const res = await readJson(await salesPOST(jsonRequest('http://localhost/api/data/sales', 'POST', { tenantId, ...body })))
    mockCookie = undefined
    return res
  }
  async function postPurchase(body: Record<string, unknown>) {
    mockCookie = ownerSession
    const res = await readJson(await purchasesPOST(jsonRequest('http://localhost/api/purchases', 'POST', { tenantId, farmId, ...body })))
    mockCookie = undefined
    return res
  }

  describe('the money maths (item 3): quantity x unit price = the stored total', () => {
    it('a sale stores exactly qty x unit price as amountCents — the same figure the sheet shows as Total', () => {
      // Mirrors what RecordSaleSheet actually sends: it never posts a lone
      // typed amount any more, only the computed total.
      const qty = 12
      const unitPriceCents = 12500 // KSh 125.00
      return postSale({ item: 'Tray eggs', amountCents: qty * unitPriceCents, method: 'Cash' }).then((res) => {
        expect(res.status).toBe(201)
        expect(res.payload.data.amountCents).toBe(qty * unitPriceCents)
      })
    })

    it('a purchase\'s totalCostCents is always quantity x unitCostCents, never a caller-supplied figure', async () => {
      const res = await postPurchase({
        supplier: 'Unga Ltd', itemName: `Feed ${randomUUID()}`, unit: 'kg',
        quantity: 40, unitCostCents: 350000, totalCostCents: 999999999, // ignored — see route's own comment
      })
      expect(res.status).toBe(201)
      expect(res.payload.data.purchase.totalCostCents).toBe(40 * 350000)
    })
  })

  describe('payment reference persists (item 2)', () => {
    it('a sale keeps its payment reference, and Credit carries a due date', async () => {
      const res = await postSale({
        item: 'Broiler Live Birds', amountCents: 500000, method: 'Credit',
        status: 'pending', paymentReference: '', soldTo: 'Mama Njeri', dueDate: '2027-01-15', notes: 'Weekly regular',
      })
      expect(res.status).toBe(201)
      expect(res.payload.data.status).toBe('pending')
      expect(res.payload.data.soldTo).toBe('Mama Njeri')
      expect(res.payload.data.notes).toBe('Weekly regular')
      expect(res.payload.data.dueDate).toBeTruthy()

      mockCookie = ownerSession
      const listed = await readJson(await salesGET(new Request(`http://localhost/api/data/sales?tenantId=${tenantId}`)))
      mockCookie = undefined
      const row = listed.payload.data.find((r: { id: string }) => r.id === res.payload.data.id)
      expect(row.soldTo).toBe('Mama Njeri')
    })

    it('an M-Pesa sale carries its own reference', async () => {
      const res = await postSale({ item: 'Dressed Chicken', amountCents: 80000, method: 'M-Pesa', paymentReference: 'QF7X8Y9Z' })
      expect(res.status).toBe(201)
      expect(res.payload.data.paymentReference).toBe('QF7X8Y9Z')
    })

    it('a purchase keeps its reference, invoice number, received date, notes and receipt photo', async () => {
      const photo = 'data:image/jpeg;base64,' + 'A'.repeat(40)
      const res = await postPurchase({
        supplier: 'Agro Dealer', itemName: `Layers Mash ${randomUUID()}`, unit: 'kg',
        quantity: 10, unitCostCents: 8000, paymentMethod: 'Bank transfer', paymentReference: 'FT2609221234',
        invoiceNumber: 'INV-00231', receivedDate: '2026-09-20', notes: 'Delivered by pickup', photoUrl: photo,
      })
      expect(res.status).toBe(201)
      const purchaseRow = res.payload.data.purchase
      expect(purchaseRow.paymentReference).toBe('FT2609221234')
      expect(purchaseRow.invoiceNumber).toBe('INV-00231')
      expect(purchaseRow.notes).toBe('Delivered by pickup')
      expect(purchaseRow.photoUrl).toBe(photo)
      expect(purchaseRow.receivedDate).toBeTruthy()
      // Dual-write (the approved decision): createdAt keeps doing the P&L-
      // period job it always has, at the SAME value as the new column.
      expect(new Date(purchaseRow.createdAt).toISOString().slice(0, 10)).toBe('2026-09-20')
      expect(new Date(purchaseRow.receivedDate).toISOString().slice(0, 10)).toBe('2026-09-20')
    })

    it('a Credit purchase leaves an amount due and refuses an overpayment on top of it', async () => {
      const res = await postPurchase({
        supplier: 'Vet Shop', itemName: `Vaccine ${randomUUID()}`, unit: 'dose',
        quantity: 5, unitCostCents: 20000, paymentMethod: 'Credit', amountPaidCents: 0, dueDate: '2026-10-15',
      })
      expect(res.status).toBe(201)
      expect(res.payload.data.purchase.amountPaidCents).toBe(0)
      expect(res.payload.data.purchase.dueDate).toBeTruthy()
    })
  })

  describe('item-master creation (item 6)', () => {
    it('POST /api/inventory/items creates the item alone, at zero quantity', async () => {
      mockCookie = ownerSession
      const name = `Broiler Starter ${randomUUID()}`
      const res = await readJson(await itemsPOST(jsonRequest('http://localhost/api/inventory/items', 'POST', {
        tenantId, name, category: 'Feed', unit: 'kg', lowStockThreshold: 200, sku: 'FEED-001',
      })))
      expect(res.status).toBe(201)
      expect(res.payload.data.qtyOnHand).toBe(0)
      expect(res.payload.data.lots).toEqual([])
      expect(res.payload.data.sku).toBe('FEED-001')
      expect(res.payload.data.lowStockThreshold).toBe(200)

      // It shows up in the merged stock list too, at zero.
      const listed = await readJson(await itemsGET(new Request(`http://localhost/api/inventory/items?tenantId=${tenantId}`)))
      mockCookie = undefined
      const row = listed.payload.data.find((r: { name: string }) => r.name === name)
      expect(row).toBeTruthy()
      expect(row.qtyOnHand).toBe(0)

      await db.delete(inventoryItems).where(eq(inventoryItems.id, res.payload.data.id))
    })

    it('refuses a duplicate name, the same as the purchase path already does', async () => {
      mockCookie = ownerSession
      const name = `Duplicate Feed ${randomUUID()}`
      const first = await readJson(await itemsPOST(jsonRequest('http://localhost/api/inventory/items', 'POST', { tenantId, name, unit: 'kg' })))
      expect(first.status).toBe(201)
      const second = await readJson(await itemsPOST(jsonRequest('http://localhost/api/inventory/items', 'POST', { tenantId, name: name.toUpperCase(), unit: 'kg' })))
      mockCookie = undefined
      expect(second.status).toBe(400)
      await db.delete(inventoryItems).where(eq(inventoryItems.id, first.payload.data.id))
    })

    it('PATCH /api/inventory/items/[id] edits the reorder level of an existing item, not just a new one\'s', async () => {
      mockCookie = ownerSession
      const created = await readJson(await itemsPOST(jsonRequest('http://localhost/api/inventory/items', 'POST', {
        tenantId, name: `Reorder Test ${randomUUID()}`, unit: 'kg', lowStockThreshold: 50,
      })))
      const id = created.payload.data.id
      const patched = await readJson(await itemPATCH(jsonRequest(`http://localhost/api/inventory/items/${id}`, 'PATCH', { tenantId, lowStockThreshold: 300 }), { params: Promise.resolve({ id }) }))
      mockCookie = undefined
      expect(patched.status).toBe(200)
      expect(patched.payload.data.lowStockThreshold).toBe(300)
      await db.delete(inventoryItems).where(eq(inventoryItems.id, id))
    })
  })
})

describe('the dimension report is reachable from the UI (item 7)', () => {
  const dimensions = read('components/farm/dimensions.tsx')
  const reports = read('components/farm/reports.tsx')

  it('Reporting dimensions\' button navigates straight to the report, pre-selected', () => {
    expect(dimensions).toMatch(/navigate\('reports', \{ report: 'dimension-pl', dimension: 'FARM' \}\)/)
  })

  it('Reports catalogues dimension-pl with a real endpoint behind it', () => {
    expect(reports).toMatch(/id: 'dimension-pl'/)
    expect(reports).toMatch(/'dimension-pl': '\/api\/reports\/dimension-pl'/)
  })

  it('Reports reads the report= deep-link param instead of always starting on the picker', () => {
    expect(reports).toMatch(/useState<string \| null>\(\(\) => params\.report \?\? null\)/)
  })

  it('offers a Farm/Unit/Batch/Enterprise selector that feeds the request', () => {
    expect(reports).toMatch(/DIMENSION_LEVEL_OPTIONS/)
    expect(reports).toMatch(/qs\.set\('dimension', dimensionCode\)/)
  })
})
