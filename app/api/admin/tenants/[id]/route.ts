import { NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import { and, desc, eq, inArray, notInArray } from 'drizzle-orm'
import { db } from '@/db'
import { payments, sessions, supportTickets, tenantAdminNotes, tenants, users } from '@/db/schemas'
import { requirePlatformCapability } from '@/lib/api-auth'
import { writeAuditLog } from '@/lib/audit'
import { SAFE_USER_COLUMNS } from '@/lib/admin-users'
import { computeAccessState } from '@/lib/billing/access-state'
import { getCurrentSubscription, getUsage, toSnapshot } from '@/lib/billing/subscriptions'

// ── GET/PATCH /api/admin/tenants/[id] (tenants.manage) ──────────────────────
// GET is the tenant-overview screen's one call: profile/status, current
// subscription + usage vs plan limits, payment history, the user list, open
// ticket count, admin notes, and "last activity" (the most recent session
// created by any user of this tenant — the closest real signal this
// codebase has to "when did someone last use the app"; there is no
// per-request activity log to read instead).
//
// PATCH: { active }  suspends/reactivates the tenant — the SAME
// `tenants.active` gate issue #223 already wired into login/session checks
// (lib/auth.ts's isTenantActive), not a second suspension mechanism.
// { note }  appends a tenant_admin_notes row (never edits/deletes a prior
// note — an audit trail of remarks, not a single overwritable field).
// Both may be supplied in the same request.

const OPEN_TICKET_STATUSES_EXCLUDED = ['resolved', 'closed']

const bad = (msg: string, status = 400) => NextResponse.json({ success: false, error: msg }, { status })

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePlatformCapability('tenants.manage')
  if ('error' in auth) return auth.error

  const { id: tenantId } = await params
  const tenantRows = await db.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1)
  const tenant = tenantRows[0]
  if (!tenant) return bad('Tenant not found', 404)

  const [userRows, sub, usage, paymentRows, openTicketRows, noteRows] = await Promise.all([
    db.select(SAFE_USER_COLUMNS).from(users).where(eq(users.tenantId, tenantId)),
    getCurrentSubscription(tenantId),
    getUsage(tenantId),
    db.select().from(payments).where(eq(payments.tenantId, tenantId)).orderBy(desc(payments.createdAt)),
    db
      .select({ id: supportTickets.id })
      .from(supportTickets)
      .where(and(eq(supportTickets.tenantId, tenantId), notInArray(supportTickets.status, OPEN_TICKET_STATUSES_EXCLUDED))),
    db.select().from(tenantAdminNotes).where(eq(tenantAdminNotes.tenantId, tenantId)).orderBy(desc(tenantAdminNotes.createdAt)),
  ])

  const userIds = userRows.map((u) => u.id)
  const lastSessionRows = userIds.length
    ? await db.select({ createdAt: sessions.createdAt }).from(sessions).where(inArray(sessions.userId, userIds)).orderBy(desc(sessions.createdAt)).limit(1)
    : []

  const authorIds = Array.from(new Set(noteRows.map((n) => n.authorId)))
  const authorRows = authorIds.length ? await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, authorIds)) : []
  const authorNameById = new Map(authorRows.map((a) => [a.id, a.name]))

  const access = computeAccessState(sub ? toSnapshot(sub) : null, new Date())

  return NextResponse.json(
    {
      success: true,
      data: {
        tenant,
        users: userRows,
        subscription: sub
          ? {
              id: sub.id,
              planId: sub.planId,
              planName: sub.plan.name,
              planCode: sub.plan.code,
              period: sub.period,
              status: access.status,
              needsPlan: access.needsPlan,
              trialEndsAt: sub.trialEndsAt,
              currentPeriodEnd: sub.currentPeriodEnd,
              amountDueCents: sub.amountDueCents,
              cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
            }
          : null,
        usage,
        limits: sub?.plan.limits ?? null,
        payments: paymentRows,
        openTicketCount: openTicketRows.length,
        notes: noteRows.map((n) => ({ ...n, authorName: authorNameById.get(n.authorId) ?? 'Unknown' })),
        lastActivityAt: lastSessionRows[0]?.createdAt ?? null,
      },
    },
    { status: 200 }
  )
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePlatformCapability('tenants.manage')
  if ('error' in auth) return auth.error
  const { session } = auth

  const { id: tenantId } = await params
  const tenantRows = await db.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1)
  const tenant = tenantRows[0]
  if (!tenant) return bad('Tenant not found', 404)

  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return bad('Invalid JSON body')
  }
  const b = (raw ?? {}) as Record<string, unknown>

  let updatedTenant = tenant
  if ('active' in b) {
    if (typeof b.active !== 'boolean') return bad('active must be a boolean')
    const result = await db.update(tenants).set({ active: b.active }).where(eq(tenants.id, tenantId)).returning()
    updatedTenant = result[0]
    await writeAuditLog({
      tenantId,
      actor: session.id,
      action: b.active ? 'tenant.reactivate' : 'tenant.suspend',
      entity: 'tenant',
      entityId: tenantId,
      meta: {},
    })
  }

  let insertedNote: typeof tenantAdminNotes.$inferSelect | null = null
  if ('note' in b) {
    const note = typeof b.note === 'string' ? b.note.trim() : ''
    if (!note) return bad('note must be a non-empty string')
    const id = randomUUID()
    const rows = await db.insert(tenantAdminNotes).values({ id, tenantId, authorId: session.id, note }).returning()
    insertedNote = rows[0]
    await writeAuditLog({ tenantId, actor: session.id, action: 'tenant.note', entity: 'tenant', entityId: tenantId, meta: { note } })
  }

  if (!('active' in b) && !('note' in b)) return bad('No updatable fields supplied (active, note)')

  return NextResponse.json({ success: true, data: { tenant: updatedTenant, note: insertedNote } }, { status: 200 })
}
