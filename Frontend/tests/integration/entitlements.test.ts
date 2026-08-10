import { describe, it, expect, beforeAll, afterAll } from 'vitest';

// #29: plan entitlements (`tenants.features`) used to be enforced only in the
// client (app/owner/layout.tsx filtering nav items) — no API route checked
// them, so a downgraded/free-plan tenant could curl a gated endpoint and get
// a full response. This suite proves the server-side gate end to end against
// a REAL running app + REAL Postgres (see lib/server/entitlements.ts and the
// mock-level coverage in tests/unit/entitlements.test.ts, which is what
// actually runs in the `pnpm test:unit` CI gate before the app is even built).
//
// Self-contained: does not import or extend tests/integration/api.test.ts so
// it can't collide with other work touching that file.

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

describe('server-side plan entitlements (#29)', () => {
  let admin = '', owner = '', tenant = '';
  const email = `entitle+${Date.now()}@example.test`;

  beforeAll(async () => {
    admin = await login('admin@ifms.app', 'demo1234');
    // Onboard on 'pro' (every feature) then explicitly strip features to an
    // empty array via the admin PATCH endpoint — independent of whatever the
    // 'free'/'standard'/'pro' packages currently resolve to (an admin may have
    // edited them), this directly simulates "a tenant whose plan includes
    // none of the gated features", i.e. a downgraded/free-plan farm.
    const res = await json(admin, '/api/admin/tenants', {
      farmName: 'Entitlement Test Farm', ownerName: 'ET', ownerEmail: email, ownerPassword: 'entitle1234', plan: 'pro',
    });
    tenant = (await res.json()).id;
    const patch = await api(`/api/admin/tenants?id=${tenant}`, admin, {
      method: 'PATCH', body: JSON.stringify({ features: [] }),
    });
    expect(patch.status).toBe(200);
    owner = await login(email, 'entitle1234');
  });
  afterAll(async () => { if (tenant) await api(`/api/admin/tenants?id=${tenant}`, admin, { method: 'DELETE' }); });

  it('GET /api/reports/pl returns 403 for a tenant without the `reports` feature', async () => {
    const res = await api('/api/reports/pl?from=2000-01-01&to=2999-12-31', owner);
    expect(res.status).toBe(403);
    expect((await res.json()).errorCode).toBe('AUTH_FORBIDDEN');
  });

  it('POST /api/ai/advise returns 403 for a tenant without the `ai_advisor` feature (never reaches the paid LLM call)', async () => {
    const res = await json(owner, '/api/ai/advise', { messages: [{ role: 'user', content: 'how are my birds doing?' }] });
    expect(res.status).toBe(403);
    expect((await res.json()).errorCode).toBe('AUTH_FORBIDDEN');
  });

  it('POST /api/alerts/evaluate returns 403 for a tenant without the `alerts` feature', async () => {
    const res = await json(owner, '/api/alerts/evaluate', {});
    expect(res.status).toBe(403);
    expect((await res.json()).errorCode).toBe('AUTH_FORBIDDEN');
  });

  it('GET and PUT /api/alert-rules return 403 for a tenant without the `alerts` feature', async () => {
    expect((await api('/api/alert-rules', owner)).status).toBe(403);
    expect((await json(owner, '/api/alert-rules', { rules: [] }, 'PUT')).status).toBe(403);
  });

  it('GET /api/worker-activity returns 403 for a tenant without the `activity_log` feature', async () => {
    const res = await api('/api/worker-activity', owner);
    expect(res.status).toBe(403);
  });

  it('an UNGATED endpoint (finance, on every plan including free) still works for the same downgraded tenant', async () => {
    // Guards against the gate being too broad (denying everything for a
    // downgraded tenant instead of just the paywalled features).
    const res = await api('/api/data/batches', owner);
    expect(res.status).toBe(200);
  });

  it('re-enabling the feature un-blocks the same route for the same tenant', async () => {
    expect((await api('/api/reports/pl?from=2000-01-01&to=2999-12-31', owner)).status).toBe(403);
    const patch = await api(`/api/admin/tenants?id=${tenant}`, admin, {
      method: 'PATCH', body: JSON.stringify({ features: ['reports'] }),
    });
    expect(patch.status).toBe(200);
    // No re-login needed — entitlements are read live from the DB, not the session/JWT.
    const res = await api('/api/reports/pl?from=2000-01-01&to=2999-12-31', owner);
    expect(res.status).toBe(200);
  });
});
