import { NextResponse } from 'next/server'
import { db } from '@/db'
import { sessions } from '@/db/schemas'
import { lt } from 'drizzle-orm'

// ── GET /api/cron/cleanup-sessions ─────────────────────────────────────────
// Deletes expired sessions. Called by Vercel Cron (see vercel.json).
// Protected by CRON_SECRET so it is not a public delete endpoint.

export async function GET(req: Request) {
  const url = new URL(req.url)
  const secret = url.searchParams.get('secret')

  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
  }

  const result = await db.delete(sessions).where(lt(sessions.expiresAt, new Date()))

  return NextResponse.json({
    success: true,
    deleted: result.length,
    ranAt: new Date().toISOString(),
  })
}
