// Stock adjustments that defend themselves (issue #418).
// The cost impact is the lot's own unit cost times the variance. A farm with
// no approval line still saves immediately. Above the line, the lot does not
// move until the count is approved, and approving it twice does not apply it
// twice. The migration adds a nullable column and does not move a seeded
// period's P&L or trial balance. An adjustment posts no journal.
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

import { PATCH as lotPATCH } from '@/app/api/inventory/lots/[id]/route'
import { GET as settingsGET, PATCH as settingsPATCH } from '@/app/api/settings/route'
import { POST as approvePOST } from '@/app/api/approvals/[id]/approve/route'
import { POST as rejectPOST } from '@/app/api/approvals/[id]/reject/route'
import { POST as purchasesPOST } from '@/app/api/purchases/route'
import { POST as salesPOST } from '@/app/api/data/sales/route'
import { POST as payrollPOST } from '@/app/api/payroll/runs/route'
import { POST as payrollPayPOST } from '@/app/api/payroll/runs/[id]/pay/route'
import { db } from '@/db'
import {
  tenants, users, sessions, employees, payslips, payrollRuns,
  purchases, inventoryLots, inventoryItems, sales, auditLog,
  approvalRequests, notifications, tenantSettings,
  journalEntries, journalLines, journalLineDimensions, documentDimensions,
} from '@/db/schemas'
import { createSession, hashSecret } from '@/lib/auth'
import { computePlReport } from '@/lib/reports'
import { computeTrialBalance } from '@/lib/finance'
import { adjustmentIsHeld, parseInventoryAdjustmentDetails } from '@/lib/inventory-adjustment'

const hasDb = !!process.env.DATABASE_URL
const run = hasDb ? describe : describe.skip

const PERIOD_FROM = new Date('2026-03-01T00:00:00.000Z')
const PERIOD_TO = new Date('2026-03-31T23:59:59.999Z')
const UNIT_COST = 100
const SALE_CENTS = 500000
const LAYER_CENTS = 4 * 2500
const PAYROLL_CENTS = 200000

describe('adjustment hold rule', () => {
  it('holds only an impact strictly above a line that exists', () => {
    expect(adjustmentIsHeld(-1000, null)).toBe(false)
    expect(adjustmentIsHeld(1000, 1000)).toBe(false)
    expect(adjustmentIsHeld(-1000, 1000)).toBe(false)
    expect(adjustmentIsHeld(1001, 1000)).toBe(true)
    expect(adjustmentIsHeld(-1001, 1000)).toBe(true)
    expect(adjustmentIsHeld(1, 0)).toBe(true)
    expect(adjustmentIsHeld(0, 0)).toBe(false)
  })

  it('refuses a proposal whose own figures disagree', () => {
    const good = {
      lotId: 'lot-1', lotNo: 'L-1', beforeQty: 10, qtyOnHand: 8, variance: -2,
      costImpactCents: -200, unitCostCents: 100, reason: 'Recount', adjustmentType: null,
      countedBy: 'Ada', witnessName: 'Bo', photoUrl: null,
    }
    expect(parseInventoryAdjustmentDetails(JSON.stringify(good))?.qtyOnHand).toBe(8)
    expect(parseInventoryAdjustmentDetails(JSON.stringify({ ...good, costImpactCents: -999 }))).toBeNull()
    expect(parseInventoryAdjustmentDetails('not json')).toBeNull()
    expect(parseInventoryAdjustmentDetails('{"lotId":"x"}')).toBeNull()
  })

  it('the migration adds a nullable column and does not rewrite rows', () => {
    const sqlText = readFileSync(join(process.cwd(), 'drizzle/0053_variance_approval_threshold.sql'), 'utf8')
    expect(sqlText).toMatch(/ADD COLUMN IF NOT EXISTS "variance_approval_threshold_cents" bigint/)
    expect(sqlText.toUpperCase()).not.toMatch(/\bUPDATE\b/)
    const journal = JSON.parse(readFileSync(join(process.cwd(), 'drizzle/meta/_journal.json'), 'utf8')) as {
      entries: { idx: number; tag: string }[]
    }
    const entry = journal.entries.find((e) => e.tag === '0053_variance_approval_threshold')
    expect(entry?.idx).toBe(53)
  })
})

