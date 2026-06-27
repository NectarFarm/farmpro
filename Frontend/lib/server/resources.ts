import 'server-only';
// Resource registry powering /api/data/[resource]. One tenant-scoped, field-filtered
// read path for many entities. Add a resource = add a line here.
import { and, eq, type SQL } from 'drizzle-orm';
import {
  productionUnits, batches, inventoryItems, inventoryLots,
  tasks, alerts, sales, purchases, employees, workerProfiles, healthRecords,
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
