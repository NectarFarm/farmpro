// ── Analytical dimensions: operable-feature tests (dimensions-operable task)
// Integration tests against the real Postgres (skipped when DATABASE_URL is
// unset, same convention as tests/dimensions.test.ts). This file covers what
// the ORIGINAL dimensions-on-gl task shipped no UI or route surface for:
//   1. Default Dimensions writing the right `requirement` value (the
//      Required Dimensions panel's whole job — POST /api/dimensions/defaults
//      with masterType 'account').
//   2. Editing/archiving a user-defined dimension and its values via the new
//      PATCH routes, and the system-dimension/projected-value refusals.
//   3. The resolve-preview endpoint a sale/purchase form calls before
//      submitting (owner addition 2026-09-20: "proper linkage").
//   4. The for-document read-back endpoint a journal/sale/purchase detail
//      view calls to show how a posting was actually analysed.
//   5. An archived dimension stops applying to new postings but a value
//      posted against it before archiving keeps its history.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { eq, inArray } from 'drizzle-orm'

vi.mock('server-only', () => ({}))

let mockCookie: string | undefined
vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({ get: () => (mockCookie ? { value: mockCookie } : undefined) })),
}))

import { db } from '@/db'
import {
  tenants, users, sessions, farms, productionUnits, batches, dimensions, dimensionLevels, dimensionValues,
  defaultDimensions, documentDimensions, journalEntries, journalLines, journalLineDimensions, accounts, sales,
} from '@/db/schemas'
import { createSession, hashSecret } from '@/lib/auth'
import { ensureSystemDimensions, projectFarm, projectUnit, projectBatch, SYSTEM_DIMENSION_CODES } from '@/lib/dimensions'
import { ensureAccountsSeeded, recordSale, ACCOUNT_CODES } from '@/lib/finance'
import { PATCH as dimensionPATCH } from '@/app/api/dimensions/[id]/route'
import { PATCH as valuePATCH } from '@/app/api/dimensions/[id]/values/[valueId]/route'
import { POST as dimensionsPOST } from '@/app/api/dimensions/route'
import { POST as defaultsPOST } from '@/app/api/dimensions/defaults/route'
import { POST as resolvePOST } from '@/app/api/dimensions/resolve/route'
import { GET as forDocumentGET } from '@/app/api/dimensions/for-document/route'

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

async function makeTenantWithOwner(name: string): Promise<{ tenantId: string; cookie: string }> {
  const tenantId = `t-dimop-${randomUUID()}`
  await db.insert(tenants).values({ id: tenantId, name, active: true })
  const ownerId = `usr-${randomUUID()}`
  const salt = randomUUID()
  await db.insert(users).values({
    id: ownerId, tenantId, name: 'Owner', email: `dimop-${randomUUID()}@test.ifms`, role: 'owner',
    passwordHash: hashSecret('pw', salt), passwordSalt: salt, status: 'ACTIVE',
  })
  const cookie = await createSession(ownerId)
  return { tenantId, cookie }
}

async function cleanupTenant(tenantId: string) {
  const entryRows = await db.select({ id: journalEntries.id }).from(journalEntries).where(eq(journalEntries.tenantId, tenantId))
  const entryIds = entryRows.map((r) => r.id)
  const lineRows = entryIds.length > 0 ? await db.select({ id: journalLines.id }).from(journalLines).where(inArray(journalLines.entryId, entryIds)) : []
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
  await db.delete(sales).where(eq(sales.tenantId, tenantId))
  await db.delete(batches).where(eq(batches.tenantId, tenantId))
  await db.delete(productionUnits).where(eq(productionUnits.tenantId, tenantId))
  await db.delete(farms).where(eq(farms.tenantId, tenantId))
  const userRows = await db.select({ id: users.id }).from(users).where(eq(users.tenantId, tenantId))
  const userIds = userRows.map((u) => u.id)
  if (userIds.length > 0) await db.delete(sessions).where(inArray(sessions.userId, userIds))
  await db.delete(users).where(eq(users.tenantId, tenantId))
  await db.delete(tenants).where(eq(tenants.id, tenantId))
}

