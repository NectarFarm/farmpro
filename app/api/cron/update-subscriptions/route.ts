import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { subscriptions, type SubscriptionStatus } from '@/db/schemas'
import { effectiveStatus } from '@/lib/billing/access-state'
import { logger } from '@/lib/logger'

// ── GET /api/cron/update-subscriptions ──────────────────────────────────────
// Persists the time-based status transitions lib/billing/access-state.ts's
// `effectiveStatus` already computes on every READ (GET /api/auth/session,
// GET /api/billing/subscription, GET /api/admin/subscriptions) — those reads
// are the actual source of truth and work correctly even if this cron never
// ran. This exists purely so a plain `WHERE status = 'past_due'` (e.g. an
// admin list filter, or a future "notify past_due tenants" job) run directly
// against the stored column stays close to accurate too, once a day, rather
// than only ever being right at read time. Same auth pattern as
// app/api/cron/cleanup-sessions — see that route for the CRON_SECRET
// reasoning this one reuses verbatim.
function timingSafeStringEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB)
}

export async function GET(req: Request) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    logger.error('cron/update-subscriptions: CRON_SECRET is not configured — refusing to run')
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
  }

  const authHeader = req.headers.get('authorization') ?? ''
  const bearerOk = timingSafeStringEqual(authHeader, `Bearer ${cronSecret}`)
  const url = new URL(req.url)
  const querySecret = url.searchParams.get('secret')
  const queryOk = querySecret !== null && timingSafeStringEqual(querySecret, cronSecret)

  if (!bearerOk && !queryOk) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
  }

  return logger.withRequestId(async (requestId) => {
    const stopTimer = logger.time('cron/update-subscriptions')
    const now = new Date()

    const rows = await db
      .select({
        id: subscriptions.id,
        status: subscriptions.status,
        trialEndsAt: subscriptions.trialEndsAt,
        currentPeriodEnd: subscriptions.currentPeriodEnd,
        cancelAtPeriodEnd: subscriptions.cancelAtPeriodEnd,
      })
      .from(subscriptions)
      .where(eq(subscriptions.isCurrent, true))

    let updated = 0
    for (const row of rows) {
      const next = effectiveStatus(
        {
          status: row.status as SubscriptionStatus,
          trialEndsAt: row.trialEndsAt,
          currentPeriodEnd: row.currentPeriodEnd,
          cancelAtPeriodEnd: row.cancelAtPeriodEnd,
        },
        now
      )
      if (next !== row.status) {
        await db.update(subscriptions).set({ status: next, updatedAt: now }).where(eq(subscriptions.id, row.id))
        updated++
      }
    }

    stopTimer()
    logger.info('cron/update-subscriptions: recomputed subscription statuses', { requestId, checked: rows.length, updated })

    return NextResponse.json({ success: true, checked: rows.length, updated, ranAt: now.toISOString() })
  })
}
