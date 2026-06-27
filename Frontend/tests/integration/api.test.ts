import { describe, it, expect, beforeAll, afterAll } from 'vitest';

// Hits a RUNNING app (the dev server, or the app service in docker compose).
const BASE = process.env.TEST_BASE_URL ?? 'http://localhost:13000';

async function rawLogin(identifier: string, secret: string) {
  return fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier, secret }), redirect: 'manual',
  });
}
async function login(identifier: string, secret: string): Promise<string> {
  const res = await rawLogin(identifier, secret);
  const cookie = res.headers.get('set-cookie');
  if (!res.ok || !cookie) throw new Error(`login failed for ${identifier}: ${res.status}`);
  return cookie.split(';')[0];
}
function api(path: string, cookie: string, init: RequestInit = {}) {
  return fetch(`${BASE}${path}`, {
    ...init, redirect: 'manual',
    headers: { ...(init.headers ?? {}), cookie, ...(init.body ? { 'Content-Type': 'application/json' } : {}) },
  });
}
const json = (cookie: string, path: string, body: unknown, method = 'POST') =>
  api(path, cookie, { method, body: JSON.stringify(body) });

describe('unified login identifies role server-side', () => {
  it.each([
    ['kutswa@ifms.farm', 'demo1234', 'owner'],
    ['admin@ifms.app', 'demo1234', 'super_admin'],
    ['+254700333444', '1234', 'worker'],
  ])('%s → %s', async (id, secret, role) => {
    const res = await rawLogin(id, secret);
    expect(res.status).toBe(200);
    expect((await res.json()).user.role).toBe(role);
  });

  it('returns the SAME generic 401 for wrong password and unknown user (no enumeration)', async () => {
    const bad = await rawLogin('kutswa@ifms.farm', 'WRONG');
    const unknown = await rawLogin('nobody@nowhere.test', 'whatever');
    expect(bad.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect((await bad.json()).error).toBe((await unknown.json()).error);
  });
});

describe('edge auth middleware', () => {
  it('redirects logged-out users from a protected page to /login', async () => {
    const res = await fetch(`${BASE}/owner/dashboard`, { redirect: 'manual' });
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('/login');
  });
});

describe('role gating', () => {
  it('blocks a non-admin from the admin API (403)', async () => {
    const owner = await login('kutswa@ifms.farm', 'demo1234');
    const res = await api('/api/admin/tenants', owner);
    expect(res.status).toBe(403);
  });
});

describe('field-permission default-deny', () => {
  it('a worker never receives feed unit cost', async () => {
    const worker = await login('+254700333444', '1234');
    const res = await api('/api/data/lots', worker);
    const lots = await res.json();
    if (Array.isArray(lots)) for (const l of lots) expect(l).not.toHaveProperty('unitCost');
  });
});

describe('tenant isolation + over-sell guard', () => {
  let admin = '', ownerB = '', tenantB = '';
  const email = `itest+${Date.now()}@example.test`;

  beforeAll(async () => {
    admin = await login('admin@ifms.app', 'demo1234');
    const res = await json(admin, '/api/admin/tenants', { farmName: 'ITest Farm', ownerName: 'IT', ownerEmail: email, ownerPassword: 'itest1234', plan: 'pro' });
    tenantB = (await res.json()).id;
    ownerB = await login(email, 'itest1234');
  });
  afterAll(async () => { if (tenantB) await api(`/api/admin/tenants?id=${tenantB}`, admin, { method: 'DELETE' }); });

  it('one farm cannot read another farm’s batch by id', async () => {
    // Self-seeding: create a real batch inside tenant B, then prove a DIFFERENT
    // tenant (kutswa) gets 404 for it. No reliance on pre-existing seed data.
    const unitId = (await (await json(ownerB, '/api/data/units', { name: 'Iso House', type: 'HOUSE', capacity: 50, species: 'broiler' })).json()).id;
    const batchId = (await (await json(ownerB, '/api/data/batches', { name: 'Iso B1', unitId, species: 'broiler', qty: 10, cost: 1000 })).json()).id;
    expect(batchId).toBeTruthy();

    // Owner B sees its own batch…
    const own = await api(`/api/data/batches?id=${batchId}`, ownerB);
    expect(own.status).toBe(200);
    // …but kutswa (a different tenant) must not.
    const kutswa = await login('kutswa@ifms.farm', 'demo1234');
    const cross = await api(`/api/data/batches?id=${batchId}`, kutswa);
    expect(cross.status).toBe(404);
  });
});

// Selling the animal itself (per-head livestock) must succeed and physically draw
// down the batch's live headcount — the bug that previously blocked every such sale.
describe('selling the animal itself decrements live headcount', () => {
  let admin = '', ownerC = '', tenantC = '';
  const email = `headtest+${Date.now()}@example.test`;

  beforeAll(async () => {
    admin = await login('admin@ifms.app', 'demo1234');
    const res = await json(admin, '/api/admin/tenants', { farmName: 'Head Test Farm', ownerName: 'HT', ownerEmail: email, ownerPassword: 'htest1234', plan: 'pro' });
    tenantC = (await res.json()).id;
    ownerC = await login(email, 'htest1234');
  });
  afterAll(async () => { if (tenantC) await api(`/api/admin/tenants?id=${tenantC}`, admin, { method: 'DELETE' }); });

  it('sells broilers per head and reduces currentQty by exactly the head count sold', async () => {
    // A broiler batch auto-creates its per-head animal product (Live bird).
    const unitRes = await json(ownerC, '/api/data/units', { name: 'House A', type: 'HOUSE', capacity: 1000, species: 'broiler' });
    const unitId = (await unitRes.json()).id;
    const batchRes = await json(ownerC, '/api/data/batches', { name: 'Broiler B1', unitId, species: 'broiler', qty: 100, cost: 30000 });
    const batchId = (await batchRes.json()).id;

    const products = await (await api(`/api/products?batchId=${batchId}`, ownerC)).json();
    const animal = products.find((p: { isAnimalProduct?: boolean }) => p.isAnimalProduct);
    expect(animal).toBeTruthy(); // the animal itself was identified as a sellable product
    const unit = animal.saleUnits.find((u: { perBase: number }) => u.perBase === 1) ?? animal.saleUnits[0];

    // The endpoint the sale form reads must report the headcount basis (= live count),
    // not the harvested basis — otherwise the UI disables the Save button.
    const av = await (await api(`/api/availability?batchId=${batchId}&productId=${animal.id}`, ownerC)).json();
    expect(av.basis).toBe('headcount');
    expect(av.available).toBe(100);

    // Selling 40 head must SUCCEED — no "record the collection first" rejection.
    const sale = await json(ownerC, '/api/data/sales', { batchId, productId: animal.id, unitName: unit.name, quantity: 40, unitPrice: 600 });
    expect(sale.status).toBe(201);

    // Live count drops 100 → 60.
    const batch = await (await api(`/api/data/batches?id=${batchId}`, ownerC)).json();
    expect(batch.currentQty).toBe(60);

    // Cannot oversell beyond the surviving head; message is headcount-phrased.
    const over = await json(ownerC, '/api/data/sales', { batchId, productId: animal.id, unitName: unit.name, quantity: 9_999, unitPrice: 600 });
    expect(over.status).toBe(400);
    expect((await over.json()).error).toMatch(/left in this batch/i);
  });

  it('a layer batch auto-creates Eggs + Manure + the spent hen, and eggs cannot be sold before collection', async () => {
    const unitId = (await (await json(ownerC, '/api/data/units', { name: 'Layer House', type: 'HOUSE', capacity: 500, species: 'layer' })).json()).id;
    const batchId = (await (await json(ownerC, '/api/data/batches', { name: 'Layers L1', unitId, species: 'layer', qty: 200, cost: 80000 })).json()).id;

    // The egg product is auto-created (the Setup Guide's promise) — not added by hand.
    const products = await (await api(`/api/products?batchId=${batchId}`, ownerC)).json();
    const names = products.map((p: { name: string }) => p.name).sort();
    expect(names).toEqual(['Eggs', 'Manure', 'Spent hen']);
    const eggs = products.find((p: { name: string }) => p.name === 'Eggs');
    expect(eggs.isAnimalProduct).toBe(false);            // eggs are harvested, not head
    const spentHen = products.find((p: { name: string }) => p.name === 'Spent hen');
    expect(spentHen.isAnimalProduct).toBe(true);         // the bird itself sells by head
    const tray = eggs.saleUnits.find((u: { name: string; perBase: number }) => u.perBase === 30);
    expect(tray).toBeTruthy();

    // Availability for a harvested product reports the harvested basis at zero stock.
    const av = await (await api(`/api/availability?batchId=${batchId}&productId=${eggs.id}`, ownerC)).json();
    expect(av.basis).toBe('harvested');
    expect(av.available).toBe(0);

    const res = await json(ownerC, '/api/data/sales', { batchId, productId: eggs.id, unitName: tray.name, quantity: 1, unitPrice: 360 });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/record the collection first/i);

    // The egg sale must NOT have touched the live bird headcount.
    const batch = await (await api(`/api/data/batches?id=${batchId}`, ownerC)).json();
    expect(batch.currentQty).toBe(200);
  });

  it('recording a purchase creates stock (a lot) and shows up in purchases', async () => {
    // Regression: recordSale/Purchase used to POST to /api/data/purchases (no handler),
    // so "Record Purchase" silently failed and stock never appeared.
    const res = await json(ownerC, '/api/purchases', {
      itemId: '__new', itemName: 'Layer Mash', unit: 'kg', category: 'FEED_FINISHED',
      supplier: 'Pembe Ltd', quantity: 200, unitCost: 55,
    });
    expect(res.status).toBe(201);
    const { itemId, lotId } = await res.json();
    expect(itemId).toBeTruthy();
    expect(lotId).toBeTruthy();

    // The purchase is listed…
    const purchases = await (await api('/api/purchases', ownerC)).json();
    expect(purchases.some((p: { id: string; totalCost: number }) => p.totalCost === 11000)).toBe(true);
    // …and the stock (lot) exists on hand.
    const lots = await (await api('/api/data/lots', ownerC)).json();
    const lot = lots.find((l: { id: string }) => l.id === lotId);
    expect(lot?.qtyOnHand).toBe(200);
  });

  it('break-even on the live position matches the worked example (140, not 840)', async () => {
    // 100 birds, KSh 21,000 total cost; record 5 deaths and sell 70 head, leaving 25;
    // with KSh 17,500 already received the break-even on the 25 unsold is 140, and the
    // cost is spread over the 95 SURVIVORS (≈221), never the 25 left (which would be 840).
    const unitId = (await (await json(ownerC, '/api/data/units', { name: 'BE House', type: 'HOUSE', capacity: 200, species: 'broiler' })).json()).id;
    const batchId = (await (await json(ownerC, '/api/data/batches', { name: 'BE B1', unitId, species: 'broiler', qty: 100, cost: 21000 })).json()).id;
    const products = await (await api(`/api/products?batchId=${batchId}`, ownerC)).json();
    const animal = products.find((p: { isAnimalProduct?: boolean }) => p.isAnimalProduct);
    const unitName = (animal.saleUnits.find((u: { perBase: number }) => u.perBase === 1) ?? animal.saleUnits[0]).name;

    // Record 5 deaths via sync (mortality decrements the live count).
    await json(ownerC, '/api/sync', { records: [{ clientUuid: `be-mort-${batchId}`, type: 'mortality', capturedAt: new Date().toISOString(), payload: { batchId, count: 5 } }] });
    // Sell 70 head for 17,500 total (250 each).
    const sale = await json(ownerC, '/api/data/sales', { batchId, productId: animal.id, unitName, quantity: 70, unitPrice: 250 });
    expect(sale.status).toBe(201);

    const cost = await (await api(`/api/cost-summary?batchId=${batchId}`, ownerC)).json();
    expect(cost.survivors).toBe(95);                 // 100 − 5 died
    expect(cost.soldHead).toBe(70);
    expect(cost.remainingQty).toBe(25);              // 95 − 70 still on farm
    expect(cost.totalRevenue).toBe(17500);
    expect(cost.costPerBird).toBeCloseTo(221.05, 1); // 21000 ÷ 95 survivors — NOT ÷25 (=840)
    expect(cost.breakEvenPricePerRemaining).toBe(140); // (21000 − 17500) ÷ 25
  });
});

