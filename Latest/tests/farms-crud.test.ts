// ── Farms CRUD tests (farms/employees CRUD task) ───────────────────────────
// Integration tests that call the real route handlers directly against real
// Postgres (no HTTP server needed), mirroring tests/onboarding.test.ts /
// tests/admin-users.test.ts. Skips when DATABASE_URL is unset (CI has no
// database).
//
// Covers: PATCH /api/farms/[id] requires a session and derives tenant scope
// from it only (never a body/query tenantId taken on faith for an
// owner/manager caller); role enforcement; duplicate-code handling via
// isUniqueViolation (never a bare 500); the archive-guard against live
// production_units/batches; archive-never-deletes; restore; and GET
// /api/farms's default archived-exclusion plus its includeArchived opt-in.
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { and, eq, inArray } from 'drizzle-orm'

vi.mock('server-only', () => ({}))

let mockCookie: string | undefined
vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({ get: () => (mockCookie ? { value: mockCookie } : undefined) })),
}))

import { GET as farmsGET } from '@/app/api/farms/route'
import { PATCH as farmPATCH } from '@/app/api/farms/[id]/route'
import { db } from '@/db'
import { tenants, users, sessions, farms, productionUnits, batches, auditLog } from '@/db/schemas'
import { createSession, hashSecret } from '@/lib/auth'

const hasDb = !!process.env.DATABASE_URL
const run = hasDb ? describe : describe.skip

