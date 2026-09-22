import { NextResponse } from 'next/server'
import { randomBytes, randomUUID } from 'node:crypto'
import { eq, inArray } from 'drizzle-orm'
import { db } from '@/db'
import { platformStaff, users } from '@/db/schemas'
import { requirePlatformCapability } from '@/lib/api-auth'
import { hashSecret } from '@/lib/auth'
import { issueSetPasswordToken } from '@/lib/set-password'
import { writeAuditLog } from '@/lib/audit'
import { normalizeEmail, isValidEmail } from '@/lib/validation'
import { isUniqueViolation } from '@/lib/db-errors'
import { CAPABILITIES, effectiveCapabilities, isCapability, type Capability } from '@/lib/platform-staff'

// ── GET/POST /api/admin/staff (staff.manage) ────────────────────────────────
// Lists/creates platform staff — super_admin users with a platform_staff
// row. GET also includes every super_admin WITHOUT a row (hasRow: false),
// since those still act with full capabilities today (see
// lib/platform-staff.ts) and the staff screen needs to be able to show that,
// not just the users someone has explicitly onboarded here.

const bad = (msg: string, status = 400) => NextResponse.json({ success: false, error: msg }, { status })
const badFields = (fields: Record<string, string>, status = 400) => {
  const firstKey = Object.keys(fields)[0]
  return NextResponse.json({ success: false, error: fields[firstKey], fields }, { status })
}

export async function GET() {
  const auth = await requirePlatformCapability('staff.manage')
  if ('error' in auth) return auth.error

  const admins = await db
    .select({ id: users.id, name: users.name, email: users.email, status: users.status, createdAt: users.createdAt })
    .from(users)
    .where(eq(users.role, 'super_admin'))

  const staffRows = admins.length
    ? await db.select().from(platformStaff).where(inArray(platformStaff.userId, admins.map((a) => a.id)))
    : []
  const staffByUserId = new Map(staffRows.map((r) => [r.userId, r]))

  const data = admins.map((admin) => {
    const row = staffByUserId.get(admin.id)
    const shape = row ? { hasRow: true as const, active: row.active, capabilities: row.capabilities } : null
    return {
      userId: admin.id,
      name: admin.name,
      email: admin.email,
      status: admin.status,
      hasRow: !!row,
      title: row?.title ?? '',
      capabilities: effectiveCapabilities('super_admin', shape),
      active: row?.active ?? true,
      createdBy: row?.createdBy ?? null,
      createdAt: row?.createdAt ?? admin.createdAt,
      updatedAt: row?.updatedAt ?? null,
    }
  })

  return NextResponse.json({ success: true, data }, { status: 200 })
}

export async function POST(req: Request) {
  const auth = await requirePlatformCapability('staff.manage')
  if ('error' in auth) return auth.error
  const { session } = auth

  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return bad('Invalid JSON body')
  }
  const b = (raw ?? {}) as Record<string, unknown>

  const fields: Record<string, string> = {}
  const name = typeof b.name === 'string' ? b.name.trim() : ''
  if (!name) fields.name = 'name must be a non-empty string'
  else if (name.length > 120) fields.name = 'name must be at most 120 characters'

  const email = normalizeEmail(b.email)
  if (!email) fields.email = 'email is required'
  else if (!isValidEmail(email)) fields.email = 'A valid email is required'

  const title = typeof b.title === 'string' ? b.title.trim().slice(0, 120) : ''

  let capabilities: Capability[] = []
  if (b.capabilities !== undefined) {
    if (!Array.isArray(b.capabilities) || !b.capabilities.every(isCapability)) {
      fields.capabilities = `capabilities must be an array drawn from: ${CAPABILITIES.join(', ')}`
    } else {
      capabilities = Array.from(new Set(b.capabilities as Capability[]))
    }
  }

  if (Object.keys(fields).length > 0) return badFields(fields)

  const userId = randomUUID()
  const tempPassword = randomBytes(9).toString('base64url')
  const salt = randomBytes(16).toString('hex')

  try {
    await db.transaction(async (tx) => {
      await tx.insert(users).values({
        id: userId,
        tenantId: null,
        name,
        email,
        role: 'super_admin',
        passwordHash: hashSecret(tempPassword, salt),
        passwordSalt: salt,
        status: 'ACTIVE',
      })
      await tx.insert(platformStaff).values({
        userId,
        title,
        capabilities,
        active: true,
        createdBy: session.id,
      })
    })
  } catch (err) {
    if (isUniqueViolation(err)) {
      return badFields({ email: 'This email is already in use by another account' }, 409)
    }
    return bad('Failed to create staff account', 500)
  }

  // Same one-time-reveal contract as POST /api/admin/users/[id]/reset-password
  // — the temp password is returned here exactly once and never persisted in
  // plaintext or logged. A set-password token is ALSO issued so a future
  // "invite by email" flow (none exists yet — no email infra for this route)
  // can hand the new staff member a self-service link instead, without a
  // second migration.
  const { token: setPasswordToken, expiresAt: setPasswordExpiresAt } = await issueSetPasswordToken(userId)

  await writeAuditLog({
    tenantId: null,
    actor: session.id,
    action: 'staff.create',
    entity: 'user',
    entityId: userId,
    meta: { email, title, capabilities },
  })

  return NextResponse.json(
    {
      success: true,
      data: {
        userId,
        name,
        email,
        title,
        capabilities,
        active: true,
        tempPassword,
        setPasswordToken,
        setPasswordExpiresAt: setPasswordExpiresAt.toISOString(),
      },
    },
    { status: 201 }
  )
}
