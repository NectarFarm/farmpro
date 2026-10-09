import 'server-only'
import { and, asc, eq, inArray } from 'drizzle-orm'
import { db } from '@/db'
import { employees, users } from '@/db/schemas'
import { setPasswordWaitFor } from '@/lib/set-password'

// ── Who on the roster cannot sign in yet? ───────────────────────────────────
// Two credential shapes, so two meanings of "waiting":
//   - manager / vet / auditor sign in with email + a password they choose
//     through a one-time link. Waiting = no login at all, or a login whose
//     NEWEST link is still unredeemed (live or expired — lib/set-password.ts).
//   - worker signs in with phone + PIN. Waiting = no login, or a login with no
//     PIN set. There is no link and no expiry.
// Owners are never listed (they are not issued a login from here).
//
// One roster query (employees LEFT JOIN users) plus one token query for the
// whole page — never a query per person.
export type PendingLoginReason = 'no-login' | 'no-pin' | 'link-waiting' | 'link-expired'

export interface PendingLogin {
  employeeId: string
  name: string
  role: string
  phone: string
  kind: 'email' | 'pin'
  reason: PendingLoginReason
  /** When they started waiting: the link's issue time, else when the person was added. */
  since: string | null
  /** Link expiry; only for link-waiting / link-expired. */
  expiresAt: string | null
}

export const LOGIN_ROLES = ['manager', 'vet', 'auditor', 'worker'] as const

export async function listPendingLogins(tenantId: string): Promise<PendingLogin[]> {
  const rows = await db
    .select({
      id: employees.id,
      name: employees.name,
      role: employees.role,
      phone: employees.phone,
      createdAt: employees.createdAt,
      userId: employees.userId,
      loginUserId: users.id,
      pinHash: users.pinHash,
    })
    .from(employees)
    .leftJoin(users, and(eq(users.id, employees.userId), eq(users.tenantId, tenantId)))
    .where(and(eq(employees.tenantId, tenantId), eq(employees.status, 'ACTIVE'), inArray(employees.role, [...LOGIN_ROLES])))
    .orderBy(asc(employees.createdAt), asc(employees.id))

  const emailUserIds = rows.filter((r) => r.role !== 'worker' && r.loginUserId).map((r) => r.loginUserId as string)
  const waits = await setPasswordWaitFor(emailUserIds)

  const out: PendingLogin[] = []
  for (const r of rows) {
    const base = { employeeId: r.id, name: r.name, role: r.role, phone: r.phone ?? '', since: r.createdAt?.toISOString() ?? null, expiresAt: null }
    if (r.role === 'worker') {
      if (!r.loginUserId) out.push({ ...base, kind: 'pin', reason: 'no-login' })
      else if (!r.pinHash) out.push({ ...base, kind: 'pin', reason: 'no-pin' })
      continue
    }
    if (!r.loginUserId) { out.push({ ...base, kind: 'email', reason: 'no-login' }); continue }
    const wait = waits.get(r.loginUserId)
    if (wait) {
      out.push({
        ...base, kind: 'email',
        reason: wait.state === 'expired' ? 'link-expired' : 'link-waiting',
        since: wait.issuedAt.toISOString(),
        expiresAt: wait.expiresAt.toISOString(),
      })
    }
  }
  return out
}
