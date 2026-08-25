import { NextResponse } from 'next/server'
import { desc, eq } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import { db } from '@/db'
import { enterpriseRequests, notifications } from '@/db/schemas'
import { requireTenantSession } from '@/lib/api-auth'
import { PLATFORM_TENANT_SENTINEL } from '@/lib/audit'
import {
  isValidEnterpriseKey, normalizeEnterprise, tenantEnterpriseList, tenantEnterpriseSet,
} from '@/lib/enterprises'
import { notifyRecipientsByEmail } from '@/lib/notification-email'

// ── /api/tenant-enterprises — what this farm is scoped to, and asking for more ─
// GET  → { enterprises: [{ enterprise, source, createdAt }], requests: [...], unrestricted }
// POST → { enterprise, reason? } files a request for a super_admin to decide.
//
// The farmer can SEE their scope and ASK to widen it; they cannot widen it.
// Enterprise scope decides which forms a worker gets, which batch types exist,
// which report shapes apply and which code prefixes are minted, so
// self-service would let an account quietly grow past what was approved. Same
// admin-mediated shape as password resets (POST /api/auth/forgot-password →
// GET /api/admin/password-resets), for the same reason and with the same
// notification plumbing.
const REQUESTER_ROLES = ['owner', 'manager'] as const

const bad = (msg: string, status = 400) =>
  NextResponse.json({ success: false, error: msg }, { status })

export async function GET() {
  const auth = await requireTenantSession({ roles: REQUESTER_ROLES })
  if ('error' in auth) return auth.error
  const { tenantId } = auth

  const enterprises = await tenantEnterpriseList(tenantId)
  const requests = await db
    .select({
      id: enterpriseRequests.id,
      enterprise: enterpriseRequests.enterprise,
      reason: enterpriseRequests.reason,
      status: enterpriseRequests.status,
      decisionNote: enterpriseRequests.decisionNote,
      createdAt: enterpriseRequests.createdAt,
      decidedAt: enterpriseRequests.decidedAt,
    })
    .from(enterpriseRequests)
    .where(eq(enterpriseRequests.tenantId, tenantId))
    .orderBy(desc(enterpriseRequests.createdAt))
    .limit(50)

  return NextResponse.json({
    success: true,
    data: {
      enterprises,
      requests,
      // Told plainly rather than left for the client to infer from an empty
      // array — "no rows" and "unrestricted" are the same state here, and a
      // client that guessed wrong would render "you farm nothing".
      unrestricted: enterprises.length === 0,
    },
  }, { status: 200 })
}

export async function POST(req: Request) {
  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    raw = {}
  }
  const body = (raw ?? {}) as Record<string, unknown>

  const auth = await requireTenantSession({
    roles: REQUESTER_ROLES,
    explicitTenantId: typeof body.tenantId === 'string' ? body.tenantId : undefined,
  })
  if ('error' in auth) return auth.error
  const { tenantId, session } = auth

  const enterprise = normalizeEnterprise(body.enterprise)
  if (!isValidEnterpriseKey(enterprise)) {
    return bad('enterprise is required and must be at most 64 characters.')
  }
  const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 500) : ''

  // Already have it: say so instead of queueing work an admin would only
  // close as redundant.
  const existing = await tenantEnterpriseSet(tenantId)
  if (existing.has(enterprise)) {
    return bad(`Your farm is already set up for "${enterprise}".`, 409)
  }

  const requestId = randomUUID()
  try {
    await db.insert(enterpriseRequests).values({
      id: requestId,
      tenantId,
      enterprise,
      requestedByUserId: session.id,
      reason,
      status: 'pending',
    })
  } catch (err) {
    // The one-pending-per-tenant-per-enterprise partial unique index. A farmer
    // tapping twice is the common case, so this is a plain "already asked",
    // not an error worth logging as a failure.
    const detail = err instanceof Error ? err.message : ''
    if (/idx_enterprise_requests_one_pending|duplicate key/i.test(detail)) {
      return bad(`You have already requested "${enterprise}" — an administrator is reviewing it.`, 409)
    }
    console.error('[enterprise-request] insert failed', { tenantId, enterprise, err })
    return bad('Could not file your request. Please try again.', 500)
  }

  // Surfaced to super_admins exactly the way a password-reset request is: on
  // the tenantless platform scope, userId null (any super_admin, not one
  // specific person), so it never lands in the requesting tenant's own feed.
  // notifyRecipientsByEmail() then resolves recipients from this row's own
  // role/tenant and claims it so a retry can't double-send — the same call
  // POST /api/auth/forgot-password makes, rather than a second copy of the
  // admin lookup here.
  const notificationId = randomUUID()
  await db.insert(notifications).values({
    id: notificationId,
    tenantId: PLATFORM_TENANT_SENTINEL,
    sourceType: 'enterprise_request',
    sourceId: requestId,
    title: 'Enterprise access requested',
    message: `A farm has asked to add "${enterprise}".${reason ? ` Reason: ${reason}` : ''}`,
    role: 'super_admin',
  })
  // Failure is logged and swallowed inside the helper: the queue row above is
  // the source of truth, and an email that didn't send must not fail a request
  // the farmer already made.
  await notifyRecipientsByEmail(notificationId)

  return NextResponse.json({
    success: true,
    data: { id: requestId, enterprise, status: 'pending' },
  }, { status: 201 })
}
