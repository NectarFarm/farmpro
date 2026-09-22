// ── Platform staff capability resolution (SaaS back-office backend) ────────
// See db/schemas/platform.ts for the table this reads. The one rule every
// caller of this module must get right: a super_admin with NO platform_staff
// row has ALL capabilities (the pre-existing founder account, or any admin
// nobody has gotten around to configuring, must keep working unchanged). A
// row with `active: false` has NONE — that is how access is revoked, see
// app/api/admin/staff/[id]/route.ts's DELETE handler for why a real SQL
// DELETE against this table is never issued (it would restore full access
// via the same backward-compat rule).
import 'server-only'
import { and, eq, inArray, ne } from 'drizzle-orm'
import { db } from '@/db'
import { platformStaff, users } from '@/db/schemas'

export const CAPABILITIES = [
  'tenants.manage',
  'users.manage',
  'billing.manage',
  'support.handle',
  'support.assign',
  'staff.manage',
  'onboarding.review',
  'impersonate',
  'analytics.view',
] as const

export type Capability = (typeof CAPABILITIES)[number]

export function isCapability(v: unknown): v is Capability {
  return typeof v === 'string' && (CAPABILITIES as readonly string[]).includes(v)
}

export interface StaffRowShape {
  hasRow: boolean
  active: boolean
  capabilities: readonly string[]
}

// ── Pure resolution (unit-tested without a database) ────────────────────────
// `role` must already be known to be 'super_admin' by the caller — a
// tenant-scoped role has no capabilities in this system at all (it uses
// lib/permissions.ts's module-access grid instead), so this always returns
// an empty set for anything else, fail-closed.
export function effectiveCapabilities(role: string, row: StaffRowShape | null): Capability[] {
  if (role !== 'super_admin') return []
  if (!row || !row.hasRow) return [...CAPABILITIES] // no row = all capabilities
  if (!row.active) return [] // deactivated staff = no capabilities
  return row.capabilities.filter(isCapability)
}

export function hasAllCapabilities(caps: readonly string[]): boolean {
  const set = new Set(caps)
  return CAPABILITIES.every((c) => set.has(c))
}

// A "full-capability admin" is a super_admin who currently resolves to every
// capability — either because they have no row at all, or because their row
// is active and lists all of them. Used to guard against ever deactivating
// or downgrading the last one (app/api/admin/staff/[id]/route.ts).
export function isFullCapabilityAdmin(role: string, row: StaffRowShape | null): boolean {
  return hasAllCapabilities(effectiveCapabilities(role, row))
}

async function loadStaffRow(userId: string): Promise<StaffRowShape | null> {
  const rows = await db
    .select({ active: platformStaff.active, capabilities: platformStaff.capabilities })
    .from(platformStaff)
    .where(eq(platformStaff.userId, userId))
    .limit(1)
  const row = rows[0]
  if (!row) return null
  return { hasRow: true, active: row.active, capabilities: row.capabilities }
}

export async function resolveCapabilities(userId: string, role: string): Promise<Capability[]> {
  if (role !== 'super_admin') return []
  const row = await loadStaffRow(userId)
  return effectiveCapabilities(role, row)
}

export async function hasCapability(userId: string, role: string, cap: Capability): Promise<boolean> {
  const caps = await resolveCapabilities(userId, role)
  return caps.includes(cap)
}

// Every ACTIVE super_admin user id that currently resolves `cap` — used to
// notify "all support.handle staff" when a ticket has no assignee. Loads
// every active super_admin plus every platform_staff row in two queries
// (never N+1), then applies the same pure rule as everywhere else.
export async function listCapableStaffUserIds(cap: Capability): Promise<string[]> {
  const adminRows = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.role, 'super_admin'), eq(users.status, 'ACTIVE')))
  if (adminRows.length === 0) return []
  const adminIds = adminRows.map((r) => r.id)

  const staffRows = await db
    .select({ userId: platformStaff.userId, active: platformStaff.active, capabilities: platformStaff.capabilities })
    .from(platformStaff)
    .where(inArray(platformStaff.userId, adminIds))
  const staffByUserId = new Map(staffRows.map((r) => [r.userId, r]))

  return adminIds.filter((id) => {
    const row = staffByUserId.get(id)
    const shape: StaffRowShape | null = row ? { hasRow: true, active: row.active, capabilities: row.capabilities } : null
    return effectiveCapabilities('super_admin', shape).includes(cap)
  })
}

// Count of active super_admins who currently resolve to ALL capabilities,
// excluding `excludeUserId` (the one about to be changed) — so a caller can
// ask "would this change leave zero full-capability admins?" BEFORE applying
// it. See app/api/admin/staff/[id]/route.ts.
export async function countFullCapabilityAdmins(excludeUserId?: string): Promise<number> {
  const conditions = [eq(users.role, 'super_admin'), eq(users.status, 'ACTIVE')]
  if (excludeUserId) conditions.push(ne(users.id, excludeUserId))

  const adminRows = await db.select({ id: users.id }).from(users).where(and(...conditions))
  if (adminRows.length === 0) return 0
  const adminIds = adminRows.map((r) => r.id)

  const staffRows = await db
    .select({ userId: platformStaff.userId, active: platformStaff.active, capabilities: platformStaff.capabilities })
    .from(platformStaff)
    .where(inArray(platformStaff.userId, adminIds))
  const staffByUserId = new Map(staffRows.map((r) => [r.userId, r]))

  let count = 0
  for (const id of adminIds) {
    const row = staffByUserId.get(id)
    const shape: StaffRowShape | null = row ? { hasRow: true, active: row.active, capabilities: row.capabilities } : null
    if (isFullCapabilityAdmin('super_admin', shape)) count++
  }
  return count
}
