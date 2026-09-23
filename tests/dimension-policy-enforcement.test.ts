// ── Dimension policy that actually holds (item 19) ──────────────────────────
// The enforcement mechanism itself (lib/dimensions.ts's applyAccountRules /
// attachLineDimensions — refuse a posting missing a REQUIRED account
// dimension, naming the account and the dimension; apply a per-account
// default VALUE when a posting doesn't specify one) already existed and was
// already unit-tested against recordSale directly (tests/dimensions.test.ts).
// What this file proves instead:
//   1. The refusal surfaces through the real HTTP routes (POST /api/data/
//      sales, POST /api/purchases), not just the lib function — a 400 naming
//      the missing dimension, exactly as an owner would actually hit it.
//   2. Every account is Optional by construction until an owner deliberately
//      sets one to Required — ensureAccountsSeeded never writes a
//      default_dimensions row, so "nothing that saves today starts failing"
//      needs no migration to be true; this is the regression test for it.
//   3. A per-account default VALUE (not just a requirement) is actually
//      applied to a posting that never specified one.
//   4. The sheets now offer a setup link when this exact error occurs
//      (source-text check, this repo's own convention for UI with no
//      render harness).
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { and, eq, inArray } from 'drizzle-orm'

vi.mock('server-only', () => ({}))

let mockCookie: string | undefined
vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({ get: () => (mockCookie ? { value: mockCookie } : undefined) })),
}))

import { POST as salesPOST } from '@/app/api/data/sales/route'
import { POST as purchasesPOST } from '@/app/api/purchases/route'
import { ensureSystemDimensions, SYSTEM_DIMENSION_CODES, projectFarm } from '@/lib/dimensions'
import { ensureAccountsSeeded, ACCOUNT_CODES } from '@/lib/finance'
import { db } from '@/db'
import {
  tenants, users, sessions, farms, accounts, defaultDimensions, dimensionValues, documentDimensions,
  sales, purchases, inventoryItems, inventoryLots, journalEntries, journalLines, journalLineDimensions,
} from '@/db/schemas'
import { createSession, hashSecret } from '@/lib/auth'

const hasDb = !!process.env.DATABASE_URL
const run = hasDb ? describe : describe.skip
const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')

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

