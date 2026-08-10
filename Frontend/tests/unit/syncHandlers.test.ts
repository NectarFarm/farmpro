import { describe, it, expect, vi } from 'vitest';
import { handleProduction, handleMorningRound, type IncomingRecord } from '@/lib/server/syncHandlers';
import { productionPayloadSchema } from '@/lib/server/validate';
import { products, productionRecords } from '@/db/schemas';
import type { DbClient } from '@/db';
import type { Session } from '@/lib/server/session';

// These tests exercise handleProduction/handleMorningRound's own logic, not
// #203's field-permission gate (see tests/unit/writePermissions.test.ts for
// that) — an owner session makes assertWritable a no-op with zero extra `db`
// calls, so it doesn't disturb any of the `select` call-count assertions below.
const OWNER = { role: 'owner' } as Session;

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
// sites (e.g. the "same day" soft-duplicate lookup) and chased with
// `.limit(1)` in others (the retry / slot / product lookups) — so the object
// returned by `.where()` must be both a thenable AND expose `.limit`.
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

// `tx.update(productionRecords).set({...}).where(...)` — the UPDATE-in-place
// path #24 uses instead of ever DELETEing a row.
function makeUpdateChain() {
  const chain: Record<string, unknown> = {};
  chain.set = vi.fn(() => chain);
  chain.where = vi.fn(() => Promise.resolve(undefined));
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

  // #24: an explicit slot is how a genuine edit is expressed.
  it('preserves an explicit slot instead of stripping it', () => {
    const parsed = productionPayloadSchema.parse({ batchId: 'b1', type: 'Milk', qty: 5, slot: 'morning' });
    expect(parsed.slot).toBe('morning');
  });

  it('allows slot to be omitted — the default, always-additive path (the collect page never sends one today)', () => {
    const parsed = productionPayloadSchema.parse({ batchId: 'b1', type: 'eggs', qty: 5 });
    expect(parsed.slot).toBeUndefined();
  });
});

