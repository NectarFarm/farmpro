import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/api-auth'
import { resolveCapabilities } from '@/lib/platform-staff'

// ── GET /api/admin/me (super_admin) ─────────────────────────────────────────
// The caller's own resolved capabilities — no capability required beyond
// being a super_admin at all, since a UI needs this response BEFORE it knows
// which admin screens to even offer. See lib/platform-staff.ts for the
// resolution rule (a no-row super_admin gets every capability back here).
export async function GET() {
  const auth = await requireRole(['super_admin'])
  if ('error' in auth) return auth.error
  const { session } = auth

  const capabilities = await resolveCapabilities(session.id, session.role)

  return NextResponse.json(
    { success: true, data: { userId: session.id, name: session.name, email: session.email, capabilities } },
    { status: 200 }
  )
}
