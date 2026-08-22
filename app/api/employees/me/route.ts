import { NextResponse } from 'next/server'
import { db } from '@/db'
import { employees } from '@/db/schemas'
import { and, eq } from 'drizzle-orm'
import { requireTenantSession } from '@/lib/api-auth'

// ── GET /api/employees/me (issue #247 task 3; auth fix:
// fix/authenticate-all-apis) ─────────────────────────────────────────────────
// Returns the logged-in worker's own employees row — the profile config the
// worker app needs client-side (mortalityPhotoThreshold today; whatever else
// a future issue adds to this row later, e.g. assignedBatchIds for a
// batch-scoped record form).
//
// Resolution: by `userId` (matched against the session user's id), not
// phone — see db/schemas/people.ts's comment on `employees.userId` for why
// (short version: `users` has no phone column on this branch, so userId is
// the only exact-match link available). Both tenantId and userId come from
// the session ONLY now — this used to accept `?tenantId=&userId=` from a
// session-less caller, which meant anyone could read ANY user's employee
// profile (mortalityPhotoThreshold, assigned batches, ...) just by naming
// their ids.
const ok = <T>(data: T) => NextResponse.json({ success: true, data }, { status: 200 })
const notFound = () => NextResponse.json({ success: false, error: 'No employee record linked to this account' }, { status: 404 })

export async function GET() {
  const auth = await requireTenantSession()
  if ('error' in auth) return auth.error
  const { session, tenantId } = auth

  const rows = await db
    .select()
    .from(employees)
    .where(and(eq(employees.tenantId, tenantId), eq(employees.userId, session.id)))
  if (rows.length === 0) return notFound()
  return ok(rows[0])
}