run('Default Dimensions UI: requirement written correctly (POST /api/dimensions/defaults)', () => {
  let tenantId: string; let cookie: string

  beforeAll(async () => {
    ({ tenantId, cookie } = await makeTenantWithOwner('DimOp Requirement'))
    mockCookie = cookie
    await ensureAccountsSeeded()
    await ensureSystemDimensions(tenantId)
  })
  afterAll(async () => { await cleanupTenant(tenantId); mockCookie = undefined })

  async function accountId(code: string): Promise<string> {
    return (await db.select().from(accounts).where(eq(accounts.code, code)).limit(1))[0].id
  }

  it('Yes writes requirement "required" on the account row', async () => {
    const res = await defaultsPOST(jsonRequest('http://x/api/dimensions/defaults', 'POST', {
      tenantId, masterType: 'account', masterId: await accountId(ACCOUNT_CODES.SALES_REVENUE), dimensionCode: SYSTEM_DIMENSION_CODES.FARM, requirement: 'required',
    }))
    const { status, payload } = await readJson(res)
    expect(status).toBe(200)
    expect(payload.data.requirement).toBe('required')
  })

  it('No writes requirement "optional"', async () => {
    const res = await defaultsPOST(jsonRequest('http://x/api/dimensions/defaults', 'POST', {
      tenantId, masterType: 'account', masterId: await accountId(ACCOUNT_CODES.PURCHASES_EXPENSE), dimensionCode: SYSTEM_DIMENSION_CODES.FARM, requirement: 'optional',
    }))
    const { status, payload } = await readJson(res)
    expect(status).toBe(200)
    expect(payload.data.requirement).toBe('optional')
  })

  it('Blocked writes requirement "blocked", kept as the third state', async () => {
    const res = await defaultsPOST(jsonRequest('http://x/api/dimensions/defaults', 'POST', {
      tenantId, masterType: 'account', masterId: await accountId(ACCOUNT_CODES.PAYROLL_EXPENSE), dimensionCode: SYSTEM_DIMENSION_CODES.FARM, requirement: 'blocked',
    }))
    const { status, payload } = await readJson(res)
    expect(status).toBe(200)
    expect(payload.data.requirement).toBe('blocked')
  })

  it('required is refused on a non-account master (only an account row enforces it)', async () => {
    const res = await defaultsPOST(jsonRequest('http://x/api/dimensions/defaults', 'POST', {
      tenantId, masterType: 'farm', masterId: randomUUID(), dimensionCode: SYSTEM_DIMENSION_CODES.FARM, requirement: 'required',
    }))
    expect(res.status).toBe(400)
  })
})

