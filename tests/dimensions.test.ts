// ── Analytical dimensions tests (dimensions-on-gl task) ─────────────────────
// Integration tests against the real Postgres (skipped when DATABASE_URL is
// unset, same convention as tests/finance.test.ts). Covers the three things
// the task's brief calls out explicitly:
//   1. dimension-value tenant/dimension validation (the cross-tenant hole)
//   2. required-dimension enforcement at posting (refuse, don't post unanalysed)
//   3. level roll-up arithmetic (computeDimensionPlReport)
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { eq, and, inArray } from 'drizzle-orm'

vi.mock('server-only', () => ({}))

import { db } from '@/db'
import {
  tenants, farms, productionUnits, batches, dimensions, dimensionLevels, dimensionValues, defaultDimensions,
  documentDimensions, journalEntries, journalLines, journalLineDimensions, accounts,
} from '@/db/schemas'
import {
  ensureSystemDimensions, projectFarm, projectUnit, projectBatch, validateDimensionValue,
  DimensionRequirementError, SYSTEM_DIMENSION_CODES,
} from '@/lib/dimensions'
import { ensureAccountsSeeded, recordSale, ACCOUNT_CODES } from '@/lib/finance'
import { computeDimensionPlReport } from '@/lib/reports'

const hasDb = !!process.env.DATABASE_URL
const run = hasDb ? describe : describe.skip

async function makeTenant(name: string): Promise<string> {
  const id = `t-dim-${randomUUID()}`
  await db.insert(tenants).values({ id, name, active: true })
  return id
}

async function cleanupTenant(tenantId: string) {
  const entryRows = await db.select({ id: journalEntries.id }).from(journalEntries).where(eq(journalEntries.tenantId, tenantId))
  const entryIds = entryRows.map((r) => r.id)
  const lineRows = entryIds.length > 0
    ? await db.select({ id: journalLines.id }).from(journalLines).where(inArray(journalLines.entryId, entryIds))
    : []
  const lineIds = lineRows.map((l) => l.id)
  if (lineIds.length > 0) await db.delete(journalLineDimensions).where(inArray(journalLineDimensions.lineId, lineIds))

  const dimRows = await db.select({ id: dimensions.id }).from(dimensions).where(eq(dimensions.tenantId, tenantId))
  const dimIds = dimRows.map((d) => d.id)
  await db.delete(defaultDimensions).where(eq(defaultDimensions.tenantId, tenantId))
  await db.delete(documentDimensions).where(eq(documentDimensions.tenantId, tenantId))
  if (dimIds.length > 0) {
    const valueRows = await db.select({ id: dimensionValues.id }).from(dimensionValues).where(inArray(dimensionValues.dimensionId, dimIds))
    const valueIds = valueRows.map((v) => v.id)
    if (valueIds.length > 0) {
      await db.delete(journalLineDimensions).where(inArray(journalLineDimensions.valueId, valueIds))
      await db.delete(documentDimensions).where(inArray(documentDimensions.valueId, valueIds))
    }
    await db.delete(dimensionLevels).where(inArray(dimensionLevels.dimensionId, dimIds))
    await db.delete(dimensionValues).where(inArray(dimensionValues.dimensionId, dimIds))
  }
  await db.delete(dimensions).where(eq(dimensions.tenantId, tenantId))
  if (lineIds.length > 0) await db.delete(journalLines).where(inArray(journalLines.id, lineIds))
  await db.delete(journalEntries).where(eq(journalEntries.tenantId, tenantId))
  await db.delete(batches).where(eq(batches.tenantId, tenantId))
  await db.delete(productionUnits).where(eq(productionUnits.tenantId, tenantId))
  await db.delete(farms).where(eq(farms.tenantId, tenantId))
  await db.delete(tenants).where(eq(tenants.id, tenantId))
}