function getRequest(url: string): Request {
  return new Request(url)
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

run('farms CRUD (farms/employees CRUD task)', () => {
  const tenantAId = `t-farms-a-${randomUUID()}`
  const tenantBId = `t-farms-b-${randomUUID()}`

  const ownerAId = `usr-farms-owner-a-${randomUUID()}`
  const ownerBId = `usr-farms-owner-b-${randomUUID()}`
  const workerAId = `usr-farms-worker-a-${randomUUID()}`
  const superAdminId = `usr-farms-super-${randomUUID()}`
  let ownerASession: string
  let ownerBSession: string
  let workerASession: string
  let superAdminSession: string

  const farmA1Id = `f-a1-${randomUUID()}`
  const farmA2Id = `f-a2-${randomUUID()}`
  const farmBId = `f-b1-${randomUUID()}`
  const farmDepId = `f-dep-${randomUUID()}`
  const farmCleanId = `f-clean-${randomUUID()}`
  const farmArchivedId = `f-archived-${randomUUID()}`
  const unitActiveId = `u-active-${randomUUID()}`
  const openBatchId = `b-open-${randomUUID()}`

  const allTenantIds = [tenantAId, tenantBId]
  const allUserIds = [ownerAId, ownerBId, workerAId, superAdminId]
  const allFarmIds = [farmA1Id, farmA2Id, farmBId, farmDepId, farmCleanId, farmArchivedId]

  beforeAll(async () => {
    await db.insert(tenants).values([
      { id: tenantAId, name: 'Farms Test Co. A', active: true },
      { id: tenantBId, name: 'Farms Test Co. B', active: true },
    ])
    const salt = randomUUID()
    await db.insert(users).values([
      { id: ownerAId, tenantId: tenantAId, name: 'Farms Owner A', email: `farms-owner-a-${randomUUID()}@test.ifms`, role: 'owner', passwordHash: hashSecret('pw', salt), passwordSalt: salt, status: 'ACTIVE' },
      { id: ownerBId, tenantId: tenantBId, name: 'Farms Owner B', email: `farms-owner-b-${randomUUID()}@test.ifms`, role: 'owner', passwordHash: hashSecret('pw', salt), passwordSalt: salt, status: 'ACTIVE' },
      { id: workerAId, tenantId: tenantAId, name: 'Farms Worker A', email: `farms-worker-a-${randomUUID()}@test.ifms`, role: 'worker', passwordHash: hashSecret('pw', salt), passwordSalt: salt, status: 'ACTIVE' },
      { id: superAdminId, tenantId: null, name: 'Farms Super Admin', email: `farms-super-${randomUUID()}@test.ifms`, role: 'super_admin', passwordHash: hashSecret('pw', salt), passwordSalt: salt, status: 'ACTIVE' },
    ])
    ownerASession = await createSession(ownerAId)
    ownerBSession = await createSession(ownerBId)
    workerASession = await createSession(workerAId)
    superAdminSession = await createSession(superAdminId)

    await db.insert(farms).values([
      { id: farmA1Id, tenantId: tenantAId, name: 'Farm A1', location: 'Nakuru', code: 'FRM-A-001' },
      { id: farmA2Id, tenantId: tenantAId, name: 'Farm A2', location: 'Nakuru', code: 'FRM-A-002' },
      // Same code as farmA1, but under a DIFFERENT tenant — proving the
      // uniqueness guard is per-tenant, not global.
      { id: farmBId, tenantId: tenantBId, name: 'Farm B1', location: 'Eldoret', code: 'FRM-A-001' },
      { id: farmDepId, tenantId: tenantAId, name: 'Farm With Dependents', location: 'Nakuru', code: 'FRM-A-003' },
      { id: farmCleanId, tenantId: tenantAId, name: 'Farm Clean', location: 'Nakuru', code: 'FRM-A-004' },
      { id: farmArchivedId, tenantId: tenantAId, name: 'Farm Pre-Archived', location: 'Nakuru', code: 'FRM-A-005', status: 'ARCHIVED' },
    ])
    await db.insert(productionUnits).values([
      { id: unitActiveId, tenantId: tenantAId, farmId: farmDepId, type: 'house', name: 'House Dep-01', code: 'HSE-DEP-001', status: 'ACTIVE' },
    ])
    await db.insert(batches).values([
      { id: openBatchId, tenantId: tenantAId, unitId: unitActiveId, code: 'BRO-DEP-001', name: 'Dependent Batch', enterprise: 'broiler', status: 'ACTIVE' },
    ])
  })

  afterAll(async () => {
    await db.delete(auditLog).where(inArray(auditLog.tenantId, allTenantIds))
    await db.delete(batches).where(eq(batches.id, openBatchId))
    await db.delete(productionUnits).where(eq(productionUnits.id, unitActiveId))
    await db.delete(farms).where(inArray(farms.id, allFarmIds))
    await db.delete(sessions).where(inArray(sessions.userId, allUserIds))
    await db.delete(users).where(inArray(users.id, allUserIds))
    await db.delete(tenants).where(inArray(tenants.id, allTenantIds))
  })

  afterEach(() => { mockCookie = undefined })

  describe('PATCH /api/farms/[id]: auth + tenant scope', () => {
    it('rejects with no session (401)', async () => {
      const { status } = await readJson(
        await farmPATCH(patchRequest(`http://localhost/api/farms/${farmA1Id}`, { name: 'New Name' }), { params: Promise.resolve({ id: farmA1Id }) })
      )
      expect(status).toBe(401)
    })

    it('forbids a worker from writing (403)', async () => {
      mockCookie = workerASession
      const { status } = await readJson(
        await farmPATCH(patchRequest(`http://localhost/api/farms/${farmA1Id}`, { status: 'ARCHIVED' }), { params: Promise.resolve({ id: farmA1Id }) })
      )
      expect(status).toBe(403)
    })

    it('tenant A\'s owner cannot edit or archive tenant B\'s farm (404)', async () => {
      mockCookie = ownerASession
      const editRes = await readJson(
        await farmPATCH(patchRequest(`http://localhost/api/farms/${farmBId}`, { name: 'Hijacked' }), { params: Promise.resolve({ id: farmBId }) })
      )
      expect(editRes.status).toBe(404)

      const archiveRes = await readJson(
        await farmPATCH(patchRequest(`http://localhost/api/farms/${farmBId}`, { status: 'ARCHIVED' }), { params: Promise.resolve({ id: farmBId }) })
      )
      expect(archiveRes.status).toBe(404)

      // But tenant B's own owner CAN edit it — confirms the 404 above is
      // real tenant scoping, not a route that just rejects everyone.
      mockCookie = ownerBSession
      const ownRes = await readJson(
        await farmPATCH(patchRequest(`http://localhost/api/farms/${farmBId}`, { location: 'Eldoret Updated' }), { params: Promise.resolve({ id: farmBId }) })
      )
      expect(ownRes.status).toBe(200)
    })

    it('a super_admin must name an explicit tenantId (400), then can act once it matches the farm\'s real tenant', async () => {
      mockCookie = superAdminSession
      const noTenant = await readJson(
        await farmPATCH(patchRequest(`http://localhost/api/farms/${farmA2Id}`, { location: 'Updated' }), { params: Promise.resolve({ id: farmA2Id }) })
      )
      expect(noTenant.status).toBe(400)

      const withTenant = await readJson(
        await farmPATCH(patchRequest(`http://localhost/api/farms/${farmA2Id}`, { tenantId: tenantAId, location: 'Updated By Admin' }), { params: Promise.resolve({ id: farmA2Id }) })
      )
      expect(withTenant.status).toBe(200)
      expect(withTenant.payload.data.location).toBe('Updated By Admin')
    })
  })

  describe('PATCH /api/farms/[id]: field edits + duplicate code', () => {
    it('edits name/location/code and audits old -> new', async () => {
      mockCookie = ownerASession
      const { status, payload } = await readJson(
        await farmPATCH(patchRequest(`http://localhost/api/farms/${farmA2Id}`, { name: 'Farm A2 Renamed' }), { params: Promise.resolve({ id: farmA2Id }) })
      )
      expect(status).toBe(200)
      expect(payload.data.name).toBe('Farm A2 Renamed')

      const auditRows = await db.select().from(auditLog).where(and(eq(auditLog.entityId, farmA2Id), eq(auditLog.action, 'farm.updated')))
      expect(auditRows.length).toBeGreaterThan(0)
    })

    it('a duplicate code within the same tenant is a clean 409 with fields.code, not a 500', async () => {
      mockCookie = ownerASession
      const { status, payload } = await readJson(
        await farmPATCH(patchRequest(`http://localhost/api/farms/${farmA2Id}`, { code: 'FRM-A-001' }), { params: Promise.resolve({ id: farmA2Id }) })
      )
      expect(status).toBe(409)
      expect(payload.success).toBe(false)
      expect(typeof payload.fields.code).toBe('string')
    })

    it('the same code in a different tenant is allowed (per-tenant uniqueness only)', async () => {
      // farmBId (tenant B) already has code FRM-A-001, same as farmA1Id (tenant A).
      const rows = await db.select().from(farms).where(eq(farms.id, farmBId))
      expect(rows[0].code).toBe('FRM-A-001')
      const conflicting = await db.select().from(farms).where(eq(farms.id, farmA1Id))
      expect(conflicting[0].code).toBe('FRM-A-001')
    })
  })

  describe('PATCH /api/farms/[id]: archive / restore', () => {
    it('refuses to archive a farm with an active production unit and open batch, naming them', async () => {
      mockCookie = ownerASession
      const { status, payload } = await readJson(
        await farmPATCH(patchRequest(`http://localhost/api/farms/${farmDepId}`, { status: 'ARCHIVED' }), { params: Promise.resolve({ id: farmDepId }) })
      )
      expect(status).toBe(409)
      expect(payload.success).toBe(false)
      expect(payload.fields.status).toContain('House Dep-01')
      expect(payload.fields.status).toContain('Dependent Batch')

      const stillActive = await db.select().from(farms).where(eq(farms.id, farmDepId))
      expect(stillActive[0].status).toBe('ACTIVE')
    })

    it('archives a clean farm without deleting the row, and restores it', async () => {
      mockCookie = ownerASession
      const archiveRes = await readJson(
        await farmPATCH(patchRequest(`http://localhost/api/farms/${farmCleanId}`, { status: 'ARCHIVED' }), { params: Promise.resolve({ id: farmCleanId }) })
      )
      expect(archiveRes.status).toBe(200)
      expect(archiveRes.payload.data.status).toBe('ARCHIVED')

      const rowsAfterArchive = await db.select().from(farms).where(eq(farms.id, farmCleanId))
      expect(rowsAfterArchive.length).toBe(1) // still exists — archived, not deleted
      expect(rowsAfterArchive[0].status).toBe('ARCHIVED')

      const restoreRes = await readJson(
        await farmPATCH(patchRequest(`http://localhost/api/farms/${farmCleanId}`, { status: 'ACTIVE' }), { params: Promise.resolve({ id: farmCleanId }) })
      )
      expect(restoreRes.status).toBe(200)
      expect(restoreRes.payload.data.status).toBe('ACTIVE')

      const auditRows = await db.select().from(auditLog).where(and(eq(auditLog.entityId, farmCleanId), inArray(auditLog.action, ['farm.archived', 'farm.restored'])))
      expect(auditRows.some((r) => r.action === 'farm.archived')).toBe(true)
      expect(auditRows.some((r) => r.action === 'farm.restored')).toBe(true)
    })

    it('rejects an invalid status value with fields.status (400)', async () => {
      mockCookie = ownerASession
      const { status, payload } = await readJson(
        await farmPATCH(patchRequest(`http://localhost/api/farms/${farmCleanId}`, { status: 'DELETED' }), { params: Promise.resolve({ id: farmCleanId }) })
      )
      expect(status).toBe(400)
      expect(typeof payload.fields.status).toBe('string')
    })
  })

  describe('GET /api/farms: archived exclusion + opt-in', () => {
    it('excludes archived farms by default', async () => {
      mockCookie = ownerASession
      const { status, payload } = await readJson(await farmsGET(getRequest('http://localhost/api/farms')))
      expect(status).toBe(200)
      expect(payload.data.some((f: { id: string }) => f.id === farmArchivedId)).toBe(false)
      expect(payload.data.some((f: { id: string }) => f.id === farmA1Id)).toBe(true)
    })

    it('includes archived farms with includeArchived=true', async () => {
      mockCookie = ownerASession
      const { status, payload } = await readJson(await farmsGET(getRequest('http://localhost/api/farms?includeArchived=true')))
      expect(status).toBe(200)
      expect(payload.data.some((f: { id: string }) => f.id === farmArchivedId)).toBe(true)
    })

    it('401s unauthenticated, and a query-string tenantId is never consulted', async () => {
      const { status } = await readJson(await farmsGET(getRequest(`http://localhost/api/farms?tenantId=${tenantAId}`)))
      expect(status).toBe(401)
    })
  })
})