describe('worker salary + batch assignment → per-batch P&L', () => {
  let admin = '', owner = '', tenant = '', batchA = '', batchB = '';
  const email = `payroll+${Date.now()}@example.test`;
  let nextPhone = 254_799_000_000;
  const phone = () => `+${++nextPhone}`;

  // Salary allocated to a batch this month, read straight off its cost summary.
  const salaryOf = async (batchId: string) =>
    (await (await api(`/api/cost-summary?batchId=${batchId}`, owner)).json()).salaryCost;
  const empById = async (id: string) =>
    (await (await api('/api/data/employees', owner)).json()).find((e: { id: string }) => e.id === id);
  const addWorker = async (body: Record<string, unknown>) =>
    (await (await json(owner, '/api/data/employees', { phone: phone(), ...body })).json()).id;
  const deactivate = (id: string) =>
    api(`/api/data/employees?id=${id}`, owner, { method: 'PATCH', body: JSON.stringify({ active: false }) });

  beforeAll(async () => {
    admin = await login('admin@ifms.app', 'demo1234');
    tenant = (await (await json(admin, '/api/admin/tenants', { farmName: 'Payroll Farm', ownerName: 'PF', ownerEmail: email, ownerPassword: 'payroll1234', plan: 'pro' })).json()).id;
    owner = await login(email, 'payroll1234');
    // Two equal, freshly-acquired broiler batches (acquired today ⇒ 1 month active).
    const uA = (await (await json(owner, '/api/data/units', { name: 'HA', type: 'HOUSE', capacity: 200, species: 'broiler' })).json()).id;
    const uB = (await (await json(owner, '/api/data/units', { name: 'HB', type: 'HOUSE', capacity: 200, species: 'broiler' })).json()).id;
    batchA = (await (await json(owner, '/api/data/batches', { name: 'A', unitId: uA, species: 'broiler', qty: 100, cost: 0 })).json()).id;
    batchB = (await (await json(owner, '/api/data/batches', { name: 'B', unitId: uB, species: 'broiler', qty: 100, cost: 0 })).json()).id;
  });
  afterAll(async () => { if (tenant) await api(`/api/admin/tenants?id=${tenant}`, admin, { method: 'DELETE' }); });

  it('default assignment (all) splits a worker’s salary across batches by head', async () => {
    const id = await addWorker({ name: 'All-rounder', salary: 30000, payDay: 5, assignedBatchIds: null });
    expect(await salaryOf(batchA)).toBe(15000); // 30000 split 100:100 × 1 month
    expect(await salaryOf(batchB)).toBe(15000);
    expect((await empById(id)).assignedBatchIds).toBeNull(); // persisted as "all"
    await deactivate(id);
  });

  it('assigning a worker to ONE batch loads their whole salary onto it', async () => {
    const id = await addWorker({ name: 'Poultry only', salary: 20000, assignedBatchIds: [batchA] });
    expect(await salaryOf(batchA)).toBe(20000);
    expect(await salaryOf(batchB)).toBe(0);
    expect((await empById(id)).assignedBatchIds).toEqual([batchA]);
    await deactivate(id);
  });

  it('UNASSIGNING a batch (PATCH) moves the salary off it', async () => {
    const id = await addWorker({ name: 'Reassignable', salary: 10000, assignedBatchIds: null });
    expect(await salaryOf(batchA)).toBe(5000); // split first

    const res = await api(`/api/data/employees?id=${id}`, owner, { method: 'PATCH', body: JSON.stringify({ assignedBatchIds: [batchB] }) });
    expect(res.status).toBe(200);
    expect(await salaryOf(batchA)).toBe(0);      // unassigned → no labour load
    expect(await salaryOf(batchB)).toBe(10000);  // all of it lands on B
    expect((await empById(id)).assignedBatchIds).toEqual([batchB]);
    await deactivate(id);
  });

  it('a worker assigned to NO batch loads salary onto neither, but stays on the books', async () => {
    const id = await addWorker({ name: 'Unassigned', salary: 7000, assignedBatchIds: [] });
    expect(await salaryOf(batchA)).toBe(0);
    expect(await salaryOf(batchB)).toBe(0);
    const e = await empById(id);
    expect(e.assignedBatchIds).toEqual([]);
    expect(e.salary).toBe(7000); // still recorded (counts in the farm wage bill)
    await deactivate(id);
  });

  it('two workers with different assignments accumulate on the right batches', async () => {
    const a = await addWorker({ name: 'Both', salary: 20000, assignedBatchIds: null });     // 10k + 10k
    const b = await addWorker({ name: 'B-only', salary: 12000, assignedBatchIds: [batchB] }); // +12k to B
    expect(await salaryOf(batchA)).toBe(10000);
    expect(await salaryOf(batchB)).toBe(22000);
    await deactivate(a); await deactivate(b);
  });

  it('an out-of-range pay day is stored as null; salary still persists', async () => {
    const id = await addWorker({ name: 'Bad payday', salary: 8000, payDay: 99 });
    const e = await empById(id);
    expect(e.salary).toBe(8000);
    expect(e.payDay).toBeNull();
    await deactivate(id);
  });

  it('an inactive worker contributes no labour cost', async () => {
    const id = await addWorker({ name: 'Temp', salary: 50000, assignedBatchIds: null });
    expect(await salaryOf(batchA)).toBe(25000); // active → loads
    await deactivate(id);
    expect(await salaryOf(batchA)).toBe(0);     // deactivated → gone
  });
});

