import { NextResponse } from 'next/server'
import { and, asc, eq } from 'drizzle-orm'
import { db } from '@/db'
import { users } from '@/db/schemas'
import { getSessionUser, hashSecret, pinPrefilter } from '@/lib/auth'
import { isUniqueViolation } from '@/lib/db-errors'
import { isValidPhone, normalizePhone, toStoredPhone } from '@/lib/validation'

const json = (body: object, status = 200) => NextResponse.json(body, { status })

const badFields = (fields: Record<string, string>, status = 400) => {
  const firstKey = Object.keys(fields)[0]
  return json({ success: false, error: fields[firstKey], fields }, status)
}

function canManagePins(role: string) {
  return role === 'owner' || role === 'manager'
}

// GET /api/security/worker-pins — returns worker accounts only. PIN values and
// hashes never leave the server; `hasPin` is enough for an owner to see which
// workers still need credentials provisioned.
export async function GET() {
  const session = await getSessionUser()
  if (!session) return json({ success: false, error: 'Unauthorized' }, 401)
  if (!session.tenantId || !canManagePins(session.role)) return json({ success: false, error: 'Forbidden' }, 403)

  const rows = await db
    .select({ id: users.id, name: users.name, email: users.email, phone: users.phone, status: users.status, hasPin: users.pinHash })
    .from(users)
    .where(and(eq(users.tenantId, session.tenantId), eq(users.role, 'worker')))
    .orderBy(asc(users.name))

  return json({ success: true, data: rows.map(({ hasPin, ...worker }) => ({ ...worker, hasPin: Boolean(hasPin) })) })
}

// POST /api/security/worker-pins — owner/manager credential rotation for a
// worker. The existing password salt is deliberately retained because workers
// can also have password credentials; rotating it would invalidate that hash.
//
// Phone + PIN login fix: a PIN is only usable once the login route can
// resolve exactly one account by phone (users.phone's partial unique index),
// so this route refuses to set a PIN for a worker with no phone on record —
// silently accepting it would create a worker who can never sign in. `phone`
// is an OPTIONAL body field so an admin can set both in one call instead of
// two round trips (set phone via PATCH /api/admin/users/[id], then PIN here).
export async function POST(req: Request) {
  const session = await getSessionUser()
  if (!session) return json({ success: false, error: 'Unauthorized' }, 401)
  if (!session.tenantId || !canManagePins(session.role)) return json({ success: false, error: 'Forbidden' }, 403)

  let body: Record<string, unknown>
  try { body = await req.json() } catch { return json({ success: false, error: 'Invalid JSON body' }, 400) }
  const userId = typeof body.userId === 'string' ? body.userId.trim() : ''
  const pin = typeof body.pin === 'string' ? body.pin.trim() : ''
  if (!userId) return json({ success: false, error: 'Worker is required' }, 400)
  if (!/^\d{4}$/.test(pin)) return json({ success: false, error: 'PIN must contain exactly 4 digits' }, 400)

  const worker = await db
    .select({ id: users.id, passwordSalt: users.passwordSalt, phone: users.phone })
    .from(users)
    .where(and(eq(users.id, userId), eq(users.tenantId, session.tenantId), eq(users.role, 'worker')))
    .limit(1)
  if (!worker[0]) return json({ success: false, error: 'Worker account not found' }, 404)

  // Resolve what `phone` should end up as: undefined means "leave unchanged".
  // A PIN with no phone is unusable, so an explicit clear (null/'') while
  // setting a PIN is rejected rather than silently accepted.
  let phoneToSet: string | undefined
  if ('phone' in body) {
    if (body.phone === null || body.phone === '') {
      return badFields({ phone: 'A phone number is required to set a PIN' })
    }
    const normalized = normalizePhone(body.phone)
    if (!normalized || !isValidPhone(normalized)) {
      return badFields({ phone: 'A valid phone number is required (e.g. +2547XXXXXXXX or 07XXXXXXXX)' })
    }
    phoneToSet = toStoredPhone(normalized)
  } else if (!worker[0].phone) {
    return badFields({ phone: 'Set a phone number for this worker before assigning a PIN' })
  }

  try {
    await db.update(users).set({
      pinHash: hashSecret(pin, worker[0].passwordSalt),
      pinPrefilter: pinPrefilter(pin),
      ...(phoneToSet !== undefined ? { phone: phoneToSet } : {}),
    }).where(eq(users.id, worker[0].id))
  } catch (err) {
    if (isUniqueViolation(err)) {
      return badFields({ phone: 'This phone number is already in use by another account' }, 409)
    }
    return json({ success: false, error: 'Failed to set PIN' }, 500)
  }

  return json({ success: true, data: { id: worker[0].id } })
}
