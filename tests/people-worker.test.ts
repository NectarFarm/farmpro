// ── People & Worker Portal backend tests (issue #247) ───────────────────────
// Integration tests that call the real route handlers against the real
// postgres when DATABASE_URL is set (local/dev); CI has no database, so the
// suite skips there — same pattern as tests/batches.test.ts / tests/inventory.test.ts.
//
// Covers the issue's Definition of Done:
//   - employees + records tables exist; create/list works for both
//   - POST /api/records persists a real submission, readable via GET /api/records
//   - GET /api/employees/me returns a real mortalityPhotoThreshold for a seeded employee
//   - employee CRUD works, including assignedBatchIds
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { eq, inArray } from 'drizzle-orm'

vi.mock('server-only', () => ({}))

// Every route in this file now requires a real session (auth fix:
// fix/authenticate-all-apis closed the `tenantId`-query/body-param fallback
// this suite used to rely on for GET/POST) — mockable per-test via mockCookie.
let mockCookie: string | undefined
vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({ get: () => (mockCookie ? { value: mockCookie } : undefined) })),
}))

import { GET as employeesGET, POST as employeesPOST } from '@/app/api/employees/route'
import { GET as employeeGET, PATCH as employeePATCH } from '@/app/api/employees/[id]/route'
import { GET as employeeMeGET } from '@/app/api/employees/me/route'
import { GET as recordsGET, POST as recordsPOST } from '@/app/api/records/route'
import { db } from '@/db'
import { tenants, users, sessions, auditLog, farms, productionUnits, batches, employees, records } from '@/db/schemas'
import { createSession, hashSecret } from '@/lib/auth'

const hasDb = !!process.env.DATABASE_URL
const run = hasDb ? describe : describe.skip

function getRequest(url: string): Request {
  return new Request(url)
}

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

