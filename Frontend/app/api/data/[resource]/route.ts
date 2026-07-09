import { db } from '@/db';
import { tasks, alerts, inventoryItems, inventoryLots, workerProfiles, products, batches } from '@/db/schemas';
import { and, eq, asc } from 'drizzle-orm';
import { getSession } from '@/lib/server/session';
import { RESOURCES, tenantScope, vetAssignedBatchIds } from '@/lib/server/resources';
import { hiddenFieldKeysFor, stripForRead } from '@/lib/server/fieldPermissions';
import { DEFAULT_WORKER_FIELDS as DEFAULT_FIELDS } from '@/lib/workerFields';
import { ok, created, unauthorized, forbidden, notFound, badRequest, tooMany } from '@/lib/server/http';
import { createSale } from '@/lib/server/sales';
import {
  parseBody, createSaleSchema, createTaskSchema, createWorkerProfileSchema,
  updateWorkerProfileSchema, updateAlertSchema, updateItemSchema, updateLotSchema, updateTaskSchema,
} from '@/lib/server/validate';
import { toCents } from '@/lib/server/money';
import { checkWriteRateLimit, checkReadRateLimit } from '@/lib/server/rateLimit';
import type { Role, FieldConfig } from '@/lib/types';

function toRecord<T extends object>(rows: T[]): Record<string, unknown>[] {
  return rows.map((r) => ({ ...r } as Record<string, unknown>));
}

// GET — generic handler. batches/employees/units now have their own static
// route files (app/api/data/{batches,employees,units}/route.ts) which Next.js
// resolves in preference to this dynamic [resource] route for those exact
// paths — this handler's branches for those three resources (including the
// FR-M5-5 vet-scoping check below) are unreachable dead code kept only because
// every other resource (sales, tasks, worker-profiles, alerts, items, lots,
// health-records, etc.) still routes through here.
export async function GET(req: Request, ctx: { params: Promise<{ resource: string }> }) {
  const session = await getSession();
  if (!session) return unauthorized();
  const readLimit = checkReadRateLimit(req);
  if (!readLimit.allowed) return tooMany(`Too many requests.`, readLimit.retryAfter);

  const { resource } = await ctx.params;
  const def = RESOURCES[resource];
  if (!def) return notFound();
  if (!def.roles.includes(session.role)) return forbidden();

  const url = new URL(req.url);
  const id = url.searchParams.get('id');
  const limitParam = Number(url.searchParams.get('limit'));
  let limit: number | undefined;
  if (limitParam === 0) limit = undefined;
  else if (Number.isFinite(limitParam) && limitParam > 0) limit = Math.min(5000, Math.floor(limitParam));
  else limit = 2000;
  const offsetParam = Number(url.searchParams.get('offset'));
  const offset = Number.isFinite(offsetParam) && offsetParam > 0 ? Math.floor(offsetParam) : 0;

  if (resource === 'tasks' && url.searchParams.has('assignedTo')) {
    const assignedTo = url.searchParams.get('assignedTo')!;
    if (session.role === 'worker' && assignedTo !== session.userId) return forbidden('Workers can only view their own tasks.');
    const query = db.select().from(def.table).where(and(eq(def.table.tenantId, session.tenantId), eq(def.table.assignedTo, assignedTo))).orderBy(asc(def.table.id));
    const rows = limit != null ? await query.limit(limit).offset(offset) : await query;
    const hidden = await hiddenFieldKeysFor(session);
    return ok(stripForRead(resource, toRecord(rows), hidden));
  }

  // FR-M5-5: a vet sees only their assigned batches.
  if (resource === 'batches' && session.role === 'vet') {
    const assigned = await vetAssignedBatchIds(session);
    const rows = await db.select().from(batches).where(eq(batches.tenantId, session.tenantId));
    const scoped = assigned ? rows.filter((b) => assigned.includes(b.id)) : rows;
    const hidden = await hiddenFieldKeysFor(session);
    const filtered = stripForRead(resource, toRecord(scoped), hidden);
    if (id) {
      const one = filtered.find((r) => r.id === id);
      return one ? ok(one) : notFound();
    }
    return ok(limit != null ? filtered.slice(offset, offset + limit) : filtered);
  }

  if (id) {
    const rows = await db.select().from(def.table).where(tenantScope(def, session));
    const hidden = await hiddenFieldKeysFor(session);
    const filtered = stripForRead(resource, toRecord(rows), hidden);
    const one = filtered.find((r) => r.id === id);
    return one ? ok(one) : notFound();
  }

  const baseQuery = db.select().from(def.table).where(tenantScope(def, session)).orderBy(asc(def.table.id));
  const rows = limit != null ? await baseQuery.limit(limit).offset(offset) : await baseQuery;
  const hidden = await hiddenFieldKeysFor(session);
  return ok(stripForRead(resource, toRecord(rows), hidden));
}

