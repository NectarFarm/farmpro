import { NextResponse } from 'next/server'
import { randomUUID, randomBytes } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { db } from '@/db'
import { employees, users, sessions } from '@/db/schemas'
import { requireTenantSession } from '@/lib/api-auth'
import { hashSecret, pinPrefilter } from '@/lib/auth'
import { isUniqueViolation } from '@/lib/db-errors'
import { isValidPhone, normalizePhone, toStoredPhone } from '@/lib/validation'
import { writeAuditLog } from '@/lib/audit'

// ── Worker sign-in accounts, issued by the farm owner ───────────────────────
// The gap this closes: an owner could add an employee (POST /api/employees)
// and could rotate a worker's PIN (POST /api/security/worker-pins) — but
// nothing anywhere let them CREATE the login those two sit either side of.
// Creating a `users` row was super_admin-only (POST /api/admin/users), so on
// a freshly provisioned tenant the owner's own Security screen truthfully
// reported "No worker login accounts are available for this farm" and there
// was no action that could change it. Every employee of every new tenant was
// unable to sign in, and the owner had no way to fix it themselves.
//
// The account is created FROM the employee record rather than standalone, so
// the two can't drift: `employees.userId` is what links a person's work
// records to the account they sign in with, and issuing the login here is
// the only place that link gets made.
//
// Scope and privilege:
//   - owner or manager, within their own session tenant (a super_admin must
//     name the tenant explicitly, exactly like the sibling employee routes).
//   - worker accounts ONLY. A manager or owner login carries far more than
//     a 4-digit PIN should unlock, and those roles sign in with a password —
//     issuing them is deliberately still a platform-admin action.
//
// Credentials: phone + 4-digit PIN, which is what POST /api/auth/login
// accepts for a worker. A random, discarded password is stored because
// `users.password_hash` is NOT NULL — nobody, including the owner, ever
// learns it, so the account is reachable by PIN alone.

const ok = <T,>(data: T, status = 200) => NextResponse.json({ success: true, data }, { status })
const fail = (error: string, status: number) => NextResponse.json({ success: false, error }, { status })
const badFields = (fields: Record<string, string>, status = 400) => {
  const firstKey = Object.keys(fields)[0]
  return NextResponse.json({ success: false, error: fields[firstKey], fields }, { status })
}

const MANAGING_ROLES = ['owner', 'manager'] as const

// users.email is NOT NULL and uniquely indexed, but a farm worker frequently
// has no email address at all — asking the owner to invent one per worker
// would be a worse answer than deriving a handle they never have to see or
// type. The phone is already globally unique (partial unique index on
// users.phone), so a phone-derived address collides exactly when the phone
// itself would, and that collision is reported as the phone conflict it
// really is. An owner who DOES have a real address for the worker can send
// it and this is not used.
const DERIVED_EMAIL_DOMAIN = 'workers.ifms.local'

function derivedEmailFor(storedPhone: string): string {
  return `${storedPhone.replace(/\D/g, '')}@${DERIVED_EMAIL_DOMAIN}`
}

async function loadEmployee(id: string, tenantId: string) {
  const rows = await db
    .select()
    .from(employees)
    .where(and(eq(employees.id, id), eq(employees.tenantId, tenantId)))
    .limit(1)
  return rows[0] ?? null
}

// GET /api/employees/[id]/login — what sign-in this employee currently has.
// Never returns a PIN or a hash; `hasPin` is the whole of what an owner
// needs to know, and is the same shape GET /api/security/worker-pins uses.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const auth = await requireTenantSession({
    roles: MANAGING_ROLES,
    explicitTenantId: new URL(req.url).searchParams.get('tenantId'),
  })
  if ('error' in auth) return auth.error
  const { tenantId } = auth

  const employee = await loadEmployee(id, tenantId)
  if (!employee) return fail('Employee not found', 404)
  if (!employee.userId) return ok({ hasLogin: false, phone: employee.phone || null, hasPin: false, status: null })

  const [account] = await db
    .select({ id: users.id, phone: users.phone, pinHash: users.pinHash, status: users.status })
    .from(users)
    .where(eq(users.id, employee.userId))
    .limit(1)

  // A userId pointing at nothing means the account was deleted out from
  // under the link. Reporting "no login" is both true and actionable: POST
  // below will issue a fresh one.
  if (!account) return ok({ hasLogin: false, phone: employee.phone || null, hasPin: false, status: null })

  return ok({
    hasLogin: true,
    userId: account.id,
    phone: account.phone,
    hasPin: Boolean(account.pinHash),
    status: account.status,
  })
}

