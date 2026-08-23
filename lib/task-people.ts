// ── Resolving who a task is for, and who signs it off ───────────────────────
// Shared by POST /api/tasks and PATCH /api/tasks/[id] so the two can't
// disagree about what a valid assignee or approver is. Both checks are
// tenant-scoped: naming someone from another tenant must fail as "not found",
// never quietly succeed and leak that the id exists.
import 'server-only'
import { and, eq } from 'drizzle-orm'
import { db } from '@/db'
import { employees, users } from '@/db/schemas'
import { canEdit, MODULES } from '@/lib/permissions'

// An employees.id — the person doing the work. Deliberately not required to
// have a login: a task can be assigned to someone before their account is
// issued (see POST /api/employees/[id]/login), and refusing that would make
// the assignment feature depend on credential rollout.
export async function resolveAssignee(tenantId: string, assigneeId: string): Promise<string | null> {
  const rows = await db
    .select({ id: employees.id })
    .from(employees)
    .where(and(eq(employees.id, assigneeId), eq(employees.tenantId, tenantId)))
    .limit(1)
  return rows[0]?.id ?? null
}

export type ApproverProblem = 'not-found' | 'cannot-approve'

// A users.id — approving happens while signed in, so the only identity that
// can carry the action is the one a session resolves to. The named person
// must ALSO be able to approve under the tenant's own role matrix: naming
// someone who will be refused at decision time creates a task that can never
// be completed, and the queue gives no clue why.
export async function resolveApprover(
  tenantId: string,
  approverId: string
): Promise<{ id: string } | { problem: ApproverProblem; name?: string }> {
  const rows = await db
    .select({ id: users.id, name: users.name, role: users.role, status: users.status })
    .from(users)
    .where(and(eq(users.id, approverId), eq(users.tenantId, tenantId)))
    .limit(1)
  const user = rows[0]
  if (!user || user.status !== 'ACTIVE') return { problem: 'not-found' }
  if (!(await canEdit(tenantId, user.role, MODULES.governance))) {
    return { problem: 'cannot-approve', name: user.name }
  }
  return { id: user.id }
}
