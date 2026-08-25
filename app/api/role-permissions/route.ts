import { NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import { db } from '@/db'
import { rolePermissions } from '@/db/schemas'
import { getSessionUser } from '@/lib/auth'
import { eq } from 'drizzle-orm'
import { requireTenantSession } from '@/lib/api-auth'
import { writeAuditLog } from '@/lib/audit'

// ── GET/PUT /api/role-permissions (issue #243 task 4) ───────────────────────
// The real backend for the UI's `OWNER_ROLES[].permissions` / `.approvalRequired`
// shape (components/farm/data.ts's `OwnerRole` — GovernanceScreen's Role
// Builder / CRUD Rules / Permissions matrix tabs). One row per
// (tenant, role, module) in the DB; GET regroups those rows back into the
// per-role shape the UI already renders.
//
// GET is readable by any authenticated session on the tenant — a manager
// needs to see the matrix even though only an owner can change it. Tenant
// comes from the session only now (auth fix: fix/authenticate-all-apis) —
// this used to fall back to a `tenantId` query param for a session-less
// caller. PUT is owner-only and requires a real session too: granting/
// revoking edit access tenant-wide isn't something a caller should be able
// to do just by naming a tenant id in a query string.
//
// PUT replaces the tenant's ENTIRE matrix in one transaction (delete + bulk
// insert) rather than upserting row-by-row, so "set by one call, read back by
// the next" (this issue's acceptance criterion) can't observe a half-applied
// matrix from a partial upsert failure.
//
// This route is no longer "just a config store": the matrix it writes IS
// enforced on write paths now (lib/permissions.ts's getRoleAccess/canEdit,
// read by POST /api/records, PATCH /api/tasks/[id], the approval routes and
// others), and `approvalRequired` decides whether a worker's mortality report
// waits for sign-off before it moves a batch's headcount
// (lib/permissions.ts#needsApproval). The comment that used to sit here said
// enforcement was out of scope — true when it was written, false since the
// role-permission-enforcement task, and worth correcting because it is the
// reason a PUT here is now one of the most consequential writes in the app.
// Hence the audit row below.

type Access = 'hidden' | 'view' | 'edit'
const VALID_ACCESS = new Set<Access>(['hidden', 'view', 'edit'])

interface RoleMatrixEntry {
  role: string
  permissions: Record<string, Access>
  approvalRequired: string[]
}

const ok = <T>(data: T) => NextResponse.json({ success: true, data }, { status: 200 })
const bad = (msg: string, status = 400) => NextResponse.json({ success: false, error: msg }, { status })

export async function GET() {
  const auth = await requireTenantSession()
  if ('error' in auth) return auth.error
  const { tenantId } = auth

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
    // Read the matrix as it stands BEFORE the delete, so the audit row can say
    // what actually changed rather than just "somebody saved the grid". A
    // whole-matrix replace makes the new state alone useless for review: an
    // owner quietly granting `finance: edit` to workers looks identical to a
    // no-op save unless the previous value is recorded next to it.
    const before = await tx
      .select()
      .from(rolePermissions)
      .where(eq(rolePermissions.tenantId, tenantId))
    const beforeByKey = new Map(before.map((r) => [`${r.role}:${r.module}`, r]))

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

    // A (role, module) whose access or approval flag moved. Rows that are gone
    // entirely are reported too — deleting a row does not mean "no rule", it
    // means the code default in lib/permissions.ts takes over, which can be a
    // real change in either direction.
    const changes: Record<string, unknown>[] = []
    for (const row of inserts) {
      const prev = beforeByKey.get(`${row.role}:${row.module}`)
      if (prev && prev.access === row.access && prev.approvalRequired === row.approvalRequired) continue
      changes.push({
        role: row.role,
        module: row.module,
        accessFrom: prev?.access ?? null,
        accessTo: row.access,
        approvalFrom: prev?.approvalRequired ?? null,
        approvalTo: row.approvalRequired,
      })
    }
    const kept = new Set(inserts.map((r) => `${r.role}:${r.module}`))
    for (const prev of before) {
      if (kept.has(`${prev.role}:${prev.module}`)) continue
      changes.push({
        role: prev.role,
        module: prev.module,
        accessFrom: prev.access,
        accessTo: null,
        approvalFrom: prev.approvalRequired,
        approvalTo: null,
      })
    }

    // No-op saves write nothing, matching PATCH /api/farms/[id] and PATCH
    // /api/employees/[id] — a grid re-saved unchanged should not bury the
    // saves that did move a permission.
    if (changes.length > 0) {
      await writeAuditLog({
        tenantId,
        actor: session.id,
        action: 'role_permissions.updated',
        entity: 'role_permissions',
        entityId: tenantId,
        meta: { changes },
      }, tx)
    }
  })

  return ok(parsed)
}
