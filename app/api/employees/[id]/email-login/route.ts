import { NextResponse } from 'next/server'
import { randomUUID, randomBytes } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { db } from '@/db'
import { employees, users } from '@/db/schemas'
import { requireTenantSession } from '@/lib/api-auth'
import { hashSecret } from '@/lib/auth'
import { isUniqueViolation } from '@/lib/db-errors'
import { isValidEmail, normalizeEmail } from '@/lib/validation'
import { writeAuditLog } from '@/lib/audit'
import { issueSetPasswordToken } from '@/lib/set-password'
import { resolveAppBaseUrl } from '@/lib/email'

// ── Manager/vet/auditor sign-in accounts, issued by the owner ───────────────
// The gap this closes: POST /api/employees/[id]/login (sibling route) can
// only ever issue a worker account — a PIN is deliberately too little
// privilege for anyone above a worker, so that route refuses every other
// role outright. Nothing else in the owner's own app could create a login
// for a manager, vet or auditor employee: POST /api/admin/users is
// super_admin-only, so an owner who added a manager had no way to ever let
// them sign in. This is the other half of that same sign-in card.
//
// Credentials: email + password, set by the PERSON THEMSELVES through the
// same one-time set-password token flow an approved onboarding applicant
// already uses (lib/set-password.ts) — never a password the owner picks or
// ever sees. Since this codebase sends no real email, the link is handed
// back in the response for the owner to copy and share out of band, the
// same "reveal once, never again" convention TempPasswordModal already uses
// for a super_admin password reset.
//
// Scope and privilege, deliberately narrower than the worker route:
//   - OWNER only. A manager cannot use this to create another manager's
//     login (or their own), and it is not exposed to vet/auditor at all.
//   - The employee's role must be manager, vet or auditor — never worker
//     (that's the sibling PIN route), never owner or super_admin (an owner
//     could otherwise mint a peer or platform-level account for themselves
//     or anyone else; refused regardless of who the employee row belongs
//     to, so this can never become a privilege-escalation path).

const ok = <T,>(data: T, status = 200) => NextResponse.json({ success: true, data }, { status })
const fail = (error: string, status: number) => NextResponse.json({ success: false, error }, { status })
const badFields = (fields: Record<string, string>, status = 400) => {
  const firstKey = Object.keys(fields)[0]
  return NextResponse.json({ success: false, error: fields[firstKey], fields }, { status })
}

// Everything an owner may issue a login for here. Explicitly excludes
// 'worker' (the sibling PIN route) and 'owner'/'super_admin' (escalation).
const ALLOWED_ROLES = new Set(['manager', 'vet', 'auditor'])

async function loadEmployee(id: string, tenantId: string) {
  const rows = await db
    .select()
    .from(employees)
    .where(and(eq(employees.id, id), eq(employees.tenantId, tenantId)))
    .limit(1)
  return rows[0] ?? null
}