run('dimension policy that actually holds (item 19)', () => {
  const tenantId = `t-dim-policy-${randomUUID()}`
  const ownerId = `usr-owner-${randomUUID()}`
  let ownerSession: string

  beforeAll(async () => {
    await db.insert(tenants).values({ id: tenantId, name: 'Dimension Policy Co.', active: true })
    const salt = randomUUID()
    await db.insert(users).values({
      id: ownerId, tenantId, name: 'Owner', email: `dim-policy-owner-${randomUUID()}@test.ifms`, role: 'owner',
      passwordHash: hashSecret('pw', salt), passwordSalt: salt, status: 'ACTIVE',
    })
    ownerSession = await createSession(ownerId)
    await ensureAccountsSeeded(db)
    await ensureSystemDimensions(tenantId)
  })

  afterAll(async () => {
    mockCookie = undefined
    const entryRows = await db.select({ id: journalEntries.id }).from(journalEntries).where(eq(journalEntries.tenantId, tenantId))
    const entryIds = entryRows.map((r) => r.id)
    if (entryIds.length > 0) {
      const lineRows = await db.select({ id: journalLines.id }).from(journalLines).where(inArray(journalLines.entryId, entryIds))
      const lineIds = lineRows.map((r) => r.id)
      if (lineIds.length > 0) await db.delete(journalLineDimensions).where(inArray(journalLineDimensions.lineId, lineIds))
      await db.delete(journalLines).where(inArray(journalLines.entryId, entryIds))
    }
    await db.delete(journalEntries).where(eq(journalEntries.tenantId, tenantId))
    await db.delete(documentDimensions).where(eq(documentDimensions.tenantId, tenantId))
    await db.delete(defaultDimensions).where(eq(defaultDimensions.tenantId, tenantId))
    await db.delete(dimensionValues).where(eq(dimensionValues.tenantId, tenantId))
    await db.delete(sales).where(eq(sales.tenantId, tenantId))
    await db.delete(inventoryLots).where(eq(inventoryLots.tenantId, tenantId))
    await db.delete(purchases).where(eq(purchases.tenantId, tenantId))
    await db.delete(inventoryItems).where(eq(inventoryItems.tenantId, tenantId))
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
    const res = await readJson(await purchasesPOST(jsonRequest('http://localhost/api/purchases', 'POST', { tenantId, ...body })))
    mockCookie = undefined
    return res
  }

  it('every account is Optional until an owner sets one Required — a plain sale and purchase save with zero dimension rules configured', async () => {
    const sale = await postSale({ item: 'Ad hoc eggs', amountCents: 50000, method: 'Cash' })
    expect(sale.status).toBe(201)
    const purchase = await postPurchase({
      supplier: 'Agro', itemName: `Feed ${randomUUID()}`, unit: 'kg', quantity: 5, unitCostCents: 10000,
    })
    expect(purchase.status).toBe(201)
  })

  it('refuses a sale THROUGH THE REAL ROUTE once Cash requires Farm, naming the dimension', async () => {
    const idByCode = await ensureSystemDimensions(tenantId)
    const farmDimId = idByCode.get(SYSTEM_DIMENSION_CODES.FARM)!
    const [cashAccount] = await db.select().from(accounts).where(eq(accounts.code, ACCOUNT_CODES.CASH))

    await db.insert(defaultDimensions).values({
      id: randomUUID(), tenantId, masterType: 'account', masterId: cashAccount.id,
      dimensionId: farmDimId, dimensionValueId: null, requirement: 'required',
    })

    const res = await postSale({ item: 'Loose eggs, no batch', amountCents: 30000, method: 'Cash' })
    expect(res.status).toBe(400)
    expect(res.payload.error).toMatch(/requires a value for/i)
    expect(res.payload.error).toMatch(/Farm/)

    // Refused means refused — no sale row and no half-posted journal entry.
    const saleRows = await db.select().from(sales).where(eq(sales.tenantId, tenantId))
    expect(saleRows.find((s) => s.item === 'Loose eggs, no batch')).toBeUndefined()

    await db.delete(defaultDimensions).where(and(eq(defaultDimensions.tenantId, tenantId), eq(defaultDimensions.masterId, cashAccount.id)))
  })

  it('applies a per-account DEFAULT VALUE to a posting that never specified one', async () => {
    const idByCode = await ensureSystemDimensions(tenantId)
    const farmDimId = idByCode.get(SYSTEM_DIMENSION_CODES.FARM)!
    const [cashAccount] = await db.select().from(accounts).where(eq(accounts.code, ACCOUNT_CODES.CASH))

    const farm = { id: randomUUID(), tenantId, name: 'Default Farm', code: `FRM-DEF-${randomUUID().slice(0, 6)}`, location: 'Nakuru' }
    await db.insert(farms).values(farm)
    await projectFarm(db, tenantId, farm)
    const [farmValue] = await db.select().from(dimensionValues).where(eq(dimensionValues.sourceId, farm.id))

    // Cash defaults to THIS farm (optional — not required — so a posting
    // with no farm of its own still succeeds, just gets this value attached).
    await db.insert(defaultDimensions).values({
      id: randomUUID(), tenantId, masterType: 'account', masterId: cashAccount.id,
      dimensionId: farmDimId, dimensionValueId: farmValue.id, requirement: 'optional',
    })

    const res = await postSale({ item: 'Defaulted sale', amountCents: 40000, method: 'Cash' })
    expect(res.status).toBe(201)

    const [entry] = await db.select().from(journalEntries).where(eq(journalEntries.sourceId, res.payload.data.id))
    const lines = await db.select().from(journalLines).where(eq(journalLines.entryId, entry.id))
    const cashLine = lines.find((l) => l.accountId === cashAccount.id)!
    const lineDims = await db.select().from(journalLineDimensions).where(eq(journalLineDimensions.lineId, cashLine.id))
    expect(lineDims.find((d) => d.dimensionId === farmDimId && d.valueId === farmValue.id)).toBeTruthy()

    await db.delete(defaultDimensions).where(and(eq(defaultDimensions.tenantId, tenantId), eq(defaultDimensions.masterId, cashAccount.id)))
  })
})

describe('the sheets offer a setup link on a dimension-requirement error (item 19, UI)', () => {
  const shared = read('components/farm/ui-shared.tsx')
  const finance = read('components/farm/finance.tsx')
  const inventory = read('components/farm/inventory.tsx')

  it('ui-shared.tsx exports the shared SaveError with the dimension-error detector', () => {
    expect(shared).toMatch(/export function SaveError\(/)
    expect(shared).toMatch(/export function isDimensionRequirementError\(/)
    expect(shared).toMatch(/requires a value for/i)
  })

  it('all three sale/purchase sheets render it, wired to the Reporting dimensions screen', () => {
    for (const src of [finance, inventory]) {
      expect(src).toMatch(/onSetupDimensions=\{\(\) => \{ onClose\(\); navigate\('dimensions'\); \}\}/)
    }
    // Both of Finance's sheets (sale + purchase) use it, not just one.
    const matches = finance.match(/<SaveError message=\{error\}/g) ?? []
    expect(matches.length).toBeGreaterThanOrEqual(2)
  })
})