describe('adjustment screens say what will happen', () => {
  const inventory = readFileSync(join(process.cwd(), 'components/farm/inventory.tsx'), 'utf8')
  const settings = readFileSync(join(process.cwd(), 'components/farm/settings.tsx'), 'utf8')
  const governance = readFileSync(join(process.cwd(), 'components/farm/governance.tsx'), 'utf8')

  it('shows the cost impact with formatMoney, including a zero variance', () => {
    expect(inventory).toContain('Cost impact')
    expect(inventory).toContain('formatMoney(costImpactCents, threshold.currency)')
    expect(inventory).toContain('Enter a counted quantity to see the variance and the cost impact.')
    expect(inventory).not.toContain('Math.abs(centsToMajor')
    expect(inventory).toContain('Stock will not change until it is approved.')
    expect(inventory).toContain('No approval line is set. This count saves now, whatever it is worth.')
    expect(inventory).toContain('is waiting for approval. Stock has not changed.')
    expect(inventory).toContain('Witness')
    expect(inventory).toContain('size="lg"')
    expect(inventory).not.toMatch(/<select[\s>]/)
    expect(inventory).not.toContain('type="date"')
    expect(inventory).toContain('useRequiredDimensions(')
  })

  it('the approval line is blank until someone sets it', () => {
    expect(settings).toContain('placeholder="No threshold"')
    expect(settings).toContain('Leave this blank and a stock adjustment saves immediately, whatever it is worth.')
    expect(settings).not.toMatch(/<select[\s>]/)
    expect(settings).not.toContain('type="date"')
  })

  it('a stock count is not loaded as a livestock record', () => {
    expect(governance).toContain("approval.type === 'inventory_adjustment'")
    expect(governance).toContain('This proposal could not be read, so the quantities and cost impact are not shown.')
    expect(governance).toContain('What was counted')
  })
})

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

async function applyMigration() {
  const raw = readFileSync(join(process.cwd(), 'drizzle/0053_variance_approval_threshold.sql'), 'utf8')
  const statements = raw.split('--> statement-breakpoint').map((s) => s.trim()).filter(Boolean)
  for (const statement of statements) await db.execute(sql.raw(statement))
}

