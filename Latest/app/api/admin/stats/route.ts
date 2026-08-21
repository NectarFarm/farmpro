import { NextResponse } from 'next/server'
import { count, eq } from 'drizzle-orm'
import { db } from '@/db'
import { onboardRequests, tenants, users } from '@/db/schemas'
import { getSessionUser } from '@/lib/auth'

// ── GET /api/admin/stats (issue #252) ───────────────────────────────────────
// super_admin-only. Real aggregate platform counts for AdminDashboardScreen —
// no such route existed on this branch before this issue. Deliberately
// minimal: only figures with a real source in the DB today. No revenue or
// animal-count aggregate — there is no sales table, and batches are
// tenant-scoped with no platform-wide rollup built yet (see issue #252's
// branch-correction note) — inventing either would be a fabricated stat.
//
// Response envelope matches app/api/onboard-requests/route.ts / lib/api-response.ts
// ({ success, data | error }).

const bad = (msg: string, status = 400) =>
  NextResponse.json({ success: false, error: msg }, { status })

const ONBOARD_STATUSES = ['pending', 'approved', 'rejected', 'info-needed'] as const

export async function GET() {
  const session = await getSessionUser()
  if (!session) return bad('Unauthorized', 401)
  if (session.role !== 'super_admin') return bad('Forbidden', 403)

  const [[{ count: totalTenants }], [{ count: activeTenants }], [{ count: totalUsers }], onboardByStatusRows] =
    await Promise.all([
      db.select({ count: count() }).from(tenants),
      db.select({ count: count() }).from(tenants).where(eq(tenants.active, true)),
      db.select({ count: count() }).from(users).where(eq(users.status, 'ACTIVE')),
      db.select({ status: onboardRequests.status, count: count() }).from(onboardRequests).groupBy(onboardRequests.status),
    ])

  const onboardRequestsByStatus = Object.fromEntries(ONBOARD_STATUSES.map((s) => [s, 0])) as Record<
    (typeof ONBOARD_STATUSES)[number],
    number
  >
  for (const row of onboardByStatusRows) {
    if ((ONBOARD_STATUSES as readonly string[]).includes(row.status)) {
      onboardRequestsByStatus[row.status as (typeof ONBOARD_STATUSES)[number]] = row.count
    }
  }

  return NextResponse.json(
    {
      success: true,
      data: {
        totalTenants,
        activeTenants,
        totalUsers,
        onboardRequestsByStatus,
      },
    },
    { status: 200 }
  )
}
