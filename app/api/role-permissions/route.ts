import { NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import { db } from '@/db'
import { rolePermissions } from '@/db/schemas'
import { getSessionUser } from '@/lib/auth'
import { eq } from 'drizzle-orm'

// ── GET/PUT /api/role-permissions (issue #243 task 4) ───────────────────────
// The real backend for the UI's `OWNER_ROLES[].permissions` / `.approvalRequired`
// shape (components/farm/data.ts's `OwnerRole` — GovernanceScreen's Role
// Builder / CRUD Rules / Permissions matrix tabs). One row per
// (tenant, role, module) in the DB; GET regroups those rows back into the
// per-role shape the UI already renders.
//
// GET is readable by any authenticated (or standalone-mock-mode `tenantId`)
// caller — a manager needs to see the matrix even though only an owner can
// change it. PUT is owner-only and requires a real session (no `tenantId`
// fallback): granting/revoking edit access tenant-wide isn't something a
// caller should be able to do just by naming a tenant id in a query string.
//
// PUT replaces the tenant's ENTIRE matrix in one transaction (delete + bulk
// insert) rather than upserting row-by-row, so "set by one call, read back by
// the next" (this issue's acceptance criterion) can't observe a half-applied
// matrix from a partial upsert failure.
//
// Retrofitting every other API route to *enforce* this matrix before
// responding is explicitly out of scope for this issue (flagged in the PR) —
// this is only the config store + CRUD for it.

type Access = 'hidden' | 'view' | 'edit'
const VALID_ACCESS = new Set<Access>(['hidden', 'view', 'edit'])

interface RoleMatrixEntry {
  role: string
  permissions: Record<string, Access>
  approvalRequired: string[]
}

const ok = <T>(data: T) => NextResponse.json({ success: true, data }, { status: 200 })
const bad = (msg: string, status = 400) => NextResponse.json({ success: false, error: msg }, { status })

export async function GET(req: Request) {
  const session = await getSessionUser()
  const url = new URL(req.url)
  const tenantId = session?.tenantId ?? url.searchParams.get('tenantId')?.trim()
  if (!tenantId) return bad('tenantId is required')

  const rows = await db.select().from(rolePermissions).where(eq(rolePermissions.tenantId, tenantId))

  const byRole = new Map<string, RoleMatrixEntry>()
  for (const row of rows) {
    let entry = byRole.get(row.role)
    if (!entry) {
      entry = { role: row.role, permissions: {}, approvalRequired: [] }
      byRole.set(row.role, entry)
    }
    entry.permissions[row.module] = row.access as Access
    if (row.approvalRequired) entry.approvalRequired.push(row.module)
  }

  return ok(Array.from(byRole.values()))
}

// PUT /api/role-permissions — body: { roles: [{ role, permissions: {module:
// access}, approvalRequired?: string[] }] }. Replaces the caller's tenant's
// whole matrix.
export async function PUT(req: Request) {
  const session = await getSessionUser()
  if (!session) return bad('Unauthorized', 401)
  if (!session.tenantId) return bad('Forbidden', 403)
  if (session.role !== 'owner') return bad('Forbidden — only an owner can edit role permissions', 403)

  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return bad('Invalid JSON body')
  }
  const b = (raw ?? {}) as Record<string, unknown>
  const rolesInput = Array.isArray(b.roles) ? (b.roles as unknown[]) : null
  if (!rolesInput) return bad('roles must be an array')

  const parsed: RoleMatrixEntry[] = []
  for (const entry of rolesInput) {
    const e = (entry ?? {}) as Record<string, unknown>
    const role = typeof e.role === 'string' ? e.role.trim() : ''
    if (!role) return bad('Each role entry requires a non-empty role name')

    const permsRaw = (e.permissions ?? {}) as Record<string, unknown>
    if (typeof permsRaw !== 'object' || permsRaw === null || Array.isArray(permsRaw)) {
      return bad(`permissions for role "${role}" must be an object`)
    }
    const permissions: Record<string, Access> = {}
    for (const [module, access] of Object.entries(permsRaw)) {
      if (typeof access !== 'string' || !VALID_ACCESS.has(access as Access)) {
        return bad(`permissions.${module} for role "${role}" must be one of: hidden, view, edit`)
      }
      permissions[module] = access as Access
    }

    const approvalRequired = Array.isArray(e.approvalRequired)
      ? (e.approvalRequired as unknown[]).filter((m): m is string => typeof m === 'string')
      : []

    parsed.push({ role, permissions, approvalRequired })
  }

  const tenantId = session.tenantId
  await db.transaction(async (tx) => {
    await tx.delete(rolePermissions).where(eq(rolePermissions.tenantId, tenantId))

    const inserts: (typeof rolePermissions.$inferInsert)[] = []
    for (const entry of parsed) {
      const modules = new Set<string>([...Object.keys(entry.permissions), ...entry.approvalRequired])
      for (const module of modules) {
        inserts.push({
          id: randomUUID(),
          tenantId,
          role: entry.role,
          module,
          access: entry.permissions[module] ?? 'hidden',
          approvalRequired: entry.approvalRequired.includes(module),
        })
      }
    }
    if (inserts.length > 0) await tx.insert(rolePermissions).values(inserts)
  })

  return ok(parsed)
}