run('people & worker backend: employees + records (issue #247)', () => {
  const tenantAId = `t-${randomUUID()}`
  const tenantBId = `t-${randomUUID()}`
  const farmAId = `f-${randomUUID()}`
  const unitAId = `u-${randomUUID()}`
  const batchAId = `b-${randomUUID()}`
  const batchA2Id = `b-${randomUUID()}`
  const batchBId = `b-${randomUUID()}`
  const workerUserId = `usr-${randomUUID()}`

  // Sessions for the PATCH authorisation tests: an owner of tenant A (allowed
  // to write tenant A's employees), an owner of tenant B (so a cross-tenant
  // attempt is a real session with the wrong tenant, not just a query-param
  // mismatch), and a worker of tenant A (must be forbidden from writing).
  const ownerAId = `usr-owner-a-${randomUUID()}`
  const ownerBId = `usr-owner-b-${randomUUID()}`
  const workerAId = `usr-worker-a-${randomUUID()}`
  // A real user row for `workerUserId` — GET /api/employees/me now resolves
  // by the SESSION user's id (auth fix: fix/authenticate-all-apis; no more
  // `?userId=` query-param fallback), so the "resolves the caller's own
  // employee row" test needs a real, sign-in-able user whose id matches the
  // `employees.userId` the first test links. A second user with no linked
  // employees row covers the 404 case.
  const noEmployeeUserId = `usr-no-employee-${randomUUID()}`
  let ownerASession: string
  let ownerBSession: string
  let workerASession: string
  let workerUserSession: string
  let noEmployeeUserSession: string

  beforeAll(async () => {
    await db.insert(tenants).values([
      { id: tenantAId, name: 'People Test Co. A', active: true },
      { id: tenantBId, name: 'People Test Co. B', active: true },
    ])
    await db.insert(farms).values([
      { id: farmAId, tenantId: tenantAId, name: 'Farm A', location: 'Nakuru', code: 'FRM-KMU-001' },
    ])
    await db.insert(productionUnits).values([
      { id: unitAId, tenantId: tenantAId, farmId: farmAId, type: 'house', name: 'House A01', code: 'HSE-KMU-A01' },
    ])
    await db.insert(batches).values([
      { id: batchAId, tenantId: tenantAId, unitId: unitAId, code: 'BRO-KMU-001', name: 'Broilers Oct Run', enterprise: 'broiler' },
      { id: batchA2Id, tenantId: tenantAId, unitId: unitAId, code: 'BRO-KMU-002', name: 'Broilers Nov Run', enterprise: 'broiler' },
      { id: batchBId, tenantId: tenantBId, unitId: unitAId, code: 'BRO-KMU-003', name: 'Cross-tenant batch', enterprise: 'broiler' },
    ])
    const salt = randomUUID()
    await db.insert(users).values([
      { id: ownerAId, tenantId: tenantAId, name: 'Owner A', email: `owner-a-${randomUUID()}@test.ifms`, role: 'owner', passwordHash: hashSecret('pw', salt), passwordSalt: salt, status: 'ACTIVE' },
      { id: ownerBId, tenantId: tenantBId, name: 'Owner B', email: `owner-b-${randomUUID()}@test.ifms`, role: 'owner', passwordHash: hashSecret('pw', salt), passwordSalt: salt, status: 'ACTIVE' },
      { id: workerAId, tenantId: tenantAId, name: 'Worker A', email: `worker-a-${randomUUID()}@test.ifms`, role: 'worker', passwordHash: hashSecret('pw', salt), passwordSalt: salt, status: 'ACTIVE' },
      { id: workerUserId, tenantId: tenantAId, name: 'Worker Linked', email: `worker-linked-${randomUUID()}@test.ifms`, role: 'worker', passwordHash: hashSecret('pw', salt), passwordSalt: salt, status: 'ACTIVE' },
      { id: noEmployeeUserId, tenantId: tenantAId, name: 'No Employee', email: `no-employee-${randomUUID()}@test.ifms`, role: 'worker', passwordHash: hashSecret('pw', salt), passwordSalt: salt, status: 'ACTIVE' },
    ])
    ownerASession = await createSession(ownerAId)
    ownerBSession = await createSession(ownerBId)
    workerASession = await createSession(workerAId)
    workerUserSession = await createSession(workerUserId)
    noEmployeeUserSession = await createSession(noEmployeeUserId)
  })

  afterAll(async () => {
    mockCookie = undefined
    await db.delete(auditLog).where(inArray(auditLog.tenantId, [tenantAId, tenantBId]))
    await db.delete(records).where(inArray(records.tenantId, [tenantAId, tenantBId]))
    await db.delete(employees).where(inArray(employees.tenantId, [tenantAId, tenantBId]))
    await db.delete(batches).where(inArray(batches.tenantId, [tenantAId, tenantBId]))
    await db.delete(productionUnits).where(inArray(productionUnits.tenantId, [tenantAId, tenantBId]))
    await db.delete(farms).where(inArray(farms.tenantId, [tenantAId, tenantBId]))
    await db.delete(sessions).where(inArray(sessions.userId, [ownerAId, ownerBId, workerAId, workerUserId, noEmployeeUserId]))
    await db.delete(users).where(inArray(users.id, [ownerAId, ownerBId, workerAId, workerUserId, noEmployeeUserId]))
    await db.delete(tenants).where(inArray(tenants.id, [tenantAId, tenantBId]))
  })

  describe('POST/GET /api/employees', () => {
    afterEach(() => { mockCookie = undefined })

    it('creates an employee with assignedBatchIds and reads it back', async () => {
      mockCookie = ownerASession
      const res = await employeesPOST(
        postRequest('http://localhost/api/employees', {
          userId: workerUserId,
          name: 'John Kamau',
          phone: '+254-722-111-222',
          role: 'worker',
          assignedBatchIds: [batchAId, batchA2Id],
          mortalityPhotoThreshold: 5,
        })
      )
      expect(res.status).toBe(201)
      const payload = await res.json()
      expect(payload.success).toBe(true)
      expect(payload.data.name).toBe('John Kamau')
      expect(payload.data.assignedBatchIds.sort()).toEqual([batchAId, batchA2Id].sort())
      expect(payload.data.mortalityPhotoThreshold).toBe(5)
      expect(payload.data.status).toBe('ACTIVE')

      const readRes = await employeeGET(getRequest(`http://localhost/api/employees/${payload.data.id}`), {
        params: Promise.resolve({ id: payload.data.id }),
      })
      expect(readRes.status).toBe(200)
      expect((await readRes.json()).data.phone).toBe('+254-722-111-222')
    })

    it('defaults mortalityPhotoThreshold to 3 when not provided', async () => {
      mockCookie = ownerASession
      const res = await employeesPOST(
        postRequest('http://localhost/api/employees', { name: 'Sarah Mwangi' })
      )
      expect(res.status).toBe(201)
      const payload = await res.json()
      expect(payload.data.mortalityPhotoThreshold).toBe(3)
      expect(payload.data.assignedBatchIds).toEqual([])
    })

    it('rejects an assignedBatchIds entry belonging to a different tenant', async () => {
      mockCookie = ownerASession
      const res = await employeesPOST(
        postRequest('http://localhost/api/employees', {
          name: 'Cross-tenant attempt',
          assignedBatchIds: [batchBId],
        })
      )
      expect(res.status).toBe(404)
    })

    it('401s with no session', async () => {
      mockCookie = undefined
      const res = await employeesPOST(postRequest('http://localhost/api/employees', { name: 'Nobody' }))
      expect(res.status).toBe(401)
    })

    it('requires name once authenticated', async () => {
      mockCookie = ownerASession
      const res = await employeesPOST(postRequest('http://localhost/api/employees', {}))
      expect(res.status).toBe(400)
    })

    it('lists only the requesting tenant\'s employees', async () => {
      mockCookie = ownerBSession
      await employeesPOST(postRequest('http://localhost/api/employees', { name: 'Other Tenant Worker' }))

      mockCookie = ownerASession
      const res = await employeesGET(getRequest('http://localhost/api/employees'))
      expect(res.status).toBe(200)
      const payload = await res.json()
      expect(payload.data.length).toBeGreaterThanOrEqual(2)
      expect(payload.data.every((row: { tenantId: string }) => row.tenantId === tenantAId)).toBe(true)
    })
  })

  describe('PATCH /api/employees/[id] (session-derived tenant scope, role-gated)', () => {
    afterEach(() => { mockCookie = undefined })

    it('updates assignedBatchIds (full replace) and other fields, as tenant A\'s owner', async () => {
      mockCookie = ownerASession
      const createRes = await employeesPOST(
        postRequest('http://localhost/api/employees', { name: 'Ann Wambui', assignedBatchIds: [batchAId] })
      )
      const created = (await createRes.json()).data

      const patchRes = await employeePATCH(
        patchRequest(`http://localhost/api/employees/${created.id}`, {
          assignedBatchIds: [batchA2Id],
          role: 'harvest_lead',
          status: 'INACTIVE',
        }),
        { params: Promise.resolve({ id: created.id }) }
      )
      expect(patchRes.status).toBe(200)
      const patched = (await patchRes.json()).data
      expect(patched.assignedBatchIds).toEqual([batchA2Id])
      expect(patched.role).toBe('harvest_lead')
      expect(patched.status).toBe('INACTIVE')
      expect(patched.name).toBe('Ann Wambui')

      // Status change is audited (old -> new).
      const auditRows = await db.select().from(auditLog).where(eq(auditLog.entityId, created.id))
      const statusEntry = auditRows.find((r) => r.action === 'employee.status_changed')
      expect(statusEntry).toBeTruthy()
      expect((statusEntry?.meta as { changes?: Record<string, unknown> })?.changes).toMatchObject({
        status: { old: 'ACTIVE', new: 'INACTIVE' },
      })
    })

    it('rejects with no session (401)', async () => {
      mockCookie = undefined
      const patchRes = await employeePATCH(
        patchRequest('http://localhost/api/employees/anything', { role: 'manager' }),
        { params: Promise.resolve({ id: 'anything' }) }
      )
      expect(patchRes.status).toBe(401)
    })

    it('forbids a worker from writing (403)', async () => {
      mockCookie = ownerASession
      const createRes = await employeesPOST(postRequest('http://localhost/api/employees', { name: 'Worker-Blocked Target' }))
      const created = (await createRes.json()).data

      mockCookie = workerASession
      const patchRes = await employeePATCH(
        patchRequest(`http://localhost/api/employees/${created.id}`, { role: 'manager' }),
        { params: Promise.resolve({ id: created.id }) }
      )
      expect(patchRes.status).toBe(403)
    })

    it('returns 404 for an employee belonging to a different tenant (session tenant vs. target tenant mismatch)', async () => {
      mockCookie = ownerBSession
      const createRes = await employeesPOST(postRequest('http://localhost/api/employees', { name: 'B-Tenant Worker 2' }))
      const created = (await createRes.json()).data

      // Tenant A's owner, targeting an employee that actually belongs to tenant B.
      mockCookie = ownerASession
      const patchRes = await employeePATCH(
        patchRequest(`http://localhost/api/employees/${created.id}`, { role: 'manager' }),
        { params: Promise.resolve({ id: created.id }) }
      )
      expect(patchRes.status).toBe(404)

      // And tenant B's own owner CAN reach it.
      mockCookie = ownerBSession
      const ownRes = await employeePATCH(
        patchRequest(`http://localhost/api/employees/${created.id}`, { role: 'manager' }),
        { params: Promise.resolve({ id: created.id }) }
      )
      expect(ownRes.status).toBe(200)
    })

    it('rejects an assignedBatchIds update referencing a foreign batch', async () => {
      mockCookie = ownerASession
      const createRes = await employeesPOST(postRequest('http://localhost/api/employees', { name: 'Moses Kiptoo' }))
      const created = (await createRes.json()).data

      const patchRes = await employeePATCH(
        patchRequest(`http://localhost/api/employees/${created.id}`, { assignedBatchIds: [batchBId] }),
        { params: Promise.resolve({ id: created.id }) }
      )
      expect(patchRes.status).toBe(404)
    })

    it('rejects a status value outside ACTIVE/INACTIVE with fields.status (400)', async () => {
      mockCookie = ownerASession
      const createRes = await employeesPOST(postRequest('http://localhost/api/employees', { name: 'Bad Status Target' }))
      const created = (await createRes.json()).data

      const patchRes = await employeePATCH(
        patchRequest(`http://localhost/api/employees/${created.id}`, { status: 'DELETED' }),
        { params: Promise.resolve({ id: created.id }) }
      )
      expect(patchRes.status).toBe(400)
      const payload = await patchRes.json()
      expect(payload.success).toBe(false)
      expect(typeof payload.fields.status).toBe('string')
    })
  })

  describe('GET /api/employees/me', () => {
    afterEach(() => { mockCookie = undefined })

    it('resolves the caller\'s employee row by userId and returns mortalityPhotoThreshold', async () => {
      // Session-derived userId now (auth fix: fix/authenticate-all-apis) — no
      // more `?userId=` query-param fallback. workerUserSession's user id is
      // the real `workerUserId` the "creates an employee..." test above
      // linked via `userId: workerUserId`.
      mockCookie = workerUserSession
      const res = await employeeMeGET()
      expect(res.status).toBe(200)
      const payload = await res.json()
      expect(payload.success).toBe(true)
      expect(payload.data.userId).toBe(workerUserId)
      expect(payload.data.mortalityPhotoThreshold).toBe(5)
    })

    it('returns 404 when no employee is linked to the caller', async () => {
      mockCookie = noEmployeeUserSession
      const res = await employeeMeGET()
      expect(res.status).toBe(404)
    })

    it('401s with no session', async () => {
      mockCookie = undefined
      const res = await employeeMeGET()
      expect(res.status).toBe(401)
    })
  })

  describe('POST/GET /api/records', () => {
    afterEach(() => { mockCookie = undefined })

    it('persists a mortality record and reads it back via GET /api/records', async () => {
      mockCookie = ownerASession
      const empRes = await employeesPOST(postRequest('http://localhost/api/employees', { name: 'Record Submitter' }))
      const employee = (await empRes.json()).data

      const createRes = await recordsPOST(
        postRequest('http://localhost/api/records', {
          batchId: batchAId,
          employeeId: employee.id,
          type: 'mortality',
          data: { count: 4, cause: 'Disease' },
          photoUrl: 'https://example.com/photo.jpg',
        })
      )
      expect(createRes.status).toBe(201)
      const createdRecord = (await createRes.json()).data
      expect(createdRecord.type).toBe('mortality')
      expect(createdRecord.data).toEqual({ count: 4, cause: 'Disease' })
      expect(createdRecord.photoUrl).toBe('https://example.com/photo.jpg')

      const listRes = await recordsGET(getRequest(`http://localhost/api/records?batchId=${batchAId}&type=mortality`))
      expect(listRes.status).toBe(200)
      const listPayload = await listRes.json()
      expect(listPayload.data.some((r: { id: string }) => r.id === createdRecord.id)).toBe(true)
      expect(listPayload.data.every((r: { tenantId: string }) => r.tenantId === tenantAId)).toBe(true)
    })

    it('rejects an unknown record type', async () => {
      mockCookie = ownerASession
      const empRes = await employeesPOST(postRequest('http://localhost/api/employees', { name: 'Bad Type Submitter' }))
      const employee = (await empRes.json()).data

      const res = await recordsPOST(
        postRequest('http://localhost/api/records', { batchId: batchAId, employeeId: employee.id, type: 'not-a-type' })
      )
      expect(res.status).toBe(400)
    })

    it('rejects a batchId belonging to a different tenant', async () => {
      mockCookie = ownerASession
      const empRes = await employeesPOST(postRequest('http://localhost/api/employees', { name: 'Cross Batch Submitter' }))
      const employee = (await empRes.json()).data

      const res = await recordsPOST(
        postRequest('http://localhost/api/records', { batchId: batchBId, employeeId: employee.id, type: 'feeding' })
      )
      expect(res.status).toBe(404)
    })

    it('rejects an employeeId belonging to a different tenant', async () => {
      mockCookie = ownerBSession
      const otherEmpRes = await employeesPOST(postRequest('http://localhost/api/employees', { name: 'Other Tenant Submitter' }))
      const otherEmployee = (await otherEmpRes.json()).data

      mockCookie = ownerASession
      const res = await recordsPOST(
        postRequest('http://localhost/api/records', { batchId: batchAId, employeeId: otherEmployee.id, type: 'feeding' })
      )
      expect(res.status).toBe(404)
    })
  })
})