describe('handleProduction', () => {
  it('writes productId and a snapshotted baseUnit when the product resolves for the tenant', async () => {
    const select = vi.fn()
      .mockReturnValueOnce(selectOnce([{ baseUnit: 'piece' }])) // product lookup
      .mockReturnValueOnce(selectOnce([]))                      // retry check (client_uuid): none
      .mockReturnValueOnce(selectOnce([]))                      // slot lookup: none — first submission on this slot
      .mockReturnValueOnce(selectOnce([]));                     // soft-duplicate same-day scan: none
    const insertChain = makeInsertChain();
    const insert = vi.fn(() => insertChain);
    const tx = { select, insert } as unknown as DbClient;

    const record: IncomingRecord = {
      clientUuid: 'c1', type: 'production',
      payload: { batchId: 'b1', type: 'Eggs', qty: 12, productId: 'prod-1' },
      capturedAt: '2026-08-05T08:00:00Z',
    };

    const result = await handleProduction(record, 't1', 'u1', tx, OWNER);
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
      .mockReturnValueOnce(selectOnce([])) // retry check: none
      .mockReturnValueOnce(selectOnce([])) // slot lookup: none
      .mockReturnValueOnce(selectOnce([])); // soft-duplicate scan: none
    const insertChain = makeInsertChain();
    const insert = vi.fn(() => insertChain);
    const tx = { select, insert } as unknown as DbClient;

    const record: IncomingRecord = {
      clientUuid: 'c2', type: 'production',
      payload: { batchId: 'b1', type: 'Eggs', qty: 5, productId: 'someone-elses-product' },
      capturedAt: '2026-08-05T08:00:00Z',
    };

    await handleProduction(record, 't1', 'u1', tx, OWNER);
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
      .mockReturnValueOnce(selectOnce([])) // retry check: none
      .mockReturnValueOnce(selectOnce([])) // slot lookup: none
      .mockReturnValueOnce(selectOnce([])); // soft-duplicate scan: none
    const insertChain = makeInsertChain();
    const insert = vi.fn(() => insertChain);
    const tx = { select, insert } as unknown as DbClient;

    const record: IncomingRecord = {
      clientUuid: 'c4', type: 'production',
      payload: { batchId: 'b1', type: 'Eggs', qty: 7, productId: 'other-batchs-product' },
      capturedAt: '2026-08-05T08:00:00Z',
    };

    const result = await handleProduction(record, 't1', 'u1', tx, OWNER);

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
    const select = vi.fn()
      .mockReturnValueOnce(selectOnce([])) // retry check: none
      .mockReturnValueOnce(selectOnce([])) // slot lookup: none
      .mockReturnValueOnce(selectOnce([])); // soft-duplicate scan: none
    const insertChain = makeInsertChain();
    const insert = vi.fn(() => insertChain);
    const tx = { select, insert } as unknown as DbClient;

    const record: IncomingRecord = {
      clientUuid: 'c3', type: 'production',
      payload: { batchId: 'b1', type: 'Manure', qty: 3 },
      capturedAt: '2026-08-05T08:00:00Z',
    };

    await handleProduction(record, 't1', 'u1', tx, OWNER);
    expect(select).toHaveBeenCalledTimes(3); // no product lookup query issued — just retry/slot/soft-dup
    expect(insertChain.values).toHaveBeenCalledWith(expect.objectContaining({
      productId: null, baseUnit: null,
    }));
  });

  // ── #24: additive by default ──────────────────────────────────────────────

  it('is additive by default: two different clientUuids for the same batch/type/day both insert — never a conflict, never a DELETE', async () => {
    // Plucker 1: 30kg.
    const select1 = vi.fn()
      .mockReturnValueOnce(selectOnce([])) // retry check: none
      .mockReturnValueOnce(selectOnce([])) // slot lookup: none — default slot is unique to c-pluck-1
      .mockReturnValueOnce(selectOnce([])); // soft-duplicate scan: none yet
    const insertChain1 = makeInsertChain();
    // No `delete` on this tx at all — if the code ever tried to call it, this
    // throws immediately (TypeError: tx.delete is not a function), which is
    // exactly the assertion we want: no DELETE anywhere.
    const tx1 = { select: select1, insert: vi.fn(() => insertChain1) } as unknown as DbClient;
    const rec1: IncomingRecord = {
      clientUuid: 'c-pluck-1', type: 'production',
      payload: { batchId: 'b1', type: 'Tea leaves', qty: 30 },
      capturedAt: '2026-08-05T08:00:00Z',
    };
    const result1 = await handleProduction(rec1, 't1', 'u1', tx1, OWNER);
    expect(result1.conflict).toBeUndefined();
    expect(insertChain1.values).toHaveBeenCalledWith(expect.objectContaining({ clientUuid: 'c-pluck-1', qty: 30 }));

    // Plucker 2: 45kg, same batch/type/day, different clientUuid.
    const select2 = vi.fn()
      .mockReturnValueOnce(selectOnce([])) // retry check: none (different clientUuid)
      .mockReturnValueOnce(selectOnce([])) // slot lookup: none — default slot is unique to c-pluck-2, so plucker 1's row doesn't collide
      .mockReturnValueOnce(selectOnce([{ clientUuid: 'c-pluck-1', qty: 30 }])); // soft-duplicate scan sees plucker 1's row, but qty differs (30 vs 45) — no alert
    const insertChain2 = makeInsertChain();
    const tx2 = { select: select2, insert: vi.fn(() => insertChain2) } as unknown as DbClient;
    const rec2: IncomingRecord = {
      clientUuid: 'c-pluck-2', type: 'production',
      payload: { batchId: 'b1', type: 'Tea leaves', qty: 45 },
      capturedAt: '2026-08-05T09:00:00Z',
    };
    const result2 = await handleProduction(rec2, 't1', 'u1', tx2, OWNER);

    expect(result2.conflict).toBeUndefined();
    expect(insertChain2.values).toHaveBeenCalledWith(expect.objectContaining({ clientUuid: 'c-pluck-2', qty: 45 }));
    // Both rows exist — this is the "total is the sum" behaviour: two INSERTs, zero DELETEs.
  });

  it('raises an info alert (a warning, not a mutation) when an additive insert lands on the same day as an identical quantity', async () => {
    const select = vi.fn()
      .mockReturnValueOnce(selectOnce([])) // retry check: none
      .mockReturnValueOnce(selectOnce([])) // slot lookup: none
      .mockReturnValueOnce(selectOnce([{ clientUuid: 'other-uuid', qty: 30 }])) // soft-duplicate scan: same qty already recorded today
      .mockReturnValueOnce(selectOnce([{ name: 'North Field' }])); // batchName() lookup inside the alert message
    const insertChain = makeInsertChain();
    const tx = { select, insert: vi.fn(() => insertChain) } as unknown as DbClient;

    const rec: IncomingRecord = {
      clientUuid: 'c-new', type: 'production',
      payload: { batchId: 'b1', type: 'Tea leaves', qty: 30 },
      capturedAt: '2026-08-05T10:00:00Z',
    };
    await handleProduction(rec, 't1', 'u1', tx, OWNER);

    // First insert is the production row itself (unconditional); second is the alert.
    expect(insertChain.values).toHaveBeenNthCalledWith(1, expect.objectContaining({ clientUuid: 'c-new', qty: 30 }));
    expect(insertChain.values).toHaveBeenNthCalledWith(2, expect.objectContaining({ severity: 'info', type: 'possible_duplicate' }));
  });

  it('does NOT raise the duplicate-qty alert when the two same-day entries have different quantities', async () => {
    const select = vi.fn()
      .mockReturnValueOnce(selectOnce([])) // retry check: none
      .mockReturnValueOnce(selectOnce([])) // slot lookup: none
      .mockReturnValueOnce(selectOnce([{ clientUuid: 'other-uuid', qty: 30 }])); // soft-duplicate scan: different qty (30 vs 45)
    const insertChain = makeInsertChain();
    const tx = { select, insert: vi.fn(() => insertChain) } as unknown as DbClient;

    const rec: IncomingRecord = {
      clientUuid: 'c-new', type: 'production',
      payload: { batchId: 'b1', type: 'Tea leaves', qty: 45 },
      capturedAt: '2026-08-05T10:00:00Z',
    };
    await handleProduction(rec, 't1', 'u1', tx, OWNER);
    expect(insertChain.values).toHaveBeenCalledTimes(1); // production row only — no alert insert
  });

  // ── #24: retry idempotency ────────────────────────────────────────────────

  it('is idempotent under offline-sync retry: the same clientUuid resubmitted is a no-op, not a second row', async () => {
    const select = vi.fn().mockReturnValueOnce(selectOnce([{ clientUuid: 'c1' }])); // retry check: already on disk
    const insert = vi.fn();
    const tx = { select, insert } as unknown as DbClient;

    const rec: IncomingRecord = {
      clientUuid: 'c1', type: 'production',
      payload: { batchId: 'b1', type: 'Tea leaves', qty: 30 },
      capturedAt: '2026-08-05T08:00:00Z',
    };
    const result = await handleProduction(rec, 't1', 'u1', tx, OWNER);
    expect(result.routed).toBe(true);
    expect(insert).not.toHaveBeenCalled();
    expect(select).toHaveBeenCalledTimes(1); // stops at the retry check — never even looks at the slot
  });

  // ── #24: an explicit slot is a genuine edit ──────────────────────────────

  it('resubmitting the SAME explicit slot with a NEWER capturedAt UPDATEs the existing row in place — conflict logged, never DELETEd', async () => {
    const existingRow = {
      clientUuid: 'c-morning-1', tenantId: 't1', batchId: 'b1', type: 'Milk', qty: 10,
      weightKg: null, productId: null, baseUnit: null, recordedBy: 'u0',
      capturedAt: '2026-08-05T06:00:00Z', slotKey: '2026-08-05:none:morning',
    };
    const select = vi.fn()
      .mockReturnValueOnce(selectOnce([]))            // retry check: none (a different clientUuid than the slot's occupant)
      .mockReturnValueOnce(selectOnce([existingRow])); // slot lookup: the slot is already occupied
    const insertChain = makeInsertChain();
    const updateChain = makeUpdateChain();
    const insert = vi.fn(() => insertChain);
    const update = vi.fn(() => updateChain);
    const tx = { select, insert, update } as unknown as DbClient; // no `delete` — asserting none is ever called

    eqSpy.mockClear();
    const rec: IncomingRecord = {
      clientUuid: 'c-morning-2', type: 'production',
      payload: { batchId: 'b1', type: 'Milk', qty: 12, slot: 'morning' },
      capturedAt: '2026-08-05T07:00:00Z', // newer than the existing row
    };
    const result = await handleProduction(rec, 't1', 'u1', tx, OWNER);

    expect(insert).toHaveBeenCalledTimes(1); // conflict_log only — the incoming row itself is never inserted
    expect(insertChain.values).toHaveBeenCalledWith(expect.objectContaining({
      recordType: 'production', resolution: 'kept_mine', recordId: 'b1:Milk:2026-08-05',
    }));
    expect(update).toHaveBeenCalledWith(productionRecords);
    expect(updateChain.set).toHaveBeenCalledWith(expect.objectContaining({ qty: 12 }));
    // The row updated is identified by its ORIGINAL client_uuid, not the incoming one —
    // this is what lets the offline client that owns c-morning-1 keep resolving.
    expect(eqSpy).toHaveBeenCalledWith(productionRecords.clientUuid, 'c-morning-1');
    expect(result.conflict).toEqual({ clientUuid: 'c-morning-2', recordType: 'production', resolution: 'kept_mine' });
  });

  it('resubmitting the SAME explicit slot with an OLDER capturedAt logs the conflict but leaves the surviving row unchanged (kept_server)', async () => {
    const existingRow = {
      clientUuid: 'c-morning-1', tenantId: 't1', batchId: 'b1', type: 'Milk', qty: 10,
      capturedAt: '2026-08-05T09:00:00Z', slotKey: '2026-08-05:none:morning',
    };
    const select = vi.fn()
      .mockReturnValueOnce(selectOnce([]))
      .mockReturnValueOnce(selectOnce([existingRow]));
    const insertChain = makeInsertChain();
    const insert = vi.fn(() => insertChain);
    const update = vi.fn();
    const tx = { select, insert, update } as unknown as DbClient;

    const rec: IncomingRecord = {
      clientUuid: 'c-morning-0', type: 'production',
      payload: { batchId: 'b1', type: 'Milk', qty: 8, slot: 'morning' },
      capturedAt: '2026-08-05T07:00:00Z', // OLDER than the existing row
    };
    const result = await handleProduction(rec, 't1', 'u1', tx, OWNER);

    expect(update).not.toHaveBeenCalled();
    expect(insert).toHaveBeenCalledTimes(1); // conflict_log only
    expect(result.conflict).toEqual({ clientUuid: 'c-morning-0', recordType: 'production', resolution: 'kept_server' });
  });

  it('an identical resubmission on the same slot (same qty) is a true no-op: no conflict log, no update', async () => {
    const existingRow = { clientUuid: 'c-morning-1', qty: 10, capturedAt: '2026-08-05T06:00:00Z', slotKey: '2026-08-05:none:morning' };
    const select = vi.fn().mockReturnValueOnce(selectOnce([])).mockReturnValueOnce(selectOnce([existingRow]));
    const insert = vi.fn();
    const update = vi.fn();
    const tx = { select, insert, update } as unknown as DbClient;

    const rec: IncomingRecord = {
      clientUuid: 'c-morning-2', type: 'production',
      payload: { batchId: 'b1', type: 'Milk', qty: 10, slot: 'morning' },
      capturedAt: '2026-08-05T07:00:00Z',
    };
    const result = await handleProduction(rec, 't1', 'u1', tx, OWNER);
    expect(insert).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    expect(result.conflict).toBeUndefined();
  });

  // ── slot key shape ────────────────────────────────────────────────────────

  it('the default (no explicit slot) slot key folds in the record\'s own clientUuid, making it globally unique', async () => {
    const select = vi.fn().mockReturnValueOnce(selectOnce([])).mockReturnValueOnce(selectOnce([])).mockReturnValueOnce(selectOnce([]));
    const insertChain = makeInsertChain();
    const tx = { select, insert: vi.fn(() => insertChain) } as unknown as DbClient;
    const rec: IncomingRecord = {
      clientUuid: 'unique-abc', type: 'production',
      payload: { batchId: 'b1', type: 'Eggs', qty: 5 },
      capturedAt: '2026-08-05T08:00:00Z',
    };
    await handleProduction(rec, 't1', 'u1', tx, OWNER);
    expect(insertChain.values).toHaveBeenCalledWith(expect.objectContaining({ slotKey: '2026-08-05:none:unique-abc' }));
  });

  it('an explicit slot folds in productId, so the same slot NAME for two different products cannot collide (depends on #22/#23\'s productId)', async () => {
    const select = vi.fn()
      .mockReturnValueOnce(selectOnce([{ baseUnit: 'litre' }])) // product lookup resolves
      .mockReturnValueOnce(selectOnce([]))                       // retry check: none
      .mockReturnValueOnce(selectOnce([]));                      // slot lookup: none
    const insertChain = makeInsertChain();
    const tx = { select, insert: vi.fn(() => insertChain) } as unknown as DbClient;
    const rec: IncomingRecord = {
      clientUuid: 'c-milk', type: 'production',
      payload: { batchId: 'b1', type: 'Milk', qty: 5, productId: 'prod-milk', slot: 'morning' },
      capturedAt: '2026-08-05T08:00:00Z',
    };
    await handleProduction(rec, 't1', 'u1', tx, OWNER);
    expect(insertChain.values).toHaveBeenCalledWith(expect.objectContaining({ slotKey: '2026-08-05:prod-milk:morning' }));
  });
});