// POST — create handlers for resources NOT extracted to their own route files.
export async function POST(req: Request, ctx: { params: Promise<{ resource: string }> }) {
  const session = await getSession();
  if (!session) return unauthorized();
  const writeLimit = checkWriteRateLimit(req);
  if (!writeLimit.allowed) return tooMany(`Too many requests.`, writeLimit.retryAfter);
  const { resource } = await ctx.params;
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const allow = (roles: Role[]) => roles.includes(session.role);

  // Sales — delegates to lib/server/sales.ts
  if (resource === 'sales') {
    if (!allow(['owner', 'manager'])) return forbidden();
    const parsed = await parseBody(req, createSaleSchema);
    if ('error' in parsed) return parsed.error;
    const body = parsed.data;
    const result = await createSale({
      tenantId: session.tenantId, batchId: body.batchId, quantity: body.quantity,
      unitPrice: body.unitPrice, productId: body.productId ?? undefined,
      productType: body.productType ?? undefined, unitName: body.unitName ?? undefined,
      weightKg: body.weightKg ?? null, buyer: body.buyer ?? undefined,
      paymentMethod: body.paymentMethod ?? undefined,
    });
    if (!result.ok) return badRequest(result.error);
    return created({ id: result.id });
  }

  // Tasks
  if (resource === 'tasks') {
    if (!allow(['owner', 'manager'])) return forbidden();
    const parsed = await parseBody(req, createTaskSchema);
    if ('error' in parsed) return parsed.error;
    const body = parsed.data;
    await db.insert(tasks).values({
      id, tenantId: session.tenantId, title: body.title, description: body.description ?? null,
      type: body.type, assignedTo: body.assignedTo, unitId: body.unitId ?? null,
      batchId: body.batchId ?? null, scheduledFor: body.scheduledFor || now,
      status: 'ASSIGNED', dueAt: body.dueAt || now, overdue: false,
    });
    return created({ id });
  }

  // Worker Profiles
  if (resource === 'worker-profiles') {
    if (!allow(['owner'])) return forbidden();
    const parsed = await parseBody(req, createWorkerProfileSchema);
    if ('error' in parsed) return parsed.error;
    const body = parsed.data;
    const prods = await db.select().from(products).where(eq(products.tenantId, session.tenantId));
    const have = new Set(DEFAULT_FIELDS.map((f) => f.fieldKey));
    const collectFields: FieldConfig[] = [];
    for (const p of prods) {
      const key = p.fieldKey ?? '';
      if (key && !have.has(key)) { have.add(key); collectFields.push({ fieldKey: key, label: `Collect ${p.name} (${p.collectFrequency})`, permission: 'editable', required: false }); }
    }
    await db.insert(workerProfiles).values({
      id, tenantId: session.tenantId, name: body.name,
      description: body.description ?? null,
      fields: [...DEFAULT_FIELDS, ...collectFields], modules: ['morning_round', 'mortality', 'feeding', 'health', 'collect'],
      mortalityPhotoThreshold: 1, alertThresholds: {},
    });
    return created({ id });
  }
  return badRequest('resource not creatable');
}

