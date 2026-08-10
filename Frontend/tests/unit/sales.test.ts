import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DrizzleQueryError } from 'drizzle-orm';
import { createSale } from '@/lib/server/sales';

// createSale runs the sale insert inside a SERIALIZABLE transaction so two
// concurrent sales against the same batch can't both pass the pre-check and
// oversell. Postgres aborts the loser with SQLSTATE 40001, which createSale
// is meant to translate into a friendly "please try again" result instead of
// a raw DB error string.
//
// The error shape below is the real one: drizzle-orm (postgres-js driver)
// wraps the underlying postgres error in a DrizzleQueryError, with the
// SQLSTATE-bearing PostgresError attached as `.cause` — never a flat
// `Object.assign(new Error, { code })`, which is never produced at runtime.
function pgError(code: string, message: string): DrizzleQueryError {
  const cause = Object.assign(new Error(message), { code });
  return new DrizzleQueryError('insert into "sales" ...', [], cause as Error);
}

const { mockDbSelect, mockDbTransaction } = vi.hoisted(() => ({
  mockDbSelect: vi.fn(),
  mockDbTransaction: vi.fn(),
}));

vi.mock('@/db', () => ({
  db: { select: mockDbSelect, transaction: mockDbTransaction, insert: vi.fn(), update: vi.fn(), delete: vi.fn() },
}));

// Thenable query-builder stub: every chained call (.from/.where/.limit/...)
// returns itself, and awaiting it resolves to `result` — matching how the
// real drizzle query builder is both chainable and awaitable.
function chain(result: unknown) {
  const obj: Record<string, unknown> = {
    from: () => obj,
    where: () => obj,
    limit: () => obj,
    orderBy: () => obj,
    for: () => obj,
    then: (resolve: (v: unknown) => void) => resolve(result),
  };
  return obj;
}

const batchRow = {
  id: 'b1', unitId: 'u1', currentQty: 10, species: 'chicken', avgWeightKg: 0,
};

describe('createSale', () => {
  beforeEach(() => {
    mockDbSelect.mockReset();
    mockDbTransaction.mockReset();
    // 1st select: the batch lookup. 2nd select: checkWithdrawal's health-records
    // read (empty = no withdrawal in effect). No productId in these tests, so
    // there's no third (product) select.
    mockDbSelect
      .mockReturnValueOnce(chain([batchRow]))
      .mockReturnValueOnce(chain([]));
  });

  it('a serialization conflict (40001) returns a friendly retry message, not a raw DB error', async () => {
    mockDbTransaction.mockRejectedValue(pgError('40001', 'could not serialize access due to concurrent update'));

    const res = await createSale({ tenantId: 't1', batchId: 'b1', quantity: 1, unitPrice: 100 });

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/concurrent sale/i);
  });

  it('an unrelated db error surfaces its own message rather than the conflict message', async () => {
    mockDbTransaction.mockRejectedValue(pgError('57P01', 'connection reset'));

    const res = await createSale({ tenantId: 't1', batchId: 'b1', quantity: 1, unitPrice: 100 });

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).not.toMatch(/concurrent sale/i);
      expect(res.error).toMatch(/Failed query/);
    }
  });

  it('a sale with no conflict still works', async () => {
    mockDbTransaction.mockResolvedValue(undefined);

    const res = await createSale({ tenantId: 't1', batchId: 'b1', quantity: 1, unitPrice: 100 });

    expect(res.ok).toBe(true);
  });
});
