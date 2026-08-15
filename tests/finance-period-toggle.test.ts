// ── Finance: Budget Overview Month/Quarter/YTD toggle (issue #299) ─────────
// Integration test that reproduces exactly what components/farm/finance.tsx's
// restored period toggle now does: compute a period's from/to via
// lib/period-range.ts's periodDateRange, then call the real
// GET /api/reports/pl route handler with it, and check the returned
// meta.periodRevenue actually differs per period for a seeded scenario
// spanning multiple periods within the same year — proving the toggle
// changes the numbers instead of always showing all-time totals (the bug
// this issue fixes). Runs against the real postgres when DATABASE_URL is
// set; skipped in CI (no DB), same pattern as tests/reports.test.ts.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { eq, inArray } from 'drizzle-orm'

vi.mock('server-only', () => ({}))
vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({ get: () => undefined })),
}))

import { GET as plGET } from '@/app/api/reports/pl/route'
import { POST as salesPOST } from '@/app/api/data/sales/route'
import { db } from '@/db'
import { tenants, sales, purchases, journalEntries, journalLines } from '@/db/schemas'
import { periodDateRange } from '@/lib/period-range'

const hasDb = !!process.env.DATABASE_URL
const run = hasDb ? describe : describe.skip

function postRequest(url: string, body: unknown): Request {
  return new Request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function getRequest(url: string): Request {
  return new Request(url)
}

async function readJson(res: Response) {
  return { status: res.status, payload: await res.json() }
}

run('Finance Budget Overview: period toggle actually filters real sales (issue #299)', () => {
  const tenantId = `t-fin-period-${randomUUID()}`

  // Pin "now" to a fixed date so the scenario (a sale this month, a sale
  // last month-but-same-quarter, a sale earlier in the year, and a sale in
  // the prior year) is deterministic regardless of what day the suite runs.
  const now = new Date(2026, 7, 15, 12, 0, 0) // Aug 15, 2026 — Q3, matches the app's "August 2026" mock label

  const saleInMonth = new Date(2026, 7, 10, 9, 0, 0) // Aug 10 — in month, quarter, ytd
  const saleInQuarterOnly = new Date(2026, 6, 5, 9, 0, 0) // Jul 5 — in quarter + ytd, NOT month
  const saleInYtdOnly = new Date(2026, 2, 1, 9, 0, 0) // Mar 1 — in ytd only
  const saleLastYear = new Date(2025, 11, 1, 9, 0, 0) // Dec 1, 2025 — outside all three

  beforeAll(async () => {
    await db.insert(tenants).values({ id: tenantId, name: 'Period Toggle Test Co.', active: true })

    await salesPOST(postRequest('http://localhost/api/data/sales', {
      tenantId, item: 'August batch sale', amount: 40000, status: 'paid', soldAt: saleInMonth.toISOString(),
    }))
    await salesPOST(postRequest('http://localhost/api/data/sales', {
      tenantId, item: 'July batch sale', amount: 25000, status: 'paid', soldAt: saleInQuarterOnly.toISOString(),
    }))
    await salesPOST(postRequest('http://localhost/api/data/sales', {
      tenantId, item: 'March batch sale', amount: 15000, status: 'paid', soldAt: saleInYtdOnly.toISOString(),
    }))
    await salesPOST(postRequest('http://localhost/api/data/sales', {
      tenantId, item: 'Prior-year sale', amount: 90000, status: 'paid', soldAt: saleLastYear.toISOString(),
    }))
  })

  afterAll(async () => {
    const entryIds = (await db.select({ id: journalEntries.id }).from(journalEntries).where(eq(journalEntries.tenantId, tenantId))).map((e) => e.id)
    if (entryIds.length > 0) await db.delete(journalLines).where(inArray(journalLines.entryId, entryIds))
    await db.delete(journalEntries).where(eq(journalEntries.tenantId, tenantId))
    await db.delete(sales).where(eq(sales.tenantId, tenantId))
    await db.delete(purchases).where(eq(purchases.tenantId, tenantId))
    await db.delete(tenants).where(eq(tenants.id, tenantId))
  })

  async function revenueFor(period: 'month' | 'quarter' | 'ytd'): Promise<number> {
    const { from, to } = periodDateRange(period, now)
    const { status, payload } = await readJson(
      await plGET(getRequest(`http://localhost/api/reports/pl?tenantId=${tenantId}&from=${from}&to=${to}`))
    )
    expect(status).toBe(200)
    return payload.data.meta.periodRevenue as number
  }

  it('"month" only includes the sale within the current calendar month', async () => {
    expect(await revenueFor('month')).toBe(40000)
  })

  it('"quarter" includes this month + last month\'s sale (same quarter), not earlier or prior-year sales', async () => {
    expect(await revenueFor('quarter')).toBe(40000 + 25000)
  })

  it('"ytd" includes every sale so far this year, but not the prior-year sale', async () => {
    expect(await revenueFor('ytd')).toBe(40000 + 25000 + 15000)
  })

  it('selecting a different period genuinely changes the displayed number (the bug this issue fixes)', async () => {
    const month = await revenueFor('month')
    const quarter = await revenueFor('quarter')
    const ytd = await revenueFor('ytd')
    expect(month).not.toBe(quarter)
    expect(quarter).not.toBe(ytd)
    // None of them equal the old hardcoded "All-time" total, which would
    // have included the prior-year sale too.
    expect(ytd).not.toBe(40000 + 25000 + 15000 + 90000)
  })
})
