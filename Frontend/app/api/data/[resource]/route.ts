import { db } from '@/db';
import { sales, employees, tasks, workerProfiles, alerts, productionUnits, batches, products, inventoryItems, inventoryLots } from '@/db/schemas';
import { productAvailability } from '@/lib/server/inventory';
import { and, eq } from 'drizzle-orm';
import { getSession } from '@/lib/server/session';
import { RESOURCES, tenantScope } from '@/lib/server/resources';
import { hiddenFieldKeysFor, stripForRead } from '@/lib/server/fieldPermissions';
import { createProductsForBatch, defaultsForBatch } from '@/lib/server/products';
import { ok, created, unauthorized, forbidden, notFound, badRequest } from '@/lib/server/http';
import type { Role, FieldConfig } from '@/lib/types';

const DEFAULT_FIELDS: FieldConfig[] = [
  { fieldKey: 'feed_unit_cost', label: 'Feed unit cost (KES)', permission: 'hidden' },
  { fieldKey: 'feed_quantity', label: 'Feed quantity (kg)', permission: 'editable', required: true },
  { fieldKey: 'egg_sale_price', label: 'Egg sale price', permission: 'hidden' },
  { fieldKey: 'mortality_cause', label: 'Mortality cause', permission: 'editable' },
  { fieldKey: 'batch_profit_loss', label: 'Batch profit/loss', permission: 'hidden' },
  { fieldKey: 'water_level', label: 'Water level', permission: 'editable', required: true },
  { fieldKey: 'eggs_collected', label: 'Eggs collected', permission: 'editable', required: true },
  { fieldKey: 'abnormal', label: 'Abnormal observation', permission: 'editable', required: true },
];

// GET /api/data/<resource>  — tenant-scoped, role-gated, field-permission filtered.
// Optional ?id=<id> returns a single row.
export async function GET(
  req: Request,
  ctx: { params: Promise<{ resource: string }> }
) {
  const session = await getSession();
  if (!session) return unauthorized();

  const { resource } = await ctx.params;
  const def = RESOURCES[resource];
  if (!def) return notFound();
  if (!def.roles.includes(session.role)) return forbidden();

  const rows = await db.select().from(def.table).where(tenantScope(def, session));

  const hidden = await hiddenFieldKeysFor(session);
  const filtered = stripForRead(resource, rows as Record<string, unknown>[], hidden);

  const id = new URL(req.url).searchParams.get('id');
  if (id) {
    const one = filtered.find((r) => (r as { id?: string }).id === id);
    return one ? ok(one) : notFound();
  }
  return ok(filtered);
}

