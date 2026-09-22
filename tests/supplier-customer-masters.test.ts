// ── Supplier and customer masters (item 20) ─────────────────────────────────
// Covers: creation + case-insensitive dedupe (both masters), the balance
// computation (unpaid purchases for a supplier, pending sales for a
// customer — "no new ledger concepts, just a sum"), linking a sale/purchase
// to a master while the existing free-text field keeps working untouched,
// and the active-flag PATCH.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'

vi.mock('server-only', () => ({}))

let mockCookie: string | undefined
vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({ get: () => (mockCookie ? { value: mockCookie } : undefined) })),
}))

import { GET as suppliersGET, POST as suppliersPOST } from '@/app/api/suppliers/route'
import { PATCH as supplierPATCH } from '@/app/api/suppliers/[id]/route'
import { GET as customersGET, POST as customersPOST } from '@/app/api/customers/route'
import { POST as salesPOST } from '@/app/api/data/sales/route'
import { POST as purchasesPOST } from '@/app/api/purchases/route'
import { db } from '@/db'
import { tenants, users, sessions, suppliers, customers, sales, purchases, inventoryItems, inventoryLots, journalEntries, journalLines } from '@/db/schemas'
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

run('supplier and customer masters (item 20)', () => {
  const tenantId = `t-masters-${randomUUID()}`
  const ownerId = `usr-owner-${randomUUID()}`
  let ownerSession: string

  beforeAll(async () => {
    await db.insert(tenants).values({ id: tenantId, name: 'Masters Co.', active: true })
    const salt = randomUUID()
    await db.insert(users).values({
      id: ownerId, tenantId, name: 'Owner', email: `masters-owner-${randomUUID()}@test.ifms`, role: 'owner',
      passwordHash: hashSecret('pw', salt), passwordSalt: salt, status: 'ACTIVE',
    })
    ownerSession = await createSession(ownerId)
  })

  afterAll(async () => {
    mockCookie = undefined
    const entries = await db.select({ id: journalEntries.id }).from(journalEntries).where(eq(journalEntries.tenantId, tenantId))
    for (const e of entries) await db.delete(journalLines).where(eq(journalLines.entryId, e.id))
    await db.delete(journalEntries).where(eq(journalEntries.tenantId, tenantId))
    await db.delete(sales).where(eq(sales.tenantId, tenantId))
    await db.delete(inventoryLots).where(eq(inventoryLots.tenantId, tenantId))
    await db.delete(purchases).where(eq(purchases.tenantId, tenantId))
    await db.delete(inventoryItems).where(eq(inventoryItems.tenantId, tenantId))
    await db.delete(suppliers).where(eq(suppliers.tenantId, tenantId))
    await db.delete(customers).where(eq(customers.tenantId, tenantId))
    await db.delete(sessions).where(eq(sessions.userId, ownerId))
    await db.delete(users).where(eq(users.id, ownerId))
    await db.delete(tenants).where(eq(tenants.id, tenantId))
  })

  async function call(fn: (req: Request) => Promise<Response>, url: string, method: string, body?: unknown) {
    mockCookie = ownerSession
    const res = await readJson(await fn(jsonRequest(url, method, body)))
    mockCookie = undefined
    return res
  }

  it('creates a supplier and refuses a case-insensitive duplicate', async () => {
    const name = `Unga Ltd ${randomUUID()}`
    const created = await call(suppliersPOST, 'http://localhost/api/suppliers', 'POST', { tenantId, name, phone: '0722000000' })
    expect(created.status).toBe(201)
    expect(created.payload.data.balanceCents).toBe(0)

    const dupe = await call(suppliersPOST, 'http://localhost/api/suppliers', 'POST', { tenantId, name: name.toUpperCase() })
    expect(dupe.status).toBe(400)
  })

  it('a supplier\'s balance is the unpaid portion of its linked purchases, clamped at zero, summed', async () => {
    const name = `Balance Supplier ${randomUUID()}`
    const created = await call(suppliersPOST, 'http://localhost/api/suppliers', 'POST', { tenantId, name })
    const supplierId = created.payload.data.id

    // Fully paid — contributes nothing.
    await call(purchasesPOST, 'http://localhost/api/purchases', 'POST', {
      tenantId, supplier: name, supplierId, itemName: `Feed A ${randomUUID()}`, unit: 'kg',
      quantity: 10, unitCostCents: 10000, amountPaidCents: 100000,
    })
    // Half paid — contributes the remainder.
    await call(purchasesPOST, 'http://localhost/api/purchases', 'POST', {
      tenantId, supplier: name, supplierId, itemName: `Feed B ${randomUUID()}`, unit: 'kg',
      quantity: 10, unitCostCents: 10000, amountPaidCents: 40000,
    })
    // Unpaid — contributes in full.
    await call(purchasesPOST, 'http://localhost/api/purchases', 'POST', {
      tenantId, supplier: name, supplierId, itemName: `Feed C ${randomUUID()}`, unit: 'kg',
      quantity: 5, unitCostCents: 10000, amountPaidCents: 0,
    })

    const listed = await call(suppliersGET, `http://localhost/api/suppliers?tenantId=${tenantId}`, 'GET')
    const row = listed.payload.data.find((s: { id: string }) => s.id === supplierId)!
    // (100000-100000=0) + (100000-40000=60000) + (50000-0=50000) = 110000
    expect(row.balanceCents).toBe(110000)
  })

  it('linking a purchase to a supplier leaves the free-text purchases.supplier untouched', async () => {
    const name = `Free Text Check ${randomUUID()}`
    const created = await call(suppliersPOST, 'http://localhost/api/suppliers', 'POST', { tenantId, name })
    const supplierId = created.payload.data.id

    const purchase = await call(
      purchasesPOST, 'http://localhost/api/purchases', 'POST',
      { tenantId, supplier: name, supplierId, itemName: `Item ${randomUUID()}`, unit: 'kg', quantity: 1, unitCostCents: 1000 },
    )
    expect(purchase.payload.data.purchase.supplier).toBe(name)
    expect(purchase.payload.data.purchase.supplierId).toBe(supplierId)
  })

  it('refuses a supplierId from a different tenant', async () => {
    const otherTenantId = `t-other-${randomUUID()}`
    await db.insert(tenants).values({ id: otherTenantId, name: 'Other Co.', active: true })
    const foreignSupplierId = randomUUID()
    await db.insert(suppliers).values({ id: foreignSupplierId, tenantId: otherTenantId, name: 'Foreign Supplier' })

    const res = await call(purchasesPOST, 'http://localhost/api/purchases', 'POST', {
      tenantId, supplier: 'Foreign Supplier', supplierId: foreignSupplierId, itemName: `Item ${randomUUID()}`, unit: 'kg', quantity: 1, unitCostCents: 1000,
    })
    expect(res.status).toBe(404)

    await db.delete(suppliers).where(eq(suppliers.id, foreignSupplierId))
    await db.delete(tenants).where(eq(tenants.id, otherTenantId))
  })

  it('creates a customer, and its balance is the sum of its PENDING (on-account) sales only', async () => {
    const name = `Balance Customer ${randomUUID()}`
    const created = await call(customersPOST, 'http://localhost/api/customers', 'POST', { tenantId, name, phone: '0733000000' })
    expect(created.status).toBe(201)
    const customerId = created.payload.data.id

    await call(salesPOST, 'http://localhost/api/data/sales', 'POST', {
      tenantId, item: 'Paid sale', amountCents: 50000, status: 'paid', method: 'Cash', soldTo: name, customerId,
    })
    await call(salesPOST, 'http://localhost/api/data/sales', 'POST', {
      tenantId, item: 'On account sale', amountCents: 75000, status: 'pending', method: 'Credit', soldTo: name, customerId,
    })

    const listed = await call(customersGET, `http://localhost/api/customers?tenantId=${tenantId}`, 'GET')
    const row = listed.payload.data.find((c: { id: string }) => c.id === customerId)!
    expect(row.balanceCents).toBe(75000)
  })

  it('PATCH toggles the active flag', async () => {
    const created = await call(suppliersPOST, 'http://localhost/api/suppliers', 'POST', { tenantId, name: `Toggle Me ${randomUUID()}` })
    const id = created.payload.data.id

    mockCookie = ownerSession
    const res = await readJson(await supplierPATCH(jsonRequest(`http://localhost/api/suppliers/${id}`, 'PATCH', { tenantId, active: false }), { params: Promise.resolve({ id }) }))
    mockCookie = undefined
    expect(res.status).toBe(200)
    expect(res.payload.data.active).toBe(false)
  })
})
