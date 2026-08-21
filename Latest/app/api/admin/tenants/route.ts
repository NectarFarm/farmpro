import { NextResponse } from 'next/server'
import { asc, count, eq } from 'drizzle-orm'
import { db } from '@/db'
import { farms, tenants, users } from '@/db/schemas'
import { getSessionUser } from '@/lib/auth'

// ── GET /api/admin/tenants (issue #252) ─────────────────────────────────────
// super_admin-only. Real backend for AdminFarmsScreen's farm/tenant list —
// no such route existed on this branch before this issue (confirmed by grep,
// the issue's own branch-correction note). Returns each tenant's basic real
// fields plus a farm count and a user count, computed as two grouped counts
// merged in application code rather than a join (a farms⋈users join would
// fan out rows and double-count either side).
//
// Response envelope matches app/api/onboard-requests/route.ts / lib/api-response.ts
// ({ success, data | error }).

const bad = (msg: string, status = 400) =>
  NextResponse.json({ success: false, error: msg }, { status })

export async function GET() {
  const session = await getSessionUser()
  if (!session) return bad('Unauthorized', 401)
  if (session.role !== 'super_admin') return bad('Forbidden', 403)

  const tenantRows = await db.select().from(tenants).orderBy(asc(tenants.createdAt), asc(tenants.id))

  const farmCounts = await db
    .select({ tenantId: farms.tenantId, count: count() })
    .from(farms)
    .groupBy(farms.tenantId)
  const userCounts = await db
    .select({ tenantId: users.tenantId, count: count() })
    .from(users)
    .where(eq(users.status, 'ACTIVE'))
    .groupBy(users.tenantId)

  const farmCountByTenant = new Map(farmCounts.map((r) => [r.tenantId, r.count]))
  const userCountByTenant = new Map(userCounts.map((r) => [r.tenantId, r.count]))

  const data = tenantRows.map((t) => ({
    id: t.id,
    name: t.name,
    active: t.active,
    createdAt: t.createdAt,
    farms: farmCountByTenant.get(t.id) ?? 0,
    users: userCountByTenant.get(t.id) ?? 0,
  }))

  return NextResponse.json({ success: true, data }, { status: 200 })
}