run('Editing and archiving a user-defined dimension (PATCH /api/dimensions/[id])', () => {
  let tenantId: string; let cookie: string; let dimId: string; let sysDimId: string

  beforeAll(async () => {
    ({ tenantId, cookie } = await makeTenantWithOwner('DimOp Editing'))
    mockCookie = cookie
    const idByCode = await ensureSystemDimensions(tenantId)
    sysDimId = idByCode.get(SYSTEM_DIMENSION_CODES.UNIT)!
    const createRes = await dimensionsPOST(jsonRequest('http://x/api/dimensions', 'POST', {
      tenantId, code: 'DEPT', name: 'Department', levels: ['Department'],
    }))
    const created = await readJson(createRes)
    dimId = created.payload.data.id
  })
  afterAll(async () => { await cleanupTenant(tenantId); mockCookie = undefined })

  it('a user-defined dimension can be renamed and its register fields set', async () => {
    const res = await dimensionPATCH(
      jsonRequest('http://x/api/dimensions/x', 'PATCH', { tenantId, name: 'Cost Centre', shortName: 'CC', separator: '/', budgetCheck: true, budgetControl: true }),
      { params: Promise.resolve({ id: dimId }) },
    )
    const { status, payload } = await readJson(res)
    expect(status).toBe(200)
    expect(payload.data.name).toBe('Cost Centre')
    expect(payload.data.shortName).toBe('CC')
    expect(payload.data.separator).toBe('/')
    expect(payload.data.budgetCheck).toBe(true)
    expect(payload.data.budgetControl).toBe(true)
  })

  it('archiving it sets archived, and it can be restored', async () => {
    const archiveRes = await dimensionPATCH(
      jsonRequest('http://x/api/dimensions/x', 'PATCH', { tenantId, archived: true }),
      { params: Promise.resolve({ id: dimId }) },
    )
    expect((await readJson(archiveRes)).payload.data.archived).toBe(true)

    const restoreRes = await dimensionPATCH(
      jsonRequest('http://x/api/dimensions/x', 'PATCH', { tenantId, archived: false }),
      { params: Promise.resolve({ id: dimId }) },
    )
    expect((await readJson(restoreRes)).payload.data.archived).toBe(false)
  })

  it('a SYSTEM dimension refuses edit and archive', async () => {
    const editRes = await dimensionPATCH(
      jsonRequest('http://x/api/dimensions/x', 'PATCH', { tenantId, name: 'Renamed Unit' }),
      { params: Promise.resolve({ id: sysDimId }) },
    )
    expect(editRes.status).toBe(400)

    const archiveRes = await dimensionPATCH(
      jsonRequest('http://x/api/dimensions/x', 'PATCH', { tenantId, archived: true }),
      { params: Promise.resolve({ id: sysDimId }) },
    )
    expect(archiveRes.status).toBe(400)
  })
})

run('Editing and archiving a user-defined dimension VALUE (PATCH /api/dimensions/[id]/values/[valueId])', () => {
  let tenantId: string; let cookie: string; let dimId: string; let valueId: string
  let farmDimId: string; let projectedValueId: string

  beforeAll(async () => {
    ({ tenantId, cookie } = await makeTenantWithOwner('DimOp Value Editing'))
    mockCookie = cookie
    const idByCode = await ensureSystemDimensions(tenantId)
    farmDimId = idByCode.get(SYSTEM_DIMENSION_CODES.FARM)!

    const farmId = `f-${randomUUID()}`
    await db.insert(farms).values({ id: farmId, tenantId, name: 'Farm One', code: 'FRM-DIMOP-001' })
    const projected = await projectFarm(db, tenantId, { id: farmId, code: 'FRM-DIMOP-001', name: 'Farm One' })
    projectedValueId = projected.id

    const createRes = await dimensionsPOST(jsonRequest('http://x/api/dimensions', 'POST', { tenantId, code: 'SEG', name: 'Segment', levels: ['Segment'] }))
    dimId = (await readJson(createRes)).payload.data.id
    const valueRow = (await db.insert(dimensionValues).values({
      id: randomUUID(), dimensionId: dimId, tenantId, code: 'A1', name: 'Segment A1', levelOrdinal: 1, archived: false,
    }).returning())[0]
    valueId = valueRow.id
  })
  afterAll(async () => { await cleanupTenant(tenantId); mockCookie = undefined })

  it('a user-defined value can be renamed', async () => {
    const res = await valuePATCH(
      jsonRequest('http://x', 'PATCH', { tenantId, name: 'Renamed A1' }),
      { params: Promise.resolve({ id: dimId, valueId }) },
    )
    const { status, payload } = await readJson(res)
    expect(status).toBe(200)
    expect(payload.data.name).toBe('Renamed A1')
  })

  it('a user-defined value can be archived and restored', async () => {
    const archiveRes = await valuePATCH(jsonRequest('http://x', 'PATCH', { tenantId, archived: true }), { params: Promise.resolve({ id: dimId, valueId }) })
    expect((await readJson(archiveRes)).payload.data.archived).toBe(true)
    const restoreRes = await valuePATCH(jsonRequest('http://x', 'PATCH', { tenantId, archived: false }), { params: Promise.resolve({ id: dimId, valueId }) })
    expect((await readJson(restoreRes)).payload.data.archived).toBe(false)
  })

  it('a value projected from a real farm refuses rename (ledger/farm must not disagree)', async () => {
    const res = await valuePATCH(
      jsonRequest('http://x', 'PATCH', { tenantId, name: 'Hijacked Name' }),
      { params: Promise.resolve({ id: farmDimId, valueId: projectedValueId }) },
    )
    expect(res.status).toBe(400)
  })
})

