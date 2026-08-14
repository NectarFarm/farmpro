// ── Units backend tests (issue #232) ────────────────────────────────────────
// Integration tests that call the real GET/POST /api/units route handlers
// against the real postgres when DATABASE_URL is set (local/dev); CI has no
// database, so the suite skips there (vitest exits 0, and CI's build/typecheck
// still run) — same pattern as tests/batches.test.ts / tests/auth.test.ts.
//
// No session cookie is set, so getSessionUser() resolves to null and every
// route falls back to its `tenantId` query param / body field (the same
// standalone-mock-mode fallback GET /api/farms already uses).
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { inArray } from 'drizzle-orm'

vi.mock('server-only', () => ({}))
vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({ get: () => undefined })),
}))

import { GET as unitsGET, POST as unitsPOST } from '@/app/api/units/route'
import { db } from '@/db'
import { tenants, farms, productionUnits } from '@/db/schemas'

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

run('units: GET/POST /api/units + code generation (issue #232)', () => {
  const tenantAId = `t-${randomUUID()}`
  const tenantBId = `t-${randomUUID()}`
  const farmAId = `f-${randomUUID()}`
  const farmBId = `f-${randomUUID()}`

  beforeAll(async () => {
    await db.insert(tenants).values([
      { id: tenantAId, name: 'Units Test Co. A', active: true },
      { id: tenantBId, name: 'Units Test Co. B', active: true },
    ])
    await db.insert(farms).values([
      { id: farmAId, tenantId: tenantAId, name: 'Farm A', location: 'Nakuru', code: 'FRM-KMU-001' },
      { id: farmBId, tenantId: tenantBId, name: 'Farm B', location: 'Eldoret', code: 'FRM-ELD-001' },
    ])
  })

  afterAll(async () => {
    await db.delete(productionUnits).where(inArray(productionUnits.tenantId, [tenantAId, tenantBId]))
    await db.delete(farms).where(inArray(farms.tenantId, [tenantAId, tenantBId]))
    await db.delete(tenants).where(inArray(tenants.id, [tenantAId, tenantBId]))
  })

  describe('POST /api/units', () => {
    it('creates a unit with a generated HSE-<segment>-NNN code from the enterprise subtype', async () => {
      const res = await unitsPOST(
        postRequest('http://localhost/api/units', {
          tenantId: tenantAId,
          farmId: farmAId,
          type: 'house',
          name: 'House A01',
          enterprise: 'broiler',
        })
      )
      expect(res.status).toBe(201)
      const payload = await res.json()
      expect(payload.success).toBe(true)
      expect(payload.data.code).toBe('HSE-KMU-001')
      expect(payload.data.status).toBe('ACTIVE')
      expect(payload.data.farmId).toBe(farmAId)
    })

    it('increments the sequence per tenant+prefix+farm-segment for a second unit', async () => {
      const res = await unitsPOST(
        postRequest('http://localhost/api/units', {
          tenantId: tenantAId,
          farmId: farmAId,
          type: 'house',
          name: 'House A02',
          enterprise: 'broiler',
        })
      )
      expect(res.status).toBe(201)
      const payload = await res.json()
      expect(payload.data.code).toBe('HSE-KMU-002')
    })

    it('falls back to a type-derived prefix when no enterprise is given', async () => {
      const res = await unitsPOST(
        postRequest('http://localhost/api/units', {
          tenantId: tenantAId,
          farmId: farmAId,
          type: 'greenhouse',
          name: 'Greenhouse 1',
        })
      )
      expect(res.status).toBe(201)
      const payload = await res.json()
      expect(payload.data.code).toMatch(/^GRE-KMU-\d{3}$/)
    })

    it('rejects a farmId belonging to a different tenant', async () => {
      const res = await unitsPOST(
        postRequest('http://localhost/api/units', {
          tenantId: tenantAId,
          farmId: farmBId,
          type: 'house',
          name: 'Cross-tenant attempt',
        })
      )
      expect(res.status).toBe(404)
    })

    it('requires tenantId, farmId, type, and name', async () => {
      const res = await unitsPOST(postRequest('http://localhost/api/units', { tenantId: tenantAId }))
      expect(res.status).toBe(400)
    })

    it('de-dupes a repeated explicit code for the same tenant instead of colliding (same convention as POST /api/farms and /api/batches)', async () => {
      const first = await unitsPOST(
        postRequest('http://localhost/api/units', {
          tenantId: tenantAId,
          farmId: farmAId,
          type: 'pen',
          name: 'Pen X',
          code: 'PEN-KMU-X01',
        })
      )
      expect(first.status).toBe(201)
      expect((await first.json()).data.code).toBe('PEN-KMU-X01')

      const dup = await unitsPOST(
        postRequest('http://localhost/api/units', {
          tenantId: tenantAId,
          farmId: farmAId,
          type: 'pen',
          name: 'Pen X duplicate',
          code: 'PEN-KMU-X01',
        })
      )
      expect(dup.status).toBe(201)
      const dupPayload = await dup.json()
      expect(dupPayload.data.code).not.toBe('PEN-KMU-X01')
      expect(dupPayload.data.code.startsWith('PEN-KMU-X01-')).toBe(true)
    })
  })

  describe('GET /api/units', () => {
    it("lists only the requesting tenant's units", async () => {
      await unitsPOST(
        postRequest('http://localhost/api/units', {
          tenantId: tenantBId,
          farmId: farmBId,
          type: 'pen',
          name: 'Layer Pen B01',
          enterprise: 'layer',
        })
      )

      const res = await unitsGET(getRequest(`http://localhost/api/units?tenantId=${tenantAId}`))
      expect(res.status).toBe(200)
      const payload = await res.json()
      expect(payload.data.length).toBeGreaterThanOrEqual(3)
      expect(payload.data.every((row: { tenantId: string }) => row.tenantId === tenantAId)).toBe(true)
    })

    it('filters by farmId when provided', async () => {
      const farmCId = `f-${randomUUID()}`
      await db.insert(farms).values({ id: farmCId, tenantId: tenantAId, name: 'Farm C', location: 'Kisumu', code: 'FRM-KSM-001' })
      await unitsPOST(
        postRequest('http://localhost/api/units', {
          tenantId: tenantAId,
          farmId: farmCId,
          type: 'field',
          name: 'Field C01',
          enterprise: 'maize',
        })
      )

      const res = await unitsGET(getRequest(`http://localhost/api/units?tenantId=${tenantAId}&farmId=${farmCId}`))
      expect(res.status).toBe(200)
      const payload = await res.json()
      expect(payload.data.length).toBe(1)
      expect(payload.data[0].farmId).toBe(farmCId)

      await db.delete(productionUnits).where(inArray(productionUnits.farmId, [farmCId]))
      await db.delete(farms).where(inArray(farms.id, [farmCId]))
    })

    it('requires tenantId', async () => {
      const res = await unitsGET(getRequest('http://localhost/api/units'))
      expect(res.status).toBe(400)
    })
  })
})