// POST /api/data/<resource> — create. Owner/manager only (employees: owner only).
export async function POST(req: Request, ctx: { params: Promise<{ resource: string }> }) {
  const session = await getSession();
  if (!session) return unauthorized();
  const { resource } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const allow = (roles: Role[]) => roles.includes(session.role);
  const s = (v: unknown, d = '') => (typeof v === 'string' ? v : d);
  const n = (v: unknown) => (typeof v === 'number' ? v : Number(v) || 0);

  if (resource === 'units') {
    if (!allow(['owner', 'manager'])) return forbidden();
    if (!body.name) return badRequest('name required');
    await db.insert(productionUnits).values({
      id, tenantId: session.tenantId, farmId: 'f1', type: s(body.type, 'HOUSE'), name: s(body.name),
      code: s(body.name).slice(0, 10), capacity: n(body.capacity), status: 'ACTIVE', currentQty: 0,
      species: body.species ? s(body.species) : null,
    });
    return created({ id });
  }
  if (resource === 'batches') {
    if (!allow(['owner', 'manager'])) return forbidden();
    if (!body.name || !body.unitId) return badRequest('name and unitId required');
    // Verify the unit belongs to this tenant.
    const [unit] = await db.select({ id: productionUnits.id }).from(productionUnits)
      .where(and(eq(productionUnits.tenantId, session.tenantId), eq(productionUnits.id, s(body.unitId)))).limit(1);
    if (!unit) return badRequest('unknown unit');
    const qty = n(body.qty ?? body.quantity);
    await db.insert(batches).values({
      id, tenantId: session.tenantId, unitId: s(body.unitId), name: s(body.name),
      species: s(body.species, 'unknown'), breed: body.breed ? s(body.breed) : null, source: s(body.source, 'PURCHASED'),
      acquiredDate: s(body.acquiredDate, now.slice(0, 10)), ageAtAcquire: n(body.ageAtAcquire),
      initialQty: qty, currentQty: qty, stage: s(body.stage, 'GROWING'), acquisitionCost: n(body.cost ?? body.acquisitionCost), status: 'ACTIVE',
    });
    // Auto-create this batch's products (eggs/pork/manure…) from its enterprise template.
    const defs = defaultsForBatch(s(body.species), s(body.enterprise) || undefined);
    const prod = await createProductsForBatch(session.tenantId, id, defs);
    return created({ id, products: prod.length });
  }
  if (resource === 'sales') {
    if (!allow(['owner', 'manager'])) return forbidden();
    if (!body.batchId) return badRequest('batchId required');
    // Derive the unit from the batch (a sale is from a batch, which lives in a unit).
    const [batch] = await db.select({ id: batches.id, unitId: batches.unitId }).from(batches)
      .where(and(eq(batches.tenantId, session.tenantId), eq(batches.id, s(body.batchId)))).limit(1);
    if (!batch) return badRequest('unknown batch');
    const quantity = n(body.quantity), unitPrice = n(body.unitPrice);
    if (quantity <= 0) return badRequest('Enter a quantity greater than zero.');

    // Convert the sale to base units and refuse to sell more than was collected.
    let baseQty = quantity;
    let productName = s(body.productType, 'eggs');
    if (body.productId) {
      const [product] = await db.select().from(products)
        .where(and(eq(products.tenantId, session.tenantId), eq(products.id, s(body.productId)))).limit(1);
      if (product) {
        productName = product.name;
        const unit = (product.saleUnits as { name: string; perBase: number; price: number }[] | null)?.find((u) => u.name === s(body.unitName));
        baseQty = quantity * (unit?.perBase ?? 1);
        const av = await productAvailability(session.tenantId, batch.id, productName);
        if (baseQty > av.available + 1e-6) {
          return badRequest(`Only ${av.available} ${product.baseUnit} of ${productName} available to sell — collected ${av.produced}, already sold ${av.sold}. Record the collection first.`);
        }
      }
    }
    await db.insert(sales).values({
      id, tenantId: session.tenantId, batchId: batch.id, unitId: batch.unitId,
      productType: productName, quantity, baseQty, weightKg: body.weightKg ? n(body.weightKg) : null,
      unitPrice, totalAmount: quantity * unitPrice, buyer: s(body.buyer, 'Market'),
      paymentMethod: s(body.paymentMethod, 'cash'), status: 'PAID',
      withdrawalCheck: s(body.withdrawalCheck, 'cleared'), createdAt: now,
    });
    return created({ id });
  }
  if (resource === 'employees') {
    if (!allow(['owner'])) return forbidden();
    if (!body.name || !body.phone) return badRequest('name and phone required');
    await db.insert(employees).values({
      id, tenantId: session.tenantId, name: s(body.name), phone: s(body.phone),
      role: s(body.role, 'worker'), pinSet: false, active: true,
    });
    return created({ id });
  }
  if (resource === 'tasks') {
    if (!allow(['owner', 'manager'])) return forbidden();
    if (!body.assignedTo || !body.title) return badRequest('title and assignedTo required');
    await db.insert(tasks).values({
      id, tenantId: session.tenantId, title: s(body.title), description: body.description ? s(body.description) : null,
      type: s(body.type, 'custom'), assignedTo: s(body.assignedTo), unitId: body.unitId ? s(body.unitId) : null,
      batchId: body.batchId ? s(body.batchId) : null, scheduledFor: s(body.scheduledFor, now),
      status: 'ASSIGNED', dueAt: s(body.dueAt, now), overdue: false,
    });
    return created({ id });
  }
  if (resource === 'worker-profiles') {
    if (!allow(['owner'])) return forbidden();
    // Retroactively include collect-permissions for products that already exist.
    const prods = await db.select().from(products).where(eq(products.tenantId, session.tenantId));
    const have = new Set(DEFAULT_FIELDS.map((f) => f.fieldKey));
    const collectFields: FieldConfig[] = [];
    for (const p of prods) {
      const key = p.fieldKey ?? '';
      if (key && !have.has(key)) { have.add(key); collectFields.push({ fieldKey: key, label: `Collect ${p.name} (${p.collectFrequency})`, permission: 'editable', required: false }); }
    }
    await db.insert(workerProfiles).values({
      id, tenantId: session.tenantId, name: s(body.name, 'New Profile'),
      description: body.description ? s(body.description) : null,
      fields: [...DEFAULT_FIELDS, ...collectFields], modules: ['morning_round', 'mortality', 'feeding', 'health', 'collect'],
      mortalityPhotoThreshold: 1, alertThresholds: {},
    });
    return created({ id });
  }
  return badRequest('resource not creatable');
}

