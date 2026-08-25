import { NextResponse } from 'next/server'
import { desc, eq } from 'drizzle-orm'
import { db } from '@/db'
import { enterpriseRequests, tenants, users } from '@/db/schemas'
import { requireRole } from '@/lib/api-auth'

// ── GET /api/admin/enterprise-requests (super_admin) ───────────────────────
// The queue behind POST /api/tenant-enterprises. Deliberately NOT filtered by
// tenant — a super_admin session carries `tenantId: null` and handles every
// tenant's requests, exactly like GET /api/admin/password-resets.
//
// `?status=` filters (default: pending, which is the only actionable state).
export async function GET(req: Request) {
  const auth = await requireRole(['super_admin'])
  if ('error' in auth) return auth.error

  const status = new URL(req.url).searchParams.get('status')?.trim() || 'pending'

  const rows = await db
    .select({
      id: enterpriseRequests.id,
      tenantId: enterpriseRequests.tenantId,
      // Joined so the queue reads as "Kamau Poultry Farm wants layers", not a
      // UUID an admin has to look up before they can decide anything.
      tenantName: tenants.name,
      enterprise: enterpriseRequests.enterprise,
      reason: enterpriseRequests.reason,
      status: enterpriseRequests.status,
      requestedByName: users.name,
      requestedByEmail: users.email,
      createdAt: enterpriseRequests.createdAt,
      decidedAt: enterpriseRequests.decidedAt,
      decisionNote: enterpriseRequests.decisionNote,
    })
    .from(enterpriseRequests)
    .leftJoin(tenants, eq(tenants.id, enterpriseRequests.tenantId))
    .leftJoin(users, eq(users.id, enterpriseRequests.requestedByUserId))
    .where(status === 'all' ? undefined : eq(enterpriseRequests.status, status))
    .orderBy(desc(enterpriseRequests.createdAt))
    .limit(200)

  return NextResponse.json({ success: true, data: rows }, { status: 200 })
}
