// ── CSV import validation is server-authoritative ───────────────────────────
// The import preview used to validate in the browser against static fixtures
// in components/farm/data.ts, so a farmer's REAL batch codes were rejected
// while fixture-only codes passed. These tests pin that reference checks now
// run against the caller's own rows.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { eq, inArray } from 'drizzle-orm'

vi.mock('server-only', () => ({}))

let mockCookie: string | undefined
vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({ get: () => (mockCookie ? { value: mockCookie } : undefined) })),
}))

import { POST as validatePOST } from '@/app/api/imports/validate/route'
import { db } from '@/db'
import { tenants, users, sessions, farms, productionUnits, batches } from '@/db/schemas'
import { createSession, hashSecret } from '@/lib/auth'

const hasDb = !!process.env.DATABASE_URL
const run = hasDb ? describe : describe.skip

const post = (body: unknown) =>
  validatePOST(new Request('http://localhost/api/imports/validate', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }))

async function json(res: Response) { return { status: res.status, payload: await res.json() } }

const issuesFor = (payload: { data: { rows: { index: number; issues: { col: string; severity: string; message: string }[] }[] } }, i: number) =>
  payload.data.rows.find(r => r.index === i)?.issues ?? []

run('CSV import validation (server-authoritative)', () => {
  const tenantA = `t-imp-${randomUUID()}`
  const tenantB = `t-imp-${randomUUID()}`
  const ownerAId = randomUUID()
  const ownerAEmail = `impowner-${randomUUID()}@test.ifms`
  let ownerAToken: string
  const farmAId = randomUUID()
  const farmBId = randomUUID()
  const unitAId = randomUUID()
  const unitBId = randomUUID()
  const batchAId = randomUUID()
  const batchBId = randomUUID()
  const FARM_A_CODE = 'FRM-IMP-A'
  const BATCH_A_CODE = 'LYR-IMP-A'
  const BATCH_B_CODE = 'LYR-IMP-B' // belongs to the OTHER tenant

  beforeAll(async () => {
    await db.insert(tenants).values([
      { id: tenantA, name: 'Import Tenant A', active: true },
      { id: tenantB, name: 'Import Tenant B', active: true },
    ])
    const salt = randomUUID()
    await db.insert(users).values({
      id: ownerAId, tenantId: tenantA, name: 'Import Owner', email: ownerAEmail,
      role: 'owner', passwordHash: hashSecret('pw', salt), passwordSalt: salt, status: 'ACTIVE',
    })
    ownerAToken = await createSession(ownerAId)

    await db.insert(farms).values([
      { id: farmAId, tenantId: tenantA, name: 'Import Farm A', location: 'A', code: FARM_A_CODE },
      { id: farmBId, tenantId: tenantB, name: 'Import Farm B', location: 'B', code: 'FRM-IMP-B' },
    ])
    await db.insert(productionUnits).values([
      { id: unitAId, tenantId: tenantA, farmId: farmAId, type: 'livestock', name: 'U A', code: 'U-IMP-A', status: 'ACTIVE' },
      { id: unitBId, tenantId: tenantB, farmId: farmBId, type: 'livestock', name: 'U B', code: 'U-IMP-B', status: 'ACTIVE' },
    ])
    await db.insert(batches).values([
      { id: batchAId, tenantId: tenantA, unitId: unitAId, code: BATCH_A_CODE, name: 'B A', species: 'chicken', enterprise: 'layer', stage: 'laying', status: 'ACTIVE', initialQty: 10, currentQty: 10, acquisitionCostCents: 0 },
      { id: batchBId, tenantId: tenantB, unitId: unitBId, code: BATCH_B_CODE, name: 'B B', species: 'chicken', enterprise: 'layer', stage: 'laying', status: 'ACTIVE', initialQty: 10, currentQty: 10, acquisitionCostCents: 0 },
    ])
  })

  afterAll(async () => {
    await db.delete(batches).where(inArray(batches.id, [batchAId, batchBId]))
    await db.delete(productionUnits).where(inArray(productionUnits.id, [unitAId, unitBId]))
    await db.delete(farms).where(inArray(farms.id, [farmAId, farmBId]))
    await db.delete(sessions).where(eq(sessions.userId, ownerAId))
    await db.delete(users).where(eq(users.id, ownerAId))
    await db.delete(tenants).where(inArray(tenants.id, [tenantA, tenantB]))
  })

  it('rejects an unauthenticated caller', async () => {
    mockCookie = undefined
    const { status } = await json(await post({ entity: 'employees', rows: [] }))
    expect(status).toBe(401)
  })

  it('rejects an unsupported entity with a fields error', async () => {
    mockCookie = ownerAToken
    const { status, payload } = await json(await post({ entity: 'aliens', rows: [] }))
    expect(status).toBe(400)
    expect(payload.fields?.entity).toBeTruthy()
  })

  it('accepts the tenant\'s REAL batch code — the case the old fixture check rejected', async () => {
    mockCookie = ownerAToken
    const { status, payload } = await json(await post({
      entity: 'employees',
      rows: [{ name: 'Jane Farmer', role: 'worker', phone: '0712345678', batches: BATCH_A_CODE, farmCode: FARM_A_CODE }],
    }))
    expect(status).toBe(200)
    expect(issuesFor(payload, 0).filter(i => i.severity === 'error')).toEqual([])
  })

  it('rejects a batch code that does not exist', async () => {
    mockCookie = ownerAToken
    const { payload } = await json(await post({
      entity: 'employees', rows: [{ name: 'Jane Farmer', batches: 'NOPE-9999' }],
    }))
    expect(issuesFor(payload, 0).some(i => i.col === 'batches' && i.severity === 'error')).toBe(true)
  })

  it('rejects another tenant\'s batch code — reference checks are tenant-scoped', async () => {
    mockCookie = ownerAToken
    const { payload } = await json(await post({
      entity: 'employees', rows: [{ name: 'Jane Farmer', batches: BATCH_B_CODE }],
    }))
    expect(issuesFor(payload, 0).some(i => i.col === 'batches' && i.severity === 'error')).toBe(true)
  })

  it('rejects an unknown farm code and an invalid phone', async () => {
    mockCookie = ownerAToken
    const { payload } = await json(await post({
      entity: 'employees', rows: [{ name: 'Jane Farmer', phone: '12345', farmCode: 'FRM-NOPE' }],
    }))
    const issues = issuesFor(payload, 0)
    expect(issues.some(i => i.col === 'farmCode' && i.severity === 'error')).toBe(true)
    expect(issues.some(i => i.col === 'phone' && i.severity === 'error')).toBe(true)
  })

  it('requires a name, and flags a duplicate name within the file', async () => {
    mockCookie = ownerAToken
    const { payload } = await json(await post({
      entity: 'employees',
      rows: [{ name: '' }, { name: 'Sam Twin' }, { name: 'sam twin' }],
    }))
    expect(issuesFor(payload, 0).some(i => i.col === 'name' && i.severity === 'error')).toBe(true)
    expect(issuesFor(payload, 1).some(i => i.col === 'name' && i.severity === 'warning')).toBe(true)
    expect(issuesFor(payload, 2).some(i => i.col === 'name' && i.severity === 'warning')).toBe(true)
  })

  it('validates inventory quantity, cost and dates', async () => {
    mockCookie = ownerAToken
    const { payload } = await json(await post({
      entity: 'inventory',
      rows: [
        { name: 'Layer Mash', unit: 'kg', qty: '100', costPerUnit: '62', expiryDate: '2027-01-01' },
        { name: '', unit: '', qty: '-5', costPerUnit: 'abc', expiryDate: 'not-a-date' },
      ],
    }))
    expect(issuesFor(payload, 0).filter(i => i.severity === 'error')).toEqual([])
    const bad = issuesFor(payload, 1)
    for (const col of ['name', 'unit', 'qty', 'costPerUnit', 'expiryDate']) {
      expect(bad.some(i => i.col === col && i.severity === 'error')).toBe(true)
    }
  })

  it('caps the number of rows per request', async () => {
    mockCookie = ownerAToken
    const rows = Array.from({ length: 2001 }, (_, i) => ({ name: `Row ${i}` }))
    const { status, payload } = await json(await post({ entity: 'employees', rows }))
    expect(status).toBe(400)
    expect(payload.fields?.rows).toBeTruthy()
  })
})