run('adjustments that defend themselves (issue #418)', () => {
  const tenantId = `t-adj-${randomUUID()}`
  const employeeId = randomUUID()
  let ownerUserId = ''
  let managerUserId = ''
  let ownerToken = ''
  let managerToken = ''
  let countLotId = ''

  async function snapshot() {
    const pl = await computePlReport(tenantId, PERIOD_FROM, PERIOD_TO)
    const tb = await computeTrialBalance(tenantId)
    const journals = await db.select({ id: journalEntries.id }).from(journalEntries).where(eq(journalEntries.tenantId, tenantId))
    return {
      periodRevenue: Number(pl.meta.periodRevenue),
      periodExpense: Number(pl.meta.periodExpense),
      periodPurchaseExpense: Number(pl.meta.periodPurchaseExpense),
      periodPayrollExpense: Number(pl.meta.periodPayrollExpense),
      periodOperatingExpense: Number(pl.meta.periodOperatingExpense),
      totalDebitsCents: tb.totalDebitsCents,
      totalCreditsCents: tb.totalCreditsCents,
      balanced: tb.balanced,
      journalIds: journals.map((r) => r.id).sort(),
    }
  }

  async function qty() {
    const [row] = await db.select().from(inventoryLots).where(eq(inventoryLots.id, countLotId))
    return row.qtyOnHand
  }

  async function approvalsForLot() {
    return db.select().from(approvalRequests).where(eq(approvalRequests.entityId, countLotId))
  }

  function adjust(target: number, extra: Record<string, unknown> = {}) {
    mockCookie = ownerToken
    return lotPATCH(
      patchRequest(`http://localhost/api/inventory/lots/${countLotId}`, {
        qtyOnHand: target,
        reason: 'Physical recount',
        ...extra,
      }),
      { params: Promise.resolve({ id: countLotId }) },
    )
  }

  function setLine(cents: number | null) {
    mockCookie = ownerToken
    return settingsPATCH(patchRequest('http://localhost/api/settings', { varianceApprovalThresholdCents: cents }))
  }

  beforeAll(async () => {
    await applyMigration()
    await db.insert(tenants).values({ id: tenantId, name: 'Adjustment Test Co.', active: true })
    const salt = randomUUID()
    ownerUserId = randomUUID()
    managerUserId = randomUUID()
    await db.insert(users).values([
      {
        id: ownerUserId, tenantId, name: 'Adjustment Owner', email: `owner-adj-${randomUUID()}@test.ifms`,
        role: 'owner', passwordHash: hashSecret('pw', salt), passwordSalt: salt, status: 'ACTIVE',
      },
      {
        id: managerUserId, tenantId, name: 'Adjustment Manager', email: `manager-adj-${randomUUID()}@test.ifms`,
        role: 'manager', passwordHash: hashSecret('pw', salt), passwordSalt: salt, status: 'ACTIVE',
      },
    ])
    ownerToken = await createSession(ownerUserId)
    managerToken = await createSession(managerUserId)
    await db.insert(employees).values({
      id: employeeId, tenantId, name: 'March Hand', phone: '', role: 'worker',
      monthlySalaryCents: PAYROLL_CENTS, status: 'ACTIVE',
    })
    mockCookie = ownerToken
    const sale = await readJson(await salesPOST(postRequest('http://localhost/api/data/sales', {
      tenantId, item: 'Eggs', amountCents: SALE_CENTS, method: 'Cash', status: 'paid',
      soldAt: '2026-03-10', postingDate: '2026-03-10',
    })))
    expect(sale.status).toBe(201)
    const layer = await readJson(await purchasesPOST(postRequest('http://localhost/api/purchases', {
      tenantId, supplier: 'Unga Ltd', itemName: 'Layer Mash', unit: 'kg', quantity: 4,
      unitCostCents: 2500, amountPaidCents: LAYER_CENTS,
      transactionDate: '2026-03-12', postingDate: '2026-03-12', receivedDate: '2026-03-12',
    })))
    expect(layer.status).toBe(201)
    const bags = await readJson(await purchasesPOST(postRequest('http://localhost/api/purchases', {
      tenantId, supplier: 'Sack Co', itemName: 'Count Bags', unit: 'bag', quantity: 100,
      unitCostCents: UNIT_COST, amountPaidCents: 100 * UNIT_COST,
      transactionDate: '2026-03-12', postingDate: '2026-03-12', receivedDate: '2026-03-12',
    })))
    expect(bags.status).toBe(201)
    countLotId = bags.payload.data.lot.id as string
    expect(bags.payload.data.lot.qtyOnHand).toBe(100)
    expect(bags.payload.data.lot.unitCostCents).toBe(UNIT_COST)
    const payroll = await readJson(await payrollPOST(postRequest('http://localhost/api/payroll/runs', {
      tenantId, periodStart: '2026-03-01', periodEnd: '2026-03-31', memo: 'March wages',
      employees: [{ employeeId }],
    })))
    expect(payroll.status).toBe(201)
    const payrollPaid = await readJson(await payrollPayPOST(postRequest('http://localhost/api/payroll/runs/pay', {
      tenantId, confirmation: 'PAY', payDate: '2026-03-31', paymentMethod: 'Cash', paymentReference: 'MARCH-WAGES',
    }), { params: Promise.resolve({ id: payroll.payload.data.run.id }) }))
    expect(payrollPaid.status).toBe(200)
  })

  afterAll(async () => {
    const entryIds = (await db.select({ id: journalEntries.id }).from(journalEntries).where(eq(journalEntries.tenantId, tenantId))).map((r) => r.id)
    if (entryIds.length > 0) {
      const lineIds = (await db.select({ id: journalLines.id }).from(journalLines).where(inArray(journalLines.entryId, entryIds))).map((r) => r.id)
      if (lineIds.length > 0) await db.delete(journalLineDimensions).where(inArray(journalLineDimensions.lineId, lineIds))
      await db.delete(journalLines).where(inArray(journalLines.entryId, entryIds))
      await db.delete(journalEntries).where(inArray(journalEntries.id, entryIds))
    }
    await db.delete(documentDimensions).where(eq(documentDimensions.tenantId, tenantId))
    await db.delete(notifications).where(eq(notifications.tenantId, tenantId))
    await db.delete(approvalRequests).where(eq(approvalRequests.tenantId, tenantId))
    await db.delete(auditLog).where(eq(auditLog.tenantId, tenantId))
    await db.delete(payslips).where(eq(payslips.tenantId, tenantId))
    await db.delete(payrollRuns).where(eq(payrollRuns.tenantId, tenantId))
    await db.delete(purchases).where(eq(purchases.tenantId, tenantId))
    await db.delete(inventoryLots).where(eq(inventoryLots.tenantId, tenantId))
    await db.delete(inventoryItems).where(eq(inventoryItems.tenantId, tenantId))
    await db.delete(sales).where(eq(sales.tenantId, tenantId))
    await db.delete(employees).where(eq(employees.tenantId, tenantId))
    await db.delete(tenantSettings).where(eq(tenantSettings.tenantId, tenantId))
    const userIds = [ownerUserId, managerUserId].filter(Boolean)
    if (userIds.length > 0) {
      await db.delete(sessions).where(inArray(sessions.userId, userIds))
      await db.delete(users).where(inArray(users.id, userIds))
    }
    await db.delete(tenants).where(eq(tenants.id, tenantId))
    mockCookie = undefined
  })

  it('a tenant with no settings row has no approval line', async () => {
    mockCookie = ownerToken
    const { status, payload } = await readJson(await settingsGET(new Request('http://localhost/api/settings')))
    expect(status).toBe(200)
    expect(payload.data.varianceApprovalThresholdCents).toBeNull()
  })

  it('re-applying the migration does not move the seeded period', async () => {
    const before = await snapshot()
    expect(before.periodRevenue).toBe(SALE_CENTS / 100)
    expect(before.periodPurchaseExpense).toBe((LAYER_CENTS + 100 * UNIT_COST) / 100)
    expect(before.periodPayrollExpense).toBe(PAYROLL_CENTS / 100)
    expect(before.periodOperatingExpense).toBe(0)
    expect(before.periodExpense).toBe(before.periodPurchaseExpense + before.periodPayrollExpense)
    expect(before.balanced).toBe(true)
    expect(before.totalDebitsCents).toBe(before.totalCreditsCents)
    await applyMigration()
    await applyMigration()
    expect(await snapshot()).toEqual(before)
  })

  it('with no line, a count saves immediately and the books do not move', async () => {
    expect((await readJson(await setLine(null))).payload.data.varianceApprovalThresholdCents).toBeNull()
    const before = await snapshot()
    const beforeQty = await qty()
    const target = beforeQty - 10
    const { status, payload } = await readJson(await adjust(target))
    expect(status).toBe(200)
    expect(payload.data.pending).toBe(false)
    expect(payload.data.costImpactCents).toBe((target - beforeQty) * UNIT_COST)
    expect(payload.data.qtyOnHand).toBe(target)
    expect(await qty()).toBe(target)
    expect(await approvalsForLot()).toHaveLength(0)
    expect(await snapshot()).toEqual(before)
  })

  it('an impact equal to the line saves immediately', async () => {
    const line = await readJson(await setLine(10 * UNIT_COST))
    expect(line.status).toBe(200)
    expect(line.payload.data.varianceApprovalThresholdCents).toBe(10 * UNIT_COST)
    const before = await snapshot()
    const beforeQty = await qty()
    const target = beforeQty - 10
    const { status, payload } = await readJson(await adjust(target, { countedBy: 'Sam', witnessName: 'Sam' }))
    expect(status).toBe(200)
    expect(payload.data.pending).toBe(false)
    expect(payload.data.costImpactCents).toBe(-10 * UNIT_COST)
    expect(await qty()).toBe(target)
    expect((await approvalsForLot()).filter((a) => a.status === 'pending')).toHaveLength(0)
    expect(await snapshot()).toEqual(before)
  })

  it('above the line, a missing or identical witness is refused and the lot stays', async () => {
    expect((await readJson(await setLine(10 * UNIT_COST))).status).toBe(200)
    const beforeQty = await qty()
    const target = beforeQty - 11
    const books = await snapshot()
    const missingCounter = await readJson(await adjust(target, { witnessName: 'Bo' }))
    expect(missingCounter.status).toBe(400)
    expect(missingCounter.payload.error).toBe('Name the person who counted.')
    const missingWitness = await readJson(await adjust(target, { countedBy: 'Ada' }))
    expect(missingWitness.status).toBe(400)
    expect(missingWitness.payload.error).toMatch(/witness/i)
    const samePerson = await readJson(await adjust(target, { countedBy: 'Ada', witnessName: ' ada ' }))
    expect(samePerson.status).toBe(400)
    expect(samePerson.payload.error).toBe('The witness has to be a different person from the one who counted.')
    expect(await qty()).toBe(beforeQty)
    expect((await approvalsForLot()).filter((a) => a.status === 'pending')).toHaveLength(0)
    expect(await snapshot()).toEqual(books)
  })

  it('above the line, the lot waits and one approval applies the counted quantity once', async () => {
    expect((await readJson(await setLine(10 * UNIT_COST))).status).toBe(200)
    const beforeQty = await qty()
    const target = beforeQty - 11
    const books = await snapshot()
    const filed = await readJson(await adjust(target, { countedBy: 'Ada', witnessName: 'Bo', adjustmentType: 'count' }))
    expect(filed.status).toBe(200)
    expect(filed.payload.data.pending).toBe(true)
    expect(filed.payload.data.qtyOnHand).toBe(beforeQty)
    expect(filed.payload.data.costImpactCents).toBe((target - beforeQty) * UNIT_COST)
    expect(await qty()).toBe(beforeQty)
    const pending = (await approvalsForLot()).filter((a) => a.status === 'pending')
    expect(pending).toHaveLength(1)
    expect(pending[0].type).toBe('inventory_adjustment')
    const proposal = parseInventoryAdjustmentDetails(pending[0].details)
    expect(proposal?.beforeQty).toBe(beforeQty)
    expect(proposal?.qtyOnHand).toBe(target)
    expect(proposal?.countedBy).toBe('Ada')
    expect(proposal?.witnessName).toBe('Bo')
    const pendingAudit = await db.select().from(auditLog).where(eq(auditLog.entityId, countLotId))
    expect(pendingAudit.some((a) => a.action === 'inventory.adjust.pending')).toBe(true)
    expect(await snapshot()).toEqual(books)

    mockCookie = ownerToken
    const approved = await readJson(await approvePOST(
      postRequest(`http://localhost/api/approvals/${pending[0].id}/approve`, {}),
      { params: Promise.resolve({ id: pending[0].id }) },
    ))
    expect(approved.status).toBe(200)
    expect(await qty()).toBe(target)
    const applied = await db.select().from(auditLog).where(eq(auditLog.entityId, countLotId))
    const adjustRow = applied.find((a) => a.action === 'inventory.adjust' && (a.meta as { approvalId?: string } | null)?.approvalId === pending[0].id)
    expect(adjustRow?.meta).toMatchObject({ before: beforeQty, after: target, countedBy: 'Ada', witnessName: 'Bo' })
    expect(await snapshot()).toEqual(books)

    const again = await readJson(await approvePOST(
      postRequest(`http://localhost/api/approvals/${pending[0].id}/approve`, {}),
      { params: Promise.resolve({ id: pending[0].id }) },
    ))
    expect(again.status).toBe(409)
    expect(await qty()).toBe(target)
    expect(await snapshot()).toEqual(books)
  })

  it('rejecting leaves the lot and requires a reason', async () => {
    expect((await readJson(await setLine(10 * UNIT_COST))).status).toBe(200)
    const beforeQty = await qty()
    const target = beforeQty - 11
    const filed = await readJson(await adjust(target, { countedBy: 'Ada', witnessName: 'Bo' }))
    expect(filed.payload.data.pending).toBe(true)
    const approvalId = filed.payload.data.approvalId as string
    mockCookie = ownerToken
    const noReason = await readJson(await rejectPOST(
      postRequest(`http://localhost/api/approvals/${approvalId}/reject`, {}),
      { params: Promise.resolve({ id: approvalId }) },
    ))
    expect(noReason.status).toBe(400)
    expect(await qty()).toBe(beforeQty)
    const rejected = await readJson(await rejectPOST(
      postRequest(`http://localhost/api/approvals/${approvalId}/reject`, { reason: 'Count the row again' }),
      { params: Promise.resolve({ id: approvalId }) },
    ))
    expect(rejected.status).toBe(200)
    expect(await qty()).toBe(beforeQty)
    const [row] = await db.select().from(approvalRequests).where(eq(approvalRequests.id, approvalId))
    expect(row.status).toBe('rejected')
    expect(row.decisionNote).toBe('Count the row again')
  })

  it('refuses to apply a count after the lot quantity has moved', async () => {
    expect((await readJson(await setLine(10 * UNIT_COST))).status).toBe(200)
    const beforeQty = await qty()
    const filed = await readJson(await adjust(beforeQty - 11, { countedBy: 'Ada', witnessName: 'Bo' }))
    const approvalId = filed.payload.data.approvalId as string
    await db.update(inventoryLots).set({ qtyOnHand: beforeQty - 1 }).where(eq(inventoryLots.id, countLotId))
    mockCookie = ownerToken
    const decided = await readJson(await approvePOST(
      postRequest(`http://localhost/api/approvals/${approvalId}/approve`, {}),
      { params: Promise.resolve({ id: approvalId }) },
    ))
    expect(decided.status).toBe(409)
    expect(decided.payload.error).toBe('The lot quantity changed after this count was submitted. Reject it and count again.')
    expect(await qty()).toBe(beforeQty - 1)
    const [row] = await db.select().from(approvalRequests).where(eq(approvalRequests.id, approvalId))
    expect(row.status).toBe('pending')
  })

  it('a line of zero holds any non-zero impact and still saves a zero variance', async () => {
    const line = await readJson(await setLine(0))
    expect(line.payload.data.varianceApprovalThresholdCents).toBe(0)
    const beforeQty = await qty()
    const refused = await readJson(await adjust(beforeQty - 1))
    expect(refused.status).toBe(400)
    expect(await qty()).toBe(beforeQty)
    const books = await snapshot()
    const same = await readJson(await adjust(beforeQty))
    expect(same.status).toBe(200)
    expect(same.payload.data.pending).toBe(false)
    expect(same.payload.data.costImpactCents).toBe(0)
    expect(await qty()).toBe(beforeQty)
    expect(await snapshot()).toEqual(books)
  })

  it('rejects a negative or non-integer line and can clear one back to nothing', async () => {
    const set = await readJson(await setLine(5000))
    expect(set.status).toBe(200)
    const negative = await readJson(await setLine(-1))
    expect(negative.status).toBe(400)
    const fractional = await readJson(await setLine(10.5 as unknown as number))
    expect(fractional.status).toBe(400)
    mockCookie = ownerToken
    const text = await readJson(await settingsPATCH(patchRequest('http://localhost/api/settings', { varianceApprovalThresholdCents: '5000' })))
    expect(text.status).toBe(400)
    const still = await readJson(await settingsGET(new Request('http://localhost/api/settings')))
    expect(still.payload.data.varianceApprovalThresholdCents).toBe(5000)
    const currency = await readJson(await settingsPATCH(patchRequest('http://localhost/api/settings', { currencySymbol: 'KSh' })))
    expect(currency.status).toBe(200)
    expect(currency.payload.data.varianceApprovalThresholdCents).toBe(5000)
    mockCookie = managerToken
    const manager = await readJson(await settingsPATCH(patchRequest('http://localhost/api/settings', { varianceApprovalThresholdCents: 1 })))
    expect(manager.status).toBe(403)
    mockCookie = ownerToken
    const cleared = await readJson(await setLine(null))
    expect(cleared.status).toBe(200)
    expect(cleared.payload.data.varianceApprovalThresholdCents).toBeNull()
    const after = await readJson(await settingsGET(new Request('http://localhost/api/settings')))
    expect(after.payload.data.varianceApprovalThresholdCents).toBeNull()
  })
})