// POST /api/employees/[id]/email-login — issue the sign-in account.
// Body: { tenantId?, email }
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  let body: Record<string, unknown>
  try { body = await req.json() } catch { return fail('Invalid JSON body', 400) }

  // Owner only — see header comment. A manager cannot reach this route even
  // for another employee, unlike the worker PIN route which trusts either.
  const auth = await requireTenantSession({
    roles: ['owner'],
    explicitTenantId: typeof body.tenantId === 'string' ? body.tenantId : null,
  })
  if ('error' in auth) return auth.error
  const { session, tenantId } = auth

  const employee = await loadEmployee(id, tenantId)
  if (!employee) return fail('Employee not found', 404)

  if (employee.role === 'worker') {
    return fail('Worker accounts sign in with a phone and PIN — use the PIN option on this same card instead.', 400)
  }
  if (!ALLOWED_ROLES.has(employee.role)) {
    // Covers 'owner' and 'super_admin' (and anything else not on the
    // allow-list) — the escalation refusal the tests below check for.
    return fail('Cannot issue a login for this role from here', 403)
  }

  const email = normalizeEmail(body.email)
  if (!email || !isValidEmail(email)) {
    return badFields({ email: 'A valid email address is required — this is what they sign in with' })
  }

  // Refuse rather than quietly re-issue — same discipline as the worker
  // route: an existing login may already be in use, and "create" silently
  // becoming "replace" is not something an owner asked for.
  if (employee.userId) {
    const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.id, employee.userId)).limit(1)
    if (existing) return fail('This employee already has a login — there is no reset action here yet; ask the platform admin.', 409)
  }

  const userId = randomUUID()
  const salt = randomUUID()
  // Nobody — not even the owner issuing this — ever learns a working
  // password: the account starts with an unusable random hash, and the
  // set-password token below is the only way it becomes usable.
  const unusablePassword = randomBytes(32).toString('hex')

  try {
    await db.insert(users).values({
      id: userId,
      tenantId,
      name: employee.name,
      email,
      role: employee.role,
      passwordHash: hashSecret(unusablePassword, salt),
      passwordSalt: salt,
      status: 'ACTIVE',
    })
  } catch (err) {
    if (isUniqueViolation(err)) {
      return badFields({ email: 'That email address already signs in to another account' }, 409)
    }
    throw err
  }

  await db.update(employees).set({ userId }).where(eq(employees.id, employee.id))

  await writeAuditLog({
    tenantId,
    actor: session.email,
    action: 'employee.login.created',
    entity: 'user',
    entityId: userId,
    meta: { employeeId: employee.id, email, role: employee.role },
  })

  const { token } = await issueSetPasswordToken(userId)
  const setPasswordUrl = `${resolveAppBaseUrl(req)}/set-password/${token}`

  return ok({ userId, email, setPasswordUrl }, 201)
}

// PATCH /api/employees/[id]/email-login — re-issue the set-password link for
// a login that already exists. Body: { tenantId? }
//
// A set-password token expires (lib/set-password.ts's
// SET_PASSWORD_TOKEN_TTL_MS), and until this existed an expired link was a
// dead end: POST refuses once a login exists, told the owner to ask the
// platform admin, and the platform admin had no such action either, so the
// person simply could not sign in. issueSetPasswordToken already invalidates
// whatever is outstanding before minting a new one, so this cannot leave two
// live links for one account.
//
// It deliberately does NOT touch the password itself. The account keeps the
// unusable hash it was born with (or the password its owner already chose,
// if they set one and merely want a new link) — nobody, including the owner
// issuing it, ever learns a working password.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  let body: Record<string, unknown> = {}
  try { body = await req.json() } catch { /* an empty body is fine here */ }

  const auth = await requireTenantSession({
    roles: ['owner'],
    explicitTenantId: typeof body.tenantId === 'string' ? body.tenantId : null,
  })
  if ('error' in auth) return auth.error
  const { session, tenantId } = auth

  const employee = await loadEmployee(id, tenantId)
  if (!employee) return fail('Employee not found', 404)

  if (employee.role === 'worker') {
    return fail('Worker accounts sign in with a phone and PIN — set a new PIN on this same card instead.', 400)
  }
  if (!ALLOWED_ROLES.has(employee.role)) {
    return fail('Cannot issue a login for this role from here', 403)
  }
  if (!employee.userId) {
    return fail('This employee has no login yet — create one first.', 404)
  }

  const [user] = await db
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(and(eq(users.id, employee.userId), eq(users.tenantId, tenantId)))
    .limit(1)
  if (!user) return fail('This employee has no login yet — create one first.', 404)

  await writeAuditLog({
    tenantId,
    actor: session.email,
    action: 'employee.login.link_reissued',
    entity: 'user',
    entityId: user.id,
    meta: { employeeId: employee.id, email: user.email, role: employee.role },
  })

  const { token, expiresAt } = await issueSetPasswordToken(user.id)
  const setPasswordUrl = `${resolveAppBaseUrl(req)}/set-password/${token}`

  return ok({ userId: user.id, email: user.email, setPasswordUrl, expiresAt })
}

