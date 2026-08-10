import { describe, it, expect, vi } from 'vitest';
import { handleProduction, handleMorningRound, type IncomingRecord } from '@/lib/server/syncHandlers';
import { productionPayloadSchema } from '@/lib/server/validate';
import { products } from '@/db/schemas';
import type { DbClient } from '@/db';

// Spy on the real `eq` (delegates to the actual implementation, so every
// other call site in syncHandlers.ts — like/ilike/desc/and included — keeps
// working) so the #201 test below can assert the product lookup is actually
// scoped by batchId, not just infer it from mocked query results.
const { eqSpy } = vi.hoisted(() => ({ eqSpy: vi.fn() }));
vi.mock('drizzle-orm', async (importOriginal) => {
  const actual = await importOriginal<typeof import('drizzle-orm')>();
  return { ...actual, eq: (...args: Parameters<typeof actual.eq>) => { eqSpy(...args); return actual.eq(...args); } };
});

// ── Query-chain helpers (mirrors tests/unit/inventory.test.ts's pattern) ────
// `tx.select(...).from(...).where(...)` is awaited directly in some call
// sites (e.g. the production "same day" lookup) and chased with `.limit(1)`
// in others (the product/egg-product lookups this test exercises) — so the
// object returned by `.where()` must be both a thenable AND expose `.limit`.
function makeWhereResult(rows: unknown[]) {
  const p = Promise.resolve(rows) as Promise<unknown[]> & { limit?: (n: number) => Promise<unknown[]> };
  p.limit = (n: number) => Promise.resolve(rows.slice(0, n));
  return p;
}
function selectOnce(rows: unknown[]) {
  return { from: vi.fn(() => ({ where: vi.fn(() => makeWhereResult(rows)) })) };
}

// A single shared insert chain: `.values()` records every row passed to it
// (across every `tx.insert(...)` call in a test, in call order) so tests can
// assert on exactly what would have been written, without caring which
// table each call targeted.
function makeInsertChain(returningRows: unknown[] = []) {
  const chain: Record<string, unknown> = {};
  chain.values = vi.fn(() => chain);
  chain.onConflictDoNothing = vi.fn(() => chain);
  chain.returning = vi.fn(() => Promise.resolve(returningRows));
  // Awaitable directly when no `.returning()` is chained (matches real
  // drizzle usage in handleProduction: `await tx.insert(...).values(...).onConflictDoNothing(...)`).
  (chain as { then?: unknown }).then = (resolve: (v: unknown) => void) => resolve(undefined);
  return chain;
}

describe('productionPayloadSchema', () => {
  // Previously `productId` was an unknown key to this schema, so Zod silently
  // stripped it before handleProduction ever saw it (#22).
  it('preserves productId instead of stripping it', () => {
    const parsed = productionPayloadSchema.parse({ batchId: 'b1', type: 'Eggs', qty: 12, productId: 'prod-1' });
    expect(parsed.productId).toBe('prod-1');
  });

  it('allows productId to be omitted (legacy clients, morning round)', () => {
    const parsed = productionPayloadSchema.parse({ batchId: 'b1', type: 'eggs', qty: 5 });
    expect(parsed.productId).toBeUndefined();
  });

  it('allows productId to be explicitly null', () => {
    const parsed = productionPayloadSchema.parse({ batchId: 'b1', type: 'eggs', qty: 5, productId: null });
    expect(parsed.productId).toBeNull();
  });
});

