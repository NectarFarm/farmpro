import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DELETE } from '@/app/api/products/route';

// DELETE /api/products used to hard-delete unconditionally. Migration 0039
// made production_records.product_id a real FK with ON DELETE RESTRICT, so
// deleting a product with recorded production now raises a Postgres FK
// violation (SQLSTATE 23503) — this used to succeed and is a user-facing
// regression if it surfaces as a raw 500 (#195). These tests exercise the
// actual exported route handler (not a copy of its logic) with the db and
// session layers mocked, the same way tests/unit/products.test.ts mocks '@/db'.

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
    const fkError = Object.assign(new Error('update or delete on table "products" violates foreign key constraint'), { code: '23503' });
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
    const otherError = Object.assign(new Error('connection reset'), { code: '57P01' });
    mockDbDelete.mockReturnValue({ where: vi.fn().mockRejectedValue(otherError) });

    const req = new Request('http://localhost/api/products?id=p3', { method: 'DELETE' });
    await expect(DELETE(req)).rejects.toThrow('connection reset');
  });
});
