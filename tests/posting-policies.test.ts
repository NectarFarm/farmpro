// Approval thresholds on money (issue #424).
// No policy posts exactly as before. A held document is absent from the
// period until it is approved, and approving uses the document's own date.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { and, eq, inArray, sql } from 'drizzle-orm'

vi.mock('server-only', () => ({}))

let mockCookie: string | undefined
vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({ get: () => (mockCookie ? { value: mockCookie } : undefined) })),
}))

import { POST as purchasesPOST } from '@/app/api/purchases/route'
import { POST as expensesPOST } from '@/app/api/expenses/route'
import { POST as expensePayPOST } from '@/app/api/expenses/[id]/payments/route'
import { POST as purchaseReversePOST } from '@/app/api/purchases/[id]/reverse/route'
import { GET as policiesGET, POST as policiesPOST } from '@/app/api/posting-policies/route'
import { DELETE as policiesDELETE } from '@/app/api/posting-policies/[id]/route'
import { PATCH as lotPATCH } from '@/app/api/inventory/lots/[id]/route'
import { PATCH as settingsPATCH } from '@/app/api/settings/route'
import { POST as approvePOST } from '@/app/api/approvals/[id]/approve/route'
import { db } from '@/db'
import {
  tenants, users, sessions, farms,
  purchases, inventoryLots, inventoryItems,
  journalEntries, journalLines, journalLineDimensions, documentDimensions,
  postingPolicies, approvalRequests, expenses, sales,
} from '@/db/schemas'
import { createSession, hashSecret } from '@/lib/auth'
import { computePlReport } from '@/lib/reports'
import { computeTrialBalance } from '@/lib/finance'
import { blockedMessage, judgeMoney, purchaseLegs, varianceDecision, POSTS_NOW, PENDING_MESSAGE } from '@/lib/posting-policy'

const hasDb = !!process.env.DATABASE_URL
const run = hasDb ? describe : describe.skip

