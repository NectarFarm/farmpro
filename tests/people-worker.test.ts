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
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { inArray } from 'drizzle-orm'

vi.mock('server-only', () => ({}))
vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({ get: () => undefined })),
}))

import { GET as employeesGET, POST as employeesPOST } from '@/app/api/employees/route'
import { GET as employeeGET, PATCH as employeePATCH } from '@/app/api/employees/[id]/route'
import { GET as employeeMeGET } from '@/app/api/employees/me/route'
import { GET as recordsGET, POST as recordsPOST } from '@/app/api/records/route'
import { db } from '@/db'
import { tenants, farms, productionUnits, batches, employees, records } from '@/db/schemas'

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
  })

  afterAll(async () => {
    await db.delete(records).where(inArray(records.tenantId, [tenantAId, tenantBId]))
    await db.delete(employees).where(inArray(employees.tenantId, [tenantAId, tenantBId]))
    await db.delete(batches).where(inArray(batches.tenantId, [tenantAId, tenantBId]))
    await db.delete(productionUnits).where(inArray(productionUnits.tenantId, [tenantAId, tenantBId]))
    await db.delete(farms).where(inArray(farms.tenantId, [tenantAId, tenantBId]))
    await db.delete(tenants).where(inArray(tenants.id, [tenantAId, tenantBId]))
  })

  describe('POST/GET /api/employees', () => {
    it('creates an employee with assignedBatchIds and reads it back', async () => {
      const res = await employeesPOST(
        postRequest('http://localhost/api/employees', {
          tenantId: tenantAId,
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

      const readRes = await employeeGET(getRequest(`http://localhost/api/employees/${payload.data.id}?tenantId=${tenantAId}`), {
        params: Promise.resolve({ id: payload.data.id }),
      })
      expect(readRes.status).toBe(200)
      expect((await readRes.json()).data.phone).toBe('+254-722-111-222')
    })

    it('defaults mortalityPhotoThreshold to 3 when not provided', async () => {
      const res = await employeesPOST(
        postRequest('http://localhost/api/employees', { tenantId: tenantAId, name: 'Sarah Mwangi' })
      )
      expect(res.status).toBe(201)
      const payload = await res.json()
      expect(payload.data.mortalityPhotoThreshold).toBe(3)
      expect(payload.data.assignedBatchIds).toEqual([])
    })

    it('rejects an assignedBatchIds entry belonging to a different tenant', async () => {
      const res = await employeesPOST(
        postRequest('http://localhost/api/employees', {
          tenantId: tenantAId,
          name: 'Cross-tenant attempt',
          assignedBatchIds: [batchBId],
        })
      )
      expect(res.status).toBe(404)
    })

    it('requires tenantId and name', async () => {
      const res = await employeesPOST(postRequest('http://localhost/api/employees', {}))
      expect(res.status).toBe(400)
    })

    it('lists only the requesting tenant\'s employees', async () => {
      await employeesPOST(postRequest('http://localhost/api/employees', { tenantId: tenantBId, name: 'Other Tenant Worker' }))

      const res = await employeesGET(getRequest(`http://localhost/api/employees?tenantId=${tenantAId}`))
      expect(res.status).toBe(200)
      const payload = await res.json()
      expect(payload.data.length).toBeGreaterThanOrEqual(2)
      expect(payload.data.every((row: { tenantId: string }) => row.tenantId === tenantAId)).toBe(true)
    })
  })

  describe('PATCH /api/employees/[id]', () => {
    it('updates assignedBatchIds (full replace) and other fields', async () => {
      const createRes = await employeesPOST(
        postRequest('http://localhost/api/employees', { tenantId: tenantAId, name: 'Ann Wambui', assignedBatchIds: [batchAId] })
      )
      const created = (await createRes.json()).data

      const patchRes = await employeePATCH(
        patchRequest(`http://localhost/api/employees/${created.id}?tenantId=${tenantAId}`, {
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
    })

    it('returns 404 for an employee belonging to a different tenant', async () => {
      const createRes = await employeesPOST(postRequest('http://localhost/api/employees', { tenantId: tenantBId, name: 'B-Tenant Worker 2' }))
      const created = (await createRes.json()).data

      const patchRes = await employeePATCH(
        patchRequest(`http://localhost/api/employees/${created.id}?tenantId=${tenantAId}`, { role: 'manager' }),
        { params: Promise.resolve({ id: created.id }) }
      )
      expect(patchRes.status).toBe(404)
    })

    it('rejects an assignedBatchIds update referencing a foreign batch', async () => {
      const createRes = await employeesPOST(postRequest('http://localhost/api/employees', { tenantId: tenantAId, name: 'Moses Kiptoo' }))
      const created = (await createRes.json()).data

      const patchRes = await employeePATCH(
        patchRequest(`http://localhost/api/employees/${created.id}?tenantId=${tenantAId}`, { assignedBatchIds: [batchBId] }),
        { params: Promise.resolve({ id: created.id }) }
      )
      expect(patchRes.status).toBe(404)
    })
  })

  describe('GET /api/employees/me', () => {
    it('resolves the caller\'s employee row by userId and returns mortalityPhotoThreshold', async () => {
      const res = await employeeMeGET(getRequest(`http://localhost/api/employees/me?tenantId=${tenantAId}&userId=${workerUserId}`))
      expect(res.status).toBe(200)
      const payload = await res.json()
      expect(payload.success).toBe(true)
      expect(payload.data.userId).toBe(workerUserId)
      expect(payload.data.mortalityPhotoThreshold).toBe(5)
    })

    it('returns 404 when no employee is linked to the given userId', async () => {
      const res = await employeeMeGET(getRequest(`http://localhost/api/employees/me?tenantId=${tenantAId}&userId=usr-does-not-exist`))
      expect(res.status).toBe(404)
    })
  })

  describe('POST/GET /api/records', () => {
    it('persists a mortality record and reads it back via GET /api/records', async () => {
      const empRes = await employeesPOST(postRequest('http://localhost/api/employees', { tenantId: tenantAId, name: 'Record Submitter' }))
      const employee = (await empRes.json()).data

      const createRes = await recordsPOST(
        postRequest('http://localhost/api/records', {
          tenantId: tenantAId,
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

      const listRes = await recordsGET(getRequest(`http://localhost/api/records?tenantId=${tenantAId}&batchId=${batchAId}&type=mortality`))
      expect(listRes.status).toBe(200)
      const listPayload = await listRes.json()
      expect(listPayload.data.some((r: { id: string }) => r.id === createdRecord.id)).toBe(true)
      expect(listPayload.data.every((r: { tenantId: string }) => r.tenantId === tenantAId)).toBe(true)
    })

    it('rejects an unknown record type', async () => {
      const empRes = await employeesPOST(postRequest('http://localhost/api/employees', { tenantId: tenantAId, name: 'Bad Type Submitter' }))
      const employee = (await empRes.json()).data

      const res = await recordsPOST(
        postRequest('http://localhost/api/records', { tenantId: tenantAId, batchId: batchAId, employeeId: employee.id, type: 'not-a-type' })
      )
      expect(res.status).toBe(400)
    })

    it('rejects a batchId belonging to a different tenant', async () => {
      const empRes = await employeesPOST(postRequest('http://localhost/api/employees', { tenantId: tenantAId, name: 'Cross Batch Submitter' }))
      const employee = (await empRes.json()).data

      const res = await recordsPOST(
        postRequest('http://localhost/api/records', { tenantId: tenantAId, batchId: batchBId, employeeId: employee.id, type: 'feeding' })
      )
      expect(res.status).toBe(404)
    })

    it('rejects an employeeId belonging to a different tenant', async () => {
      const otherEmpRes = await employeesPOST(postRequest('http://localhost/api/employees', { tenantId: tenantBId, name: 'Other Tenant Submitter' }))
      const otherEmployee = (await otherEmpRes.json()).data

      const res = await recordsPOST(
        postRequest('http://localhost/api/records', { tenantId: tenantAId, batchId: batchAId, employeeId: otherEmployee.id, type: 'feeding' })
      )
      expect(res.status).toBe(404)
    })

    it('rejects a mortality record at/above the photo threshold with no photo (server-side gate)', async () => {
      // Threshold defaults to 3 (see employees POST test above)
      const empRes = await employeesPOST(postRequest('http://localhost/api/employees', { tenantId: tenantAId, name: 'No-Photo Submitter' }))
      const employee = (await empRes.json()).data
      expect(employee.mortalityPhotoThreshold).toBe(3)

      // Below threshold → allowed without a photo
      const below = await recordsPOST(
        postRequest('http://localhost/api/records', {
          tenantId: tenantAId, batchId: batchAId, employeeId: employee.id,
          type: 'mortality', data: { count: 2, cause: 'Injury' },
        })
      )
      expect(below.status).toBe(201)
      const belowRecord = (await below.json()).data
      expect(belowRecord.photoUrl).toBeNull()

      // At threshold → rejected without a photo
      const atThreshold = await recordsPOST(
        postRequest('http://localhost/api/records', {
          tenantId: tenantAId, batchId: batchAId, employeeId: employee.id,
          type: 'mortality', data: { count: 3, cause: 'Disease' },
        })
      )
      expect(atThreshold.status).toBe(400)
      expect((await atThreshold.json()).error).toMatch(/photo is required/i)

      // Above threshold → rejected without a photo
      const above = await recordsPOST(
        postRequest('http://localhost/api/records', {
          tenantId: tenantAId, batchId: batchAId, employeeId: employee.id,
          type: 'mortality', data: { count: 4, cause: 'Disease' },
        })
      )
      expect(above.status).toBe(400)

      // Above threshold → accepted WITH a photo
      const withPhoto = await recordsPOST(
        postRequest('http://localhost/api/records', {
          tenantId: tenantAId, batchId: batchAId, employeeId: employee.id,
          type: 'mortality', data: { count: 4, cause: 'Disease' },
          photoUrl: 'https://example.com/evidence.jpg',
        })
      )
      expect(withPhoto.status).toBe(201)
    })

    it('uses the employee\'s real threshold, not a hardcoded 3', async () => {
      const empRes = await employeesPOST(postRequest('http://localhost/api/employees', {
        tenantId: tenantAId, name: 'High-Threshold Submitter', mortalityPhotoThreshold: 10,
      }))
      const employee = (await empRes.json()).data
      expect(employee.mortalityPhotoThreshold).toBe(10)

      // count 5 < 10 → allowed without a photo even though it exceeds a 3 default
      const below = await recordsPOST(
        postRequest('http://localhost/api/records', {
          tenantId: tenantAId, batchId: batchAId, employeeId: employee.id,
          type: 'mortality', data: { count: 5, cause: 'Unknown' },
        })
      )
      expect(below.status).toBe(201)

      // count 12 >= 10 → rejected without a photo
      const above = await recordsPOST(
        postRequest('http://localhost/api/records', {
          tenantId: tenantAId, batchId: batchAId, employeeId: employee.id,
          type: 'mortality', data: { count: 12, cause: 'Unknown' },
        })
      )
      expect(above.status).toBe(400)
    })

    it('does not gate non-mortality record types on the photo rule', async () => {
      const empRes = await employeesPOST(postRequest('http://localhost/api/employees', { tenantId: tenantAId, name: 'Feeding Submitter' }))
      const employee = (await empRes.json()).data

      // feeding with a large data.count (irrelevant field) and no photo → fine
      const res = await recordsPOST(
        postRequest('http://localhost/api/records', {
          tenantId: tenantAId, batchId: batchAId, employeeId: employee.id,
          type: 'feeding', data: { count: 50, feedType: 'mash' },
        })
      )
      expect(res.status).toBe(201)
    })
  })
})
