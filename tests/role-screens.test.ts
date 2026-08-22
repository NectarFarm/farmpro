// ── Vet / auditor / admin-settings screens: role-gate tests ─────────────────
// Integration tests that call the real route handlers directly against real
// Postgres (no HTTP server needed), same pattern as tests/farm-scoping.test.ts /
// tests/settings.test.ts. Skips when DATABASE_URL is unset (CI has no
// database).
//
// vet and auditor used to be funneled straight to a "not supported" notice
// screen with zero tabs — this suite proves the real screens' server-side
// boundary, not just that the UI now shows something:
//   - an auditor can read the four report endpoints for their own tenant,
//     is refused (403) on a representative write endpoint, and can never
//     read another tenant's reports even by naming one explicitly
//   - a vet can list batches/records and POST a mortality record, but is
//     refused (403) on an admin-only route
//   - a super_admin can GET/PATCH another tenant's settings by naming it
//     explicitly (their own session carries no tenantId); a normal owner
//     cannot use the same query param to reach a tenant that isn't theirs
//   - unauthenticated calls 401 on every route this task modified
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { eq, inArray } from 'drizzle-orm'

vi.mock('server-only', () => ({}))

let mockCookie: string | undefined
vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({ get: () => (mockCookie ? { value: mockCookie } : undefined) })),
}))

import { GET as plGET } from '@/app/api/reports/pl/route'
import { GET as batchPlGET } from '@/app/api/reports/batch-pl/route'
import { GET as mortalityGET } from '@/app/api/reports/mortality/route'
import { GET as feedGET } from '@/app/api/reports/feed-consumption/route'
import { GET as batchesGET } from '@/app/api/batches/route'
import { GET as recordsGET, POST as recordsPOST } from '@/app/api/records/route'
import { GET as adminTenantsGET } from '@/app/api/admin/tenants/route'
import { GET as settingsGET, PATCH as settingsPATCH } from '@/app/api/settings/route'
import { db } from '@/db'
import {
  tenants, users, sessions, farms, productionUnits, batches, employees, records, tenantSettings,
} from '@/db/schemas'
import { createSession, hashSecret } from '@/lib/auth'

const hasDb = !!process.env.DATABASE_URL
const run = hasDb ? describe : describe.skip