function postRequest(url: string, body: unknown, method = 'POST'): Request {
  return new Request(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

async function readJson(res: Response) {
  return { status: res.status, payload: await res.json() }
}

async function applyMigration() {
  const raw = readFileSync(join(process.cwd(), 'drizzle/0056_posting_policies.sql'), 'utf8')
  for (const statement of raw.split('--> statement-breakpoint').map((s) => s.trim()).filter(Boolean)) {
    await db.execute(sql.raw(statement))
  }
}

const none = { accountCode: null, farmId: null }

describe('posting policy arithmetic', () => {
  it('posts an amount that is equal to the line, and a block beats a lower pending line', () => {
    const amount = { kind: 'amount' as const, thresholdCents: 1000, effect: 'block' as const, ...none }
    expect(judgeMoney([amount], { amountCents: 1000, farmId: null, legs: [] }).outcome).toBe('post')
    expect(judgeMoney([amount], { amountCents: 1001, farmId: null, legs: [] }).message).toBe(blockedMessage(1000, 'any posting'))
    const pending = { kind: 'amount' as const, thresholdCents: 100, effect: 'pending' as const, ...none }
    const higherBlock = { kind: 'amount' as const, thresholdCents: 500, effect: 'block' as const, ...none }
    const decided = judgeMoney([pending, higherBlock], { amountCents: 600, farmId: null, legs: purchaseLegs({ totalCents: 600, paidCents: 600, netCents: null, taxCents: null }) })
    expect(decided.outcome).toBe('block')
    expect(decided.thresholdCents).toBe(500)
    expect(judgeMoney([], { amountCents: 1, farmId: null, legs: [] })).toEqual({ outcome: 'post', message: POSTS_NOW, thresholdCents: null })
  })

  it('does not let a farm or account line catch a different farm or account', () => {
    const farm = { kind: 'farm' as const, thresholdCents: 0, effect: 'block' as const, accountCode: null, farmId: 'farm-a' }
    const account = { kind: 'account' as const, thresholdCents: 0, effect: 'block' as const, accountCode: '5010', farmId: null }
    const legs = purchaseLegs({ totalCents: 500, paidCents: 500, netCents: null, taxCents: null })
    expect(judgeMoney([farm], { amountCents: 500, farmId: 'farm-b', legs }).outcome).toBe('post')
    expect(judgeMoney([farm], { amountCents: 500, farmId: 'farm-a', legs }).outcome).toBe('block')
    expect(judgeMoney([account], { amountCents: 500, farmId: null, legs }).outcome).toBe('post')
    expect(judgeMoney([account], { amountCents: 500, farmId: null, legs: [{ accountCode: '5010', amountCents: 500 }] }).outcome).toBe('block')
  })

  it('reads a variance policy first and still honours the older column', () => {
    const loose = { kind: 'variance' as const, thresholdCents: 1_000_000, effect: 'pending' as const, ...none }
    const column = varianceDecision(500, [loose], 100)
    expect(column.outcome).toBe('pending')
    expect(column.message).toContain('Stock will not change until it is approved.')
    expect(column.thresholdCents).toBe(100)
    const block = { kind: 'variance' as const, thresholdCents: 0, effect: 'block' as const, ...none }
    expect(varianceDecision(1, [block], null).outcome).toBe('block')
    expect(varianceDecision(0, [block], 0).outcome).toBe('post')
    expect(varianceDecision(50, [], null).message).toBe(POSTS_NOW)
  })

  it('quotes the pending sentence', () => {
    const pending = { kind: 'amount' as const, thresholdCents: 1, effect: 'pending' as const, ...none }
    expect(judgeMoney([pending], { amountCents: 2, farmId: null, legs: [] }).message).toBe(PENDING_MESSAGE)
  })
})

run('approval thresholds (issue #424)', () => {
  const tenantId = `t-policy-${randomUUID()}`
  const farmA = randomUUID()
  const farmB = randomUUID()
  let ownerUserId = ''
  let managerUserId = ''
  let ownerToken = ''
  let managerToken = ''
  const periodFrom = new Date('2026-03-01T00:00:00.000Z')
  const periodTo = new Date('2026-03-31T23:59:59.999Z')

  beforeAll(async () => {
    await applyMigration()
    await db.insert(tenants).values({ id: tenantId, name: 'Policy Test Co.', active: true })
    const salt = randomUUID()
    ownerUserId = randomUUID()
    managerUserId = randomUUID()
    const passwordHash = hashSecret('pw', salt)
    await db.insert(users).values([
      { id: ownerUserId, tenantId, name: 'Policy Owner', email: `owner-policy-${randomUUID()}@test.ifms`, role: 'owner', passwordHash, passwordSalt: salt, status: 'ACTIVE' },
      { id: managerUserId, tenantId, name: 'Policy Manager', email: `manager-policy-${randomUUID()}@test.ifms`, role: 'manager', passwordHash, passwordSalt: salt, status: 'ACTIVE' },
    ])
    ownerToken = await createSession(ownerUserId)
    managerToken = await createSession(managerUserId)
    await db.insert(farms).values([
      { id: farmA, tenantId, name: 'North', location: 'Nakuru', code: `NA-${farmA.slice(0, 6)}` },
      { id: farmB, tenantId, name: 'South', location: 'Nakuru', code: `SO-${farmB.slice(0, 6)}` },
    ])
  })

  afterAll(async () => {
    await db.delete(postingPolicies).where(eq(postingPolicies.tenantId, tenantId))
    await db.delete(approvalRequests).where(eq(approvalRequests.tenantId, tenantId))
    const entryIds = (await db.select({ id: journalEntries.id }).from(journalEntries).where(eq(journalEntries.tenantId, tenantId))).map((r) => r.id)
    if (entryIds.length > 0) {
      const lineIds = (await db.select({ id: journalLines.id }).from(journalLines).where(inArray(journalLines.entryId, entryIds))).map((r) => r.id)
      if (lineIds.length > 0) await db.delete(journalLineDimensions).where(inArray(journalLineDimensions.lineId, lineIds))
      await db.delete(journalLines).where(inArray(journalLines.entryId, entryIds))
      await db.delete(journalEntries).where(inArray(journalEntries.id, entryIds))
    }
    await db.delete(documentDimensions).where(eq(documentDimensions.tenantId, tenantId))
    await db.delete(expenses).where(eq(expenses.tenantId, tenantId))
    await db.delete(sales).where(eq(sales.tenantId, tenantId))
    await db.delete(purchases).where(eq(purchases.tenantId, tenantId))
    await db.delete(inventoryLots).where(eq(inventoryLots.tenantId, tenantId))
    await db.delete(inventoryItems).where(eq(inventoryItems.tenantId, tenantId))
    await db.delete(farms).where(eq(farms.tenantId, tenantId))
    const userIds = [ownerUserId, managerUserId].filter(Boolean)
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
      periodOperatingExpense: Number(pl.meta.periodOperatingExpense),
      totalDebitsCents: tb.totalDebitsCents,
      totalCreditsCents: tb.totalCreditsCents,
    }
  }

  async function clearPolicies() {
    await db.delete(postingPolicies).where(eq(postingPolicies.tenantId, tenantId))
  }

  async function addPolicy(body: Record<string, unknown>, token = ownerToken) {
    mockCookie = token
    return readJson(await policiesPOST(postRequest('http://localhost/api/posting-policies', { tenantId, ...body })))
  }

  function purchase(body: Record<string, unknown>) {
    mockCookie = ownerToken
    return purchasesPOST(postRequest('http://localhost/api/purchases', {
      tenantId, supplier: 'Unga', itemName: `Mash ${randomUUID().slice(0, 8)}`, unit: 'kg',
      quantity: 4, unitCostCents: 2500, amountPaidCents: 10000, farmId: farmA,
      postingDate: '2026-03-12', receivedDate: '2026-03-12',
      ...body,
    })).then(readJson)
  }

  it('keeps a purchase with no policy, and re-applying the migration does not move it', async () => {
    await clearPolicies()
    const posted = await purchase({})
    expect(posted.status).toBe(201)
    expect(posted.payload.data.purchase.approvalStatus).toBeNull()
    expect(posted.payload.data.purchase.totalCostCents).toBe(10000)
    expect(posted.payload.data.lot.unitCostCents).toBe(2500)
    const before = await snapshot()
    expect(before.periodPurchaseExpense).toBe(100)
    await applyMigration()
    expect(await snapshot()).toEqual(before)
  })

  it('refuses an unauthenticated policy write and a manager write', async () => {
    mockCookie = undefined
    const open = await readJson(await policiesPOST(postRequest('http://localhost/api/posting-policies', {})))
    expect(open.status).toBe(401)
    const manager = await addPolicy({ kind: 'amount', effect: 'block', thresholdCents: 1 }, managerToken)
    expect(manager.status).toBe(403)
    mockCookie = ownerToken
    const listed = await readJson(await policiesGET(new Request(`http://localhost/api/posting-policies?tenantId=${tenantId}`)))
    expect(listed.status).toBe(200)
    expect(listed.payload.data).toEqual([])
  })

  it('blocks a purchase above the line and writes nothing', async () => {
    await clearPolicies()
    const added = await addPolicy({ kind: 'amount', effect: 'block', thresholdCents: 100 })
    expect(added.status).toBe(201)
    const before = await snapshot()
    const beforeRows = await db.select({ id: purchases.id }).from(purchases).where(eq(purchases.tenantId, tenantId))
    const refused = await purchase({ itemName: 'Blocked Mash', unitCostCents: 50, quantity: 4, amountPaidCents: 200 })
    expect(refused.status).toBe(400)
    expect(refused.payload.error).toBe(blockedMessage(100, 'any posting'))
    const afterRows = await db.select({ id: purchases.id }).from(purchases).where(eq(purchases.tenantId, tenantId))
    expect(afterRows).toHaveLength(beforeRows.length)
    expect(await snapshot()).toEqual(before)
  })

  it('holds a purchase, leaves the books unchanged, and posts on the original date once', async () => {
    await clearPolicies()
    const before = await snapshot()
    const beforeLots = await db.select({ id: inventoryLots.id }).from(inventoryLots).where(eq(inventoryLots.tenantId, tenantId))
    await addPolicy({ kind: 'amount', effect: 'pending', thresholdCents: 0 })
    const posted = await purchase({ itemName: 'Held Mash', quantity: 2, unitCostCents: 1500, amountPaidCents: 3000 })
    expect(posted.status).toBe(201)
    expect(posted.payload.data.purchase.approvalStatus).toBe('pending')
    expect(posted.payload.data.lot).toBeNull()
    expect(posted.payload.data.lots).toEqual([])
    expect(await snapshot()).toEqual(before)
    const lotsNow = await db.select({ id: inventoryLots.id }).from(inventoryLots).where(eq(inventoryLots.tenantId, tenantId))
    expect(lotsNow).toHaveLength(beforeLots.length)
    const purchaseId = posted.payload.data.purchase.id as string
    const [approval] = await db.select().from(approvalRequests).where(and(
      eq(approvalRequests.tenantId, tenantId),
      eq(approvalRequests.entityId, purchaseId),
      eq(approvalRequests.type, 'money_posting'),
    ))
    expect(approval.status).toBe('pending')
    mockCookie = ownerToken
    const approved = await readJson(await approvePOST(
      postRequest(`http://localhost/api/approvals/${approval.id}/approve`, {}),
      { params: Promise.resolve({ id: approval.id }) },
    ))
    expect(approved.status).toBe(200)
    const [row] = await db.select().from(purchases).where(eq(purchases.id, purchaseId))
    expect(row.approvalStatus).toBe('approved')
    const [entry] = await db.select().from(journalEntries).where(and(
      eq(journalEntries.tenantId, tenantId),
      eq(journalEntries.sourceType, 'purchase'),
      eq(journalEntries.sourceId, purchaseId),
    ))
    expect(entry.entryDate.getTime()).toBe(row.postingDate!.getTime())
    const after = await snapshot()
    expect(after.periodPurchaseExpense).toBe(before.periodPurchaseExpense + 30)
    const again = await readJson(await approvePOST(
      postRequest(`http://localhost/api/approvals/${approval.id}/approve`, {}),
      { params: Promise.resolve({ id: approval.id }) },
    ))
    expect(again.status).toBe(409)
    const entries = await db.select().from(journalEntries).where(and(
      eq(journalEntries.sourceType, 'purchase'),
      eq(journalEntries.sourceId, purchaseId),
    ))
    expect(entries).toHaveLength(1)
    const lotsAfter = await db.select().from(inventoryLots).where(eq(inventoryLots.itemId, row.itemId))
    expect(lotsAfter).toHaveLength(1)
    expect(lotsAfter[0].qtyOnHand).toBe(2)
  })

  it('carries a held receipt at its landed cost exactly once it is approved', async () => {
    await clearPolicies()
    await addPolicy({ kind: 'amount', effect: 'pending', thresholdCents: 0 })
    mockCookie = ownerToken
    const posted = await readJson(await purchasesPOST(postRequest('http://localhost/api/purchases', {
      tenantId, supplier: 'Mill', farmId: farmA, postingDate: '2026-03-14', receivedDate: '2026-03-14',
      lines: [{ itemName: `Held Receipt ${randomUUID().slice(0, 8)}`, unit: 'kg', quantity: 3, unitCostCents: 100, lots: [{ quantity: 1 }, { quantity: 2 }] }],
      charges: [{ kind: 'freight', amountCents: 1 }],
    })))
    expect(posted.status).toBe(201)
    const held = posted.payload.data.purchases[0]
    expect(held.purchase.approvalStatus).toBe('pending')
    expect(held.lots).toEqual([])
    const [approval] = await db.select().from(approvalRequests).where(and(
      eq(approvalRequests.entityId, held.purchase.id),
      eq(approvalRequests.type, 'money_posting'),
    ))
    const approved = await readJson(await approvePOST(
      postRequest(`http://localhost/api/approvals/${approval.id}/approve`, {}),
      { params: Promise.resolve({ id: approval.id }) },
    ))
    expect(approved.status).toBe(200)
    const lots = await db.select().from(inventoryLots).where(eq(inventoryLots.itemId, held.purchase.itemId))
    expect(lots.reduce((sum, lot) => sum + lot.qtyOnHand, 0)).toBe(3)
    // 3 x 100 plus 1 of freight: 301 cents, not 3 x round(100.33) = 300.
    expect(lots.reduce((sum, lot) => sum + lot.qtyOnHand * lot.unitCostCents, 0)).toBe(301)
    await clearPolicies()
  })

  it('does not let a farm line or an account line catch a different one, and an equal amount still posts', async () => {
    await clearPolicies()
    await addPolicy({ kind: 'farm', effect: 'block', thresholdCents: 0, farmId: farmA })
    const otherFarm = await purchase({ itemName: 'South Mash', farmId: farmB, quantity: 1, unitCostCents: 400, amountPaidCents: 400 })
    expect(otherFarm.status).toBe(201)
    expect(otherFarm.payload.data.purchase.approvalStatus).toBeNull()
    const thisFarm = await purchase({ itemName: 'North Mash', farmId: farmA, quantity: 1, unitCostCents: 400, amountPaidCents: 400 })
    expect(thisFarm.status).toBe(400)
    expect(thisFarm.payload.error).toContain('this farm')

    await clearPolicies()
    await addPolicy({ kind: 'account', effect: 'block', thresholdCents: 0, accountCode: '5010' })
    const stock = await purchase({ itemName: 'Still Stock', quantity: 1, unitCostCents: 300, amountPaidCents: 300 })
    expect(stock.status).toBe(201)
    mockCookie = ownerToken
    const transport = await readJson(await expensesPOST(postRequest('http://localhost/api/expenses', {
      tenantId, payee: 'Boda', categoryId: 'expcat-transport', amountCents: 500, amountPaidCents: 500,
      paymentMethod: 'Cash', farmId: farmB, date: '2026-03-18',
    })))
    expect(transport.status).toBe(400)
    expect(transport.payload.error).toContain('account 5010')

    await clearPolicies()
    await addPolicy({ kind: 'amount', effect: 'block', thresholdCents: 10000 })
    const equal = await purchase({ itemName: 'Exact Mash', quantity: 4, unitCostCents: 2500, amountPaidCents: 10000 })
    expect(equal.status).toBe(201)
    expect(equal.payload.data.purchase.approvalStatus).toBeNull()
    const journals = await db.select().from(journalEntries).where(eq(journalEntries.sourceId, equal.payload.data.purchase.id))
    expect(journals).toHaveLength(1)
  })

  it('refuses payment and reversal of a document that is not in the books', async () => {
    await clearPolicies()
    await addPolicy({ kind: 'amount', effect: 'pending', thresholdCents: 0 })
    mockCookie = ownerToken
    const created = await readJson(await expensesPOST(postRequest('http://localhost/api/expenses', {
      tenantId, payee: 'Vet', categoryId: 'expcat-veterinary', amountCents: 800, amountPaidCents: 0,
      paymentMethod: 'Cash', farmId: farmA, date: '2026-03-20',
    })))
    expect(created.status).toBe(201)
    expect(created.payload.data.expense.approvalStatus).toBe('pending')
    const expenseId = created.payload.data.expense.id as string
    const before = await snapshot()
    const paid = await readJson(await expensePayPOST(
      postRequest(`http://localhost/api/expenses/${expenseId}/payments`, {
        tenantId, amountCents: 100, paymentMethod: 'Cash', reason: 'Part pay', date: '2026-03-21',
      }),
      { params: Promise.resolve({ id: expenseId }) },
    ))
    expect(paid.status).toBe(400)
    expect(paid.payload.error).toBe('This expense is not in the books.')
    const reversed = await readJson(await purchaseReversePOST(
      postRequest(`http://localhost/api/purchases/${created.payload.data.expense.id}/reverse`, { tenantId, reason: 'No' }),
      { params: Promise.resolve({ id: expenseId }) },
    ))
    expect(reversed.status).toBe(404)
    const heldPurchase = await purchase({ itemName: 'Unreversed', quantity: 1, unitCostCents: 200, amountPaidCents: 0 })
    expect(heldPurchase.payload.data.purchase.approvalStatus).toBe('pending')
    const purchaseId = heldPurchase.payload.data.purchase.id as string
    const purchaseReversed = await readJson(await purchaseReversePOST(
      postRequest(`http://localhost/api/purchases/${purchaseId}/reverse`, { tenantId, reason: 'No' }),
      { params: Promise.resolve({ id: purchaseId }) },
    ))
    expect(purchaseReversed.status).toBe(400)
    expect(purchaseReversed.payload.error).toBe('This purchase is not in the books.')
    expect(await snapshot()).toEqual(before)
  })

  it('blocks a stock count from a variance policy and still holds on the older column', async () => {
    await clearPolicies()
    const seeded = await purchase({ itemName: 'Counted Bags', quantity: 10, unitCostCents: 100, amountPaidCents: 1000 })
    expect(seeded.status).toBe(201)
    const lotId = seeded.payload.data.lot.id as string
    await addPolicy({ kind: 'variance', effect: 'block', thresholdCents: 0 })
    mockCookie = ownerToken
    const blocked = await readJson(await lotPATCH(
      postRequest(`http://localhost/api/inventory/lots/${lotId}`, { qtyOnHand: 9, reason: 'Short' }, 'PATCH'),
      { params: Promise.resolve({ id: lotId }) },
    ))
    expect(blocked.status).toBe(400)
    expect(blocked.payload.error).toContain('a stock count')
    const [lot] = await db.select().from(inventoryLots).where(eq(inventoryLots.id, lotId))
    expect(lot.qtyOnHand).toBe(10)
    const approvals = await db.select().from(approvalRequests).where(eq(approvalRequests.entityId, lotId))
    expect(approvals).toHaveLength(0)

    await clearPolicies()
    await addPolicy({ kind: 'variance', effect: 'pending', thresholdCents: 1_000_000 })
    mockCookie = ownerToken
    await settingsPATCH(postRequest('http://localhost/api/settings', { varianceApprovalThresholdCents: 100 }, 'PATCH'))
    const held = await readJson(await lotPATCH(
      postRequest(`http://localhost/api/inventory/lots/${lotId}`, {
        qtyOnHand: 8, reason: 'Short again', countedBy: 'Ada', witnessName: 'Bo',
      }, 'PATCH'),
      { params: Promise.resolve({ id: lotId }) },
    ))
    expect(held.status).toBe(200)
    expect(held.payload.data.pending).toBe(true)
    expect(held.payload.data.qtyOnHand).toBe(10)
    const [pending] = await db.select().from(approvalRequests).where(and(
      eq(approvalRequests.entityId, lotId),
      eq(approvalRequests.status, 'pending'),
    ))
    expect(pending.type).toBe('inventory_adjustment')
    await settingsPATCH(postRequest('http://localhost/api/settings', { varianceApprovalThresholdCents: null }, 'PATCH'))
  })

  it('removes a line the owner added', async () => {
    await clearPolicies()
    const added = await addPolicy({ kind: 'amount', effect: 'pending', thresholdCents: 50 })
    expect(added.status).toBe(201)
    mockCookie = ownerToken
    const removed = await readJson(await policiesDELETE(
      new Request(`http://localhost/api/posting-policies/${added.payload.data.id}?tenantId=${tenantId}`, { method: 'DELETE' }),
      { params: Promise.resolve({ id: added.payload.data.id }) },
    ))
    expect(removed.status).toBe(200)
    const listed = await readJson(await policiesGET(new Request(`http://localhost/api/posting-policies?tenantId=${tenantId}`)))
    expect(listed.payload.data).toEqual([])
  })
})
