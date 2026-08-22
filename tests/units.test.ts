// ── Units backend tests (issue #232) ────────────────────────────────────────
// Integration tests that call the real GET/POST /api/units route handlers
// against the real postgres when DATABASE_URL is set (local/dev); CI has no
// database, so the suite skips there (vitest exits 0, and CI's build/typecheck
// still run) — same pattern as tests/batches.test.ts / tests/auth.test.ts.
//
// Auth fix (fix/authenticate-all-apis): a real session is required, and
// tenant scope comes from that session's own tenantId only — a `tenantId` in
// the query string or body is never consulted for an ordinary (non-
// super_admin) session. Tests authenticate as a real owner of the relevant
// tenant instead of relying on the old query-param/body fallback.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { inArray } from 'drizzle-orm'

vi.mock('server-only', () => ({}))

let mockCookie: string | undefined
vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({ get: () => (mockCookie ? { value: mockCookie } : undefined) })),
}))

import { GET as unitsGET, POST as unitsPOST } from '@/app/api/units/route'
import { db } from '@/db'
import { tenants, users, sessions, farms, productionUnits } from '@/db/schemas'
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

run('units: GET/POST /api/units + code generation (issue #232)', () => {
  const tenantAId = `t-${randomUUID()}`
  const tenantBId = `t-${randomUUID()}`
  const farmAId = `f-${randomUUID()}`
  const farmBId = `f-${randomUUID()}`

  const ownerAId = randomUUID()
  const ownerBId = randomUUID()
  let ownerAToken: string
  let ownerBToken: string

  beforeAll(async () => {
    await db.insert(tenants).values([
      { id: tenantAId, name: 'Units Test Co. A', active: true },
      { id: tenantBId, name: 'Units Test Co. B', active: true },
    ])
    await db.insert(farms).values([
      { id: farmAId, tenantId: tenantAId, name: 'Farm A', location: 'Nakuru', code: 'FRM-KMU-001' },
      { id: farmBId, tenantId: tenantBId, name: 'Farm B', location: 'Eldoret', code: 'FRM-ELD-001' },
    ])
    const salt = () => `salt-${randomUUID()}`
    await db.insert(users).values([
      { id: ownerAId, tenantId: tenantAId, name: 'Owner A', email: `owner-a-${randomUUID()}@test.ifms`, role: 'owner', passwordHash: hashSecret('pw', salt()), passwordSalt: salt(), status: 'ACTIVE' },
      { id: ownerBId, tenantId: tenantBId, name: 'Owner B', email: `owner-b-${randomUUID()}@test.ifms`, role: 'owner', passwordHash: hashSecret('pw', salt()), passwordSalt: salt(), status: 'ACTIVE' },
    ])
    ownerAToken = await createSession(ownerAId)
    ownerBToken = await createSession(ownerBId)
  })

  afterAll(async () => {
    await db.delete(productionUnits).where(inArray(productionUnits.tenantId, [tenantAId, tenantBId]))
    await db.delete(farms).where(inArray(farms.tenantId, [tenantAId, tenantBId]))
    await db.delete(sessions).where(inArray(sessions.userId, [ownerAId, ownerBId]))
    await db.delete(users).where(inArray(users.id, [ownerAId, ownerBId]))
    await db.delete(tenants).where(inArray(tenants.id, [tenantAId, tenantBId]))
    mockCookie = undefined
  })

  describe('POST /api/units', () => {
    it('creates a unit with a generated HSE-<segment>-NNN code from the enterprise subtype', async () => {
      mockCookie = ownerAToken
      const res = await unitsPOST(
        postRequest('http://localhost/api/units', {
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
      mockCookie = ownerAToken
      const res = await unitsPOST(
        postRequest('http://localhost/api/units', {
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
      mockCookie = ownerAToken
      const res = await unitsPOST(
        postRequest('http://localhost/api/units', {
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
      mockCookie = ownerAToken
      const res = await unitsPOST(
        postRequest('http://localhost/api/units', {
          farmId: farmBId,
          type: 'house',
          name: 'Cross-tenant attempt',
        })
      )
      expect(res.status).toBe(404)
    })

    it('requires farmId, type, and name', async () => {
      mockCookie = ownerAToken
      const res = await unitsPOST(postRequest('http://localhost/api/units', {}))
      expect(res.status).toBe(400)
    })

    it('401s unauthenticated', async () => {
      mockCookie = undefined
      const res = await unitsPOST(postRequest('http://localhost/api/units', { farmId: farmAId, type: 'house', name: 'x' }))
      expect(res.status).toBe(401)
    })

    it('ignores a body-supplied tenantId naming a different tenant — the session\'s own tenant always wins', async () => {
      mockCookie = ownerAToken
      const res = await unitsPOST(
        postRequest('http://localhost/api/units', {
          tenantId: tenantBId,
          farmId: farmAId,
          type: 'house',
          name: 'Should still be tenant A',
        })
      )
      // farmAId belongs to tenant A; if the body tenantId had won, this
      // would 404 (farm not found for tenant B) instead of succeeding.
      expect(res.status).toBe(201)
      const payload = await res.json()
      expect(payload.data.tenantId).toBe(tenantAId)
    })

    it('de-dupes a repeated explicit code for the same tenant instead of colliding (same convention as POST /api/farms and /api/batches)', async () => {
      mockCookie = ownerAToken
      const first = await unitsPOST(
        postRequest('http://localhost/api/units', {
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
      mockCookie = ownerBToken
      await unitsPOST(
        postRequest('http://localhost/api/units', {
          farmId: farmBId,
          type: 'pen',
          name: 'Layer Pen B01',
          enterprise: 'layer',
        })
      )

      mockCookie = ownerAToken
      const res = await unitsGET(getRequest('http://localhost/api/units'))
      expect(res.status).toBe(200)
      const payload = await res.json()
      expect(payload.data.length).toBeGreaterThanOrEqual(3)
      expect(payload.data.every((row: { tenantId: string }) => row.tenantId === tenantAId)).toBe(true)
    })

    it('filters by farmId when provided', async () => {
      mockCookie = ownerAToken
      const farmCId = `f-${randomUUID()}`
      await db.insert(farms).values({ id: farmCId, tenantId: tenantAId, name: 'Farm C', location: 'Kisumu', code: 'FRM-KSM-001' })
      await unitsPOST(
        postRequest('http://localhost/api/units', {
          farmId: farmCId,
          type: 'field',
          name: 'Field C01',
          enterprise: 'maize',
        })
      )

      const res = await unitsGET(getRequest(`http://localhost/api/units?farmId=${farmCId}`))
      expect(res.status).toBe(200)
      const payload = await res.json()
      expect(payload.data.length).toBe(1)
      expect(payload.data[0].farmId).toBe(farmCId)

      await db.delete(productionUnits).where(inArray(productionUnits.farmId, [farmCId]))
      await db.delete(farms).where(inArray(farms.id, [farmCId]))
    })

    it('401s unauthenticated, and a query-string tenantId is never consulted', async () => {
      mockCookie = undefined
      const res = await unitsGET(getRequest(`http://localhost/api/units?tenantId=${tenantAId}`))
      expect(res.status).toBe(401)
    })
  })
})