// POST /api/employees/[id]/login — issue the sign-in account.
// Body: { pin: '1234', phone?: '07…', email? }
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  let body: Record<string, unknown>
  try { body = await req.json() } catch { return fail('Invalid JSON body', 400) }

  const auth = await requireTenantSession({
    roles: MANAGING_ROLES,
    explicitTenantId: typeof body.tenantId === 'string' ? body.tenantId : null,
  })
  if ('error' in auth) return auth.error
  const { session, tenantId } = auth

  const employee = await loadEmployee(id, tenantId)
  if (!employee) return fail('Employee not found', 404)
  if (employee.role !== 'worker') {
    return fail(`Only worker accounts can be created here — ${employee.name} is a ${employee.role}, and those sign in with an email and password`, 400)
  }

  const pin = typeof body.pin === 'string' ? body.pin.trim() : ''
  if (!/^\d{4}$/.test(pin)) return badFields({ pin: 'PIN must contain exactly 4 digits' })

  // The phone may come from the request (the owner typing it as they issue
  // the login) or from the employee record. It is what the worker signs in
  // with, so there is no useful account without one.
  const phoneSource = typeof body.phone === 'string' && body.phone.trim() ? body.phone : employee.phone
  const normalized = normalizePhone(phoneSource)
  if (!normalized || !isValidPhone(normalized)) {
    return badFields({ phone: 'A valid phone number is required (e.g. +2547XXXXXXXX or 07XXXXXXXX) — this is what the worker signs in with' })
  }
  const storedPhone = toStoredPhone(normalized)

  const email = typeof body.email === 'string' && body.email.trim()
    ? body.email.trim().toLowerCase()
    : derivedEmailFor(storedPhone)

  // Refuse rather than quietly re-issue: an existing login means a worker
  // may already be signing in with it, and "create" silently becoming
  // "replace their credentials" is not something an owner asked for. The
  // PIN reset on the Security screen is the deliberate way to do that.
  if (employee.userId) {
    const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.id, employee.userId)).limit(1)
    if (existing) return fail('This employee already has a login — reset their PIN instead of creating a second account', 409)
  }

  const userId = randomUUID()
  const salt = randomUUID()
  // Nobody is ever told this password: the account is PIN-only by
  // construction, and password_hash is NOT NULL.
  const unusablePassword = randomBytes(32).toString('hex')

  try {
    await db.insert(users).values({
      id: userId,
      tenantId,
      name: employee.name,
      email,
      role: 'worker',
      passwordHash: hashSecret(unusablePassword, salt),
      passwordSalt: salt,
      pinHash: hashSecret(pin, salt),
      pinPrefilter: pinPrefilter(pin),
      phone: storedPhone,
      status: 'ACTIVE',
    })
  } catch (err) {
    if (isUniqueViolation(err)) {
      return badFields({ phone: 'That phone number already signs in to another account' }, 409)
    }
    throw err
  }

  // Link and backfill: the employee record now carries the phone the worker
  // actually signs in with, so the two can't disagree.
  await db.update(employees).set({ userId, phone: storedPhone }).where(eq(employees.id, employee.id))

  await writeAuditLog({
    tenantId,
    actor: session.email,
    action: 'worker.login.created',
    entity: 'user',
    entityId: userId,
    meta: { employeeId: employee.id, phone: storedPhone },
  })

  // The PIN is not echoed back. The caller just supplied it and is the one
  // who has to hand it to the worker.
  return ok({ userId, phone: storedPhone, hasPin: true }, 201)
}

// DELETE /api/employees/[id]/login — revoke sign-in without deleting the
// person. The account row stays (their records reference it), but the PIN is
// cleared, the status is suspended and every live session is destroyed, so
// the credential stops working immediately rather than at its next expiry.
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const auth = await requireTenantSession({
    roles: MANAGING_ROLES,
    explicitTenantId: new URL(req.url).searchParams.get('tenantId'),
  })
  if ('error' in auth) return auth.error
  const { session, tenantId } = auth

  const employee = await loadEmployee(id, tenantId)
  if (!employee) return fail('Employee not found', 404)
  if (!employee.userId) return fail('This employee has no login to revoke', 404)

  const [account] = await db
    .select({ id: users.id, tenantId: users.tenantId, role: users.role })
    .from(users)
    .where(eq(users.id, employee.userId))
    .limit(1)
  if (!account) return fail('This employee has no login to revoke', 404)
  // A link crossing tenants would be corrupt data, not an authorization
  // decision to make here — refuse rather than reach outside the tenant.
  if (account.tenantId !== tenantId || account.role !== 'worker') {
    return fail('This login cannot be revoked from here', 403)
  }

  await db.update(users)
    .set({ pinHash: null, pinPrefilter: null, status: 'SUSPENDED' })
    .where(eq(users.id, account.id))
  await db.delete(sessions).where(eq(sessions.userId, account.id))

  await writeAuditLog({
    tenantId,
    actor: session.email,
    action: 'worker.login.revoked',
    entity: 'user',
    entityId: account.id,
    meta: { employeeId: employee.id },
  })

  return ok({ userId: account.id, hasLogin: true, hasPin: false, status: 'SUSPENDED' })
}
