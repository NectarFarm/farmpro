import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DrizzleQueryError } from 'drizzle-orm';
import { DELETE } from '@/app/api/products/route';

// DELETE /api/products used to hard-delete unconditionally. Migration 0039
// made production_records.product_id a real FK with ON DELETE RESTRICT, so
// deleting a product with recorded production now raises a Postgres FK
// violation (SQLSTATE 23503) — this used to succeed and is a user-facing
// regression if it surfaces as a raw 500 (#195). These tests exercise the
// actual exported route handler (not a copy of its logic) with the db and
// session layers mocked, the same way tests/unit/products.test.ts mocks '@/db'.
//
// The error shape below is deliberately NOT a flat `Object.assign(new Error, {
// code })` — that shape is never produced at runtime. drizzle-orm (postgres-js
// driver) always wraps the real postgres error in a DrizzleQueryError, with
// the SQLSTATE-bearing PostgresError attached as `.cause` (verified empirically
// against this project's own drizzle-orm 0.45.1 + postgres client: `e.code` is
// `undefined`, `e.cause.code` is the SQLSTATE). A test built on the flat shape
// cannot fail against a route that only checks `e.code` — which is exactly how
// this bug shipped — so these tests construct the real `DrizzleQueryError`.
function pgError(code: string, message: string): DrizzleQueryError {
  const cause = Object.assign(new Error(message), { code });
  return new DrizzleQueryError('delete from "products" ...', [], cause as Error);
}

const { mockDbDelete, mockGetSession } = vi.hoisted(() => ({
  mockDbDelete: vi.fn(),
  mockGetSession: vi.fn(),
}));

vi.mock('@/db', () => ({
  db: { delete: mockDbDelete, select: vi.fn(), update: vi.fn(), insert: vi.fn() },
}));
vi.mock('@/lib/server/session', () => ({ getSession: mockGetSession }));
vi.mock('@/lib/server/rateLimit', () => ({
  readRateLimited: () => null,
  writeRateLimited: () => null,
}));
// Focus these tests on DELETE's own error handling, not the logging wrapper.
vi.mock('@/lib/server/apiErrorHandler', () => ({
  withErrorLogging: (_name: string, handler: unknown) => handler,
}));

describe('DELETE /api/products', () => {
  beforeEach(() => {
    mockGetSession.mockReset();
    mockDbDelete.mockReset();
    mockGetSession.mockResolvedValue({ userId: 'u1', tenantId: 't1', role: 'owner', name: 'Owner', exp: 0 });
  });

  it('deleting a product with production history returns a 4xx, not a 500', async () => {
    const fkError = pgError('23503', 'update or delete on table "products" violates foreign key constraint');
    mockDbDelete.mockReturnValue({ where: vi.fn().mockRejectedValue(fkError) });

    const req = new Request('http://localhost/api/products?id=p1', { method: 'DELETE' });
    const res = await DELETE(req);

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/production/i);
    expect(body.error).toMatch(/deactivat/i);
  });

  it('deleting a product with no production history still works', async () => {
    mockDbDelete.mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) });

    const req = new Request('http://localhost/api/products?id=p2', { method: 'DELETE' });
    const res = await DELETE(req);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ id: 'p2', deleted: true });
  });

  it('rethrows an unrelated db error rather than mislabeling it as the FK case', async () => {
    // A DrizzleQueryError's own .message is the failed query text, not the
    // underlying postgres message, so assert on identity + the wrapped cause
    // rather than matching .message against the cause's text.
    const otherError = pgError('57P01', 'connection reset');
    mockDbDelete.mockReturnValue({ where: vi.fn().mockRejectedValue(otherError) });

    const req = new Request('http://localhost/api/products?id=p3', { method: 'DELETE' });
    await expect(DELETE(req)).rejects.toBe(otherError);
  });
});
