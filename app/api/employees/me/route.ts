import { NextResponse } from 'next/server'
import { db } from '@/db'
import { employees } from '@/db/schemas'
import { getSessionUser } from '@/lib/auth'
import { and, eq } from 'drizzle-orm'

// ── GET /api/employees/me (issue #247 task 3) ───────────────────────────────
// Returns the logged-in worker's own employees row — the profile config the
// worker app needs client-side (mortalityPhotoThreshold today; whatever else
// a future issue adds to this row later, e.g. assignedBatchIds for a
// batch-scoped record form).
//
// Resolution: by `userId` (matched against the session user's id), not
// phone — see db/schemas/people.ts's comment on `employees.userId` for why
// (short version: `users` has no phone column on this branch, so userId is
// the only exact-match link available). In standalone mock mode (no session
// cookie — the same fallback every other route on this branch uses), the
// caller passes `?tenantId=&userId=` directly; this is also what the test
// suite uses, since there's no login flow to exercise here.
const ok = <T>(data: T) => NextResponse.json({ success: true, data }, { status: 200 })
const badRequest = (msg: string) => NextResponse.json({ success: false, error: msg }, { status: 400 })
const notFound = () => NextResponse.json({ success: false, error: 'No employee record linked to this account' }, { status: 404 })

export async function GET(req: Request) {
  const session = await getSessionUser()
  const url = new URL(req.url)
  const tenantId = session?.tenantId ?? url.searchParams.get('tenantId')?.trim()
  const userId = session?.id ?? url.searchParams.get('userId')?.trim()

  if (!tenantId) return badRequest('tenantId is required')
  if (!userId) return badRequest('userId is required')

  const rows = await db
    .select()
    .from(employees)
    .where(and(eq(employees.tenantId, tenantId), eq(employees.userId, userId)))
  if (rows.length === 0) return notFound()
  return ok(rows[0])
}