describe('dashboard + reports data integrity', () => {
  let admin = '', owner = '', tenant = '', batchId = '';
  const email = `reports+${Date.now()}@example.test`;
  const today = new Date().toISOString().slice(0, 10);
  const report = async (type: string, from = '2000-01-01', to = '2999-12-31') =>
    (await api(`/api/reports/${type}?from=${from}&to=${to}`, owner)).json();

  beforeAll(async () => {
    admin = await login('admin@ifms.app', 'demo1234');
    tenant = (await (await json(admin, '/api/admin/tenants', { farmName: 'Report Farm', ownerName: 'RF', ownerEmail: email, ownerPassword: 'report1234', plan: 'pro' })).json()).id;
    owner = await login(email, 'report1234');
    const unitId = (await (await json(owner, '/api/data/units', { name: 'RH', type: 'HOUSE', capacity: 200, species: 'broiler' })).json()).id;
    batchId = (await (await json(owner, '/api/data/batches', { name: 'R1', unitId, species: 'broiler', qty: 100, cost: 50000 })).json()).id;
    const products = await (await api(`/api/products?batchId=${batchId}`, owner)).json();
    const animal = products.find((p: { isAnimalProduct?: boolean }) => p.isAnimalProduct);
    const unitName = (animal.saleUnits.find((u: { perBase: number }) => u.perBase === 1) ?? animal.saleUnits[0]).name;
    await json(owner, '/api/sync', { records: [{ clientUuid: `rmort-${batchId}`, type: 'mortality', capturedAt: new Date().toISOString(), payload: { batchId, count: 4 } }] });
    await json(owner, '/api/data/sales', { batchId, productId: animal.id, unitName, quantity: 30, unitPrice: 600 }); // 18,000
  });
  afterAll(async () => { if (tenant) await api(`/api/admin/tenants?id=${tenant}`, admin, { method: 'DELETE' }); });

  it('dashboard KPIs reflect the live data exactly', async () => {
    const k = await (await api('/api/dashboard/kpis', owner)).json();
    expect(k.activeBatches).toBe(1);
    expect(k.totalBirds).toBe(66);          // 100 − 4 died − 30 sold
    expect(k.mortalityPct).toBe(4);          // 4 / 100
    expect(k.revenueThisMonth).toBe(18000);  // the sale, this month
    expect(k.grossMargin).toBe(-32000);      // 18,000 revenue − 50,000 acquisition cost
  });

  it('P&L report total cost EQUALS the batch cost-summary (no drift) and includes salaries', async () => {
    const cs = await (await api(`/api/cost-summary?batchId=${batchId}`, owner)).json();
    const pl = await report('pl');
    expect(pl.scope).toBe('lifecycle');
    expect(pl.columns).toContain('Salaries');
    const row = pl.rows.find((r: (string | number)[]) => r[0] === 'R1');
    expect(row).toBeTruthy();
    const totalCostCol = pl.columns.indexOf('Total Cost');
    expect(row[totalCostCol]).toBe(cs.totalCost);   // same number in Reports and on the batch page
    expect(cs.totalCost).toBe(50000);
    expect(pl.rows[pl.rows.length - 1][0]).toBe('TOTAL'); // bottom-line row present
  });

  it('transaction reports honour the date range; lifecycle reports ignore it', async () => {
    const salesToday = await report('sales', today, today);
    expect(salesToday.scope).toBe('range');
    expect(salesToday.rows.length).toBeGreaterThan(0); // the sale falls today

    const salesPast = await report('sales', '2020-01-01', '2020-01-02');
    expect(salesPast.rows.length).toBe(0);             // nothing in 2020

    const plPast = await report('pl', '2020-01-01', '2020-01-02');
    expect(plPast.scope).toBe('lifecycle');
    expect(plPast.rows.find((r: (string | number)[]) => r[0] === 'R1')).toBeTruthy(); // still there
  });

  it('period summary nets date-filtered revenue against expenses', async () => {
    const wide = await report('baseline', '2000-01-01', today);
    const map = Object.fromEntries(wide.rows as [string, number][]);
    expect(map['Revenue']).toBe(18000);
    expect(map['Stock acquired']).toBe(50000);        // batch acquired today, in range
    expect(map['Net for period']).toBe(map['Revenue'] - map['Total expenses']);
  });
});

