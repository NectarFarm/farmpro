// Landed cost and multi-line receipts (issue #423).
// The old single-item body still posts one lot at the typed unit cost.
// Re-applying the migration does not move a seeded period.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { eq, inArray, sql } from 'drizzle-orm'

vi.mock('server-only', () => ({}))

let mockCookie: string | undefined
vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({ get: () => (mockCookie ? { value: mockCookie } : undefined) })),
}))

import { POST as purchasesPOST } from '@/app/api/purchases/route'
import { POST as adminRatesPOST } from '@/app/api/admin/tax-rates/route'
import { db } from '@/db'
import {
  tenants, users, sessions, farms,
  purchases, inventoryLots, inventoryItems, purchaseCharges,
  journalEntries, journalLines, journalLineDimensions, documentDimensions, accounts,
  taxRates,
} from '@/db/schemas'
import { createSession, hashSecret } from '@/lib/auth'
import { computePlReport } from '@/lib/reports'
import { computeTrialBalance } from '@/lib/finance'
import { allocateCharges, apportionCents, landedUnitCostCents } from '@/lib/landed-cost'

const hasDb = !!process.env.DATABASE_URL
const run = hasDb ? describe : describe.skip

function postRequest(url: string, body: unknown): Request {
  return new Request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

async function readJson(res: Response) {
  return { status: res.status, payload: await res.json() }
}

async function applyMigration() {
  const raw = readFileSync(join(process.cwd(), 'drizzle/0055_landed_cost.sql'), 'utf8')
  for (const statement of raw.split('--> statement-breakpoint').map((s) => s.trim()).filter(Boolean)) {
    await db.execute(sql.raw(statement))
  }
}

describe('landed cost arithmetic', () => {
  it('gives the remainder to the largest line, and nothing to a zero line', () => {
    expect(apportionCents(100, [1000, 1000, 0])).toEqual([50, 50, 0])
    expect(apportionCents(100, [1, 1, 1])).toEqual([34, 33, 33])
    const byQty = allocateCharges(
      [
        { extendedCents: 0, quantity: 2 },
        { extendedCents: 0, quantity: 1 },
        { extendedCents: 0, quantity: 1 },
      ],
      [{ amountCents: 100 }],
    )
    expect(byQty).toEqual([50, 25, 25])
    expect(landedUnitCostCents(1100, 10)).toBe(110)
  })
})

run('landed cost receipts (issue #423)', () => {
  const tenantId = `t-landed-${randomUUID()}`
  const farmId = randomUUID()
  let ownerUserId = ''
  let adminUserId = ''
  let ownerToken = ''
  let adminToken = ''
  const rateIds: string[] = []
  const periodFrom = new Date('2026-03-01T00:00:00.000Z')
  const periodTo = new Date('2026-03-31T23:59:59.999Z')

  beforeAll(async () => {
    await applyMigration()
    await db.insert(tenants).values({ id: tenantId, name: 'Landed Test Co.', active: true })
    const salt = randomUUID()
    ownerUserId = randomUUID()
    adminUserId = randomUUID()
    const passwordHash = hashSecret('pw', salt)
    await db.insert(users).values([
      { id: ownerUserId, tenantId, name: 'Landed Owner', email: `owner-landed-${randomUUID()}@test.ifms`, role: 'owner', passwordHash, passwordSalt: salt, status: 'ACTIVE' },
      { id: adminUserId, tenantId: null, name: 'Landed Admin', email: `admin-landed-${randomUUID()}@test.ifms`, role: 'super_admin', passwordHash, passwordSalt: salt, status: 'ACTIVE' },
    ])
    ownerToken = await createSession(ownerUserId)
    adminToken = await createSession(adminUserId)
    await db.insert(farms).values({ id: farmId, tenantId, name: 'Landed Farm', location: 'Nakuru', code: `LF-${farmId.slice(0, 6)}` })
  })

  afterAll(async () => {
    if (rateIds.length > 0) await db.delete(taxRates).where(inArray(taxRates.id, rateIds))
    await db.delete(purchaseCharges).where(eq(purchaseCharges.tenantId, tenantId))
    const entryIds = (await db.select({ id: journalEntries.id }).from(journalEntries).where(eq(journalEntries.tenantId, tenantId))).map((r) => r.id)
    if (entryIds.length > 0) {
      const lineIds = (await db.select({ id: journalLines.id }).from(journalLines).where(inArray(journalLines.entryId, entryIds))).map((r) => r.id)
      if (lineIds.length > 0) await db.delete(journalLineDimensions).where(inArray(journalLineDimensions.lineId, lineIds))
      await db.delete(journalLines).where(inArray(journalLines.entryId, entryIds))
      await db.delete(journalEntries).where(inArray(journalEntries.id, entryIds))
    }
    await db.delete(documentDimensions).where(eq(documentDimensions.tenantId, tenantId))
    await db.delete(purchases).where(eq(purchases.tenantId, tenantId))
    await db.delete(inventoryLots).where(eq(inventoryLots.tenantId, tenantId))
    await db.delete(inventoryItems).where(eq(inventoryItems.tenantId, tenantId))
    await db.delete(farms).where(eq(farms.tenantId, tenantId))
    const userIds = [ownerUserId, adminUserId].filter(Boolean)
    if (userIds.length > 0) {
      await db.delete(sessions).where(inArray(sessions.userId, userIds))
      await db.delete(users).where(inArray(users.id, userIds))
    }
    await db.delete(tenants).where(eq(tenants.id, tenantId))
  })

  async function snapshot() {
    const pl = await computePlReport(tenantId, periodFrom, periodTo)
    const tb = await computeTrialBalance(tenantId)
    return {
      periodPurchaseExpense: Number(pl.meta.periodPurchaseExpense),
      periodRevenue: Number(pl.meta.periodRevenue),
      totalDebitsCents: tb.totalDebitsCents,
      totalCreditsCents: tb.totalCreditsCents,
    }
  }

  it('keeps an old single-item purchase, and re-applying the migration does not move it', async () => {
    mockCookie = ownerToken
    const posted = await readJson(await purchasesPOST(postRequest('http://localhost/api/purchases', {
      tenantId, supplier: 'Unga', itemName: 'Old Mash', unit: 'kg', quantity: 4,
      unitCostCents: 2500, amountPaidCents: 5000, farmId,
      postingDate: '2026-03-12', receivedDate: '2026-03-12',
    })))
    expect(posted.status).toBe(201)
    expect(posted.payload.data.purchase.totalCostCents).toBe(10000)
    expect(posted.payload.data.purchase.rawUnitCostCents).toBeNull()
    expect(posted.payload.data.purchase.receiptGroupId).toBeNull()
    expect(posted.payload.data.lot.unitCostCents).toBe(2500)
    expect(posted.payload.data.lots).toHaveLength(1)
    const before = await snapshot()
    expect(before.periodPurchaseExpense).toBe(100)
    await applyMigration()
    expect(await snapshot()).toEqual(before)
  })

  it('apportions freight across lines and expenses the invoice total', async () => {
    mockCookie = ownerToken
    const posted = await readJson(await purchasesPOST(postRequest('http://localhost/api/purchases', {
      tenantId, supplier: 'Mill', invoiceNumber: 'INV-9', farmId,
      postingDate: '2026-06-10', receivedDate: '2026-06-10', amountPaidCents: 2100,
      lines: [
        { itemName: 'Maize', unit: 'kg', quantity: 10, unitCostCents: 100 },
        { itemName: 'Soya', unit: 'kg', quantity: 5, unitCostCents: 200 },
        { itemName: 'Salt', unit: 'kg', quantity: 1, unitCostCents: 0 },
      ],
      charges: [{ kind: 'freight', amountCents: 100 }],
    })))
    expect(posted.status).toBe(201)
    const rows = posted.payload.data.purchases as { purchase: { itemId: string; totalCostCents: number; rawUnitCostCents: number; unitCostCents: number; receiptGroupId: string }; item: { name: string }; lot: { unitCostCents: number } }[]
    expect(rows).toHaveLength(3)
    const group = rows[0].purchase.receiptGroupId
    expect(rows.every((row) => row.purchase.receiptGroupId === group)).toBe(true)
    const byName = Object.fromEntries(rows.map((row) => [row.item.name, row]))
    expect(byName.Maize.purchase.rawUnitCostCents).toBe(100)
    expect(byName.Maize.purchase.totalCostCents).toBe(1050)
    expect(byName.Maize.lot.unitCostCents).toBe(105)
    expect(byName.Soya.purchase.totalCostCents).toBe(1050)
    expect(byName.Soya.lot.unitCostCents).toBe(210)
    expect(byName.Salt.purchase.totalCostCents).toBe(0)
    expect(byName.Salt.lot.unitCostCents).toBe(0)
    const charges = await db.select().from(purchaseCharges).where(eq(purchaseCharges.receiptGroupId, group))
    expect(charges.map((row) => row.amountCents)).toEqual([100])
    const names = rows.map((row) => row.item.name)
    expect(names).not.toContain('freight')
    const june = await computePlReport(tenantId, new Date('2026-06-01T00:00:00.000Z'), new Date('2026-06-30T23:59:59.999Z'))
    expect(june.meta.periodPurchaseExpense).toBe(21)
    const march = await snapshot()
    expect(march.periodPurchaseExpense).toBe(100)
  })

  it('splits one line into lots that share the landed unit cost', async () => {
    mockCookie = ownerToken
    const posted = await readJson(await purchasesPOST(postRequest('http://localhost/api/purchases', {
      tenantId, supplier: 'Mill', farmId, postingDate: '2026-06-11', receivedDate: '2026-06-11',
      lines: [{
        itemName: 'Premix', unit: 'kg', quantity: 10, unitCostCents: 100,
        lots: [
          { quantity: 4, expiryDate: '2026-12-01' },
          { quantity: 6, expiryDate: '2027-03-01' },
        ],
      }],
      charges: [{ kind: 'loading', amountCents: 50 }],
    })))
    expect(posted.status).toBe(201)
    const lots = posted.payload.data.purchases[0].lots as { qtyOnHand: number; unitCostCents: number; expiryDate: string }[]
    expect(lots.map((lot) => lot.qtyOnHand)).toEqual([4, 6])
    expect(lots.every((lot) => lot.unitCostCents === 105)).toBe(true)
    expect(new Set(lots.map((lot) => String(lot.expiryDate).slice(0, 10))).size).toBe(2)
    const refused = await readJson(await purchasesPOST(postRequest('http://localhost/api/purchases', {
      tenantId, supplier: 'Mill', farmId,
      lines: [{ itemName: 'Premix', unit: 'kg', quantity: 10, unitCostCents: 100, lots: [{ quantity: 3 }, { quantity: 3 }] }],
    })))
    expect(refused.status).toBe(400)
    expect(refused.payload.error).toBe('Lot quantities must add up to the line quantity.')
  })

  it('applies VAT to the landed total, and refuses an overpayment', async () => {
    mockCookie = adminToken
    const rate = await readJson(await adminRatesPOST(postRequest('http://localhost/api/admin/tax-rates', {
      taxCode: 'VATABLE', percent: '16', effectiveFrom: '2026-07-01', effectiveTo: '2026-07-31',
    })))
    expect(rate.status).toBe(201)
    rateIds.push(rate.payload.data.id)
    mockCookie = ownerToken
    const posted = await readJson(await purchasesPOST(postRequest('http://localhost/api/purchases', {
      tenantId, supplier: 'Mill', farmId, postingDate: '2026-07-04', receivedDate: '2026-07-04',
      taxCode: 'VATABLE', taxInclusive: false, amountPaidCents: 11600,
      lines: [{ itemName: 'VAT Mash', unit: 'kg', quantity: 2, unitCostCents: 5000 }],
      charges: [{ kind: 'levy', amountCents: 0 }],
    })))
    expect(posted.status).toBe(400)
    expect(posted.payload.error).toBe('A charge amount has to be more than zero')
    const ok = await readJson(await purchasesPOST(postRequest('http://localhost/api/purchases', {
      tenantId, supplier: 'Mill', farmId, postingDate: '2026-07-04', receivedDate: '2026-07-04',
      taxCode: 'VATABLE', taxInclusive: false, amountPaidCents: 11600,
      lines: [{ itemName: 'VAT Mash', unit: 'kg', quantity: 2, unitCostCents: 5000 }],
    })))
    expect(ok.status).toBe(201)
    const purchase = ok.payload.data.purchases[0].purchase
    expect(purchase.totalCostCents).toBe(11600)
    expect(purchase.netCents).toBe(10000)
    expect(purchase.taxCents).toBe(1600)
    expect(ok.payload.data.purchases[0].lot.unitCostCents).toBe(5000)
    const [entry] = await db.select().from(journalEntries).where(eq(journalEntries.sourceId, purchase.id))
    const lines = await db.select().from(journalLines).where(eq(journalLines.entryId, entry.id))
    const codes = await db.select().from(accounts)
    const byId = new Map(codes.map((row) => [row.id, row.code]))
    const shaped = lines.map((row) => ({ code: byId.get(row.accountId), debit: row.debitCents, credit: row.creditCents }))
    expect(shaped).toEqual(expect.arrayContaining([
      { code: '5001', debit: 10000, credit: 0 },
      { code: '1300', debit: 1600, credit: 0 },
      { code: '1001', debit: 0, credit: 11600 },
    ]))
    const over = await readJson(await purchasesPOST(postRequest('http://localhost/api/purchases', {
      tenantId, supplier: 'Mill', farmId, postingDate: '2026-07-05', receivedDate: '2026-07-05',
      amountPaidCents: 5000,
      lines: [{ itemName: 'Over', unit: 'kg', quantity: 1, unitCostCents: 1000 }],
    })))
    expect(over.status).toBe(400)
    expect(over.payload.error).toBe('Amount paid is more than the purchase total — check the figures')
  })
})
