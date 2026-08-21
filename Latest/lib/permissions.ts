import { db } from '@/db'
import { rolePermissions } from '@/db/schemas'
import { and, eq } from 'drizzle-orm'

export type AccessLevel = 'hidden' | 'view' | 'edit'

const OWNER = 'owner'

export async function getRoleAccess(tenantId: string, role: string, module: string): Promise<AccessLevel> {
  if (role === OWNER) return 'edit'
  const rows = await db
    .select({ access: rolePermissions.access })
    .from(rolePermissions)
    .where(and(eq(rolePermissions.tenantId, tenantId), eq(rolePermissions.role, role), eq(rolePermissions.module, module)))
    .limit(1)
  return (rows[0]?.access as AccessLevel) ?? 'edit'
}

export async function canEdit(tenantId: string, role: string, module: string): Promise<boolean> {
  return (await getRoleAccess(tenantId, role, module)) === 'edit'
}

export async function canView(tenantId: string, role: string, module: string): Promise<boolean> {
  const level = await getRoleAccess(tenantId, role, module)
  return level === 'view' || level === 'edit'
}

export const MODULES = {
  feeding: 'feeding', eggCollection: 'egg-collection', milking: 'milking', mortality: 'mortality',
  health: 'health', physicalCount: 'physical-count', harvest: 'harvest', tasks: 'tasks',
  inventory: 'inventory', batches: 'batches', finance: 'finance', payroll: 'payroll',
  governance: 'governance', deleteRecord: 'delete-record',
} as const
