import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DrizzleQueryError } from 'drizzle-orm';
import { POST } from '@/app/api/data/employees/route';

// POST /api/data/employees creates an employee + optional login inside a
// transaction. A duplicate phone/email raises a Postgres unique violation
// (SQLSTATE 23505) on the `users` table — expected to surface as a 400
// ("that number already has a login"), not a raw 500.
//
// The error shape below is the real one: drizzle-orm (postgres-js driver)
// wraps the underlying postgres error in a DrizzleQueryError, with the
// SQLSTATE-bearing PostgresError attached as `.cause` — never a flat
// `Object.assign(new Error, { code })`, which is never produced at runtime
// and would let a route that only checks `e.code` pass a test wrongly.
function pgError(code: string, message: string): DrizzleQueryError {
  const cause = Object.assign(new Error(message), { code });
  return new DrizzleQueryError('insert into "users" ...', [], cause as Error);
}

const { mockDbSelect, mockDbTransaction, mockGetSession } = vi.hoisted(() => ({
  mockDbSelect: vi.fn(),
  mockDbTransaction: vi.fn(),
  mockGetSession: vi.fn(),
}));

vi.mock('@/db', () => ({
  db: { select: mockDbSelect, transaction: mockDbTransaction, insert: vi.fn(), update: vi.fn(), delete: vi.fn() },
}));
vi.mock('@/lib/server/session', () => ({ getSession: mockGetSession }));
vi.mock('@/lib/server/rateLimit', () => ({
  checkWriteRateLimit: () => ({ allowed: true }),
  checkReadRateLimit: () => ({ allowed: true }),
}));

function selectChain(rows: unknown[]) {
  return { from: () => ({ where: () => ({ limit: async () => rows }) }) };
}

describe('POST /api/data/employees', () => {
  beforeEach(() => {
    mockGetSession.mockReset();
    mockDbSelect.mockReset();
    mockDbTransaction.mockReset();
    mockGetSession.mockResolvedValue({ userId: 'u1', tenantId: 't1', role: 'owner', name: 'Owner', exp: 0 });
    // No pre-existing duplicate found by the app-level check — the race is
    // caught by the DB's unique constraint instead (see comment in the route).
    mockDbSelect.mockReturnValue(selectChain([]));
  });

  function req(body: Record<string, unknown>) {
    return new Request('http://localhost/api/data/employees', {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'content-type': 'application/json' },
    });
  }

  it('a concurrent duplicate phone/email on insert returns a 4xx, not a 500', async () => {
    mockDbTransaction.mockRejectedValue(pgError('23505', 'duplicate key value violates unique constraint "users_phone_unique"'));

    const res = await POST(req({ name: 'Jane', phone: '0712345678', role: 'manager', email: 'jane@example.com', password: 'longenoughpassword' }));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/already has a login/i);
  });

  it('rethrows an unrelated db error rather than mislabeling it as the duplicate case', async () => {
    const otherError = pgError('57P01', 'connection reset');
    mockDbTransaction.mockRejectedValue(otherError);

    await expect(POST(req({ name: 'Jane', phone: '0712345678', role: 'manager', email: 'jane@example.com', password: 'longenoughpassword' })))
      .rejects.toBe(otherError);
  });

  it('creating an employee with no login conflict still works', async () => {
    mockDbTransaction.mockResolvedValue(undefined);

    const res = await POST(req({ name: 'Jane', phone: '0712345678', role: 'worker', pin: '1234' }));

    expect(res.status).toBe(201);
  });
});
