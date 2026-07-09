import { db } from '@/db';
import { sales, employees, tasks, workerProfiles, alerts, productionUnits, batches, products, inventoryItems, inventoryLots, users, lifecycleStages, batchStageEvents, mortalityRecords, feedingRecords, healthRecords, productionRecords, laborLogs, physicalCounts, weightSamples, observations } from '@/db/schemas';
import { sellableStock, liveWeightFor, checkWithdrawal } from '@/lib/server/inventory';
import { and, eq } from 'drizzle-orm';
import { getSession } from '@/lib/server/session';
import { RESOURCES, tenantScope, vetAssignedBatchIds } from '@/lib/server/resources';
import { hiddenFieldKeysFor, stripForRead } from '@/lib/server/fieldPermissions';
import { createProductsForBatch, defaultsForBatch } from '@/lib/server/products';
import { defaultLiveWeightKg, enterpriseFromSpecies } from '@/lib/server/productTemplates';
import { defaultStages } from '@/lib/lifecycle';
import { hashSecret } from '@/lib/server/crypto';
import { DEFAULT_WORKER_FIELDS as DEFAULT_FIELDS } from '@/lib/workerFields';
import { ok, created, unauthorized, forbidden, notFound, badRequest } from '@/lib/server/http';
import { audit, actorLabel } from '@/lib/server/audit';
import type { Role, FieldConfig } from '@/lib/types';

// A worker signs in with a 4–6 digit PIN; a manager/vet with an email + password.
const isPin = (v: string) => /^\d{4,6}$/.test(v);

// Pay day must be a calendar day 1–31, else null (no scheduled pay day).
const parsePayDay = (v: unknown): number | null => {
  const d = Number(v);
  return Number.isInteger(d) && d >= 1 && d <= 31 ? d : null;
};
// Assignment list: null → all batches; array → those (strings only); else undefined
// (caller treats undefined as "not provided").
const parseBatchIds = (v: unknown): string[] | null | undefined => {
  if (v === null) return null;
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === 'string');
  return undefined;
};

// No resource here has a column that is both universally present AND safely
// sortable for true cursor pagination: `id` is a random UUID (not ordered),
// and `createdAt` exists on only 3 of 11 resources (alerts/sales/purchases).
// A per-resource sort key would mean per-resource special-casing, which this
// single shared handler is meant to avoid. So pagination here is opt-in only:
// `?limit=`/`?offset=` are honoured when a caller explicitly passes them, but
// the default (no `?limit=`) is the full, unbounded result — same as before
// this route ever had pagination. It must NOT apply a silent default cap:
// several callers (e.g. app/owner/finance/page.tsx summing `sales`/`purchases`
// for revenue/cost totals) need the complete list, and a hard cap with no
// `ORDER BY` would silently and non-deterministically truncate those totals
// for any tenant with more rows than the cap — wrong numbers, not an error.
const MAX_LIMIT = 2000;

