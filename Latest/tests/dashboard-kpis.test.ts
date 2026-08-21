// ── Dashboard KPI / production-chart backend tests (issue #228, revisited
// #292, #296) ────────────────────────────────────────────────────────────
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
import { tenants, products, tasks, notifications, farms, productionUnits, batches, sales, approvalRequests } from '@/db/schemas'

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
        // revenueTrend is date-dependent (one zero-filled bucket per day of
        // the current month to date) — checked separately below rather than
        // folded into the toEqual, so this test doesn't become flaky at
        // month boundaries.
        const { revenueTrend, ...rest } = payload.data
        expect(rest).toEqual({
          activeTasksCount: 0,
          overdueTasksCount: 0,
          unreadNotifications: 0,
          productCount: 0,
          // Real counts/sums — 0 is an honest empty result, not "not tracked".
          activeBatches: 0,
          revenueCents: 0,
          // No active batches to divide by -> no honest percentage to report.
          mortalityPct: null,
          // No FCR-capable data source exists anywhere in this app yet.
          avgFCR: null,
          // issue #296: real primary KPI grid + Revenue card fields.
          pendingApprovals: 0,
          livestockUnitsCount: 0,
          livestockUnitsQty: 0,
          cropBatchGroupsCount: 0,
          period: 'month',
          periodRevenueCents: 0,
          // No revenue in the period -> no honest percentage to report.
          marginPct: null,
          // farm-scoped-data task: no farmId was passed, so this response is
          // unfiltered ('ALL'), and the tenant-wide-metrics marker lists the
          // fields that never change with a farm filter — see GET
          // /api/dashboard/kpis's header.
          farmId: 'ALL',
          tenantWideMetrics: ['unreadNotifications', 'productCount', 'avgFCR'],
        })
        expect(Array.isArray(revenueTrend)).toBe(true)
        expect(revenueTrend.length).toBeGreaterThan(0)
        for (const point of revenueTrend) {
          expect(point.amountCents).toBe(0)
          expect(point.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
        }
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
      expect(payload.data.revenueCents).toBe(0)
      // Never fabricated — no FCR-capable data source exists anywhere yet.
      expect(payload.data.avgFCR).toBeNull()
      // No approval_requests/batches seeded for this tenant in this test.
      expect(payload.data.pendingApprovals).toBe(0)
      expect(payload.data.livestockUnitsCount).toBe(0)
      expect(payload.data.livestockUnitsQty).toBe(0)
      expect(payload.data.cropBatchGroupsCount).toBe(0)
      expect(payload.data.periodRevenueCents).toBe(0)
      expect(payload.data.marginPct).toBeNull()

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
            // 10,000 KSh acquisition cost — used below to prove marginPct
            // matches lib/reports.ts's computeBatchPlReport formula exactly.
            acquisitionCostCents: 1_000_000,
          },
          {
            id: activeBatch2Id, tenantId, unitId, code: 'BRD-KMU-002', name: 'Broiler Batch 2',
            enterprise: 'broiler', status: 'ACTIVE', initialQty: 500, currentQty: 494,
            acquisitionCostCents: 500_000, // 5,000 KSh
          },
          // CLOSED — must not count toward activeBatches, mortalityPct, or the
          // Livestock Units group count, but its acquisition cost still counts
          // toward the margin cost basis (same "all batches, any status" rule
          // as computeBatchPlReport — see route's Margin % writeup).
          {
            id: closedBatchId, tenantId, unitId, code: 'BRD-KMU-003', name: 'Broiler Batch 3 (closed)',
            enterprise: 'broiler', status: 'CLOSED', initialQty: 300, currentQty: 100,
            acquisitionCostCents: 200_000, // 2,000 KSh
          },
        ])

        // Real sales — both 'paid' and 'pending' count toward revenue, matching
        // how lib/finance.ts posts every sale to Sales Revenue regardless of
        // payment status. No explicit soldAt -> defaults to now(), so both
        // fall inside every period (month/quarter/year) to-date.
        await db.insert(sales).values([
          { id: randomUUID(), tenantId, item: 'Broilers', amountCents: 4500000, status: 'paid' },
          { id: randomUUID(), tenantId, item: 'Eggs', amountCents: 1250000, status: 'pending' },
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
        expect(payload.data.revenueCents).toBe(5750000)
        // Still no FCR-capable data source.
        expect(payload.data.avgFCR).toBeNull()

        // Livestock Units: both ACTIVE batches share enterprise 'broiler' ->
        // ONE distinct group (not 2 — this counts groups, not batches),
        // qty = pooled currentQty across that group (872 + 494).
        expect(payload.data.livestockUnitsCount).toBe(1)
        expect(payload.data.livestockUnitsQty).toBe(1366)
        expect(payload.data.cropBatchGroupsCount).toBe(0)

        // Default period is 'month'; both sales default to soldAt = now(),
        // so periodRevenue matches the all-time revenue here.
        expect(payload.data.period).toBe('month')
        expect(payload.data.periodRevenueCents).toBe(5750000)
        // Margin = periodRevenue(57500) - totalAcquisitionCost(10,000 + 5,000 +
        // 2,000 = 17,000, ALL 3 batches incl. the closed one) = 40,500.
        // marginPct = 40500/57500 = 70.434...% -> rounds to 70.4, same
        // rounding convention as mortalityPct.
        expect(payload.data.marginPct).toBeCloseTo(70.4, 1)
      } finally {
        await db.delete(sales).where(inArray(sales.tenantId, [tenantId]))
        await db.delete(batches).where(inArray(batches.tenantId, [tenantId]))
        await db.delete(productionUnits).where(inArray(productionUnits.tenantId, [tenantId]))
        await db.delete(farms).where(inArray(farms.tenantId, [tenantId]))
        await db.delete(tenants).where(inArray(tenants.id, [tenantId]))
      }
    })

    it('groups ACTIVE batches by enterprise across MULTIPLE livestock + crop subtypes, matching Crops', async () => {
      // Proves the classification is real — driven by lib/codes.ts's
      // ENTERPRISE_TYPES map (the server-safe mirror of ENTERPRISE_REGISTRY's
      // `type` field), not just a single-enterprise happy path.
      const tenantId = `t-${randomUUID()}`
      const farmId = `f-${randomUUID()}`
      const unitId = `u-${randomUUID()}`

      await db.insert(tenants).values({ id: tenantId, name: 'Multi-Enterprise KPI Co.', active: true })
      await db.insert(farms).values({ id: farmId, tenantId, name: 'Farm Multi', location: 'Eldoret', code: 'FRM-ELD-296' })
      await db.insert(productionUnits).values({ id: unitId, tenantId, farmId, type: 'house', name: 'Unit 296', code: 'HSE-ELD-296' })

      try {
        await db.insert(batches).values([
          // Livestock group 1: broiler, 2 ACTIVE batches -> ONE group.
          { id: `b-${randomUUID()}`, tenantId, unitId, code: 'BRO-ELD-001', name: 'Broiler A', enterprise: 'broiler', status: 'ACTIVE', initialQty: 200, currentQty: 195 },
          { id: `b-${randomUUID()}`, tenantId, unitId, code: 'BRO-ELD-002', name: 'Broiler B', enterprise: 'broiler', status: 'ACTIVE', initialQty: 300, currentQty: 290 },
          // Livestock group 2: layer, 1 ACTIVE batch -> a second, distinct group.
          { id: `b-${randomUUID()}`, tenantId, unitId, code: 'LYR-ELD-001', name: 'Layers A', enterprise: 'layer', status: 'ACTIVE', initialQty: 400, currentQty: 400 },
          // Crop group: maize, 2 ACTIVE batches -> ONE crop group.
          { id: `b-${randomUUID()}`, tenantId, unitId, code: 'MZE-ELD-001', name: 'Maize A', enterprise: 'maize', status: 'ACTIVE', initialQty: 1, currentQty: 1 },
          { id: `b-${randomUUID()}`, tenantId, unitId, code: 'MZE-ELD-002', name: 'Maize B', enterprise: 'maize', status: 'ACTIVE', initialQty: 1, currentQty: 1 },
          // A CLOSED layer batch must not add a third livestock count, nor
          // count into livestockUnitsQty.
          { id: `b-${randomUUID()}`, tenantId, unitId, code: 'LYR-ELD-002', name: 'Layers B (closed)', enterprise: 'layer', status: 'CLOSED', initialQty: 50, currentQty: 50 },
        ])

        const res = await kpisGET(getRequest(`http://localhost/api/dashboard/kpis?tenantId=${tenantId}`))
        expect(res.status).toBe(200)
        const payload = await res.json()
        expect(payload.success).toBe(true)
        expect(payload.data.activeBatches).toBe(5)
        // 2 distinct livestock groups (broiler, layer) — the closed layer
        // batch does not create a group of its own since it's excluded.
        expect(payload.data.livestockUnitsCount).toBe(2)
        // qty = 195+290 (broiler group) + 400 (layer group) = 885.
        expect(payload.data.livestockUnitsQty).toBe(885)
        // 1 distinct crop group (maize).
        expect(payload.data.cropBatchGroupsCount).toBe(1)
      } finally {
        await db.delete(batches).where(inArray(batches.tenantId, [tenantId]))
        await db.delete(productionUnits).where(inArray(productionUnits.tenantId, [tenantId]))
        await db.delete(farms).where(inArray(farms.tenantId, [tenantId]))
        await db.delete(tenants).where(inArray(tenants.id, [tenantId]))
      }
    })

    it('scopes pendingApprovals to status=pending, matching GET /api/approvals, and the period toggle to soldAt within range', async () => {
      const tenantId = `t-${randomUUID()}`
      await db.insert(tenants).values({ id: tenantId, name: 'Period/Approvals KPI Co.', active: true })

      try {
        await db.insert(approvalRequests).values([
          { id: randomUUID(), tenantId, type: 'task_completion', title: 'Pending #1', requestedBy: 'worker-1', entityId: 'tsk-1', status: 'pending' },
          { id: randomUUID(), tenantId, type: 'task_completion', title: 'Pending #2', requestedBy: 'worker-2', entityId: 'tsk-2', status: 'pending' },
          // Already decided -> must not count.
          { id: randomUUID(), tenantId, type: 'task_completion', title: 'Approved already', requestedBy: 'worker-3', entityId: 'tsk-3', status: 'approved' },
        ])

        const now = new Date()
        // Safely inside the current month (or the 1st, if run on the 1st).
        const thisMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
        // A year before the start of the current month -> outside month AND
        // quarter AND year-to-date ranges no matter when this test runs.
        const longAgo = new Date(Date.UTC(now.getUTCFullYear() - 1, 0, 1))

        await db.insert(sales).values([
          { id: randomUUID(), tenantId, item: 'In-period sale', amountCents: 1000000, soldAt: thisMonth },
          { id: randomUUID(), tenantId, item: 'Long-ago sale', amountCents: 9999900, soldAt: longAgo },
        ])

        const monthRes = await kpisGET(getRequest(`http://localhost/api/dashboard/kpis?tenantId=${tenantId}&period=month`))
        const monthPayload = await monthRes.json()
        expect(monthPayload.data.pendingApprovals).toBe(2)
        expect(monthPayload.data.period).toBe('month')
        // Only the in-period sale counts; the long-ago sale is excluded.
        expect(monthPayload.data.periodRevenueCents).toBe(1000000)
        // All-time `revenue` still includes both sales — unaffected by period.
        expect(monthPayload.data.revenueCents).toBe(10999900)

        const yearRes = await kpisGET(getRequest(`http://localhost/api/dashboard/kpis?tenantId=${tenantId}&period=year`))
        const yearPayload = await yearRes.json()
        expect(yearPayload.data.period).toBe('year')
        // The long-ago sale (a full year before this Jan 1) is still outside
        // even the year-to-date range.
        expect(yearPayload.data.periodRevenueCents).toBe(1000000)

        // Unknown/omitted period falls back to 'month' rather than erroring.
        const badRes = await kpisGET(getRequest(`http://localhost/api/dashboard/kpis?tenantId=${tenantId}&period=decade`))
        const badPayload = await badRes.json()
        expect(badRes.status).toBe(200)
        expect(badPayload.data.period).toBe('month')
      } finally {
        await db.delete(sales).where(inArray(sales.tenantId, [tenantId]))
        await db.delete(approvalRequests).where(inArray(approvalRequests.tenantId, [tenantId]))
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
