import { describe, it, expect, vi, beforeEach } from 'vitest';

// #29: `tenants.features` was returned by /api/me and consumed in exactly one
// place — app/owner/layout.tsx, to filter nav items. No API route checked it:
// a free-plan tenant could curl /api/reports/pl, /api/ai/advise or
// /api/alerts/evaluate and get a full response. The "paywall" was
// `display: none`.
//
// This suite has two jobs:
//   1. Unit-test the guard itself (requireFeature / getTenantFeatures) against
//      a mocked '@/db' — no live database, so this stays in tests/unit.
//   2. THE LOAD-BEARING PART: import the REAL exported route handlers for
//      every entry in lib/server/entitlements.ts's ROUTE_FEATURES registry
//      and call them, with a mocked session + a tenant whose `features` array
//      is empty. If a route is registered as gated but the route file never
//      actually applies the gate (the exact bug class #29 exists to fix —
//      "a control that appears to exist but doesn't"), this test gets a 200
//      instead of a 403 and fails. Adding a new entry to ROUTE_FEATURES
//      without wiring `withFeature` into the route — or without adding a
//      matching case here — fails one of the two assertions in the "every
//      registry entry has a covering case" test below, so the registry and
//      the enforcement can't silently drift apart the way #200 showed
//      TENANT_TABLES can (see tests/unit/tenantAdmin.test.ts).

const { mockDbSelect, mockGetSession } = vi.hoisted(() => ({
  mockDbSelect: vi.fn(),
  mockGetSession: vi.fn(),
}));

vi.mock('@/db', () => ({
  db: { select: mockDbSelect, insert: vi.fn(), update: vi.fn(), delete: vi.fn(), transaction: vi.fn() },
}));
vi.mock('@/lib/server/session', () => ({ getSession: mockGetSession }));

// A self-returning query builder: every chaining method (`from`, `where`,
// `orderBy`, `limit`) returns the same builder, and it resolves to `rows`
// when awaited — so it satisfies both `await db.select(...).from(t).where(...)`
// (no `.limit()`, used by the alert-rules/worker-activity handlers) and
// `await db.select(...).from(tenants).where(...).limit(1)` (entitlements'
// own tenant lookup) with one mock, regardless of which table is passed in.
function selectBuilder(rows: unknown[]) {
  const builder = {
    from: () => builder,
    where: () => builder,
    orderBy: () => builder,
    limit: () => builder,
    then: (resolve: (v: unknown) => void) => resolve(rows),
  };
  return builder;
}

const OWNER_SESSION = { userId: 'u1', tenantId: 't1', role: 'owner' as const, name: 'Owner', exp: 0 };

beforeEach(() => {
  mockDbSelect.mockReset();
  mockGetSession.mockReset();
});

describe('requireFeature / getTenantFeatures (the guard itself)', () => {
  it('returns null (pass) when the tenant\'s features include the required key', async () => {
    mockDbSelect.mockReturnValue(selectBuilder([{ features: ['reports', 'alerts'] }]));
    const { requireFeature } = await import('@/lib/server/entitlements');
    expect(await requireFeature('t1', 'reports')).toBeNull();
  });

  it('returns a 403 with the standard error envelope when the feature is missing', async () => {
    mockDbSelect.mockReturnValue(selectBuilder([{ features: ['finance'] }]));
    const { requireFeature } = await import('@/lib/server/entitlements');
    const res = await requireFeature('t1', 'ai_advisor');
    expect(res).not.toBeNull();
    expect(res!.status).toBe(403);
    const body = await res!.json();
    expect(body.errorCode).toBe('AUTH_FORBIDDEN');
    expect(body.error).toMatch(/AI Advisor/i);
  });

  it('fails closed (all-features-off) rather than failing open on a malformed features column', async () => {
    mockDbSelect.mockReturnValue(selectBuilder([{ features: 'not-an-array' }]));
    const { requireFeature } = await import('@/lib/server/entitlements');
    const res = await requireFeature('t1', 'reports');
    expect(res!.status).toBe(403);
  });

  it('a tenant that no longer exists gets denied, not a crash', async () => {
    mockDbSelect.mockReturnValue(selectBuilder([]));
    const { requireFeature } = await import('@/lib/server/entitlements');
    const res = await requireFeature('deleted-tenant', 'reports');
    expect(res!.status).toBe(403);
  });
});

