import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { users } from '@/db/schemas'
import { getSessionUser } from '@/lib/auth'
import { writeAuditLog } from '@/lib/audit'
import { isUniqueViolation, SAFE_USER_COLUMNS, toSafeUser, VALID_ROLES, VALID_STATUSES } from '@/lib/admin-users'
import { isValidEmail, normalizeEmail, normalizePhone, isValidPhone, toStoredPhone } from '@/lib/validation'

// ── GET/PATCH /api/admin/users/[id] (admin user-management feature) ────────
// super_admin only. GET returns one user (same safe column set as the list
// route); PATCH updates name/email/phone/role/status and writes an audit_log
// entry recording exactly which fields changed (old -> new) — never the
// credential columns, which this route never even reads.

const bad = (msg: string, status = 400) =>
  NextResponse.json({ success: false, error: msg }, { status })

const badFields = (fields: Record<string, string>, status = 400) => {
  const firstKey = Object.keys(fields)[0]
  return NextResponse.json({ success: false, error: fields[firstKey], fields }, { status })
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSessionUser()
  if (!session) return bad('Unauthorized', 401)
  if (session.role !== 'super_admin') return bad('Forbidden', 403)

  const { id } = await params
  const rows = await db.select(SAFE_USER_COLUMNS).from(users).where(eq(users.id, id)).limit(1)
  const user = rows[0]
  if (!user) return bad('User not found', 404)
  return NextResponse.json({ success: true, data: user }, { status: 200 })
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSessionUser()
  if (!session) return bad('Unauthorized', 401)
  if (session.role !== 'super_admin') return bad('Forbidden', 403)

  const { id } = await params

  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return bad('Invalid JSON body')
  }
  const b = (raw ?? {}) as Record<string, unknown>

  const existingRows = await db.select().from(users).where(eq(users.id, id)).limit(1)
  const existing = existingRows[0]
  if (!existing) return bad('User not found', 404)

  const fields: Record<string, string> = {}
  const patch: Partial<typeof users.$inferInsert> = {}

  if ('name' in b) {
    const name = typeof b.name === 'string' ? b.name.trim() : ''
    if (!name) fields.name = 'name must be a non-empty string'
    else if (name.length > 120) fields.name = 'name must be at most 120 characters'
    else patch.name = name
  }

  if ('email' in b) {
    const email = normalizeEmail(b.email)
    if (!email) fields.email = 'email is required'
    else if (!isValidEmail(email)) fields.email = 'A valid email is required'
    else patch.email = email
  }

  if ('phone' in b) {
    // Unlike email/role/status, phone is allowed to be explicitly cleared
    // (null/'') — not every user has one, and the admin editing screen must
    // be able to remove a wrong number, not just replace it.
    if (b.phone === null || b.phone === '') {
      patch.phone = null
    } else {
      const phoneNormalized = normalizePhone(b.phone)
      if (!phoneNormalized || !isValidPhone(phoneNormalized)) {
        fields.phone = 'A valid phone number is required (e.g. +2547XXXXXXXX or 07XXXXXXXX), or null to clear it'
      } else {
        patch.phone = toStoredPhone(phoneNormalized)
      }
    }
  }

  if ('role' in b) {
    const role = typeof b.role === 'string' ? b.role.trim() : ''
    if (!(VALID_ROLES as readonly string[]).includes(role)) {
      fields.role = `role must be one of: ${VALID_ROLES.join(', ')}`
    } else {
      patch.role = role
    }
  }

  if ('status' in b) {
    const status = typeof b.status === 'string' ? b.status.trim() : ''
    if (!(VALID_STATUSES as readonly string[]).includes(status)) {
      fields.status = `status must be one of: ${VALID_STATUSES.join(', ')}`
    } else {
      patch.status = status
    }
  }

  if (Object.keys(fields).length > 0) return badFields(fields)
  if (Object.keys(patch).length === 0) return bad('No updatable fields supplied (name, email, phone, role, status)')

  // Diff against the existing row so the audit entry records exactly which
  // fields changed and their old -> new values — never the untouched fields,
  // and never any credential column (this route never selects those).
  const changes: Record<string, { old: unknown; new: unknown }> = {}
  for (const key of Object.keys(patch)) {
    const oldValue = (existing as Record<string, unknown>)[key]
    const newValue = (patch as Record<string, unknown>)[key]
    if (oldValue !== newValue) changes[key] = { old: oldValue, new: newValue }
  }

  if (Object.keys(changes).length === 0) {
    const rows = await db.select(SAFE_USER_COLUMNS).from(users).where(eq(users.id, id)).limit(1)
    return NextResponse.json({ success: true, data: rows[0] }, { status: 200 })
  }

  let updated
  try {
    const result = await db.update(users).set(patch).where(eq(users.id, id)).returning()
    updated = toSafeUser(result[0])
  } catch (err) {
    if (isUniqueViolation(err)) {
      return badFields({ email: 'This email is already in use by another account' }, 409)
    }
    return bad('Failed to update user', 500)
  }

  await writeAuditLog({
    tenantId: existing.tenantId,
    actor: session.id,
    action: 'user.update',
    entity: 'user',
    entityId: id,
    meta: { changes },
  })

  return NextResponse.json({ success: true, data: updated }, { status: 200 })
}
