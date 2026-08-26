import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { db } from '@/db'
import { sessions } from '@/db/schemas'
import { lt } from 'drizzle-orm'
import { logger } from '@/lib/logger'

// ── GET /api/cron/cleanup-sessions ─────────────────────────────────────────
// Deletes expired sessions. Called by Vercel Cron (see vercel.json) once a
// night. Protected by CRON_SECRET so it is not a public delete endpoint.
//
// Auth (scalability audit fix): Vercel does NOT interpolate `${...}` inside
// a `crons[].path` string — it requests that literal path, so the previous
// `?secret=${CRON_SECRET}` compared the literal text "${CRON_SECRET}"
// against process.env.CRON_SECRET and never matched, 401-ing every single
// scheduled run. Sessions were never cleaned. What Vercel actually does for
// a cron-triggered request is send `Authorization: Bearer <CRON_SECRET>`
// (https://vercel.com/docs/cron-jobs/manage-cron-jobs#securing-cron-jobs) —
// that header is what we check now. A `?secret=` query param is kept ONLY
// as a manual-trigger path (e.g. an admin re-running cleanup by hand from a
// browser/curl, where setting a custom header is inconvenient); either one
// satisfies the check.
//
// If CRON_SECRET itself is unset, this refuses outright rather than
// silently comparing against `undefined` — the previous code's `secret !==
// process.env.CRON_SECRET` happened to reject an unset secret too (`null !==
// undefined`), but only by coincidence: an attacker who sends the literal
// header `Authorization: Bearer undefined` would otherwise authenticate
// against a misconfigured deployment, because `` `Bearer ${undefined}` ``
// stringifies to exactly that. Checked explicitly, first, before either
// credential is even compared. The response is still a plain 401 (not a
// distinct 500) so an unauthenticated caller can't use the status code to
// probe whether CRON_SECRET is configured at all — the distinction is only
// visible server-side, in the log line below.
function timingSafeStringEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB)
}

export async function GET(req: Request) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    logger.error('cron/cleanup-sessions: CRON_SECRET is not configured — refusing to run')
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
    const stopTimer = logger.time('cron/cleanup-sessions')
    const deletedRows = await db.delete(sessions).where(lt(sessions.expiresAt, new Date())).returning({ token: sessions.token })
    stopTimer()
    logger.info('cron/cleanup-sessions: deleted expired sessions', { requestId, deleted: deletedRows.length })

    return NextResponse.json({
      success: true,
      deleted: deletedRows.length,
      ranAt: new Date().toISOString(),
    })
  })
}