describe('guided acceptance testing (UAT)', () => {
  let admin = '', owner = '', tenant = '';
  const email = `uat+${Date.now()}@example.test`;
  const getTesting = async () => (await api('/api/testing', owner)).json();
  const post = (body: Record<string, unknown>) => json(owner, '/api/testing', body);
  const adminPost = (body: Record<string, unknown>) => json(admin, '/api/admin/testing', body);

  beforeAll(async () => {
    admin = await login('admin@ifms.app', 'demo1234');
    tenant = (await (await json(admin, '/api/admin/tenants', { farmName: 'UAT Farm', ownerName: 'UF', ownerEmail: email, ownerPassword: 'uattest1234', plan: 'pro' })).json()).id;
    owner = await login(email, 'uattest1234');
  });
  afterAll(async () => { if (tenant) await api(`/api/admin/tenants?id=${tenant}`, admin, { method: 'DELETE' }); });

  it('is OFF by default — the farmer cannot start', async () => {
    const g = await getTesting();
    expect(g.enabled).toBe(false);
    expect(g.run).toBeNull();
    expect((await post({ action: 'start' })).status).toBe(403);
  });

  it('admin enables testing → farmer can start a fresh checklist', async () => {
    expect((await adminPost({ tenantId: tenant, action: 'enable' })).status).toBe(200);
    const g = await getTesting();
    expect(g.enabled).toBe(true);
    expect(g.run).toBeNull(); // enabled but not yet started

    const started = await (await post({ action: 'start' })).json();
    expect(started.run.status).toBe('in_progress');
    expect(started.run.steps.length).toBeGreaterThan(0);
    expect(started.run.steps.every((s: { status: string }) => s.status === 'pending')).toBe(true);
  });

  it('a FAILED step is rejected without an explanation, accepted with one', async () => {
    const noNote = await post({ action: 'step', id: 'login', status: 'fail' });
    expect(noNote.status).toBe(400);
    expect((await noNote.json()).error).toMatch(/describe what went wrong/i);

    expect((await post({ action: 'step', id: 'login', status: 'fail', note: 'blank screen after sign-in' })).status).toBe(200);
    const run = (await getTesting()).run;
    expect(run.steps.find((s: { id: string }) => s.id === 'login').note).toBe('blank screen after sign-in');
  });

  it('cannot submit until every step is answered; then the admin receives the report', async () => {
    // Only 'login' answered so far → submit blocked.
    const early = await post({ action: 'submit' });
    expect(early.status).toBe(400);
    expect((await early.json()).error).toMatch(/answer every step/i);

    // Answer the rest as pass.
    const steps = (await getTesting()).run.steps as { id: string; status: string }[];
    for (const s of steps) if (s.status === 'pending') await post({ action: 'step', id: s.id, status: 'pass' });

    const submitted = await (await post({ action: 'submit' })).json();
    expect(submitted.run.status).toBe('submitted');
    expect(submitted.report.failed).toBe(1);
    expect(submitted.report.passed).toBe(submitted.report.total - 1);

    // Admin sees the submitted report with the farmer's failure note.
    const list = await (await api('/api/admin/testing', admin)).json();
    const farm = list.tenants.find((t: { tenantId: string }) => t.tenantId === tenant);
    expect(farm.run.status).toBe('submitted');
    expect(farm.run.report.failures.find((f: { id: string }) => f.id === 'login').note).toBe('blank screen after sign-in');
  });

  it('admin can request a re-test (resets the checklist) and disable testing entirely', async () => {
    expect((await adminPost({ tenantId: tenant, action: 'request' })).status).toBe(200);
    const reset = (await getTesting()).run;
    expect(reset.status).toBe('in_progress');
    expect(reset.steps.every((s: { status: string }) => s.status === 'pending')).toBe(true); // fresh again

    expect((await adminPost({ tenantId: tenant, action: 'disable' })).status).toBe(200);
    expect((await getTesting()).enabled).toBe(false);
    expect((await post({ action: 'start' })).status).toBe(403); // blocked once disabled
  });

  it('admin can EDIT the checklist; a farmer\'s new run uses the edited steps', async () => {
    // Capture the current (default) checklist so we can restore it afterwards.
    const orig = (await (await api('/api/admin/testing', admin)).json()).steps as { area: string; title: string; instruction: string }[];
    try {
      // Save a custom 2-step checklist; ids are derived & de-duplicated server-side.
      const saved = await json(admin, '/api/admin/testing', { action: 'save-steps', steps: [
        { area: 'Smoke', title: 'Open the app', instruction: 'Just open it' },
        { area: 'Smoke', title: 'Open the app', instruction: 'Open it again' },
      ] });
      expect(saved.status).toBe(200);
      const adminView = (await (await api('/api/admin/testing', admin)).json()).steps;
      expect(adminView.map((s: { id: string }) => s.id)).toEqual(['open_the_app', 'open_the_app_2']);

      // A bad edit (no title) is rejected with a clear message.
      const bad = await json(admin, '/api/admin/testing', { action: 'save-steps', steps: [{ area: 'X', title: '', instruction: 'y' }] });
      expect(bad.status).toBe(400);
      expect((await bad.json()).error).toMatch(/needs a title/i);

      // The farmer's fresh run now uses the edited checklist.
      await adminPost({ tenantId: tenant, action: 'enable' });
      const run = (await (await post({ action: 'start' })).json()).run;
      expect(run.steps.map((s: { id: string }) => s.id)).toEqual(['open_the_app', 'open_the_app_2']);
      expect(run.steps[0].title).toBe('Open the app');
    } finally {
      // Restore the default checklist so other runs of the gate aren't affected.
      await json(admin, '/api/admin/testing', { action: 'save-steps', steps: orig });
    }
  });

  it('screenshots: respects the per-step max, only on failed steps, and admin can view & delete', async () => {
    const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    const stepOf = async (id: string) => ((await getTesting()).run.steps as { id: string; photoIds?: string[] }[]).find(s => s.id === id);

    // Admin enables with up to 2 screenshots/step; farmer starts a fresh default run.
    expect((await adminPost({ tenantId: tenant, action: 'enable', maxScreenshots: 2 })).status).toBe(200);
    expect((await getTesting()).maxScreenshots).toBe(2);
    await post({ action: 'start' });
    await post({ action: 'step', id: 'login', status: 'fail', note: 'blank screen' });

    // Two screenshots OK; the third is rejected.
    expect((await post({ action: 'photo', stepId: 'login', data: PNG })).status).toBe(201);
    expect((await post({ action: 'photo', stepId: 'login', data: PNG })).status).toBe(201);
    const third = await post({ action: 'photo', stepId: 'login', data: PNG });
    expect(third.status).toBe(400);
    expect((await third.json()).error).toMatch(/up to 2 screenshot/i);
    expect((await stepOf('login'))!.photoIds).toHaveLength(2);

    // A screenshot on a not-failed step is rejected.
    const onPending = await post({ action: 'photo', stepId: 'dashboard', data: PNG });
    expect(onPending.status).toBe(400);
    expect((await onPending.json()).error).toMatch(/marked as failed/i);

    // Non-image data is rejected.
    expect((await post({ action: 'photo', stepId: 'login', data: 'not-an-image' })).status).toBe(400);

    // Admin sees the two screenshot ids on the failure, can fetch one, and delete it.
    let list = await (await api('/api/admin/testing', admin)).json();
    let farm = list.tenants.find((t: { tenantId: string }) => t.tenantId === tenant);
    const ids = farm.run.report.failures.find((f: { id: string }) => f.id === 'login').photoIds;
    expect(ids).toHaveLength(2);

    const got = await api(`/api/admin/testing/photo?id=${ids[0]}`, admin);
    expect(got.status).toBe(200);
    expect((await got.json()).data).toMatch(/^data:image\//);

    expect((await api(`/api/admin/testing/photo?id=${ids[0]}`, admin, { method: 'DELETE' })).status).toBe(200);
    // Deleted from both the photo store and the run's step.
    expect((await api(`/api/admin/testing/photo?id=${ids[0]}`, admin)).status).toBe(404);
    list = await (await api('/api/admin/testing', admin)).json();
    farm = list.tenants.find((t: { tenantId: string }) => t.tenantId === tenant);
    expect(farm.run.report.failures.find((f: { id: string }) => f.id === 'login').photoIds).toHaveLength(1);

    // Un-failing the step drops its remaining screenshot too.
    await post({ action: 'step', id: 'login', status: 'pass' });
    expect((await api(`/api/admin/testing/photo?id=${ids[1]}`, admin)).status).toBe(404);
    expect((await stepOf('login'))!.photoIds).toBeUndefined();
  });
});
