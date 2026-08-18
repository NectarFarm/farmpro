import { NextResponse } from 'next/server'
import { db } from '@/db'
import { users } from '@/db/schemas'
import { getSessionUser } from '@/lib/auth'
import { and, asc, eq, or } from 'drizzle-orm'

// ── GET /api/approvers (task approval governance) ──────────────────────────
// The users who can approve a task's completion — owner/manager roles only,
// the same ALLOWED_ROLES the approve/reject routes gate on, so a worker can
// never be selected as an approver. ACTIVE + tenant-scoped. Powers the
// "Assign Approver" picker at task creation (components/farm/tasks.tsx) and
// lets a worker see who will review their work (components/farm/worker.tsx).
//
// Same tenant-resolution + envelope conventions as GET /api/tasks: session
// tenant wins, `tenantId` query param is the standalone-mock-mode fallback.

const ok = <T>(data: T) => NextResponse.json({ success: true, data }, { status: 200 })
const badRequest = (msg: string) => NextResponse.json({ success: false, error: msg }, { status: 400 })

export async function GET(req: Request) {
  const session = await getSessionUser()
  const url = new URL(req.url)
  const tenantId = session?.tenantId ?? url.searchParams.get('tenantId')?.trim()
  if (!tenantId) return badRequest('tenantId is required')

  const rows = await db
    .select({ id: users.id, name: users.name, email: users.email, role: users.role })
    .from(users)
    .where(and(eq(users.tenantId, tenantId), eq(users.status, 'ACTIVE'), or(eq(users.role, 'owner'), eq(users.role, 'manager'))))
    .orderBy(asc(users.name))

  return ok(rows)
}