// PATCH /api/data/<resource>?id=... — update.
export async function PATCH(req: Request, ctx: { params: Promise<{ resource: string }> }) {
  const session = await getSession();
  if (!session) return unauthorized();
  const { resource } = await ctx.params;
  const id = new URL(req.url).searchParams.get('id');
  if (!id) return badRequest('id required');
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const tid = session.tenantId;

  if (resource === 'worker-profiles') {
    if (session.role !== 'owner') return forbidden();
    const patch: Record<string, unknown> = {};
    if (Array.isArray(body.fields)) patch.fields = body.fields;
    if (typeof body.mortalityPhotoThreshold === 'number') patch.mortalityPhotoThreshold = body.mortalityPhotoThreshold;
    if (typeof body.name === 'string') patch.name = body.name;
    await db.update(workerProfiles).set(patch).where(and(eq(workerProfiles.tenantId, tid), eq(workerProfiles.id, id)));
    return ok({ id });
  }
  if (resource === 'employees') {
    if (session.role !== 'owner') return forbidden();
    const patch: Record<string, unknown> = {};
    if (typeof body.name === 'string') patch.name = body.name;
    if (typeof body.role === 'string') patch.role = body.role;
    if (typeof body.active === 'boolean') patch.active = body.active;
    await db.update(employees).set(patch).where(and(eq(employees.tenantId, tid), eq(employees.id, id)));
    return ok({ id });
  }
  if (resource === 'alerts') {
    if (!['owner', 'manager'].includes(session.role)) return forbidden();
    await db.update(alerts).set({ acknowledged: body.acknowledged !== false }).where(and(eq(alerts.tenantId, tid), eq(alerts.id, id)));
    return ok({ id });
  }
  if (resource === 'items') {
    if (!['owner', 'manager'].includes(session.role)) return forbidden();
    const patch: Record<string, unknown> = {};
    if (typeof body.name === 'string' && body.name.trim()) patch.name = body.name.trim();
    if (typeof body.unit === 'string' && body.unit.trim()) patch.unit = body.unit.trim();
    if (body.lowStockThreshold != null && !isNaN(Number(body.lowStockThreshold))) patch.lowStockThreshold = Number(body.lowStockThreshold);
    if (Object.keys(patch).length === 0) return badRequest('Nothing to update.');
    await db.update(inventoryItems).set(patch).where(and(eq(inventoryItems.tenantId, tid), eq(inventoryItems.id, id)));
    return ok({ id });
  }
  if (resource === 'lots') {
    if (!['owner', 'manager'].includes(session.role)) return forbidden();
    const patch: Record<string, unknown> = {};
    if (body.qtyOnHand != null && !isNaN(Number(body.qtyOnHand))) patch.qtyOnHand = Number(body.qtyOnHand);
    if (body.unitCost != null && !isNaN(Number(body.unitCost))) patch.unitCost = Number(body.unitCost);
    if (Object.keys(patch).length === 0) return badRequest('Nothing to update.');
    await db.update(inventoryLots).set(patch).where(and(eq(inventoryLots.tenantId, tid), eq(inventoryLots.id, id)));
    return ok({ id });
  }
  return badRequest('resource not updatable');
}