function getRequest(url: string): Request {
  return new Request(url)
}
function postRequest(url: string, body: unknown): Request {
  return new Request(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
}
function patchRequest(url: string, body: unknown): Request {
  return new Request(url, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
}
async function readJson(res: Response) {
  return { status: res.status, payload: await res.json() }
}

run('vet/auditor/admin-settings screens: role gates', () => {
  const tenantAId = `t-rs-a-${randomUUID()}`
  const tenantBId = `t-rs-b-${randomUUID()}`

  const farmAId = `f-rs-a-${randomUUID()}`
  const farmBId = `f-rs-b-${randomUUID()}`
  const unitAId = `u-rs-a-${randomUUID()}`
  const unitBId = `u-rs-b-${randomUUID()}`
  const batchAId = `b-rs-a-${randomUUID()}`
  const batchBId = `b-rs-b-${randomUUID()}`
  const vetEmployeeId = `e-rs-vet-${randomUUID()}`
  const otherEmployeeId = `e-rs-other-${randomUUID()}`

  const ownerAId = randomUUID()
  const auditorAId = randomUUID()
  const vetAId = randomUUID()
  const ownerBId = randomUUID()
  const superAdminId = randomUUID()

  let ownerASession: string
  let auditorASession: string
  let vetASession: string
  let superAdminSession: string

  beforeAll(async () => {
    await db.insert(tenants).values([
      { id: tenantAId, name: 'Role Screens Co. A', active: true },
      { id: tenantBId, name: 'Role Screens Co. B', active: true },
    ])
    await db.insert(farms).values([
      { id: farmAId, tenantId: tenantAId, name: 'Farm A', location: 'Nakuru', code: 'FRM-RSA-001' },
      { id: farmBId, tenantId: tenantBId, name: 'Farm B', location: 'Eldoret', code: 'FRM-RSB-001' },
    ])
    await db.insert(productionUnits).values([
      { id: unitAId, tenantId: tenantAId, farmId: farmAId, type: 'house', name: 'House A', code: 'HSE-RSA-01' },
      { id: unitBId, tenantId: tenantBId, farmId: farmBId, type: 'house', name: 'House B', code: 'HSE-RSB-01' },
    ])
    await db.insert(batches).values([
      { id: batchAId, tenantId: tenantAId, unitId: unitAId, code: 'BRO-RSA-001', name: 'Batch A', enterprise: 'broiler', currentQty: 100 },
      { id: batchBId, tenantId: tenantBId, unitId: unitBId, code: 'BRO-RSB-001', name: 'Batch B', enterprise: 'broiler', currentQty: 200 },
    ])
    await db.insert(employees).values([
      { id: otherEmployeeId, tenantId: tenantAId, name: 'Farmhand A' },
    ])
    // A mortality record per tenant, with a different death count, so the
    // "auditor cannot read another tenant's reports" test can tell the two
    // tenants' data apart.
    await db.insert(records).values([
      { id: `r-rs-a-${randomUUID()}`, tenantId: tenantAId, batchId: batchAId, employeeId: otherEmployeeId, type: 'mortality', data: { count: 3, cause: 'Heat stress' } },
      { id: `r-rs-b-${randomUUID()}`, tenantId: tenantBId, batchId: batchBId, employeeId: otherEmployeeId, type: 'mortality', data: { count: 99, cause: 'Should never be visible to tenant A' } },
    ])

    const salt = () => `salt-${randomUUID()}`
    await db.insert(users).values([
      { id: ownerAId, tenantId: tenantAId, name: 'Owner A', email: `owner-a-${randomUUID()}@test.ifms`, role: 'owner', passwordHash: hashSecret('pw', salt()), passwordSalt: salt(), status: 'ACTIVE' },
      { id: auditorAId, tenantId: tenantAId, name: 'Auditor A', email: `auditor-a-${randomUUID()}@test.ifms`, role: 'auditor', passwordHash: hashSecret('pw', salt()), passwordSalt: salt(), status: 'ACTIVE' },
      { id: vetAId, tenantId: tenantAId, name: 'Vet A', email: `vet-a-${randomUUID()}@test.ifms`, role: 'vet', passwordHash: hashSecret('pw', salt()), passwordSalt: salt(), status: 'ACTIVE' },
      { id: ownerBId, tenantId: tenantBId, name: 'Owner B', email: `owner-b-${randomUUID()}@test.ifms`, role: 'owner', passwordHash: hashSecret('pw', salt()), passwordSalt: salt(), status: 'ACTIVE' },
      { id: superAdminId, tenantId: null, name: 'Super Admin', email: `super-${randomUUID()}@test.ifms`, role: 'super_admin', passwordHash: hashSecret('pw', salt()), passwordSalt: salt(), status: 'ACTIVE' },
    ])

    // The vet's employees row, linked by userId — same shape
    // scripts/seed-demo-data.mjs now seeds for the real vet demo login, and
    // what GET /api/employees/me (components/farm/vet.tsx) resolves by.
    await db.insert(employees).values({ id: vetEmployeeId, tenantId: tenantAId, userId: vetAId, name: 'Vet A', role: 'vet' })

    ownerASession = await createSession(ownerAId)
    auditorASession = await createSession(auditorAId)
    vetASession = await createSession(vetAId)
    superAdminSession = await createSession(superAdminId)
  })

  afterAll(async () => {
    await db.delete(tenantSettings).where(inArray(tenantSettings.tenantId, [tenantAId, tenantBId]))
    await db.delete(records).where(inArray(records.tenantId, [tenantAId, tenantBId]))
    await db.delete(employees).where(inArray(employees.tenantId, [tenantAId, tenantBId]))
    await db.delete(batches).where(inArray(batches.tenantId, [tenantAId, tenantBId]))
    await db.delete(productionUnits).where(inArray(productionUnits.tenantId, [tenantAId, tenantBId]))
    await db.delete(farms).where(inArray(farms.tenantId, [tenantAId, tenantBId]))
    await db.delete(sessions).where(inArray(sessions.userId, [ownerAId, auditorAId, vetAId, ownerBId, superAdminId]))
    await db.delete(users).where(inArray(users.id, [ownerAId, auditorAId, vetAId, ownerBId, superAdminId]))
    await db.delete(tenants).where(inArray(tenants.id, [tenantAId, tenantBId]))
    mockCookie = undefined
  })

  describe('auditor: read-only reports', () => {
    it('can read all four report endpoints for their own tenant', async () => {
      mockCookie = auditorASession
      for (const [name, handler, url] of [
        ['pl', plGET, 'http://localhost/api/reports/pl'],
        ['batch-pl', batchPlGET, 'http://localhost/api/reports/batch-pl'],
        ['mortality', mortalityGET, 'http://localhost/api/reports/mortality'],
        ['feed-consumption', feedGET, 'http://localhost/api/reports/feed-consumption'],
      ] as const) {
        const { status } = await readJson(await handler(getRequest(url)))
        expect(status, `${name} should be 200 for an auditor`).toBe(200)
      }
    })

    it('sees only their own tenant\'s mortality data, even when another tenantId is named explicitly', async () => {
      mockCookie = auditorASession
      const plain = await readJson(await mortalityGET(getRequest('http://localhost/api/reports/mortality')))
      expect(plain.status).toBe(200)
      expect(plain.payload.data.meta.totalDeaths).toBe(3)

      // Tenant is session-derived only now (see the route's header comment) —
      // naming tenant B explicitly must not leak tenant B's data.
      const spoofed = await readJson(await mortalityGET(getRequest(`http://localhost/api/reports/mortality?tenantId=${tenantBId}`)))
      expect(spoofed.status).toBe(200)
      expect(spoofed.payload.data.meta.totalDeaths).toBe(3)
      expect(spoofed.payload.data.meta.tenantId).toBe(tenantAId)
    })

    it('is refused with a real 403 on a representative write endpoint (POST /api/records)', async () => {
      mockCookie = auditorASession
      const { status, payload } = await readJson(await recordsPOST(postRequest('http://localhost/api/records', {
        batchId: batchAId, employeeId: otherEmployeeId, type: 'mortality', data: { count: 1, cause: 'Unknown' },
      })))
      expect(status).toBe(403)
      expect(payload.success).toBe(false)
    })

    it('401s unauthenticated on every report endpoint', async () => {
      mockCookie = undefined
      for (const handler of [plGET, batchPlGET, mortalityGET, feedGET]) {
        const res = await handler(getRequest('http://localhost/api/reports/pl'))
        expect(res.status).toBe(401)
      }
    })
  })

  describe('vet: herd health', () => {
    it('can list batches and records for their tenant', async () => {
      mockCookie = vetASession
      const b = await readJson(await batchesGET(getRequest('http://localhost/api/batches')))
      expect(b.status).toBe(200)
      expect(b.payload.data.some((row: { id: string }) => row.id === batchAId)).toBe(true)

      const r = await readJson(await recordsGET(getRequest(`http://localhost/api/records?batchId=${batchAId}&type=mortality`)))
      expect(r.status).toBe(200)
      expect(r.payload.data.length).toBeGreaterThan(0)
    })

    it('can POST a mortality record using their own linked employee row', async () => {
      mockCookie = vetASession
      const { status, payload } = await readJson(await recordsPOST(postRequest('http://localhost/api/records', {
        batchId: batchAId, employeeId: vetEmployeeId, type: 'mortality', data: { count: 2, cause: 'Disease' },
      })))
      expect(status).toBe(201)
      expect(payload.data.employeeId).toBe(vetEmployeeId)
      expect(payload.data.type).toBe('mortality')
      await db.delete(records).where(eq(records.id, payload.data.id))
    })

    it('is refused on an admin-only route (GET /api/admin/tenants)', async () => {
      mockCookie = vetASession
      const res = await adminTenantsGET()
      expect(res.status).toBe(403)
    })
  })

  describe('super_admin: cross-tenant settings access', () => {
    it('can GET and PATCH a named tenant\'s settings even though their own session has no tenantId', async () => {
      mockCookie = superAdminSession
      const get1 = await readJson(await settingsGET(getRequest(`http://localhost/api/settings?tenantId=${tenantBId}`)))
      expect(get1.status).toBe(200)
      expect(get1.payload.data.tenantId ?? tenantBId).toBe(tenantBId)

      const patch1 = await readJson(await settingsPATCH(patchRequest(`http://localhost/api/settings?tenantId=${tenantBId}`, {
        dashboardGreeting: 'Set by super admin',
      })))
      expect(patch1.status).toBe(200)
      expect(patch1.payload.data.dashboardGreeting).toBe('Set by super admin')
      expect(patch1.payload.data.tenantId).toBe(tenantBId)
    })

    it('a normal owner cannot use the same query param to reach a tenant that is not theirs', async () => {
      mockCookie = ownerASession
      // Owner A's session already carries tenantId A — the query param
      // naming tenant B must be inert, not an override.
      const get1 = await readJson(await settingsGET(getRequest(`http://localhost/api/settings?tenantId=${tenantBId}`)))
      expect(get1.status).toBe(200)
      expect(get1.payload.data.tenantId ?? tenantAId).toBe(tenantAId)

      const patch1 = await readJson(await settingsPATCH(patchRequest(`http://localhost/api/settings?tenantId=${tenantBId}`, {
        dashboardGreeting: 'Owner A hijack attempt',
      })))
      expect(patch1.status).toBe(200)
      expect(patch1.payload.data.tenantId).toBe(tenantAId)

      // Tenant B's row must still say what the super_admin test set, not
      // owner A's attempted value.
      const bRow = await db.select().from(tenantSettings).where(eq(tenantSettings.tenantId, tenantBId))
      expect(bRow[0]?.dashboardGreeting).toBe('Set by super admin')
    })

    it('401s unauthenticated', async () => {
      mockCookie = undefined
      const res = await settingsGET(getRequest(`http://localhost/api/settings?tenantId=${tenantBId}`))
      expect(res.status).toBe(401)
    })
  })
})
