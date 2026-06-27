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

  it('a worker CAN read operational alerts (home page needs them) but cannot acknowledge', async () => {
    const worker = await login('+254700333444', '1234');
    const read = await api('/api/data/alerts', worker);
    expect(read.status).toBe(200);
    expect(Array.isArray(await read.json())).toBe(true);
    // …but acknowledging an alert stays owner/manager only.
    const ack = await api('/api/data/alerts?id=anything', worker, { method: 'PATCH', body: JSON.stringify({ acknowledged: true }) });
    expect(ack.status).toBe(403);
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

  it('a health/vaccine record draws its medicine lot down — and never goes negative', async () => {
    const { lotId } = await (await json(ownerC, '/api/purchases', {
      itemId: '__new', itemName: 'Newcastle Vaccine', unit: 'dose', category: 'VACCINE',
      supplier: 'VetCo', quantity: 100, unitCost: 5,
    })).json();
    const unitId = (await (await json(ownerC, '/api/data/units', { name: 'HX-U', type: 'HOUSE', capacity: 50, species: 'broiler' })).json()).id;
    const batchId = (await (await json(ownerC, '/api/data/batches', { name: 'HX B', unitId, species: 'broiler', qty: 30, cost: 0 })).json()).id;
    const lotQty = async () => (await (await api('/api/data/lots', ownerC)).json()).find((l: { id: string }) => l.id === lotId).qtyOnHand;

    // Administer 40 doses → 100 − 40 = 60 on hand.
    await json(ownerC, '/api/sync', { records: [{ clientUuid: `hx1-${lotId}`, type: 'health', capturedAt: new Date().toISOString(), payload: { batchId, type: 'VACCINE', productLotId: lotId, quantity: 40 } }] });
    expect(await lotQty()).toBe(60);

    // Over-administer 1000 → clamps to 0 (never negative), even though more was logged.
    await json(ownerC, '/api/sync', { records: [{ clientUuid: `hx2-${lotId}`, type: 'health', capturedAt: new Date().toISOString(), payload: { batchId, type: 'VACCINE', productLotId: lotId, quantity: 1000 } }] });
    expect(await lotQty()).toBe(0);
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

describe('per-batch labour comes from ACTUAL payroll (assignment-aware)', () => {
  let admin = '', owner = '', tenant = '', batchA = '', batchB = '', worker = '';
  const email = `labour+${Date.now()}@example.test`;

  const salaryOf = async (batchId: string) =>
    (await (await api(`/api/cost-summary?batchId=${batchId}`, owner)).json()).salaryCost;
  const runPayroll = (period: string) => json(owner, '/api/payroll', { action: 'run', period });
  const reassign = (ids: string[] | null) => api(`/api/data/employees?id=${worker}`, owner, { method: 'PATCH', body: JSON.stringify({ assignedBatchIds: ids }) });

  beforeAll(async () => {
    admin = await login('admin@ifms.app', 'demo1234');
    tenant = (await (await json(admin, '/api/admin/tenants', { farmName: 'Labour Farm', ownerName: 'LF', ownerEmail: email, ownerPassword: 'labour1234', plan: 'pro' })).json()).id;
    owner = await login(email, 'labour1234');
    const uA = (await (await json(owner, '/api/data/units', { name: 'HA', type: 'HOUSE', capacity: 200, species: 'broiler' })).json()).id;
    const uB = (await (await json(owner, '/api/data/units', { name: 'HB', type: 'HOUSE', capacity: 200, species: 'broiler' })).json()).id;
    batchA = (await (await json(owner, '/api/data/batches', { name: 'A', unitId: uA, species: 'broiler', qty: 100, cost: 0 })).json()).id;
    batchB = (await (await json(owner, '/api/data/batches', { name: 'B', unitId: uB, species: 'broiler', qty: 100, cost: 0 })).json()).id;
    worker = (await (await json(owner, '/api/data/employees', { name: 'Hand', phone: `+254799${String(Date.now()).slice(-6)}`, role: 'worker', salary: 30000, assignedBatchIds: null })).json()).id;
  });
  afterAll(async () => { if (tenant) await api(`/api/admin/tenants?id=${tenant}`, admin, { method: 'DELETE' }); });

  it('a batch has NO labour cost until payroll is actually run (not an estimate)', async () => {
    expect(await salaryOf(batchA)).toBe(0);
    expect(await salaryOf(batchB)).toBe(0);
  });

  it('running payroll spreads the worker\'s paid gross across their batches by head', async () => {
    expect((await runPayroll('2026-01')).status).toBe(200);
    expect(await salaryOf(batchA)).toBe(15000); // 30000 split 100:100
    expect(await salaryOf(batchB)).toBe(15000);
  });

  it('re-assigning the worker moves that paid labour to the new batch', async () => {
    expect((await reassign([batchA])).status).toBe(200);
    expect(await salaryOf(batchA)).toBe(30000); // all of the paid gross now on A
    expect(await salaryOf(batchB)).toBe(0);
  });

  it('a second paid month ACCUMULATES (cumulative labour)', async () => {
    expect((await runPayroll('2026-02')).status).toBe(200); // worker now assigned to A
    expect(await salaryOf(batchA)).toBe(60000); // two months × 30000
  });

  it('deactivating the worker does NOT erase already-incurred labour (it was really paid)', async () => {
    await api(`/api/data/employees?id=${worker}`, owner, { method: 'PATCH', body: JSON.stringify({ active: false }) });
    expect(await salaryOf(batchA)).toBe(60000); // the wages stay on the books
  });

  it('an out-of-range pay day is stored as null; salary still persists', async () => {
    const id = (await (await json(owner, '/api/data/employees', { name: 'PD', phone: `+254798${String(Date.now()).slice(-6)}`, salary: 8000, payDay: 99 })).json()).id;
    const e = (await (await api('/api/data/employees', owner)).json()).find((x: { id: string }) => x.id === id);
    expect(e.salary).toBe(8000);
    expect(e.payDay).toBeNull();
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

describe('system audit log', () => {
  let admin = '';
  const email = `audit+${Date.now()}@example.test`;
  beforeAll(async () => { admin = await login('admin@ifms.app', 'demo1234'); });

  it('records farm lifecycle actions and KEEPS them after the farm is deleted', async () => {
    const tenant = (await (await json(admin, '/api/admin/tenants', { farmName: 'Audit Farm', ownerName: 'AF', ownerEmail: email, ownerPassword: 'audit1234', plan: 'pro' })).json()).id;

    let log = await (await api(`/api/admin/audit?tenantId=${tenant}`, admin)).json();
    const created = log.entries.find((e: { action: string }) => e.action === 'tenant.create');
    expect(created).toBeTruthy();
    expect(created.actor).toMatch(/super_admin/);

    // Suspend → recorded as its own action.
    await api(`/api/admin/tenants?id=${tenant}`, admin, { method: 'PATCH', body: JSON.stringify({ active: false }) });
    log = await (await api(`/api/admin/audit?tenantId=${tenant}`, admin)).json();
    expect(log.entries.some((e: { action: string }) => e.action === 'tenant.suspend')).toBe(true);

    // Delete the farm → its audit trail must REMAIN (forensic record).
    expect((await api(`/api/admin/tenants?id=${tenant}`, admin, { method: 'DELETE' })).status).toBe(200);
    log = await (await api(`/api/admin/audit?tenantId=${tenant}`, admin)).json();
    const del = log.entries.find((e: { action: string }) => e.action === 'tenant.delete');
    expect(del).toBeTruthy();
    expect(del.farm).toMatch(/deleted/i);                                   // labelled as a deleted farm
    expect(log.entries.some((e: { action: string }) => e.action === 'tenant.create')).toBe(true); // history preserved
  });

  it('is super-admin only', async () => {
    const owner = await login('kutswa@ifms.farm', 'demo1234');
    expect((await api('/api/admin/audit', owner)).status).toBe(403);
  });
});

describe('editable packages', () => {
  let admin = '';
  const email = `pkg+${Date.now()}@example.test`;
  beforeAll(async () => { admin = await login('admin@ifms.app', 'demo1234'); });

  it('saves custom packages and a new farm inherits the package features', async () => {
    const orig = (await (await api('/api/admin/packages', admin)).json()).packages;
    try {
      const saved = await json(admin, '/api/admin/packages', { packages: [
        { name: 'Lite', features: ['finance'], price: 500 },
        { name: 'Max', features: ['finance', 'reports', 'alerts'], price: 3000 },
      ] });
      expect(saved.status).toBe(200);
      expect((await saved.json()).packages.map((p: { id: string }) => p.id)).toEqual(['lite', 'max']);

      // A farm created on 'lite' must get exactly that package's features.
      const tid = (await (await json(admin, '/api/admin/tenants', { farmName: 'Pkg Farm', ownerName: 'PF', ownerEmail: email, ownerPassword: 'pkg12345', plan: 'lite' })).json()).id;
      const farms = await (await api('/api/admin/tenants', admin)).json();
      const farm = farms.find((t: { id: string }) => t.id === tid);
      expect(farm.plan).toBe('lite');
      expect(farm.features).toEqual(['finance']);

      // A nameless package is rejected.
      const bad = await json(admin, '/api/admin/packages', { packages: [{ name: '', features: [] }] });
      expect(bad.status).toBe(400);
      expect((await bad.json()).error).toMatch(/needs a name/i);

      await api(`/api/admin/tenants?id=${tid}`, admin, { method: 'DELETE' });
    } finally {
      await json(admin, '/api/admin/packages', { packages: orig });
    }
  });

  it('is super-admin only', async () => {
    const owner = await login('kutswa@ifms.farm', 'demo1234');
    expect((await api('/api/admin/packages', owner)).status).toBe(403);
  });
});

describe('payroll — runs, advances/fines, immutable paid months', () => {
  let admin = '', owner = '', tenant = '', empId = '';
  const email = `payroll2+${Date.now()}@example.test`;
  const phone = `+254788${String(Date.now()).slice(-6)}`;
  const period = '2026-06', next = '2026-07';

  beforeAll(async () => {
    admin = await login('admin@ifms.app', 'demo1234');
    tenant = (await (await json(admin, '/api/admin/tenants', { farmName: 'Pay Farm', ownerName: 'PF', ownerEmail: email, ownerPassword: 'payroll1234', plan: 'pro' })).json()).id;
    owner = await login(email, 'payroll1234');
    empId = (await (await json(owner, '/api/data/employees', { name: 'Worker A', phone, role: 'worker', salary: 18000 })).json()).id;
  });
  afterAll(async () => { if (tenant) await api(`/api/admin/tenants?id=${tenant}`, admin, { method: 'DELETE' }); });

  const slipFor = async (p: string) => (await (await api(`/api/payroll?period=${p}`, owner)).json()).employees.find((e: { id: string }) => e.id === empId);

  it('run snapshots gross; advances & fines reduce net; fines are income', async () => {
    await json(owner, '/api/payroll', { action: 'ledger', employeeId: empId, period, type: 'advance', amount: 5000 });
    await json(owner, '/api/payroll', { action: 'ledger', employeeId: empId, period, type: 'fine', amount: 1000, note: 'lateness' });
    expect((await json(owner, '/api/payroll', { action: 'run', period })).status).toBe(200);

    const g = await (await api(`/api/payroll?period=${period}`, owner)).json();
    const row = g.employees.find((e: { id: string }) => e.id === empId);
    expect(row.payslip.gross).toBe(18000);
    expect(row.payslip.advances).toBe(5000);
    expect(row.payslip.fines).toBe(1000);
    expect(row.payslip.net).toBe(12000);          // 18000 − 5000 − 1000
    expect(g.summary.fines).toBe(1000);            // fines counted as farm income
  });

  it('a PAID month is locked and immune to later salary changes', async () => {
    expect((await json(owner, '/api/payroll', { action: 'pay', period, employeeId: empId })).status).toBe(200);
    expect((await slipFor(period)).payslip.status).toBe('paid');

    // Can't add a ledger entry to a paid month.
    const blocked = await json(owner, '/api/payroll', { action: 'ledger', employeeId: empId, period, type: 'fine', amount: 500 });
    expect(blocked.status).toBe(400);
    expect((await blocked.json()).error).toMatch(/locked|already paid/i);

    // Raise the salary, then re-run — the PAID month must NOT change.
    await api(`/api/data/employees?id=${empId}`, owner, { method: 'PATCH', body: JSON.stringify({ salary: 25000 }) });
    await json(owner, '/api/payroll', { action: 'run', period });
    const paid = await slipFor(period);
    expect(paid.payslip.gross).toBe(18000);        // snapshot preserved
    expect(paid.payslip.net).toBe(12000);
    expect(paid.payslip.status).toBe('paid');

    // But a NEW month uses the new salary.
    await json(owner, '/api/payroll', { action: 'run', period: next });
    expect((await slipFor(next)).payslip.gross).toBe(25000);
  });

  it('year statement totals the months', async () => {
    const st = await (await api(`/api/payroll/statement?employeeId=${empId}&year=2026`, owner)).json();
    expect(st.totals.months).toBe(2);             // June + July
    expect(st.payslips.find((p: { period: string }) => p.period === period).net).toBe(12000);
  });

  it('payroll is owner/manager only (workers cannot)', async () => {
    const worker = await login('+254700333444', '1234');
    expect((await api('/api/payroll', worker)).status).toBe(403);
  });
});

describe('employee logins, worker profiles & task assignment', () => {
  let admin = '', owner = '', tenant = '', profileId = '';
  const email = `staff+${Date.now()}@example.test`;
  const stamp = String(Date.now()).slice(-6);
  const wPhone = `+254766${stamp}`;
  const noPinPhone = `+254744${stamp}`;
  const mPhone = `+254755${stamp}`;
  const mEmail = `mgr+${Date.now()}@example.test`;

  beforeAll(async () => {
    admin = await login('admin@ifms.app', 'demo1234');
    tenant = (await (await json(admin, '/api/admin/tenants', { farmName: 'Staff Farm', ownerName: 'SF', ownerEmail: email, ownerPassword: 'staff1234', plan: 'pro' })).json()).id;
    owner = await login(email, 'staff1234');
  });
  afterAll(async () => { if (tenant) await api(`/api/admin/tenants?id=${tenant}`, admin, { method: 'DELETE' }); });

  it('a brand-new tenant is seeded with a default worker profile', async () => {
    const profs = await (await api('/api/data/worker-profiles', owner)).json();
    expect(profs.length).toBeGreaterThan(0);
    expect(profs.find((p: { name: string }) => p.name === 'Standard Worker')).toBeTruthy();
    profileId = profs[0].id;
  });

  it('adding a worker WITH a PIN creates a login that can actually sign in', async () => {
    const res = await json(owner, '/api/data/employees', { name: 'Field Hand', phone: wPhone, role: 'worker', salary: 12000, pin: '4321', workerProfileId: profileId });
    expect(res.status).toBe(201);
    const emp = (await (await api('/api/data/employees', owner)).json()).find((e: { phone: string }) => e.phone === wPhone);
    expect(emp.pinSet).toBe(true);
    expect(emp.workerProfileId).toBe(profileId);
    const signIn = await rawLogin(wPhone, '4321');
    expect(signIn.status).toBe(200);
    expect((await signIn.json()).user.role).toBe('worker');
  });

  it('a second login on the same phone is rejected', async () => {
    const dup = await json(owner, '/api/data/employees', { name: 'Dup', phone: wPhone, role: 'worker', salary: 5000, pin: '1111' });
    expect(dup.status).toBe(400);
    expect((await dup.json()).error).toMatch(/already has a login/i);
  });

  it('owner assigns a task and the worker sees ONLY their own tasks', async () => {
    const workers = await (await api('/api/workers', owner)).json();
    const w = workers.find((x: { phone: string }) => x.phone === wPhone);
    expect(w).toBeTruthy();
    const t = await json(owner, '/api/data/tasks', { title: 'Vaccinate Batch A', type: 'vaccination', assignedTo: w.id, dueAt: new Date().toISOString(), scheduledFor: new Date().toISOString() });
    expect(t.status).toBe(201);
    const wCookie = await login(wPhone, '4321');
    const wTasks = await (await api('/api/data/tasks', wCookie)).json();
    expect(wTasks.some((x: { title: string }) => x.title === 'Vaccinate Batch A')).toBe(true);
    expect(wTasks.every((x: { assignedTo: string }) => x.assignedTo === w.id)).toBe(true);
  });

  it('a worker added without a PIN cannot sign in until the owner sets one', async () => {
    const created = await json(owner, '/api/data/employees', { name: 'No Pin', phone: noPinPhone, role: 'worker', salary: 8000 });
    expect(created.status).toBe(201);
    const empId = (await created.json()).id;
    expect((await rawLogin(noPinPhone, '0000')).status).toBe(401); // no login yet
    expect((await api(`/api/data/employees?id=${empId}`, owner, { method: 'PATCH', body: JSON.stringify({ pin: '9999' }) })).status).toBe(200);
    const r = await rawLogin(noPinPhone, '9999');
    expect(r.status).toBe(200);
    expect((await r.json()).user.role).toBe('worker');
  });

  it('a manager added with email + password can sign in via the unified login', async () => {
    const created = await json(owner, '/api/data/employees', { name: 'Ops Lead', phone: mPhone, role: 'manager', email: mEmail, password: 'manager1234' });
    expect(created.status).toBe(201);
    const r = await rawLogin(mEmail, 'manager1234');
    expect(r.status).toBe(200);
    expect((await r.json()).user.role).toBe('manager');
  });

  it('editing a worker profile SAVES and round-trips (the Save Profile path)', async () => {
    type Field = { fieldKey: string; label: string; permission: string; required?: boolean };
    const before = (await (await api('/api/data/worker-profiles', owner)).json()).find((p: { id: string }) => p.id === profileId);
    const newFields = before.fields.map((f: Field) => (f.fieldKey === 'feed_quantity' ? { ...f, permission: 'hidden' } : f));
    const res = await api(`/api/data/worker-profiles?id=${profileId}`, owner, { method: 'PATCH', body: JSON.stringify({ fields: newFields, mortalityPhotoThreshold: 4 }) });
    expect(res.status).toBe(200);
    // Re-fetch from the DB and confirm the edit actually persisted.
    const after = (await (await api('/api/data/worker-profiles', owner)).json()).find((p: { id: string }) => p.id === profileId);
    expect(after.fields.find((f: Field) => f.fieldKey === 'feed_quantity').permission).toBe('hidden');
    expect(after.mortalityPhotoThreshold).toBe(4);
  });
});

describe('morning-round eggs become sellable stock, and the sale is capped', () => {
  let admin = '', owner = '', tenant = '', batchId = '', eggProductId = '', eggUnit = '';
  const email = `eggs+${Date.now()}@example.test`;

  beforeAll(async () => {
    admin = await login('admin@ifms.app', 'demo1234');
    tenant = (await (await json(admin, '/api/admin/tenants', { farmName: 'Egg Farm', ownerName: 'EF', ownerEmail: email, ownerPassword: 'eggs1234', plan: 'pro' })).json()).id;
    owner = await login(email, 'eggs1234');
    const unitId = (await (await json(owner, '/api/data/units', { name: 'LH', type: 'HOUSE', capacity: 500, species: 'layer' })).json()).id;
    batchId = (await (await json(owner, '/api/data/batches', { name: 'Layers', unitId, species: 'layer', qty: 300, cost: 0 })).json()).id;
    const products = await (await api(`/api/products?batchId=${batchId}`, owner)).json();
    const eggs = products.find((p: { name: string }) => p.name.toLowerCase() === 'eggs');
    eggProductId = eggs.id;
    eggUnit = (eggs.saleUnits.find((u: { perBase: number }) => u.perBase === 1) ?? eggs.saleUnits[0]).name; // a single piece
  });
  afterAll(async () => { if (tenant) await api(`/api/admin/tenants?id=${tenant}`, admin, { method: 'DELETE' }); });

  const avail = async () => (await (await api(`/api/availability?batchId=${batchId}&productId=${eggProductId}`, owner)).json()).available;

  it('before any collection, nothing is sellable', async () => {
    expect(await avail()).toBe(0);
  });

  it('a morning round with 400 eggs makes 400 available to sell', async () => {
    await json(owner, '/api/sync', { records: [{
      clientUuid: `mr-${batchId}`, type: 'morning_round', capturedAt: new Date().toISOString(),
      payload: { entries: [{ batchId, eggsCollected: '400', waterLevel: 'OK', abnormal: false }] },
    }] });
    expect(await avail()).toBe(400);
  });

  it('cannot sell MORE eggs than were collected', async () => {
    const over = await json(owner, '/api/data/sales', { batchId, productId: eggProductId, unitName: eggUnit, quantity: 401, unitPrice: 10 });
    expect(over.status).toBe(400);
    expect((await over.json()).error).toMatch(/available to sell/i);
  });

  it('selling within stock works and reduces what is left', async () => {
    const ok = await json(owner, '/api/data/sales', { batchId, productId: eggProductId, unitName: eggUnit, quantity: 250, unitPrice: 10 });
    expect(ok.status).toBe(201);
    expect(await avail()).toBe(150); // 400 collected − 250 sold
  });

  it('rejects an unknown sale unit (no silent under-count past the cap)', async () => {
    const bad = await json(owner, '/api/data/sales', { batchId, productId: eggProductId, unitName: 'Bucketload', quantity: 1, unitPrice: 10 });
    expect(bad.status).toBe(400);
    expect((await bad.json()).error).toMatch(/unknown sale unit/i);
  });
});