run('Resolve preview (POST /api/dimensions/resolve) — sale/purchase form linkage', () => {
  let tenantId: string; let cookie: string; let farmId: string; let unitId: string; let batchId: string

  beforeAll(async () => {
    ({ tenantId, cookie } = await makeTenantWithOwner('DimOp Preview'))
    mockCookie = cookie
    await ensureAccountsSeeded()
    farmId = `f-${randomUUID()}`
    unitId = `u-${randomUUID()}`
    batchId = `b-${randomUUID()}`
    await db.insert(farms).values({ id: farmId, tenantId, name: 'Preview Farm', code: 'FRM-PREV-001' })
    await db.insert(productionUnits).values({ id: unitId, tenantId, farmId, type: 'poultry', name: 'Unit One', code: 'UNT-PREV-001' })
    await db.insert(batches).values({ id: batchId, tenantId, unitId, name: 'Batch One', code: 'BAT-PREV-001', enterprise: 'broiler', status: 'ACTIVE', initialQty: 100, currentQty: 100 })
    await projectFarm(db, tenantId, { id: farmId, code: 'FRM-PREV-001', name: 'Preview Farm' })
    await projectUnit(db, tenantId, { id: unitId, code: 'UNT-PREV-001', name: 'Unit One' })
    await projectBatch(db, tenantId, { id: batchId, code: 'BAT-PREV-001', name: 'Batch One', enterprise: 'broiler' })

    const salesRevenueId = (await db.select().from(accounts).where(eq(accounts.code, ACCOUNT_CODES.SALES_REVENUE)).limit(1))[0].id
    await defaultsPOST(jsonRequest('http://x', 'POST', { tenantId, masterType: 'account', masterId: salesRevenueId, dimensionCode: SYSTEM_DIMENSION_CODES.ENTERPRISE, requirement: 'required' }))
  })
  afterAll(async () => { await cleanupTenant(tenantId); mockCookie = undefined })

  it('shows the FARM/UNIT/BATCH/ENTERPRISE dimensions already derivable from the batch, before submit', async () => {
    const res = await resolvePOST(jsonRequest('http://x', 'POST', { tenantId, docType: 'sale', masterType: 'batch', masterId: batchId }))
    const { status, payload } = await readJson(res)
    expect(status).toBe(200)
    const codes = payload.data.base.map((d: { dimensionCode: string }) => d.dimensionCode).sort()
    expect(codes).toEqual(['BATCH', 'ENTERPRISE', 'FARM', 'UNIT'])
    // Sales Revenue's ENTERPRISE requirement is satisfied by the batch chain.
    const salesLine = payload.data.perAccount.find((a: { accountCode: string }) => a.accountCode === ACCOUNT_CODES.SALES_REVENUE)
    expect(salesLine.requiredMissing).toEqual([])
  })

  it('reports requiredMissing when nothing is chosen yet and the account requires a dimension', async () => {
    const res = await resolvePOST(jsonRequest('http://x', 'POST', { tenantId, docType: 'sale' }))
    const { payload } = await readJson(res)
    const salesLine = payload.data.perAccount.find((a: { accountCode: string }) => a.accountCode === ACCOUNT_CODES.SALES_REVENUE)
    expect(salesLine.requiredMissing.map((m: { dimensionCode: string }) => m.dimensionCode)).toContain('ENTERPRISE')
  })
})

