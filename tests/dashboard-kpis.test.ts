// ── Dashboard KPI / production-chart backend tests (issue #228, revisited
// #292) ──────────────────────────────────────────────────────────────────
// Integration tests that call the real route handlers against the real
// postgres when DATABASE_URL is set (local/dev); CI has no database, so the
// suite skips there — same pattern as tests/dashboard.test.ts and
// tests/auth.test.ts.
//
// No session cookie is set in any of these tests, so getSessionUser()
// resolves to null and every route falls back to its `tenantId` query param
// (the standalone-mock-mode fallback), same as tests/dashboard.test.ts.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { inArray } from 'drizzle-orm'

vi.mock('server-only', () => ({}))
vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({ get: () => undefined })),
}))

import { GET as kpisGET } from '@/app/api/dashboard/kpis/route'
import { GET as productionGET } from '@/app/api/charts/production/route'
import { db } from '@/db'
import { tenants, products, tasks, notifications, farms, productionUnits, batches, sales } from '@/db/schemas'

const hasDb = !!process.env.DATABASE_URL
const run = hasDb ? describe : describe.skip

function getRequest(url: string): Request {
  return new Request(url)
}

run('GET /api/dashboard/kpis + GET /api/charts/production (issue #228)', () => {
  const tenantAId = `t-${randomUUID()}`
  const tenantBId = `t-${randomUUID()}`

  beforeAll(async () => {
    await db.insert(tenants).values([
      { id: tenantAId, name: 'KPI Test Co. A', active: true },
      { id: tenantBId, name: 'KPI Test Co. B', active: true },
    ])
  })

  afterAll(async () => {
    await db.delete(notifications).where(inArray(notifications.tenantId, [tenantAId, tenantBId]))
    await db.delete(tasks).where(inArray(tasks.tenantId, [tenantAId, tenantBId]))
    await db.delete(products).where(inArray(products.tenantId, [tenantAId, tenantBId]))
    await db.delete(tenants).where(inArray(tenants.id, [tenantAId, tenantBId]))
  })

  describe('GET /api/dashboard/kpis', () => {
    it('requires a tenantId', async () => {
      const res = await kpisGET(getRequest('http://localhost/api/dashboard/kpis'))
      expect(res.status).toBe(400)
    })

    it('returns zeroed real counts and null avgFCR for a tenant with no data', async () => {
      const emptyTenantId = `t-${randomUUID()}`
      await db.insert(tenants).values({ id: emptyTenantId, name: 'Empty KPI Tenant', active: true })
      try {
        const res = await kpisGET(getRequest(`http://localhost/api/dashboard/kpis?tenantId=${emptyTenantId}`))
        expect(res.status).toBe(200)
        const payload = await res.json()
        expect(payload.success).toBe(true)
        expect(payload.data).toEqual({
          activeTasksCount: 0,
          overdueTasksCount: 0,
          unreadNotifications: 0,
          productCount: 0,
          // Real counts/sums — 0 is an honest empty result, not "not tracked".
          activeBatches: 0,
          revenue: 0,
          // No active batches to divide by -> no honest percentage to report.
          mortalityPct: null,
          // No FCR-capable data source exists anywhere in this app yet.
          avgFCR: null,
        })
      } finally {
        await db.delete(tenants).where(inArray(tenants.id, [emptyTenantId]))
      }
    })

    it('computes real counts from tasks/notifications/products, scoped to the requesting tenant', async () => {
      const now = new Date()
      const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000)
      const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000)

      await db.insert(tasks).values([
        // Overdue, still open -> counts toward both activeTasksCount and overdueTasksCount.
        { id: randomUUID(), tenantId: tenantAId, title: 'Overdue feeding', dueAt: yesterday, status: 'PENDING' },
        // Due in the future, open -> active but not overdue.
        { id: randomUUID(), tenantId: tenantAId, title: 'Upcoming vaccination', dueAt: tomorrow, status: 'PENDING' },
        // Done -> excluded from both counts even though its due date is in the past.
        { id: randomUUID(), tenantId: tenantAId, title: 'Completed overdue task', dueAt: yesterday, status: 'DONE' },
        // Different tenant entirely -> must not leak into tenant A's counts.
        { id: randomUUID(), tenantId: tenantBId, title: 'Tenant B overdue', dueAt: yesterday, status: 'PENDING' },
      ])
      await db.insert(products).values([
        { id: randomUUID(), tenantId: tenantAId, type: 'eggs', name: 'Eggs (tray)', saleUnits: '480' },
        { id: randomUUID(), tenantId: tenantAId, type: 'milk', name: 'Milk (litre)', saleUnits: '60' },
        { id: randomUUID(), tenantId: tenantBId, type: 'eggs', name: 'Eggs (tray)', saleUnits: '999' },
      ])

      const res = await kpisGET(getRequest(`http://localhost/api/dashboard/kpis?tenantId=${tenantAId}`))
      expect(res.status).toBe(200)
      const payload = await res.json()
      expect(payload.success).toBe(true)
      // 2 open tasks (overdue + upcoming); DONE task excluded.
      expect(payload.data.activeTasksCount).toBe(2)
      // Only the overdue-and-open task counts as overdue.
      expect(payload.data.overdueTasksCount).toBe(1)
      // Lazily synced from the overdue task, same as GET /api/notifications.
      expect(payload.data.unreadNotifications).toBeGreaterThanOrEqual(1)
      expect(payload.data.productCount).toBe(2)
      // No batches/sales seeded for this tenant in this test -> real zero/null,
      // not a fabricated number.
      expect(payload.data.activeBatches).toBe(0)
      expect(payload.data.mortalityPct).toBeNull()
      expect(payload.data.revenue).toBe(0)
      // Never fabricated — no FCR-capable data source exists anywhere yet.
      expect(payload.data.avgFCR).toBeNull()

      // Cross-tenant isolation: tenant B's rows never affected tenant A's counts.
      const notifRows = await db.select().from(notifications).where(inArray(notifications.tenantId, [tenantAId]))
      expect(notifRows.every((n) => n.tenantId === tenantAId)).toBe(true)
    })

    it('computes real activeBatches/mortalityPct/revenue from batches + sales, matching Crops/Finance', async () => {
      const tenantId = `t-${randomUUID()}`
      const farmId = `f-${randomUUID()}`
      const unitId = `u-${randomUUID()}`
      const activeBatch1Id = `b-${randomUUID()}`
      const activeBatch2Id = `b-${randomUUID()}`
      const closedBatchId = `b-${randomUUID()}`

      await db.insert(tenants).values({ id: tenantId, name: 'Dashboard KPI Real-Data Co.', active: true })
      await db.insert(farms).values({ id: farmId, tenantId, name: 'Farm KPI', location: 'Nakuru', code: 'FRM-KMU-292' })
      await db.insert(productionUnits).values({ id: unitId, tenantId, farmId, type: 'house', name: 'House 292', code: 'HSE-KMU-292' })

      try {
        // Two ACTIVE batches — same mortality formula components/farm/crops.tsx
        // renders per-batch (issue #232): (initialQty - currentQty) / initialQty.
        //   Batch 1: 900 -> 872  => 28 lost / 900 initial
        //   Batch 2: 500 -> 494  =>  6 lost / 500 initial
        // Pooled across both active batches: (28 + 6) / (900 + 500) = 34/1400
        // = 2.428...% -> rounds to 2.4, matching this route's 1-decimal rounding.
        await db.insert(batches).values([
          {
            id: activeBatch1Id, tenantId, unitId, code: 'BRD-KMU-001', name: 'Broiler Batch 1',
            enterprise: 'broiler', status: 'ACTIVE', initialQty: 900, currentQty: 872,
          },
          {
            id: activeBatch2Id, tenantId, unitId, code: 'BRD-KMU-002', name: 'Broiler Batch 2',
            enterprise: 'broiler', status: 'ACTIVE', initialQty: 500, currentQty: 494,
          },
          // CLOSED — must not count toward activeBatches or mortalityPct.
          {
            id: closedBatchId, tenantId, unitId, code: 'BRD-KMU-003', name: 'Broiler Batch 3 (closed)',
            enterprise: 'broiler', status: 'CLOSED', initialQty: 300, currentQty: 100,
          },
        ])

        // Real sales — both 'paid' and 'pending' count toward revenue, matching
        // how lib/finance.ts posts every sale to Sales Revenue regardless of
        // payment status.
        await db.insert(sales).values([
          { id: randomUUID(), tenantId, item: 'Broilers', amount: 45000, status: 'paid' },
          { id: randomUUID(), tenantId, item: 'Eggs', amount: 12500, status: 'pending' },
        ])

        const res = await kpisGET(getRequest(`http://localhost/api/dashboard/kpis?tenantId=${tenantId}`))
        expect(res.status).toBe(200)
        const payload = await res.json()
        expect(payload.success).toBe(true)
        // Only the 2 ACTIVE batches count — CLOSED is excluded.
        expect(payload.data.activeBatches).toBe(2)
        // Pooled mortality across the 2 active batches only, not the closed one.
        expect(payload.data.mortalityPct).toBeCloseTo(2.4, 1)
        // Real sum of both sales rows, regardless of paid/pending status.
        expect(payload.data.revenue).toBe(57500)
        // Still no FCR-capable data source.
        expect(payload.data.avgFCR).toBeNull()
      } finally {
        await db.delete(sales).where(inArray(sales.tenantId, [tenantId]))
        await db.delete(batches).where(inArray(batches.tenantId, [tenantId]))
        await db.delete(productionUnits).where(inArray(productionUnits.tenantId, [tenantId]))
        await db.delete(farms).where(inArray(farms.tenantId, [tenantId]))
        await db.delete(tenants).where(inArray(tenants.id, [tenantId]))
      }
    })
  })

  describe('GET /api/charts/production', () => {
    it('requires a tenantId', async () => {
      const res = await productionGET(getRequest('http://localhost/api/charts/production'))
      expect(res.status).toBe(400)
    })

    it('always returns an explicit not-available empty series, never a fabricated chart', async () => {
      const res = await productionGET(getRequest(`http://localhost/api/charts/production?tenantId=${tenantAId}`))
      expect(res.status).toBe(200)
      const payload = await res.json()
      expect(payload.success).toBe(true)
      expect(payload.data.available).toBe(false)
      expect(payload.data.series).toEqual([])
      expect(typeof payload.data.reason).toBe('string')
      expect(payload.data.reason.length).toBeGreaterThan(0)
    })
  })
})