// GET /api/data/<resource>  — tenant-scoped, role-gated, field-permission filtered.
// Optional ?id=<id> returns a single row. Optional ?limit=&?offset= page the
// result — omitted entirely, the query is unbounded.
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

  const url = new URL(req.url);
  const id = url.searchParams.get('id');
  const limitParam = Number(url.searchParams.get('limit'));
  // undefined (not applied) unless the caller explicitly asked for a page.
  const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(MAX_LIMIT, Math.floor(limitParam)) : undefined;
  const offsetParam = Number(url.searchParams.get('offset'));
  const offset = Number.isFinite(offsetParam) && offsetParam > 0 ? Math.floor(offsetParam) : 0;

  // Server-side filtering for tasks by assigned user (replaces client-side filtering)
  if (resource === 'tasks' && url.searchParams.has('assignedTo')) {
    const assignedTo = url.searchParams.get('assignedTo')!;
    const query = db.select().from(def.table)
      .where(and(eq(def.table.tenantId, session.tenantId), eq(def.table.assignedTo, assignedTo)));
    const rows = limit != null ? await query.limit(limit).offset(offset) : await query;
    const hidden = await hiddenFieldKeysFor(session);
    const filtered = stripForRead(resource, rows as Record<string, unknown>[], hidden);
    return ok(filtered);
  }

  // FR-M5-5: a vet sees only their assigned batches. Resolved via
  // employees.assignedBatchIds (same field workers use), joined to the vet's
  // login row by phone — see vetAssignedBatchIds in lib/server/resources.ts.
  // null = all batches (no assignment configured yet), matching the existing
  // worker convention — this is a real filter, not a UI-only claim.
  if (resource === 'batches' && session.role === 'vet') {
    const assigned = await vetAssignedBatchIds(session);
    const rows = await db.select().from(batches).where(eq(batches.tenantId, session.tenantId));
    const scoped = assigned ? rows.filter((b) => assigned.includes(b.id)) : rows;
    const hidden = await hiddenFieldKeysFor(session);
    const filtered = stripForRead(resource, scoped as Record<string, unknown>[], hidden);
    if (id) {
      const one = filtered.find((r) => (r as { id?: string }).id === id);
      return one ? ok(one) : notFound();
    }
    return ok(limit != null ? filtered.slice(offset, offset + limit) : filtered);
  }

  // A single-row lookup by id must not be starved by the page cap, so it skips
  // limit/offset (the old behaviour: pull the tenant's rows and find the one).
  if (id) {
    const rows = await db.select().from(def.table).where(tenantScope(def, session));
    const hidden = await hiddenFieldKeysFor(session);
    const filtered = stripForRead(resource, rows as Record<string, unknown>[], hidden);
    const one = filtered.find((r) => (r as { id?: string }).id === id);
    return one ? ok(one) : notFound();
  }

  const baseQuery = db.select().from(def.table).where(tenantScope(def, session));
  const rows = limit != null ? await baseQuery.limit(limit).offset(offset) : await baseQuery;

  const hidden = await hiddenFieldKeysFor(session);
  const filtered = stripForRead(resource, rows as Record<string, unknown>[], hidden);

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
    const acquiredDate = s(body.acquiredDate, now.slice(0, 10));
    // Start the batch at the first lifecycle stage of its enterprise (e.g. broiler →
    // Brooding), so age-based "due to move" tracking works from creation. Use the
    // TENANT's configured first stage (the farmer may have renamed it), falling back
    // to the built-in template.
    const enterprise = s(body.enterprise) || enterpriseFromSpecies(s(body.species)) || null;
    let initialStage = s(body.stage);
    if (!initialStage) {
      const first = enterprise
        ? (await db.select({ name: lifecycleStages.name }).from(lifecycleStages)
            .where(and(eq(lifecycleStages.tenantId, session.tenantId), eq(lifecycleStages.enterprise, enterprise)))
            .orderBy(lifecycleStages.ord).limit(1))[0]?.name
        : undefined;
      initialStage = first || defaultStages(enterprise)[0]?.name || 'GROWING';
    }
    await db.insert(batches).values({
      id, tenantId: session.tenantId, unitId: s(body.unitId), name: s(body.name),
      species: s(body.species, 'unknown'), breed: body.breed ? s(body.breed) : null, source: s(body.source, 'PURCHASED'),
      acquiredDate, ageAtAcquire: n(body.ageAtAcquire),
      initialQty: qty, currentQty: qty, stage: initialStage, stageEnteredAt: acquiredDate,
      acquisitionCost: n(body.cost ?? body.acquisitionCost), status: 'ACTIVE',
      // Seed an avg live weight for animals sold by weight (fish, pork) so their sale
      // is capped by biomass from day one; a weight sample refines it later.
      avgWeightKg: defaultLiveWeightKg(s(body.species)),
    });
    // Auto-create the batch's default products for its enterprise — the animal
    // itself AND its secondary outputs (a layer batch gets Eggs + Manure + the
    // spent hen). The farmer can edit or add more afterwards.
    const defs = defaultsForBatch(s(body.species), s(body.enterprise) || undefined);
    const prod = defs.length ? await createProductsForBatch(session.tenantId, id, defs) : [];
    return created({ id, products: prod.length });
  }
  if (resource === 'sales') {
    if (!allow(['owner', 'manager'])) return forbidden();
    if (!body.batchId) return badRequest('batchId required');
    // Derive the unit from the batch (a sale is from a batch, which lives in a unit).
    const [batch] = await db.select({ id: batches.id, unitId: batches.unitId, currentQty: batches.currentQty, species: batches.species, avgWeightKg: batches.avgWeightKg }).from(batches)
      .where(and(eq(batches.tenantId, session.tenantId), eq(batches.id, s(body.batchId)))).limit(1);
    if (!batch) return badRequest('unknown batch');
    const quantity = n(body.quantity), unitPrice = n(body.unitPrice);
    if (quantity <= 0) return badRequest('Enter a quantity greater than zero.');

    // BR-WD: reject the sale outright if the batch is still inside a medicine
    // withdrawal window — this is the actual enforcement, not just the UI banner
    // on the batch page (which only warns; a direct API call bypassed it before
    // this check existed). See lib/server/inventory.ts's checkWithdrawal().
    const withdrawal = await checkWithdrawal(session.tenantId, batch.id);
    if (!withdrawal.cleared) {
      return badRequest(`This batch is still inside a medicine withdrawal period until ${withdrawal.until} (${withdrawal.daysLeft} day${withdrawal.daysLeft === 1 ? '' : 's'} left) — it cannot be sold yet.`);
    }

    // Convert the sale to base units and refuse to sell more than is in stock.
    // Stock basis depends on the product: a live animal sold per head draws down
    // the batch headcount; a harvested output (eggs/pork/fish/maize…) draws down
    // what was collected. See sellableStock().
    let baseQty = quantity;
    let productName = s(body.productType, 'produce');
    let baseUnit = 'unit';
    let isAnimalProduct = false;
    if (body.productId) {
      const [product] = await db.select().from(products)
        .where(and(eq(products.tenantId, session.tenantId), eq(products.id, s(body.productId)))).limit(1);
      if (!product) return badRequest('unknown product');
      productName = product.name;
      baseUnit = product.baseUnit;
      isAnimalProduct = product.isAnimalProduct ?? false;
      const saleUnits = (product.saleUnits as { name: string; perBase: number; price: number }[] | null) ?? [];
      const unit = saleUnits.find((u) => u.name === s(body.unitName));
      // Guard the conversion: an unrecognised unit would fall back to perBase=1 and
      // silently UNDER-count the base quantity, letting a sale slip past the stock
      // cap. Reject it instead so the cap is honoured for every product.
      if (s(body.unitName) && saleUnits.length > 0 && !unit) {
        return badRequest(`Unknown sale unit "${s(body.unitName)}" for ${productName}. Pick one of: ${saleUnits.map((u) => u.name).join(', ')}.`);
      }
      baseQty = quantity * (unit?.perBase ?? 1);

      const stock = await sellableStock(session.tenantId, batch, product);
      if (baseQty > stock.available + 1e-6) {
        if (stock.basis === 'headcount') {
          return badRequest(`Only ${stock.available} ${baseUnit} of ${productName} left in this batch — you tried to sell ${baseQty}. Record mortalities or check the live count.`);
        }
        if (stock.basis === 'biomass') {
          return stock.available > 0
            ? badRequest(`Only about ${stock.available} ${baseUnit} of ${productName} in this batch (~${batch.currentQty} animals × ${stock.avgWeightKg} ${baseUnit} each) — you tried to sell ${baseQty}.`)
            : badRequest(`Record a weight sample for this batch first — without an average weight we can't tell how many ${baseUnit} of ${productName} the ${batch.currentQty} animals represent.`);
        }
        return badRequest(`Only ${stock.available} ${baseUnit} of ${productName} available to sell — collected ${stock.produced}, already sold ${stock.sold}. Record the collection first.`);
      }
    }
    await db.insert(sales).values({
      id, tenantId: session.tenantId, batchId: batch.id, unitId: batch.unitId,
      productType: productName, quantity, baseQty, weightKg: body.weightKg ? n(body.weightKg) : null,
      unitPrice, totalAmount: quantity * unitPrice, buyer: s(body.buyer, 'Market'),
      paymentMethod: s(body.paymentMethod, 'cash'), status: 'PAID',
      withdrawalCheck: 'cleared', createdAt: now, // always true here — we already rejected above otherwise
    });
    // Selling the live animal itself physically removes head from the farm. For a
    // per-head sale, head = base qty; for a weight sale (fish/pork), convert the kg
    // sold back into animals via the batch's avg live weight.
    if (isAnimalProduct && baseQty > 0) {
      const perHead = (baseUnit ?? 'head') === 'head';
      const avg = liveWeightFor(batch);
      const head = perHead ? Math.round(baseQty) : (avg > 0 ? Math.round(baseQty / avg) : 0);
      const newBatchQty = Math.max(0, batch.currentQty - head);
      await db.update(batches).set({ currentQty: newBatchQty })
        .where(eq(batches.id, batch.id));
      // The unit may hold several batches; decrement by the delta, never below zero.
      const [unitRow] = await db.select({ q: productionUnits.currentQty }).from(productionUnits)
        .where(and(eq(productionUnits.tenantId, session.tenantId), eq(productionUnits.id, batch.unitId))).limit(1);
      if (unitRow) {
        await db.update(productionUnits).set({ currentQty: Math.max(0, (unitRow.q ?? 0) - head) })
          .where(and(eq(productionUnits.tenantId, session.tenantId), eq(productionUnits.id, batch.unitId)));
      }
    }
    return created({ id });
  }
  if (resource === 'employees') {
    if (!allow(['owner'])) return forbidden();
    if (!body.name || !body.phone) return badRequest('name and phone required');
    const role = s(body.role, 'worker');
    const phone = s(body.phone);
    const email = body.email ? s(body.email).trim().toLowerCase() : null;
    const profileId = body.workerProfileId ? s(body.workerProfileId) : null;
    // Optional login. A worker can be added now and given a PIN later; a manager/
    // vet logs in with email + password. No credentials → an HR record with no login.
    const pin = s(body.pin).trim();
    const password = s(body.password);
    let pinHash: string | null = null, passwordHash: string | null = null;
    if (role === 'worker' && pin) {
      if (!isPin(pin)) return badRequest('PIN must be 4–6 digits.');
      pinHash = await hashSecret(pin);
    }
    if (role !== 'worker' && (email || password)) {
      if (!email) return badRequest('Email is required for a manager/vet login.');
      if (password.length < 6) return badRequest('Password must be at least 6 characters.');
      passwordHash = await hashSecret(password);
    }
    const makeLogin = !!(pinHash || passwordHash);
    if (makeLogin) {
      const [dupPhone] = await db.select({ id: users.id }).from(users).where(eq(users.phone, phone)).limit(1);
      if (dupPhone) return badRequest('That phone number already has a login.');
      if (email) {
        const [dupEmail] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
        if (dupEmail) return badRequest('That email already has a login.');
      }
    }
    // Atomic: an employee record with pinSet/passwordHash implied must never exist
    // without its matching login row (and vice versa) — a crash between the two
    // inserts would otherwise leave an onboarded worker unable to sign in.
    // The pre-check above is a best-effort UX shortcut, not the real guard — two
    // concurrent submissions can both pass it (TOCTOU), so users.phone/email carry
    // a DB-level unique constraint (migration 0023) as the actual source of truth;
    // a race that slips past the pre-check fails here instead of silently duplicating.
    try {
      await db.transaction(async (tx) => {
        await tx.insert(employees).values({
          id, tenantId: session.tenantId, name: s(body.name), phone,
          role, workerProfileId: profileId, pinSet: !!pinHash, active: true,
          salary: Math.max(0, n(body.salary)),
          payDay: parsePayDay(body.payDay),
          paymentsFrom: /^\d{4}-(0[1-9]|1[0-2])$/.test(s(body.paymentsFrom)) ? s(body.paymentsFrom) : null,
          assignedBatchIds: parseBatchIds(body.assignedBatchIds) ?? null, // null = all batches
        });
        if (makeLogin) {
          await tx.insert(users).values({
            id: crypto.randomUUID(), tenantId: session.tenantId, name: s(body.name), phone, email,
            role, workerProfileId: role === 'worker' ? profileId : null, language: 'en', pinHash, passwordHash,
          });
        }
      });
    } catch (e) {
      if ((e as { code?: string }).code === '23505') return badRequest('That phone number or email already has a login.');
      throw e;
    }
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
  const s = (v: unknown, d = '') => (typeof v === 'string' ? v : d);

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
    if (body.salary != null && !isNaN(Number(body.salary))) patch.salary = Math.max(0, Number(body.salary));
    if ('payDay' in body) patch.payDay = parsePayDay(body.payDay);
    if ('paymentsFrom' in body) { const pf = String(body.paymentsFrom ?? ''); patch.paymentsFrom = /^\d{4}-(0[1-9]|1[0-2])$/.test(pf) ? pf : null; }
    // assignedBatchIds: array → those; null → all; absent → unchanged. This is how
    // assigning AND unassigning a batch are persisted.
    if ('assignedBatchIds' in body) patch.assignedBatchIds = parseBatchIds(body.assignedBatchIds) ?? null;
    if ('workerProfileId' in body) patch.workerProfileId = body.workerProfileId ? s(body.workerProfileId) : null;

    // Optional credential reset: a PIN (worker) or password (manager/vet).
    const pin = s(body.pin).trim();
    const password = s(body.password);
    const wantCreds = !!(pin || password);
    if (Object.keys(patch).length === 0 && !wantCreds) return badRequest('Nothing to update.');

    // Load the employee when we must create/sync its login row (keyed by phone).
    const needUser = wantCreds || 'workerProfileId' in body || 'name' in body || 'role' in body;
    let emp: { phone: string; name: string; role: string; workerProfileId: string | null } | undefined;
    if (needUser) {
      [emp] = await db.select({ phone: employees.phone, name: employees.name, role: employees.role, workerProfileId: employees.workerProfileId })
        .from(employees).where(and(eq(employees.tenantId, tid), eq(employees.id, id))).limit(1);
      if (!emp) return notFound();
    }

    if (wantCreds && emp) {
      const role = typeof body.role === 'string' ? body.role : emp.role;
      let pinHash: string | undefined, passwordHash: string | undefined;
      if (pin) { if (!isPin(pin)) return badRequest('PIN must be 4–6 digits.'); pinHash = await hashSecret(pin); patch.pinSet = true; }
      if (password) { if (password.length < 6) return badRequest('Password must be at least 6 characters.'); passwordHash = await hashSecret(password); }
      const [u] = await db.select({ id: users.id }).from(users).where(and(eq(users.tenantId, tid), eq(users.phone, emp.phone))).limit(1);
      if (u) {
        const uset: Record<string, unknown> = {};
        if (pinHash !== undefined) uset.pinHash = pinHash;
        if (passwordHash !== undefined) uset.passwordHash = passwordHash;
        await db.update(users).set(uset).where(eq(users.id, u.id));
      } else {
        const email = body.email ? s(body.email).trim().toLowerCase() : null;
        if (passwordHash && !email) return badRequest('Email is required for a manager/vet login.');
        try {
          await db.insert(users).values({
            id: crypto.randomUUID(), tenantId: tid, name: emp.name, phone: emp.phone, email,
            role, workerProfileId: emp.workerProfileId ?? null, language: 'en', pinHash: pinHash ?? null, passwordHash: passwordHash ?? null,
          });
        } catch (e) {
          if ((e as { code?: string }).code === '23505') return badRequest('That phone number or email already has a login.');
          throw e;
        }
      }
    }

    await db.update(employees).set(patch).where(and(eq(employees.tenantId, tid), eq(employees.id, id)));

    // Keep an existing login's name/role/profile in step with the employee record.
    if (emp && ('workerProfileId' in body || 'name' in body || 'role' in body)) {
      const usync: Record<string, unknown> = {};
      if (typeof body.name === 'string') usync.name = body.name;
      if (typeof body.role === 'string') usync.role = body.role;
      if ('workerProfileId' in body) usync.workerProfileId = body.workerProfileId ? s(body.workerProfileId) : null;
      if (Object.keys(usync).length) await db.update(users).set(usync).where(and(eq(users.tenantId, tid), eq(users.phone, emp.phone)));
    }
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
  if (resource === 'tasks') {
    // Workers can mark their own tasks as done; owners/managers can update any task
    const patch: Record<string, unknown> = {};
    if (typeof body.status === 'string' && ['ASSIGNED', 'IN_PROGRESS', 'DONE', 'MISSED', 'SKIPPED'].includes(body.status)) {
      if (session.role === 'worker' && body.status !== 'DONE') {
        return badRequest('Workers can only mark tasks as done.');
      }
      patch.status = body.status;
    }
    if (Object.keys(patch).length === 0) return badRequest('Nothing to update.');
    await db.update(tasks).set(patch).where(and(eq(tasks.tenantId, tid), eq(tasks.id, id)));
    return ok({ id });
  }
  return badRequest('resource not updatable');
}

