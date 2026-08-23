import { NextResponse } from 'next/server'
import { and, asc, eq } from 'drizzle-orm'
import { db } from '@/db'
import { employees, users } from '@/db/schemas'
import { requireTenantSession } from '@/lib/api-auth'
import { canEdit, MODULES } from '@/lib/permissions'

// ── GET /api/approvals/approvers ────────────────────────────────────────────
// Who can be named as a task's approver. The task form previously offered no
// choice at all — approval simply meant "whoever holds governance rights",
// which in practice meant every such person saw every request and any of
// them could sign it off.
//
// Two rules decide this list, and both matter:
//   - the person must be able to SIGN IN (a users row), because approving is
//     an action taken in a session. An employee with no login yet can be
//     assigned work but cannot be named as its approver.
//   - their role must have governance edit access under THIS tenant's own
//     matrix, not a hardcoded owner/manager pair. Naming someone who will be
//     refused at decision time creates a task that can never be completed.
//
// The employee row is joined in only for the label: an owner picking an
// approver thinks in terms of the people on their farm, not user accounts.
export async function GET(req: Request) {
  const auth = await requireTenantSession({
    explicitTenantId: new URL(req.url).searchParams.get('tenantId'),
  })
  if ('error' in auth) return auth.error
  const { tenantId } = auth

  const rows = await db
    .select({ id: users.id, name: users.name, role: users.role, employeeId: employees.id })
    .from(users)
    .leftJoin(employees, and(eq(employees.userId, users.id), eq(employees.tenantId, tenantId)))
    .where(and(eq(users.tenantId, tenantId), eq(users.status, 'ACTIVE')))
    .orderBy(asc(users.name))

  // canEdit reads the tenant's matrix per role; roles repeat across users, so
  // the answer is resolved once per distinct role rather than once per row.
  const verdicts = new Map<string, boolean>()
  const approvers = []
  for (const row of rows) {
    if (!verdicts.has(row.role)) {
      verdicts.set(row.role, await canEdit(tenantId, row.role, MODULES.governance))
    }
    if (verdicts.get(row.role)) {
      approvers.push({ userId: row.id, name: row.name, role: row.role, employeeId: row.employeeId })
    }
  }

  return NextResponse.json({ success: true, data: approvers }, { status: 200 })
}
