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

  it('a new farm cannot read another farm’s batch by id', async () => {
    const owner = await login('kutswa@ifms.farm', 'demo1234');
    const batches = await (await api('/api/data/batches', owner)).json();
    if (!Array.isArray(batches) || !batches.length) return; // nothing to probe
    const res = await api(`/api/data/batches?id=${batches[0].id}`, ownerB);
    expect(res.status).toBe(404);
  });

  it('refuses to sell more of a product than was collected', async () => {
    const owner = await login('kutswa@ifms.farm', 'demo1234');
    const batches = await (await api('/api/data/batches', owner)).json();
    if (!Array.isArray(batches) || !batches.length) return;
    for (const b of batches) {
      const products = await (await api(`/api/products?batchId=${b.id}`, owner)).json();
      const p = Array.isArray(products) ? products.find((x: { flow: string }) => x.flow === 'sale') : null;
      if (!p) continue;
      const unit = p.saleUnits?.[0];
      const res = await json(owner, '/api/data/sales', { batchId: b.id, productId: p.id, productType: p.name, unitName: unit?.name, quantity: 9_999_999, unitPrice: 1 });
      expect(res.status).toBe(400);
      expect((await res.json()).error).toMatch(/available to sell/i);
      return; // one is enough
    }
  });
});
