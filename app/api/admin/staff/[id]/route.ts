import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { platformStaff, sessions, users } from '@/db/schemas'
import { requirePlatformCapability } from '@/lib/api-auth'
import { writeAuditLog } from '@/lib/audit'
import {
  CAPABILITIES,
  countFullCapabilityAdmins,
  effectiveCapabilities,
  isCapability,
  isFullCapabilityAdmin,
  type Capability,
  type StaffRowShape,
} from '@/lib/platform-staff'

// ── PATCH/DELETE /api/admin/staff/[id] (staff.manage) ───────────────────────
// `id` is the target's users.id. Two safety rules apply to BOTH handlers,
// because both can reduce a staff member's capabilities to nothing
// (PATCH via `active: false` or dropping a capability; DELETE always does):
//
//   1. Nobody can remove their own `staff.manage` capability — a caller
//      editing/removing THEIR OWN row must still end up with staff.manage,
//      or the request is refused. Otherwise a mistake locks every admin out
//      of ever managing staff again.
//   2. The last full-capability admin cannot be deactivated/downgraded/
//      deleted — checked by counting every OTHER super_admin who currently
//      resolves to every capability (lib/platform-staff.ts's
//      countFullCapabilityAdmins). If that count is 0, the change is refused.
//
// DELETE never issues a real SQL DELETE against platform_staff: removing the
// row would fall back to "no row = all capabilities" (db/schemas/platform.ts),
// turning a revoke into a promotion. Instead DELETE writes an active:false,
// zero-capability row AND suspends the underlying user account (same
// `users.status` gate issue #223 already uses to block logins) plus deletes
// their live sessions — full removal of access, not a half-measure.

const bad = (msg: string, status = 400) => NextResponse.json({ success: false, error: msg }, { status })
const badFields = (fields: Record<string, string>, status = 400) => {
  const firstKey = Object.keys(fields)[0]
  return NextResponse.json({ success: false, error: fields[firstKey], fields }, { status })
}

async function loadTarget(id: string) {
  const userRows = await db.select().from(users).where(eq(users.id, id)).limit(1)
  const user = userRows[0]
  if (!user || user.role !== 'super_admin') return null

  const staffRows = await db.select().from(platformStaff).where(eq(platformStaff.userId, id)).limit(1)
  const row = staffRows[0] ?? null
  const shape: StaffRowShape | null = row ? { hasRow: true, active: row.active, capabilities: row.capabilities } : null
  return { user, row, shape }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePlatformCapability('staff.manage')
  if ('error' in auth) return auth.error
  const { session } = auth

  const { id } = await params
  const target = await loadTarget(id)
  if (!target) return bad('Staff account not found', 404)

  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return bad('Invalid JSON body')
  }
  const b = (raw ?? {}) as Record<string, unknown>

  const fields: Record<string, string> = {}
  let nextTitle = target.row?.title ?? ''
  if ('title' in b) {
    if (typeof b.title !== 'string') fields.title = 'title must be a string'
    else nextTitle = b.title.trim().slice(0, 120)
  }

  // No existing row and no capabilities supplied: preserve the implicit
  // "no row = all capabilities" meaning by writing the full set explicitly,
  // rather than silently creating a zero-capability row as a side effect of
  // e.g. just setting a title.
  let nextCapabilities: Capability[] = target.row ? [...target.row.capabilities.filter(isCapability)] : [...CAPABILITIES]
  if ('capabilities' in b) {
    if (!Array.isArray(b.capabilities) || !b.capabilities.every(isCapability)) {
      fields.capabilities = `capabilities must be an array drawn from: ${CAPABILITIES.join(', ')}`
    } else {
      nextCapabilities = Array.from(new Set(b.capabilities as Capability[]))
    }
  }

  let nextActive = target.row?.active ?? true
  if ('active' in b) {
    if (typeof b.active !== 'boolean') fields.active = 'active must be a boolean'
    else nextActive = b.active
  }

  if (Object.keys(fields).length > 0) return badFields(fields)

  const resultShape: StaffRowShape = { hasRow: true, active: nextActive, capabilities: nextCapabilities }

  if (session.id === id && !effectiveCapabilities('super_admin', resultShape).includes('staff.manage')) {
    return bad('You cannot remove your own staff.manage capability.', 400)
  }

  const wasFull = isFullCapabilityAdmin('super_admin', target.shape)
  const willBeFull = isFullCapabilityAdmin('super_admin', resultShape)
  if (wasFull && !willBeFull) {
    const others = await countFullCapabilityAdmins(id)
    if (others === 0) {
      return bad('This is the last admin with every capability — promote another admin to full capabilities first.', 400)
    }
  }

  await db
    .insert(platformStaff)
    .values({ userId: id, title: nextTitle, capabilities: nextCapabilities, active: nextActive, createdBy: session.id })
    .onConflictDoUpdate({
      target: platformStaff.userId,
      set: { title: nextTitle, capabilities: nextCapabilities, active: nextActive, updatedAt: new Date() },
    })

  await writeAuditLog({
    tenantId: null,
    actor: session.id,
    action: 'staff.update',
    entity: 'user',
    entityId: id,
    meta: { title: nextTitle, capabilities: nextCapabilities, active: nextActive },
  })

  return NextResponse.json(
    { success: true, data: { userId: id, title: nextTitle, capabilities: nextCapabilities, active: nextActive } },
    { status: 200 }
  )
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePlatformCapability('staff.manage')
  if ('error' in auth) return auth.error
  const { session } = auth

  const { id } = await params
  if (id === session.id) return bad('You cannot remove your own staff access.', 400)

  const target = await loadTarget(id)
  if (!target) return bad('Staff account not found', 404)

  if (isFullCapabilityAdmin('super_admin', target.shape)) {
    const others = await countFullCapabilityAdmins(id)
    if (others === 0) {
      return bad('This is the last admin with every capability — promote another admin to full capabilities first.', 400)
    }
  }

  await db.transaction(async (tx) => {
    await tx
      .insert(platformStaff)
      .values({ userId: id, title: target.row?.title ?? '', capabilities: [], active: false, createdBy: session.id })
      .onConflictDoUpdate({
        target: platformStaff.userId,
        set: { capabilities: [], active: false, updatedAt: new Date() },
      })
    await tx.update(users).set({ status: 'SUSPENDED' }).where(eq(users.id, id))
    await tx.delete(sessions).where(eq(sessions.userId, id))
  })

  await writeAuditLog({
    tenantId: null,
    actor: session.id,
    action: 'staff.delete',
    entity: 'user',
    entityId: id,
    meta: {},
  })

  return NextResponse.json({ success: true, data: { userId: id, active: false } }, { status: 200 })
}
