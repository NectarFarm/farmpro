// ── Batches backend tests (issue #231) ─────────────────────────────────────
// Integration tests that call the real route handlers against the real
// postgres when DATABASE_URL is set (local/dev); CI has no database, so the
// suite skips there (vitest exits 0, and CI's build/typecheck still run) —
// same pattern as tests/auth.test.ts / tests/dashboard.test.ts.
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

import { GET as batchesGET, POST as batchesPOST } from '@/app/api/batches/route'
import { GET as batchGET, PATCH as batchPATCH } from '@/app/api/batches/[id]/route'
import { GET as costBreakdownGET } from '@/app/api/batches/[id]/cost-breakdown/route'
import { db } from '@/db'
import { tenants, farms, productionUnits, batches, sales } from '@/db/schemas'
import { recordSale } from '@/lib/finance'

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

run('batches: CRUD + code generation + cost-breakdown (issue #231)', () => {
  const tenantAId = `t-${randomUUID()}`
  const tenantBId = `t-${randomUUID()}`
  const farmAId = `f-${randomUUID()}`
  const farmBId = `f-${randomUUID()}`
  const unitAId = `u-${randomUUID()}`
  const unitA2Id = `u-${randomUUID()}`
  const unitBId = `u-${randomUUID()}`

  beforeAll(async () => {
    await db.insert(tenants).values([
      { id: tenantAId, name: 'Batches Test Co. A', active: true },
      { id: tenantBId, name: 'Batches Test Co. B', active: true },
    ])
    await db.insert(farms).values([
      { id: farmAId, tenantId: tenantAId, name: 'Farm A', location: 'Nakuru', code: 'FRM-KMU-001' },
      { id: farmBId, tenantId: tenantBId, name: 'Farm B', location: 'Eldoret', code: 'FRM-ELD-001' },
    ])
    await db.insert(productionUnits).values([
      { id: unitAId, tenantId: tenantAId, farmId: farmAId, type: 'house', name: 'House A01', code: 'HSE-KMU-A01' },
      { id: unitA2Id, tenantId: tenantAId, farmId: farmAId, type: 'house', name: 'House A02', code: 'HSE-KMU-A02' },
      { id: unitBId, tenantId: tenantBId, farmId: farmBId, type: 'house', name: 'House B01', code: 'HSE-ELD-B01' },
    ])
  })

  afterAll(async () => {
    await db.delete(sales).where(inArray(sales.tenantId, [tenantAId, tenantBId]))
    await db.delete(batches).where(inArray(batches.tenantId, [tenantAId, tenantBId]))
    await db.delete(productionUnits).where(inArray(productionUnits.tenantId, [tenantAId, tenantBId]))
    await db.delete(farms).where(inArray(farms.tenantId, [tenantAId, tenantBId]))
    await db.delete(tenants).where(inArray(tenants.id, [tenantAId, tenantBId]))
  })

  describe('POST /api/batches', () => {
    it('creates a batch with a generated BRO-<segment>-NNN code and reads it back', async () => {
      const res = await batchesPOST(
        postRequest('http://localhost/api/batches', {
          tenantId: tenantAId,
          unitId: unitAId,
          name: 'Broilers Oct Run',
          enterprise: 'broiler',
          species: 'Cobb 500',
          initialQty: 1000,
          acquisitionCostCents: 14500000,
        })
      )
      expect(res.status).toBe(201)
      const payload = await res.json()
      expect(payload.success).toBe(true)
      expect(payload.data.code).toBe('BRO-KMU-001')
      expect(payload.data.currentQty).toBe(1000)
      expect(payload.data.status).toBe('ACTIVE')
      const batchId = payload.data.id

      // Read it back via GET /api/batches/[id].
      const readRes = await batchGET(getRequest(`http://localhost/api/batches/${batchId}?tenantId=${tenantAId}`), {
        params: Promise.resolve({ id: batchId }),
      })
      expect(readRes.status).toBe(200)
      const readPayload = await readRes.json()
      expect(readPayload.data.name).toBe('Broilers Oct Run')
      expect(readPayload.data.species).toBe('Cobb 500')
      expect(readPayload.data.acquisitionCostCents).toBe(14500000)
    })

    it('increments the sequence per tenant+enterprise+farm-segment for a second batch', async () => {
      const res = await batchesPOST(
        postRequest('http://localhost/api/batches', {
          tenantId: tenantAId,
          unitId: unitAId,
          name: 'Broilers Nov Run',
          enterprise: 'broiler',
          initialQty: 500,
        })
      )
      expect(res.status).toBe(201)
      const payload = await res.json()
      expect(payload.data.code).toBe('BRO-KMU-002')
    })

    it('rejects a unitId belonging to a different tenant', async () => {
      const res = await batchesPOST(
        postRequest('http://localhost/api/batches', {
          tenantId: tenantAId,
          unitId: unitBId,
          name: 'Cross-tenant attempt',
          enterprise: 'broiler',
          initialQty: 10,
        })
      )
      expect(res.status).toBe(404)
    })

    it('requires tenantId, unitId, name, and enterprise', async () => {
      const res = await batchesPOST(postRequest('http://localhost/api/batches', { tenantId: tenantAId }))
      expect(res.status).toBe(400)
    })
  })

  describe('GET /api/batches', () => {
    it('lists only the requesting tenant\'s batches', async () => {
      await batchesPOST(
        postRequest('http://localhost/api/batches', {
          tenantId: tenantBId,
          unitId: unitBId,
          name: 'Layers Batch 8',
          enterprise: 'layer',
          initialQty: 500,
        })
      )

      const res = await batchesGET(getRequest(`http://localhost/api/batches?tenantId=${tenantAId}`))
      expect(res.status).toBe(200)
      const payload = await res.json()
      expect(payload.data.length).toBeGreaterThanOrEqual(2)
      expect(payload.data.every((row: { tenantId: string }) => row.tenantId === tenantAId)).toBe(true)
    })
  })

  describe('PATCH /api/batches/[id] — advance stage + update qty', () => {
    it('advances the stage and updates currentQty (e.g. after a mortality count)', async () => {
      const createRes = await batchesPOST(
        postRequest('http://localhost/api/batches', {
          tenantId: tenantAId,
          unitId: unitAId,
          name: 'Broilers Dec Run',
          enterprise: 'broiler',
          initialQty: 800,
          stage: 'Starter',
        })
      )
      const created = (await createRes.json()).data
      expect(created.stage).toBe('Starter')

      const patchRes = await batchPATCH(
        patchRequest(`http://localhost/api/batches/${created.id}?tenantId=${tenantAId}`, {
          stage: 'Grower',
          currentQty: 790,
        }),
        { params: Promise.resolve({ id: created.id }) }
      )
      expect(patchRes.status).toBe(200)
      const patched = (await patchRes.json()).data
      expect(patched.stage).toBe('Grower')
      expect(patched.currentQty).toBe(790)
      // Untouched fields survive the partial update.
      expect(patched.name).toBe('Broilers Dec Run')
    })

    it('returns 404 for a batch id that belongs to a different tenant', async () => {
      const createRes = await batchesPOST(
        postRequest('http://localhost/api/batches', {
          tenantId: tenantBId,
          unitId: unitBId,
          name: 'Layers Batch 9',
          enterprise: 'layer',
          initialQty: 400,
        })
      )
      const created = (await createRes.json()).data

      const patchRes = await batchPATCH(
        patchRequest(`http://localhost/api/batches/${created.id}?tenantId=${tenantAId}`, { stage: 'Peak Lay' }),
        { params: Promise.resolve({ id: created.id }) }
      )
      expect(patchRes.status).toBe(404)
    })
  })

  describe('PATCH /api/batches/[id] — unit transfer (issue #232)', () => {
    it('moves a batch to a different unit belonging to the same tenant', async () => {
      const createRes = await batchesPOST(
        postRequest('http://localhost/api/batches', {
          tenantId: tenantAId,
          unitId: unitAId,
          name: 'Broilers Jan Run',
          enterprise: 'broiler',
          initialQty: 600,
        })
      )
      const created = (await createRes.json()).data
      expect(created.unitId).toBe(unitAId)

      const patchRes = await batchPATCH(
        patchRequest(`http://localhost/api/batches/${created.id}?tenantId=${tenantAId}`, { unitId: unitA2Id }),
        { params: Promise.resolve({ id: created.id }) }
      )
      expect(patchRes.status).toBe(200)
      const patched = (await patchRes.json()).data
      expect(patched.unitId).toBe(unitA2Id)

      // Persists on re-read, same as a page reload would see.
      const readRes = await batchGET(getRequest(`http://localhost/api/batches/${created.id}?tenantId=${tenantAId}`), {
        params: Promise.resolve({ id: created.id }),
      })
      expect((await readRes.json()).data.unitId).toBe(unitA2Id)
    })

    it('rejects moving a batch to a unit belonging to a different tenant', async () => {
      const createRes = await batchesPOST(
        postRequest('http://localhost/api/batches', {
          tenantId: tenantAId,
          unitId: unitAId,
          name: 'Broilers Feb Run',
          enterprise: 'broiler',
          initialQty: 400,
        })
      )
      const created = (await createRes.json()).data

      const patchRes = await batchPATCH(
        patchRequest(`http://localhost/api/batches/${created.id}?tenantId=${tenantAId}`, { unitId: unitBId }),
        { params: Promise.resolve({ id: created.id }) }
      )
      expect(patchRes.status).toBe(404)

      // The batch's unit assignment is unchanged after the rejected transfer.
      const readRes = await batchGET(getRequest(`http://localhost/api/batches/${created.id}?tenantId=${tenantAId}`), {
        params: Promise.resolve({ id: created.id }),
      })
      expect((await readRes.json()).data.unitId).toBe(unitAId)
    })
  })

  describe('GET /api/batches/[id]/cost-breakdown', () => {
    it('returns the real acquisitionCostCents under stock, and explicit not-tracked zeros elsewhere', async () => {
      const createRes = await batchesPOST(
        postRequest('http://localhost/api/batches', {
          tenantId: tenantAId,
          unitId: unitAId,
          name: 'Pig Fatteners Q4',
          enterprise: 'pig',
          initialQty: 65,
          acquisitionCostCents: 18200000,
        })
      )
      const created = (await createRes.json()).data

      const res = await costBreakdownGET(
        getRequest(`http://localhost/api/batches/${created.id}/cost-breakdown?tenantId=${tenantAId}`),
        { params: Promise.resolve({ id: created.id }) }
      )
      expect(res.status).toBe(200)
      const payload = await res.json()
      expect(payload.success).toBe(true)
      const byKey = Object.fromEntries(payload.data.categories.map((c: { key: string }) => [c.key, c]))

      expect(byKey.stock.amountCents).toBe(18200000)
      expect(byKey.stock.tracked).toBe(true)

      for (const key of ['feed', 'health', 'labour', 'overhead']) {
        expect(byKey[key].amountCents).toBe(0)
        expect(byKey[key].tracked).toBe(false)
        expect(typeof byKey[key].reason).toBe('string')
      }

      expect(payload.data.totalTrackedCents).toBe(18200000)
    })

    it('returns 404 for a batch not belonging to the requesting tenant', async () => {
      const createRes = await batchesPOST(
        postRequest('http://localhost/api/batches', {
          tenantId: tenantBId,
          unitId: unitBId,
          name: 'Layers Batch 10',
          enterprise: 'layer',
          initialQty: 300,
        })
      )
      const created = (await createRes.json()).data

      const res = await costBreakdownGET(
        getRequest(`http://localhost/api/batches/${created.id}/cost-breakdown?tenantId=${tenantAId}`),
        { params: Promise.resolve({ id: created.id }) }
      )
      expect(res.status).toBe(404)
    })
  })

  // ── issue #300 ─────────────────────────────────────────────────────────
  describe('GET /api/batches/[id]/cost-breakdown — Revenue/Gross Margin (issue #300)', () => {
    it('sums this batch\'s real sales into revenue, converting sales.amount (whole KSh) to cents to match cost figures, and computes gross margin against tracked cost', async () => {
      const createRes = await batchesPOST(
        postRequest('http://localhost/api/batches', {
          tenantId: tenantAId,
          unitId: unitAId,
          name: 'Broilers Mar Run',
          enterprise: 'broiler',
          initialQty: 1000,
          acquisitionCostCents: 10000000, // KSh 100,000
        })
      )
      const created = (await createRes.json()).data

      // Two real sales for this batch, whole-KSh `amount` (matching
      // db/schemas/finance.ts's `sales.amount` contract) — KSh 70,000 + KSh
      // 60,000 = KSh 130,000 total revenue.
      await recordSale({ tenantId: tenantAId, batchId: created.id, item: 'Broilers batch 1', amount: 70000 })
      await recordSale({ tenantId: tenantAId, batchId: created.id, item: 'Broilers batch 2', amount: 60000 })
      // A sale for a *different* batch must not leak into this batch's revenue.
      const otherRes = await batchesPOST(
        postRequest('http://localhost/api/batches', {
          tenantId: tenantAId, unitId: unitAId, name: 'Other Broilers', enterprise: 'broiler', initialQty: 100,
        })
      )
      const other = (await otherRes.json()).data
      await recordSale({ tenantId: tenantAId, batchId: other.id, item: 'Unrelated sale', amount: 999999 })

      const res = await costBreakdownGET(
        getRequest(`http://localhost/api/batches/${created.id}/cost-breakdown?tenantId=${tenantAId}`),
        { params: Promise.resolve({ id: created.id }) }
      )
      expect(res.status).toBe(200)
      const payload = await res.json()

      // Revenue: KSh 130,000 -> 13,000,000 cents, explicitly converted from
      // sales.amount (whole KSh) — NOT reproducing issue #290's unit mismatch.
      expect(payload.data.revenue.amountCents).toBe(13000000)
      expect(payload.data.revenue.tracked).toBe(true)

      // Gross margin: (revenue - trackedCost) / revenue, tracked cost only
      // (acquisitionCostCents = 10,000,000 cents = KSh 100,000) — same formula
      // components/farm/finance.tsx's Batch P&L (`batchPLRows`) uses:
      // margin = 130,000 - 100,000 = 30,000; pct = 30000/130000*100 = 23.1%.
      expect(payload.data.totalTrackedCents).toBe(10000000)
      expect(payload.data.grossMarginPct).toBeCloseTo(23.1, 1)
    })

    it('shows an honest zero revenue and a null (not fabricated 0%) gross margin when the batch has no recorded sales', async () => {
      const createRes = await batchesPOST(
        postRequest('http://localhost/api/batches', {
          tenantId: tenantAId,
          unitId: unitAId,
          name: 'Broilers Apr Run (no sales)',
          enterprise: 'broiler',
          initialQty: 200,
          acquisitionCostCents: 5000000,
        })
      )
      const created = (await createRes.json()).data

      const res = await costBreakdownGET(
        getRequest(`http://localhost/api/batches/${created.id}/cost-breakdown?tenantId=${tenantAId}`),
        { params: Promise.resolve({ id: created.id }) }
      )
      const payload = await res.json()

      expect(payload.data.revenue.amountCents).toBe(0)
      expect(payload.data.revenue.tracked).toBe(false)
      expect(typeof payload.data.revenue.reason).toBe('string')
      expect(payload.data.grossMarginPct).toBeNull()
    })
  })
})
