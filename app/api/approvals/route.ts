import { NextResponse } from 'next/server'
import { db } from '@/db'
import { approvalRequests } from '@/db/schemas'
import { getSessionUser } from '@/lib/auth'
import { and, asc, eq } from 'drizzle-orm'

// ── GET /api/approvals (issue #243 task 2) ──────────────────────────────────
// Lists a tenant's approval queue (GovernanceScreen's Approvals tab). Same
// tenant-resolution convention as GET /api/batches: session tenant wins, the
// `tenantId` query param is the standalone-mock-mode fallback. Optional
// `status` filter (pending | approved | rejected); defaults to all.
//
// Deciding requests happens via the dedicated
// POST /api/approvals/[id]/approve|reject routes, not a PATCH here — approving
// has real side effects (resolving the linked task, writing audit_log) that
// don't belong in a generic field-patch endpoint.

const ok = <T>(data: T) => NextResponse.json({ success: true, data }, { status: 200 })
const badRequest = (msg: string) => NextResponse.json({ success: false, error: msg }, { status: 400 })

export async function GET(req: Request) {
  const session = await getSessionUser()
  const url = new URL(req.url)
  const tenantId = session?.tenantId ?? url.searchParams.get('tenantId')?.trim()
  if (!tenantId) return badRequest('tenantId is required')

  const status = url.searchParams.get('status')?.trim().toLowerCase()
  const conditions = [eq(approvalRequests.tenantId, tenantId)]
  if (status) conditions.push(eq(approvalRequests.status, status))

  const rows = await db
    .select()
    .from(approvalRequests)
    .where(and(...conditions))
    .orderBy(asc(approvalRequests.requestedAt), asc(approvalRequests.id))

  return ok(rows)
}