// ── The part that actually catches "there is no check" ──────────────────
//
// One case per ROUTE_FEATURES entry. Each imports the real route module and
// invokes its real exported handler — not a re-implementation of the gate.
const cases: { key: string; call: () => Promise<Response> }[] = [
  {
    key: 'POST /api/ai/advise',
    call: async () => {
      const { POST } = await import('@/app/api/ai/advise/route');
      return POST(new Request('http://localhost/api/ai/advise', {
        method: 'POST', body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }),
      }));
    },
  },
  {
    key: 'GET /api/reports/[type]',
    call: async () => {
      const { GET } = await import('@/app/api/reports/[type]/route');
      return GET(new Request('http://localhost/api/reports/pl'), { params: Promise.resolve({ type: 'pl' }) });
    },
  },
  {
    key: 'POST /api/alerts/evaluate',
    call: async () => {
      const { POST } = await import('@/app/api/alerts/evaluate/route');
      return POST(new Request('http://localhost/api/alerts/evaluate', { method: 'POST' }));
    },
  },
  {
    key: 'GET /api/alert-rules',
    call: async () => {
      const { GET } = await import('@/app/api/alert-rules/route');
      return GET(new Request('http://localhost/api/alert-rules'));
    },
  },
  {
    key: 'PUT /api/alert-rules',
    call: async () => {
      const { PUT } = await import('@/app/api/alert-rules/route');
      return PUT(new Request('http://localhost/api/alert-rules', {
        method: 'PUT', body: JSON.stringify({ rules: [] }),
      }));
    },
  },
  {
    key: 'GET /api/worker-activity',
    call: async () => {
      const { GET } = await import('@/app/api/worker-activity/route');
      return GET(new Request('http://localhost/api/worker-activity'));
    },
  },
];

describe('#29 every ROUTE_FEATURES entry is actually enforced by its route file', () => {
  beforeEach(() => {
    mockDbSelect.mockReset();
    mockGetSession.mockReset();
    // Owner role (passes every route's own role check) on a tenant with an
    // EMPTY features array — the "downgraded to free and beyond" case. If any
    // gated route answers anything but 403 here, its gate is missing or broken.
    mockGetSession.mockResolvedValue(OWNER_SESSION);
    mockDbSelect.mockReturnValue(selectBuilder([{ features: [] }]));
  });

  it('this test file has a case for every entry in the registry (and no extras)', async () => {
    const { ROUTE_FEATURES } = await import('@/lib/server/entitlements');
    expect(cases.map((c) => c.key).sort()).toEqual(Object.keys(ROUTE_FEATURES).sort());
  });

  it.each(cases.map((c): [string, typeof c] => [c.key, c]))(
    '%s returns 403 for a tenant whose plan lacks the required feature',
    async (_key, c) => {
      const res = await c.call();
      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.errorCode).toBe('AUTH_FORBIDDEN');
    },
  );

  it('a tenant WITH the feature reaches the real handler (the gate does not over-block)', async () => {
    // First db.select call is entitlements' own tenant lookup; give it the
    // feature. The alert-rules GET handler's own query (alertRules table)
    // resolves via the same generic builder to an empty list.
    mockDbSelect.mockReturnValue(selectBuilder([{ features: ['alerts'] }]));
    const { GET } = await import('@/app/api/alert-rules/route');
    const res = await GET(new Request('http://localhost/api/alert-rules'));
    expect(res.status).toBe(200);
  });

  it('an unauthenticated caller gets 401, not 403 (auth is checked before entitlement)', async () => {
    mockGetSession.mockResolvedValue(null);
    const { POST } = await import('@/app/api/ai/advise/route');
    const res = await POST(new Request('http://localhost/api/ai/advise', { method: 'POST', body: '{}' }));
    expect(res.status).toBe(401);
  });
});
