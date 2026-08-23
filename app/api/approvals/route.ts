import { NextResponse } from 'next/server'
import { db } from '@/db'
import { approvalRequests } from '@/db/schemas'
import { and, asc, eq, inArray, isNull, or } from 'drizzle-orm'
import { batchIdsForFarm, farmNotFoundResponse, resolveFarmFilter } from '@/lib/farm-scope'
import { requireTenantSession } from '@/lib/api-auth'

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
//
// ── farmId decision (farm-scoped-data task) ─────────────────────────────────
// approval_requests.batchId is NULLABLE (db/schemas/governance.ts) — not
// every approval concerns a batch. A naive `farmId` filter that only matched
// batch-linked rows through the batches->units->farm join would silently
// hide every tenant-level approval (batchId IS NULL) the moment an owner
// picks a specific farm in the switcher — exactly the "a decision needing
// making disappears" failure mode a governance queue can least afford. So:
// filtering by `farmId` returns that farm's batch-linked approvals PLUS
// every batchId-IS-NULL (tenant-level) approval, never just the former. The
// unfiltered/ALL view already includes both by construction.

const ok = <T>(data: T) => NextResponse.json({ success: true, data }, { status: 200 })

export async function GET(req: Request) {
  const url = new URL(req.url)
  const auth = await requireTenantSession()
  if ('error' in auth) return auth.error
  const { tenantId } = auth

  const status = url.searchParams.get('status')?.trim().toLowerCase()

  const farmFilter = await resolveFarmFilter(tenantId, url.searchParams.get('farmId'))
  if (farmFilter === null) return NextResponse.json(farmNotFoundResponse(), { status: 404 })

  const conditions = [eq(approvalRequests.tenantId, tenantId)]
  if (status) conditions.push(eq(approvalRequests.status, status))

  // `scope` answers the two questions an approver actually has, without
  // making the client filter a whole tenant's queue client-side:
  //   mine    — waiting on ME: named on me, plus the unassigned ones anyone
  //             with governance rights is expected to pick up. Leaving those
  //             out would hide work that genuinely is mine to do.
  //   decided — what I have already signed off or refused.
  const scope = url.searchParams.get('scope')?.trim().toLowerCase()
  if (scope === 'mine') {
    conditions.push(or(
      eq(approvalRequests.assignedApproverId, auth.session.id),
      isNull(approvalRequests.assignedApproverId)
    )!)
  } else if (scope === 'decided') {
    conditions.push(eq(approvalRequests.decidedBy, auth.session.id))
  }
  if (farmFilter) {
    const batchIds = await batchIdsForFarm(tenantId, farmFilter)
    // Tenant-level approvals (batchId IS NULL) always included — see the
    // decision writeup above. Only add the batch-id branch when this farm
    // actually has matching batches, so the query never passes an empty
    // array to inArray (invalid/ambiguous SQL).
    conditions.push(batchIds.length > 0
      ? or(inArray(approvalRequests.batchId, batchIds), isNull(approvalRequests.batchId))!
      : isNull(approvalRequests.batchId))
  }

  const rows = await db
    .select()
    .from(approvalRequests)
    .where(and(...conditions))
    .orderBy(asc(approvalRequests.requestedAt), asc(approvalRequests.id))

  return ok(rows)
}