describe('handleMorningRound', () => {
  it('resolves the batch egg product (base_unit piece, name matching egg) and writes productId/baseUnit', async () => {
    const select = vi.fn()
      .mockReturnValueOnce(selectOnce([{ id: 'egg-prod-1', baseUnit: 'piece' }])) // egg product lookup
      .mockReturnValueOnce(selectOnce([])) // retry check: none
      .mockReturnValueOnce(selectOnce([])); // slot lookup: none — first morning round for this batch/day
    const insertChain = makeInsertChain();
    const insert = vi.fn(() => insertChain);
    const tx = { select, insert } as unknown as DbClient;

    const record: IncomingRecord = {
      clientUuid: 'mr1', type: 'morning_round',
      payload: { entries: [{ batchId: 'b1', eggsCollected: 10 }] },
      capturedAt: '2026-08-05T08:00:00Z',
    };

    await handleMorningRound(record, 't1', 'u1', tx, OWNER);
    // First insert call is the production_records row for this entry's eggs.
    expect(insertChain.values).toHaveBeenNthCalledWith(1, expect.objectContaining({
      type: 'eggs', qty: 10, productId: 'egg-prod-1', baseUnit: 'piece',
    }));
  });

  it('falls back to NULL when no matching egg product exists for the batch', async () => {
    const select = vi.fn()
      .mockReturnValueOnce(selectOnce([])) // no egg product found
      .mockReturnValueOnce(selectOnce([])) // retry check: none
      .mockReturnValueOnce(selectOnce([])); // slot lookup: none
    const insertChain = makeInsertChain();
    const insert = vi.fn(() => insertChain);
    const tx = { select, insert } as unknown as DbClient;

    const record: IncomingRecord = {
      clientUuid: 'mr2', type: 'morning_round',
      payload: { entries: [{ batchId: 'b1', eggsCollected: 4 }] },
      capturedAt: '2026-08-05T08:00:00Z',
    };

    await handleMorningRound(record, 't1', 'u1', tx, OWNER);
    expect(insertChain.values).toHaveBeenNthCalledWith(1, expect.objectContaining({
      type: 'eggs', qty: 4, productId: null, baseUnit: null,
    }));
  });

  // ── #24: the one case the old dedupe intent was right about ──────────────

  it('a resubmitted morning round with a different total UPDATES the existing row in place instead of duplicating it', async () => {
    // The morning-round page mints a FRESH top-level clientUuid on every
    // submit (app/worker/record/morning-round/page.tsx), so the old
    // `${r.clientUuid}:${batchId}:eggs` client_uuid changed on every
    // resubmission too — meaning onConflictDoNothing(client_uuid) never once
    // saw a conflict, and a corrected resubmission silently duplicated the
    // day's eggs instead of correcting them. The explicit 'morning_round'
    // slot (independent of r.clientUuid) is what fixes that.
    const existingRow = {
      clientUuid: 'mr1:b1:eggs', tenantId: 't1', batchId: 'b1', type: 'eggs', qty: 10,
      productId: 'egg-prod-1', baseUnit: 'piece', capturedAt: '2026-08-05T08:00:00Z',
      slotKey: '2026-08-05:egg-prod-1:morning_round',
    };
    const select = vi.fn()
      .mockReturnValueOnce(selectOnce([{ id: 'egg-prod-1', baseUnit: 'piece' }])) // egg product lookup
      .mockReturnValueOnce(selectOnce([])) // retry check: this resubmission's own client_uuid ("mr2:b1:eggs") is new
      .mockReturnValueOnce(selectOnce([existingRow])); // slot lookup: the first morning round already occupies this slot
    const insertChain = makeInsertChain();
    const updateChain = makeUpdateChain();
    const insert = vi.fn(() => insertChain);
    const update = vi.fn(() => updateChain);
    const tx = { select, insert, update } as unknown as DbClient; // no `delete`

    eqSpy.mockClear();
    const record: IncomingRecord = {
      clientUuid: 'mr2', type: 'morning_round',
      payload: { entries: [{ batchId: 'b1', eggsCollected: 14 }] },
      capturedAt: '2026-08-05T09:00:00Z',
    };
    await handleMorningRound(record, 't1', 'u1', tx, OWNER);

    expect(update).toHaveBeenCalledWith(productionRecords);
    expect(updateChain.set).toHaveBeenCalledWith(expect.objectContaining({ qty: 14 }));
    expect(eqSpy).toHaveBeenCalledWith(productionRecords.clientUuid, 'mr1:b1:eggs');
    // The conflict_log write is the FIRST insert call — the production row
    // itself is never (re)inserted for this resubmission.
    expect(insertChain.values).toHaveBeenNthCalledWith(1, expect.objectContaining({ recordType: 'production' }));
  });

  it('a network retry of the same morning-round submission (same top-level clientUuid) is idempotent — no update, no duplicate', async () => {
    const select = vi.fn()
      .mockReturnValueOnce(selectOnce([{ id: 'egg-prod-1', baseUnit: 'piece' }])) // egg product lookup
      .mockReturnValueOnce(selectOnce([{ clientUuid: 'mr1:b1:eggs' }])); // retry check: this exact composite client_uuid already landed
    const insert = vi.fn(() => makeInsertChain());
    const update = vi.fn();
    const tx = { select, insert, update } as unknown as DbClient;

    const record: IncomingRecord = {
      clientUuid: 'mr1', type: 'morning_round',
      payload: { entries: [{ batchId: 'b1', eggsCollected: 10 }] },
      capturedAt: '2026-08-05T08:00:00Z',
    };
    await handleMorningRound(record, 't1', 'u1', tx, OWNER);
    expect(update).not.toHaveBeenCalled();
  });
});
