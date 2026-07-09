import 'server-only';
// Resource registry powering /api/data/[resource]. One tenant-scoped, field-filtered
// read path for many entities. Add a resource = add a line here.
import { and, eq, type SQL } from 'drizzle-orm';
import { db } from '@/db';
import {
  productionUnits, batches, inventoryItems, inventoryLots,
  tasks, alerts, sales, purchases, employees, workerProfiles, healthRecords, users,
} from '@/db/schemas';
import type { Session } from './session';
import type { Role } from '@/lib/types';

 
type AnyTable = any;

interface ResourceDef {
  table: AnyTable;
  roles: Role[];
  // Optional extra row-scope beyond tenant (e.g. workers see only their own tasks).
  scope?: (s: Session) => SQL | undefined;
}

const ALL: Role[] = ['owner', 'manager', 'worker', 'vet', 'auditor'];

export const RESOURCES: Record<string, ResourceDef> = {
  units: { table: productionUnits, roles: ALL },
  batches: { table: batches, roles: ALL },
  items: { table: inventoryItems, roles: ALL },
  lots: { table: inventoryLots, roles: ALL },
  tasks: {
    table: tasks,
    roles: ALL,
    scope: (s) => (s.role === 'worker' ? eq(tasks.assignedTo, s.userId) : undefined),
  },
  // Alerts are the OWNER's view of the farm (some name suspected theft/loss). Workers
  // must not see them — the worker home tolerates the 403 and just hides the section.
  alerts: { table: alerts, roles: ['owner', 'manager', 'auditor'] },
  sales: { table: sales, roles: ['owner', 'auditor'] },
  purchases: { table: purchases, roles: ['owner', 'auditor'] },
  employees: { table: employees, roles: ['owner', 'manager'] },
  'worker-profiles': { table: workerProfiles, roles: ['owner'] },
  'health-records': { table: healthRecords, roles: ['owner', 'manager', 'vet', 'auditor'] },
};

export function tenantScope(def: ResourceDef, session: Session): SQL | undefined {
  const tenant = eq(def.table.tenantId, session.tenantId);
  const extra = def.scope?.(session);
  return extra ? and(tenant, extra) : tenant;
}

// FR-M5-5: a vet sees only batches they're assigned to. Assignment reuses
// employees.assignedBatchIds (the same field workers use) — vets go through the
// same `employees` row (see employees POST/PATCH in app/api/data/[resource]/route.ts),
// joined to their `users` login row by phone (the key those two inserts share).
// null = all batches (current & future), matching the existing worker convention —
// unassigned honestly means "sees everything" rather than fake-restrictive.
export async function vetAssignedBatchIds(session: Session): Promise<string[] | null> {
  if (session.role !== 'vet') return null;
  const [u] = await db.select({ phone: users.phone }).from(users).where(eq(users.id, session.userId)).limit(1);
  if (!u) return null;
  // employees.phone has no unique constraint (unlike users.phone) — filter by
  // role too so a duplicate/re-hired phone entry can't scope this vet to some
  // other employee's assignment by whichever row Postgres happens to return first.
  const [emp] = await db.select({ assignedBatchIds: employees.assignedBatchIds }).from(employees)
    .where(and(eq(employees.tenantId, session.tenantId), eq(employees.phone, u.phone), eq(employees.role, 'vet'))).limit(1);
  return emp?.assignedBatchIds ?? null;
}