describe('handleProduction', () => {
  it('writes productId and a snapshotted baseUnit when the product resolves for the tenant', async () => {
    const select = vi.fn()
      .mockReturnValueOnce(selectOnce([{ baseUnit: 'piece' }])) // product lookup
      .mockReturnValueOnce(selectOnce([])); // same-day lookup: no existing row
    const insertChain = makeInsertChain();
    const insert = vi.fn(() => insertChain);
    const tx = { select, insert } as unknown as DbClient;

    const record: IncomingRecord = {
      clientUuid: 'c1', type: 'production',
      payload: { batchId: 'b1', type: 'Eggs', qty: 12, productId: 'prod-1' },
      capturedAt: '2026-08-05T08:00:00Z',
    };

    const result = await handleProduction(record, 't1', 'u1', tx);
    expect(result.routed).toBe(true);
    expect(insertChain.values).toHaveBeenCalledWith(expect.objectContaining({
      clientUuid: 'c1', batchId: 'b1', type: 'Eggs', qty: 12,
      productId: 'prod-1', baseUnit: 'piece',
    }));
  });

  it('falls back to NULL productId/baseUnit when the id does not resolve for this tenant', async () => {
    // Empty result models both "no such product" and "belongs to a different
    // tenant" — the lookup is scoped by (tenantId, id), so either case looks
    // identical to handleProduction: no matching row.
    const select = vi.fn()
      .mockReturnValueOnce(selectOnce([])) // product lookup: no match
      .mockReturnValueOnce(selectOnce([])); // same-day lookup: no existing row
    const insertChain = makeInsertChain();
    const insert = vi.fn(() => insertChain);
    const tx = { select, insert } as unknown as DbClient;

    const record: IncomingRecord = {
      clientUuid: 'c2', type: 'production',
      payload: { batchId: 'b1', type: 'Eggs', qty: 5, productId: 'someone-elses-product' },
      capturedAt: '2026-08-05T08:00:00Z',
    };

    await handleProduction(record, 't1', 'u1', tx);
    expect(insertChain.values).toHaveBeenCalledWith(expect.objectContaining({
      productId: null, baseUnit: null,
    }));
  });

  it('scopes the product lookup by batchId, not just tenantId, and falls back to NULL for a cross-batch id (#201)', async () => {
    eqSpy.mockClear();
    // Models a productId that belongs to a different batch of the same
    // tenant: with the batchId predicate in place, that row no longer
    // matches, so the lookup returns empty exactly like an unresolved id.
    const select = vi.fn()
      .mockReturnValueOnce(selectOnce([])) // product lookup: no match for this batch
      .mockReturnValueOnce(selectOnce([])); // same-day lookup: no existing row
    const insertChain = makeInsertChain();
    const insert = vi.fn(() => insertChain);
    const tx = { select, insert } as unknown as DbClient;

    const record: IncomingRecord = {
      clientUuid: 'c4', type: 'production',
      payload: { batchId: 'b1', type: 'Eggs', qty: 7, productId: 'other-batchs-product' },
      capturedAt: '2026-08-05T08:00:00Z',
    };

    const result = await handleProduction(record, 't1', 'u1', tx);

    // The lookup issues eq(products.batchId, 'b1') — proves the fix is the
    // batchId predicate itself, not just that empty results happen to null out.
    expect(eqSpy).toHaveBeenCalledWith(products.batchId, 'b1');
    // qty/type the worker reported are still persisted; only the foreign id is dropped.
    expect(result.routed).toBe(true);
    expect(insertChain.values).toHaveBeenCalledWith(expect.objectContaining({
      batchId: 'b1', type: 'Eggs', qty: 7, productId: null, baseUnit: null,
    }));
  });

  it('skips the product lookup entirely and writes NULL when no productId is sent', async () => {
    const select = vi.fn().mockReturnValueOnce(selectOnce([])); // same-day lookup only
    const insertChain = makeInsertChain();
    const insert = vi.fn(() => insertChain);
    const tx = { select, insert } as unknown as DbClient;

    const record: IncomingRecord = {
      clientUuid: 'c3', type: 'production',
      payload: { batchId: 'b1', type: 'Manure', qty: 3 },
      capturedAt: '2026-08-05T08:00:00Z',
    };

    await handleProduction(record, 't1', 'u1', tx);
    expect(select).toHaveBeenCalledTimes(1); // no product lookup query issued
    expect(insertChain.values).toHaveBeenCalledWith(expect.objectContaining({
      productId: null, baseUnit: null,
    }));
  });
});

describe('handleMorningRound', () => {
  it('resolves the batch egg product (base_unit piece, name matching egg) and writes productId/baseUnit', async () => {
    const select = vi.fn().mockReturnValueOnce(selectOnce([{ id: 'egg-prod-1', baseUnit: 'piece' }]));
    const insertChain = makeInsertChain();
    const insert = vi.fn(() => insertChain);
    const tx = { select, insert } as unknown as DbClient;

    const record: IncomingRecord = {
      clientUuid: 'mr1', type: 'morning_round',
      payload: { entries: [{ batchId: 'b1', eggsCollected: 10 }] },
      capturedAt: '2026-08-05T08:00:00Z',
    };

    await handleMorningRound(record, 't1', 'u1', tx);
    // First insert call is the production_records row for this entry's eggs.
    expect(insertChain.values).toHaveBeenNthCalledWith(1, expect.objectContaining({
      type: 'eggs', qty: 10, productId: 'egg-prod-1', baseUnit: 'piece',
    }));
  });

  it('falls back to NULL when no matching egg product exists for the batch', async () => {
    const select = vi.fn().mockReturnValueOnce(selectOnce([])); // no egg product found
    const insertChain = makeInsertChain();
    const insert = vi.fn(() => insertChain);
    const tx = { select, insert } as unknown as DbClient;

    const record: IncomingRecord = {
      clientUuid: 'mr2', type: 'morning_round',
      payload: { entries: [{ batchId: 'b1', eggsCollected: 4 }] },
      capturedAt: '2026-08-05T08:00:00Z',
    };

    await handleMorningRound(record, 't1', 'u1', tx);
    expect(insertChain.values).toHaveBeenNthCalledWith(1, expect.objectContaining({
      type: 'eggs', qty: 4, productId: null, baseUnit: null,
    }));
  });
});