// DELETE /api/data/<resource>?id=...&action=close — close/delete.
//   units   — hard-delete a unit (only if empty: no active batches, currentQty=0).
//   batches — action=close → soft-close (status='CLOSED'); no action → hard-delete if
//             no related data, or returns error suggesting close instead.
export async function DELETE(req: Request, ctx: { params: Promise<{ resource: string }> }) {
  const session = await getSession();
  if (!session) return unauthorized();
  if (!(['owner', 'manager'] as Role[]).includes(session.role)) return forbidden();
  const { resource } = await ctx.params;
  const url = new URL(req.url);
  const id = url.searchParams.get('id');
  if (!id) return badRequest('id required');
  const tid = session.tenantId;

  if (resource === 'units') {
    // Only allow deleting an empty unit — no active batches, currentQty === 0.
    const [u] = await db.select({ id: productionUnits.id, currentQty: productionUnits.currentQty })
      .from(productionUnits).where(and(eq(productionUnits.tenantId, tid), eq(productionUnits.id, id))).limit(1);
    if (!u) return notFound();
    if ((u.currentQty ?? 0) > 0) return badRequest('Cannot delete a unit that still has animals. Remove or close all batches first.');
    const activeBatches = await db.select({ id: batches.id }).from(batches)
      .where(and(eq(batches.tenantId, tid), eq(batches.unitId, id), eq(batches.status, 'ACTIVE'))).limit(1);
    if (activeBatches.length > 0) return badRequest('Cannot delete a unit with active batches. Close all batches first.');
    await db.delete(productionUnits).where(and(eq(productionUnits.tenantId, tid), eq(productionUnits.id, id)));
    await audit({ tenantId: tid, actor: actorLabel(session), action: 'unit.delete', entity: id, before: { id }, after: null });
    return ok({ id, deleted: true });
  }

  if (resource === 'batches') {
    // Check if the batch belongs to this tenant.
    const [b] = await db.select({ id: batches.id, status: batches.status, currentQty: batches.currentQty, unitId: batches.unitId, name: batches.name })
      .from(batches).where(and(eq(batches.tenantId, tid), eq(batches.id, id))).limit(1);
    if (!b) return notFound();

    const isClose = url.searchParams.get('action') === 'close';

    if (isClose) {
      // Soft close: set status to CLOSED. Keep the data for history.
      if (b.status === 'CLOSED') return badRequest('Batch is already closed.');
      // Release the headcount from the unit.
      if ((b.currentQty ?? 0) > 0 && b.unitId) {
        const [u] = await db.select({ q: productionUnits.currentQty }).from(productionUnits)
          .where(and(eq(productionUnits.tenantId, tid), eq(productionUnits.id, b.unitId))).limit(1);
        if (u) {
          await db.update(productionUnits).set({ currentQty: Math.max(0, (u.q ?? 0) - b.currentQty) })
            .where(and(eq(productionUnits.tenantId, tid), eq(productionUnits.id, b.unitId)));
        }
      }
      await db.update(batches).set({ status: 'CLOSED', stage: 'CLOSED' })
        .where(and(eq(batches.tenantId, tid), eq(batches.id, id)));
      await audit({ tenantId: tid, actor: actorLabel(session), action: 'batch.close', entity: id, before: { status: b.status }, after: { status: 'CLOSED' } });
      return ok({ id, closed: true });
    }

    // Hard-delete path: check for related data first.
    const [sale] = await db.select({ id: sales.id }).from(sales)
      .where(and(eq(sales.tenantId, tid), eq(sales.batchId, id))).limit(1);
    const [ev] = await db.select({ id: batchStageEvents.id }).from(batchStageEvents)
      .where(and(eq(batchStageEvents.tenantId, tid), eq(batchStageEvents.batchId, id))).limit(1);
    const [mort] = await db.select({ id: mortalityRecords.clientUuid }).from(mortalityRecords)
      .where(and(eq(mortalityRecords.tenantId, tid), eq(mortalityRecords.batchId, id))).limit(1);
    const [feed] = await db.select({ id: feedingRecords.clientUuid }).from(feedingRecords)
      .where(and(eq(feedingRecords.tenantId, tid), eq(feedingRecords.batchId, id))).limit(1);
    const [hlth] = await db.select({ id: healthRecords.clientUuid }).from(healthRecords)
      .where(and(eq(healthRecords.tenantId, tid), eq(healthRecords.batchId, id))).limit(1);
    const [prod] = await db.select({ id: productionRecords.clientUuid }).from(productionRecords)
      .where(and(eq(productionRecords.tenantId, tid), eq(productionRecords.batchId, id))).limit(1);
    const [lab] = await db.select({ id: laborLogs.clientUuid }).from(laborLogs)
      .where(and(eq(laborLogs.tenantId, tid), eq(laborLogs.batchId, id))).limit(1);
    const [pc] = await db.select({ id: physicalCounts.clientUuid }).from(physicalCounts)
      .where(and(eq(physicalCounts.tenantId, tid), eq(physicalCounts.batchId, id))).limit(1);
    const [ws] = await db.select({ id: weightSamples.clientUuid }).from(weightSamples)
      .where(and(eq(weightSamples.tenantId, tid), eq(weightSamples.batchId, id))).limit(1);
    const [obs] = await db.select({ id: observations.clientUuid }).from(observations)
      .where(and(eq(observations.tenantId, tid), eq(observations.batchId, id))).limit(1);
    // Also check tasks linked to this batch.
    const [tsk] = await db.select({ id: tasks.id }).from(tasks)
      .where(and(eq(tasks.tenantId, tid), eq(tasks.batchId, id))).limit(1);

    const hasRelatedData = !!(sale || ev || mort || feed || hlth || prod || lab || pc || ws || obs || tsk);

    if (hasRelatedData) {
      return badRequest('Batch has sales or activity — close it instead of deleting.');
    }

    // No related data — hard delete.
    await db.delete(products).where(and(eq(products.tenantId, tid), eq(products.batchId, id)));
    await db.delete(batchStageEvents).where(and(eq(batchStageEvents.tenantId, tid), eq(batchStageEvents.batchId, id)));
    await db.delete(batches).where(and(eq(batches.tenantId, tid), eq(batches.id, id)));
    await audit({ tenantId: tid, actor: actorLabel(session), action: 'batch.delete', entity: id, before: { name: b.name }, after: null });
    return ok({ id, deleted: true });
  }

  return badRequest('resource not deletable');
}
