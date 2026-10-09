import { NextResponse } from 'next/server'
import { requireTenantSession } from '@/lib/api-auth'
import { listPendingLogins } from '@/lib/pending-logins'

// GET /api/employees/sign-in-waiting — owner only. Who on the roster cannot
// sign in yet, and for how long (see lib/pending-logins.ts). A separate route
// rather than extra fields on GET /api/employees: that list is read by every
// role and every screen, and this needs a token join only the owner's People
// screen wants. Same owner-only guard as the sign-in card it feeds.
export async function GET() {
  const auth = await requireTenantSession({ roles: ['owner'] })
  if ('error' in auth) return auth.error
  const data = await listPendingLogins(auth.tenantId)
  return NextResponse.json({ success: true, data }, { status: 200 })
}