run('dimensions: tenant/dimension validation, required enforcement, level roll-up', () => {
  describe('validateDimensionValue: closes the cross-tenant and cross-dimension holes', () => {
    let tenantA: string
    let tenantB: string

    beforeAll(async () => {
      tenantA = await makeTenant('Dimension Test A')
      tenantB = await makeTenant('Dimension Test B')
      await db.insert(farms).values({ id: `f-${randomUUID()}`, tenantId: tenantA, name: 'Farm A1', code: 'FRM-AAA-001' })
    })
    afterAll(async () => {
      await cleanupTenant(tenantA)
      await cleanupTenant(tenantB)
    })

    it('a real value validates against its own tenant and dimension', async () => {
      const farmRows = await db.select().from(farms).where(eq(farms.tenantId, tenantA))
      const farm = farmRows[0]
      const value = await projectFarm(db, tenantA, farm)
      const farmDimId = (await ensureSystemDimensions(tenantA)).get(SYSTEM_DIMENSION_CODES.FARM)!

      const result = await validateDimensionValue(tenantA, farmDimId, value.id)
      expect(result.ok).toBe(true)
    })

    it('refuses a value that belongs to a DIFFERENT tenant (cross-tenant hole)', async () => {
      const farmRows = await db.select().from(farms).where(eq(farms.tenantId, tenantA))
      const value = await projectFarm(db, tenantA, farmRows[0])
      const farmDimIdA = (await ensureSystemDimensions(tenantA)).get(SYSTEM_DIMENSION_CODES.FARM)!

      // Tenant B claims tenant A's real farm-dimension value under tenant B.
      const result = await validateDimensionValue(tenantB, farmDimIdA, value.id)
      expect(result.ok).toBe(false)
    })

    it('refuses a value claimed under the WRONG dimension of the same tenant', async () => {
      const farmRows = await db.select().from(farms).where(eq(farms.tenantId, tenantA))
      const value = await projectFarm(db, tenantA, farmRows[0])
      const unitDimIdA = (await ensureSystemDimensions(tenantA)).get(SYSTEM_DIMENSION_CODES.UNIT)!

      // A real FARM value, claimed as if it were a UNIT value — same tenant, wrong axis.
      const result = await validateDimensionValue(tenantA, unitDimIdA, value.id)
      expect(result.ok).toBe(false)
    })

    it('refuses an archived value', async () => {
      const farmRows = await db.select().from(farms).where(eq(farms.tenantId, tenantA))
      const value = await projectFarm(db, tenantA, farmRows[0])
      const farmDimIdA = (await ensureSystemDimensions(tenantA)).get(SYSTEM_DIMENSION_CODES.FARM)!
      await db.update(dimensionValues).set({ archived: true }).where(eq(dimensionValues.id, value.id))

      const result = await validateDimensionValue(tenantA, farmDimIdA, value.id)
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error).toMatch(/archived/i)

      // Restore for any later test in this block relying on a live value.
      await db.update(dimensionValues).set({ archived: false }).where(eq(dimensionValues.id, value.id))
    })
  })

  describe('required-dimension enforcement at posting: refuse rather than post unanalysed', () => {
    let tenantId: string

    beforeAll(async () => {
      tenantId = await makeTenant('Dimension Test Required')
      await ensureAccountsSeeded()
    })
    afterAll(async () => {
      await cleanupTenant(tenantId)
    })

    it('refuses a sale when the debited account requires a Farm dimension and none can be derived', async () => {
      const idByCode = await ensureSystemDimensions(tenantId)
      const farmDimId = idByCode.get(SYSTEM_DIMENSION_CODES.FARM)!
      const cashAccount = (await db.select().from(accounts).where(eq(accounts.code, ACCOUNT_CODES.CASH)))[0]

      // Cash requires the Farm dimension for this tenant, with no default —
      // exactly the owner's example ("a posting to an account whose Farm
      // dimension is required must refuse without one").
      await db.insert(defaultDimensions).values({
        id: randomUUID(), tenantId, masterType: 'account', masterId: cashAccount.id,
        dimensionId: farmDimId, dimensionValueId: null, requirement: 'required',
      })

      // An ad-hoc cash sale with no batchId: nothing to derive a Farm from.
      await expect(
        recordSale({ tenantId, item: 'Loose eggs', amountCents: 50000, status: 'paid' }),
      ).rejects.toThrow(DimensionRequirementError)

      // Refused means refused — no half-posted journal entry left behind.
      const entries = await db.select().from(journalEntries).where(eq(journalEntries.tenantId, tenantId))
      expect(entries.length).toBe(0)
    })

    it('succeeds once the Farm can be derived from the sale\'s batch (batch -> unit -> farm)', async () => {
      const farm = { id: randomUUID(), tenantId, name: 'Derivation Farm', code: 'FRM-DRV-001' }
      await db.insert(farms).values(farm)
      await projectFarm(db, tenantId, farm)

      const unit = { id: randomUUID(), tenantId, farmId: farm.id, type: 'broiler', name: 'House 1', code: 'HSE-DRV-001' }
      await db.insert(productionUnits).values(unit)
      await projectUnit(db, tenantId, unit)

      const batch = { id: randomUUID(), tenantId, unitId: unit.id, code: 'BRO-DRV-001', name: 'Batch 1', enterprise: 'broiler' }
      await db.insert(batches).values(batch)
      await projectBatch(db, tenantId, batch)

      const sale = await recordSale({ tenantId, batchId: batch.id, item: 'Broilers x 10', amountCents: 200000, status: 'paid' })
      expect(sale.id).toBeTruthy()

      const idByCode = await ensureSystemDimensions(tenantId)
      const farmDimId = idByCode.get(SYSTEM_DIMENSION_CODES.FARM)!
      const cashAccount = (await db.select().from(accounts).where(eq(accounts.code, ACCOUNT_CODES.CASH)))[0]

      const entryRows = await db.select().from(journalEntries).where(and(eq(journalEntries.tenantId, tenantId), eq(journalEntries.sourceId, sale.id)))
      expect(entryRows.length).toBe(1)
      // journal_entries.farmId is set directly from the batch's farm too.
      expect(entryRows[0].farmId).toBe(farm.id)

      const lineRows = await db.select().from(journalLines).where(eq(journalLines.entryId, entryRows[0].id))
      const cashLine = lineRows.find((l) => l.accountId === cashAccount.id)!
      const lineDims = await db.select().from(journalLineDimensions).where(eq(journalLineDimensions.lineId, cashLine.id))
      const farmDim = lineDims.find((d) => d.dimensionId === farmDimId)
      expect(farmDim).toBeTruthy()

      const farmValueRows = await db.select().from(dimensionValues).where(eq(dimensionValues.id, farmDim!.valueId))
      expect(farmValueRows[0].sourceId).toBe(farm.id)
    })
  })

  describe('computeDimensionPlReport: level roll-up arithmetic', () => {
    let tenantId: string
    let dimensionId: string
    let parentValueId: string
    let childAId: string
    let childBId: string
    let revenueAccountId: string
    let expenseAccountId: string

    beforeAll(async () => {
      tenantId = await makeTenant('Dimension Test Rollup')
      await ensureAccountsSeeded()
      revenueAccountId = (await db.select().from(accounts).where(eq(accounts.code, ACCOUNT_CODES.SALES_REVENUE)))[0].id
      expenseAccountId = (await db.select().from(accounts).where(eq(accounts.code, ACCOUNT_CODES.PURCHASES_EXPENSE)))[0].id

      // A 2-level user-defined dimension: "Batch Group" (level 1) / "Sub-group" (level 2).
      dimensionId = randomUUID()
      await db.insert(dimensions).values({ id: dimensionId, tenantId, code: 'BGRP', name: 'Batch Group', levelCount: 2, isSystem: false, sortOrder: 100 })

      parentValueId = randomUUID()
      await db.insert(dimensionValues).values({ id: parentValueId, dimensionId, tenantId, code: 'P1', name: 'Parent One', levelOrdinal: 1, parentValueId: null })
      childAId = randomUUID()
      childBId = randomUUID()
      await db.insert(dimensionValues).values([
        { id: childAId, dimensionId, tenantId, code: 'C1', name: 'Child One', levelOrdinal: 2, parentValueId },
        { id: childBId, dimensionId, tenantId, code: 'C2', name: 'Child Two', levelOrdinal: 2, parentValueId },
      ])

      // Two journal entries, each with a revenue line and an expense line —
      // one analysed under C1, one under C2, one line left UNANALYSED.
      async function postEntry(sourceId: string, revenueCents: number, expenseCents: number, valueId: string | null) {
        const [entry] = await db.insert(journalEntries).values({ id: randomUUID(), tenantId, sourceType: 'sale', sourceId, memo: 'test' }).returning()
        const [revLine] = await db.insert(journalLines).values({ id: randomUUID(), entryId: entry.id, accountId: revenueAccountId, debitCents: 0, creditCents: revenueCents }).returning()
        const [expLine] = await db.insert(journalLines).values({ id: randomUUID(), entryId: entry.id, accountId: expenseAccountId, debitCents: expenseCents, creditCents: 0 }).returning()
        if (valueId) {
          await db.insert(journalLineDimensions).values([
            { id: randomUUID(), lineId: revLine.id, dimensionId, valueId },
            { id: randomUUID(), lineId: expLine.id, dimensionId, valueId },
          ])
        }
      }
      await postEntry('sale-c1', 100000, 30000, childAId) // net 70000 under C1
      await postEntry('sale-c2', 50000, 10000, childBId) // net 40000 under C2
      await postEntry('sale-unanalysed', 20000, 5000, null) // net 15000, no dimension row at all
    })
    afterAll(async () => {
      await cleanupTenant(tenantId)
    })

    it('level 2 (no roll-up): C1 and C2 report their own independent totals', async () => {
      const report = await computeDimensionPlReport(tenantId, 'BGRP', 2, null, null)
      const byCode = new Map(report.rows.map((r) => [r[0], r]))
      const c1 = byCode.get('C1')!
      const c2 = byCode.get('C2')!
      expect(c1[2]).toBe(1000) // revenue major units (100000 cents)
      expect(c1[3]).toBe(300) // expense
      expect(c1[4]).toBe(700) // net
      expect(c2[2]).toBe(500)
      expect(c2[3]).toBe(100)
      expect(c2[4]).toBe(400)
    })

    it('level 1 (roll-up): C1 + C2 collapse into their parent P1, summed', async () => {
      const report = await computeDimensionPlReport(tenantId, 'BGRP', 1, null, null)
      const byCode = new Map(report.rows.map((r) => [r[0], r]))
      // Only ONE row for the parent — C1/C2 do not appear as their own rows.
      expect(byCode.has('C1')).toBe(false)
      expect(byCode.has('C2')).toBe(false)
      const p1 = byCode.get('P1')!
      expect(p1[2]).toBe(1500) // 1000 + 500
      expect(p1[3]).toBe(400) // 300 + 100
      expect(p1[4]).toBe(1100) // 700 + 400
    })

    it('lines with no dimension row at all are reported as an honest "Unanalysed" bucket, never dropped or guessed', async () => {
      const report = await computeDimensionPlReport(tenantId, 'BGRP', 1, null, null)
      const unanalysedRow = report.rows.find((r) => r[1] === 'Unanalysed (posted before dimensions existed)')
      expect(unanalysedRow).toBeTruthy()
      expect(unanalysedRow![2]).toBe(200) // 20000 cents
      expect(unanalysedRow![3]).toBe(50)
      expect(unanalysedRow![4]).toBe(150)

      // Totals include it — the money is real even though its dimension isn't known.
      expect(report.meta.totalRevenue).toBe(1700) // 1500 + 200
      expect(report.meta.totalExpense).toBe(450) // 400 + 50
      expect(report.meta.totalNet).toBe(1250)
    })
  })
})