// PATCH — update handlers for resources NOT extracted to their own route files.
export async function PATCH(req: Request, ctx: { params: Promise<{ resource: string }> }) {
  const session = await getSession();
  if (!session) return unauthorized();
  const writeLimit = checkWriteRateLimit(req);
  if (!writeLimit.allowed) return tooMany(`Too many requests.`, writeLimit.retryAfter);
  const { resource } = await ctx.params;
  const id = new URL(req.url).searchParams.get('id');
  if (!id) return badRequest('id required');
  const tid = session.tenantId;

  // Worker Profiles
  if (resource === 'worker-profiles') {
    if (session.role !== 'owner') return forbidden();
    const parsed = await parseBody(req, updateWorkerProfileSchema);
    if ('error' in parsed) return parsed.error;
    const body = parsed.data;
    const patch: Record<string, unknown> = {};
    if (body.fields !== undefined) patch.fields = body.fields;
    if (body.mortalityPhotoThreshold !== undefined) patch.mortalityPhotoThreshold = body.mortalityPhotoThreshold;
    if (body.name !== undefined) patch.name = body.name;
    if (Object.keys(patch).length === 0) return badRequest('Nothing to update.');
    await db.update(workerProfiles).set(patch).where(and(eq(workerProfiles.tenantId, tid), eq(workerProfiles.id, id)));
    return ok({ id });
  }

  // Alerts
  if (resource === 'alerts') {
    if (!['owner', 'manager'].includes(session.role)) return forbidden();
    const parsed = await parseBody(req, updateAlertSchema);
    if ('error' in parsed) return parsed.error;
    const body = parsed.data;
    await db.update(alerts).set({ acknowledged: body.acknowledged }).where(and(eq(alerts.tenantId, tid), eq(alerts.id, id)));
    return ok({ id });
  }

  // Inventory Items
  if (resource === 'items') {
    if (!['owner', 'manager'].includes(session.role)) return forbidden();
    const parsed = await parseBody(req, updateItemSchema);
    if ('error' in parsed) return parsed.error;
    const body = parsed.data;
    const patch: Record<string, unknown> = {};
    if (body.name !== undefined && body.name.trim()) patch.name = body.name.trim();
    if (body.unit !== undefined && body.unit.trim()) patch.unit = body.unit.trim();
    if (body.lowStockThreshold !== undefined) patch.lowStockThreshold = body.lowStockThreshold;
    if (Object.keys(patch).length === 0) return badRequest('Nothing to update.');
    await db.update(inventoryItems).set(patch).where(and(eq(inventoryItems.tenantId, tid), eq(inventoryItems.id, id)));
    return ok({ id });
  }

  // Inventory Lots
  if (resource === 'lots') {
    if (!['owner', 'manager'].includes(session.role)) return forbidden();
    const parsed = await parseBody(req, updateLotSchema);
    if ('error' in parsed) return parsed.error;
    const body = parsed.data;
    const patch: Record<string, unknown> = {};
    if (body.qtyOnHand !== undefined) patch.qtyOnHand = body.qtyOnHand;
    if (body.unitCost !== undefined) {
      patch.unitCost = body.unitCost;
      patch.unitCostCents = toCents(body.unitCost);
    }
    if (Object.keys(patch).length === 0) return badRequest('Nothing to update.');
    await db.update(inventoryLots).set(patch).where(and(eq(inventoryLots.tenantId, tid), eq(inventoryLots.id, id)));
    return ok({ id });
  }

  // Tasks
  if (resource === 'tasks') {
    const parsed = await parseBody(req, updateTaskSchema);
    if ('error' in parsed) return parsed.error;
    const body = parsed.data;
    const patch: Record<string, unknown> = {};
    if (body.status !== undefined) {
      if (session.role === 'worker' && body.status !== 'DONE') return badRequest('Workers can only mark tasks as done.');
      patch.status = body.status;
    }
    if (Object.keys(patch).length === 0) return badRequest('Nothing to update.');
    if (session.role === 'worker') {
      const [task] = await db.select({ assignedTo: tasks.assignedTo }).from(tasks)
        .where(and(eq(tasks.tenantId, tid), eq(tasks.id, id))).limit(1);
      if (!task) return notFound();
      if (task.assignedTo !== session.userId) return forbidden('Workers can only update their own tasks.');
    }
    await db.update(tasks).set(patch).where(and(eq(tasks.tenantId, tid), eq(tasks.id, id)));
    return ok({ id });
  }
  return badRequest('resource not updatable');
}