run('Reading dimensions back (GET /api/dimensions/for-document) — journal-entry-view linkage', () => {
  let tenantId: string; let cookie: string; let saleId: string

  beforeAll(async () => {
    ({ tenantId, cookie } = await makeTenantWithOwner('DimOp ReadBack'))
    mockCookie = cookie
    await ensureAccountsSeeded()
    await ensureSystemDimensions(tenantId)
    const farmId = `f-${randomUUID()}`
    const unitId = `u-${randomUUID()}`
    const batchId = `b-${randomUUID()}`
    await db.insert(farms).values({ id: farmId, tenantId, name: 'ReadBack Farm', code: 'FRM-READ-001' })
    await db.insert(productionUnits).values({ id: unitId, tenantId, farmId, type: 'poultry', name: 'Unit', code: 'UNT-READ-001' })
    await db.insert(batches).values({ id: batchId, tenantId, unitId, name: 'Batch', code: 'BAT-READ-001', enterprise: 'broiler', status: 'ACTIVE', initialQty: 50, currentQty: 50 })
    await projectFarm(db, tenantId, { id: farmId, code: 'FRM-READ-001', name: 'ReadBack Farm' })
    await projectUnit(db, tenantId, { id: unitId, code: 'UNT-READ-001', name: 'Unit' })
    await projectBatch(db, tenantId, { id: batchId, code: 'BAT-READ-001', name: 'Batch', enterprise: 'broiler' })

    const sale = await recordSale({ tenantId, batchId, item: 'Broilers', amountCents: 500000, status: 'paid' })
    saleId = sale.id
  })
  afterAll(async () => { await cleanupTenant(tenantId); mockCookie = undefined })

  it('shows the document-level dimensions and each journal line carrying its own', async () => {
    const res = await forDocumentGET(new Request(`http://x/api/dimensions/for-document?tenantId=${tenantId}&docType=sale&docId=${saleId}`))
    const { status, payload } = await readJson(res)
    expect(status).toBe(200)
    expect(payload.data.document.length).toBeGreaterThan(0)
    expect(payload.data.entry).not.toBeNull()
    expect(payload.data.entry.lines.length).toBeGreaterThan(0)
    for (const line of payload.data.entry.lines) {
      const codes = line.dimensions.map((d: { dimensionCode: string }) => d.dimensionCode)
      expect(codes).toEqual(expect.arrayContaining(['FARM', 'UNIT', 'BATCH', 'ENTERPRISE']))
    }
  })

  it('a document with no matching entry returns null rather than throwing', async () => {
    const res = await forDocumentGET(new Request(`http://x/api/dimensions/for-document?tenantId=${tenantId}&docType=purchase&docId=${randomUUID()}`))
    const { status, payload } = await readJson(res)
    expect(status).toBe(200)
    expect(payload.data.entry).toBeNull()
  })
})

run('An archived dimension stops applying to new postings (item 4)', () => {
  let tenantId: string; let cookie: string; let farmId: string

  beforeAll(async () => {
    ({ tenantId, cookie } = await makeTenantWithOwner('DimOp Archived'))
    mockCookie = cookie
    await ensureSystemDimensions(tenantId)
    farmId = `f-${randomUUID()}`
    await db.insert(farms).values({ id: farmId, tenantId, name: 'Archived Dim Farm', code: 'FRM-ARCH-001' })
    await projectFarm(db, tenantId, { id: farmId, code: 'FRM-ARCH-001', name: 'Archived Dim Farm' })
  })
  afterAll(async () => { await cleanupTenant(tenantId); mockCookie = undefined })

  it('an explicit reference to an archived dimension is refused', async () => {
    const farmDimId = (await ensureSystemDimensions(tenantId)).get(SYSTEM_DIMENSION_CODES.FARM)!
    await db.update(dimensions).set({ archived: true }).where(eq(dimensions.id, farmDimId))
    try {
      const { resolveMasterDimensions } = await import('@/lib/dimensions')
      await expect(resolveMasterDimensions(db, tenantId, null, { FARM: 'FRM-ARCH-001' })).rejects.toThrow(/archived/)
    } finally {
      await db.update(dimensions).set({ archived: false }).where(eq(dimensions.id, farmDimId))
    }
  })
})
