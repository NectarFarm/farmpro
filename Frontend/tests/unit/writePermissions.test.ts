import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';
import type { DbClient } from '@/db';
import type { Session } from '@/lib/server/session';
import type { FieldConfig } from '@/lib/types';

// #203: `assertWritable` existed with passing unit tests but was never called
// from any write path — the read-side boundary (stripForRead/hiddenFieldKeysFor)
// was real, the write-side was dead code. This suite exists so THAT specific
// regression — a write path silently dropping its `assertWritable` call —
// fails loudly here, rather than shipping behind a green suite again.
//
// It does this two ways:
//  1. "reachability": wraps the REAL assertWritable in a spy and asserts every
//     permission-gated write path in syncHandlers.ts actually invokes it with
//     the field key(s) it writes. Deleting the call makes the spy see zero
//     calls for that path — a hardcoded false pass isn't possible because the
//     spy call-through also exercises the real function.
//  2. "enforcement": drives the REAL assertWritable (not mocked) against a
//     mocked `@/db` standing in for a worker profile, and asserts a
//     non-editable field actually blocks the write (throws, so the sync route
//     puts it in `rejected[]`), while owner/manager sessions bypass it exactly
//     as before.

const { assertWritableSpy } = vi.hoisted(() => ({ assertWritableSpy: vi.fn() }));

vi.mock('@/lib/server/fieldPermissions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/server/fieldPermissions')>();
  return {
    ...actual,
    assertWritable: (...args: Parameters<typeof actual.assertWritable>) => {
      assertWritableSpy(...args);
      return actual.assertWritable(...args);
    },
  };
});

// Stands in for the worker-profile lookup assertWritable performs directly
// against `db` (not the sync transaction's `tx`) — see fieldPermissions.ts.
vi.mock('@/db', () => ({ db: { select: vi.fn() } }));

import { db } from '@/db';
import {
  handleFeeding, handleMortality, handleProduction, handleMorningRound,
} from '@/lib/server/syncHandlers';

const OWNER: Session = { role: 'owner' } as Session;
const MANAGER: Session = { role: 'manager' } as Session;
const WORKER = (): Session => ({ role: 'worker', workerProfileId: 'wp1' } as unknown as Session);

function profileFields(fields: FieldConfig[]) {
  return { from: () => ({ where: () => ({ limit: () => Promise.resolve([{ fields }]) }) }) };
}

function insertChain() {
  const chain: Record<string, unknown> = {};
  chain.values = vi.fn(() => chain);
  chain.onConflictDoNothing = vi.fn(() => chain);
  chain.returning = vi.fn(() => Promise.resolve([]));
  (chain as { then?: unknown }).then = (resolve: (v: unknown) => void) => resolve(undefined);
  return chain;
}
function noRows() {
  const p = Promise.resolve([]) as Promise<unknown[]> & { limit?: (n: number) => Promise<unknown[]> };
  p.limit = () => Promise.resolve([]);
  return p;
}
function selectNone() {
  return { from: () => ({ where: () => noRows() }) };
}
function selectOnce(rows: unknown[]) {
  const p = Promise.resolve(rows) as Promise<unknown[]> & { limit?: (n: number) => Promise<unknown[]> };
  p.limit = (n: number) => Promise.resolve(rows.slice(0, n));
  return { from: () => ({ where: () => p }) };
}

beforeEach(() => {
  assertWritableSpy.mockClear();
  (db.select as unknown as Mock).mockReset();
});

// ── 1. Reachability — every gated write path calls assertWritable ──────────

describe('#203 assertWritable reachability (fails if a write path stops calling it)', () => {
  const paths: { name: string; fieldKeys: string[]; run: () => Promise<unknown> }[] = [
    {
      name: 'handleFeeding → feed_quantity',
      fieldKeys: ['feed_quantity'],
      run: () => handleFeeding(
        { clientUuid: 'c1', type: 'feeding', payload: { batchId: 'b1', quantityKg: 5 }, capturedAt: '2026-08-05T08:00:00Z' },
        't1', 'u1', { insert: () => insertChain() } as unknown as DbClient, OWNER,
      ),
    },
    {
      name: 'handleMortality → mortality_cause (cause provided)',
      fieldKeys: ['mortality_cause'],
      run: () => handleMortality(
        { clientUuid: 'c2', type: 'mortality', payload: { batchId: 'b1', count: 1, cause: 'Disease' }, capturedAt: '2026-08-05T08:00:00Z' },
        't1', 'u1', { insert: () => insertChain() } as unknown as DbClient, OWNER,
      ),
    },
    {
      name: 'handleProduction → product.fieldKey (e.g. collect_eggs)',
      fieldKeys: ['collect_eggs'],
      run: () => handleProduction(
        { clientUuid: 'c3', type: 'production', payload: { batchId: 'b1', type: 'Eggs', qty: 10, productId: 'prod-eggs' }, capturedAt: '2026-08-05T08:00:00Z' },
        't1', 'u1',
        {
          select: vi.fn()
            .mockReturnValueOnce(selectOnce([{ baseUnit: 'piece', fieldKey: 'collect_eggs' }])) // product lookup
            .mockReturnValue(selectNone()), // retry / slot / soft-dup — all empty
          insert: () => insertChain(),
        } as unknown as DbClient,
        OWNER,
      ),
    },
    {
      name: 'handleMorningRound → eggs_collected',
      fieldKeys: ['eggs_collected'],
      run: () => handleMorningRound(
        { clientUuid: 'mr1', type: 'morning_round', payload: { entries: [{ batchId: 'b1', eggsCollected: 6 }] }, capturedAt: '2026-08-05T08:00:00Z' },
        't1', 'u1',
        { select: vi.fn().mockReturnValue(selectNone()), insert: () => insertChain() } as unknown as DbClient,
        OWNER,
      ),
    },
    {
      name: 'handleMorningRound → feed_quantity',
      fieldKeys: ['feed_quantity'],
      run: () => handleMorningRound(
        { clientUuid: 'mr2', type: 'morning_round', payload: { entries: [{ batchId: 'b1', feedItemId: 'f1', feedUsed: 3 }] }, capturedAt: '2026-08-05T08:00:00Z' },
        't1', 'u1',
        { select: vi.fn().mockReturnValue(selectNone()), insert: () => insertChain() } as unknown as DbClient,
        OWNER,
      ),
    },
    {
      name: 'handleMorningRound → water_level',
      fieldKeys: ['water_level'],
      run: () => handleMorningRound(
        { clientUuid: 'mr3', type: 'morning_round', payload: { entries: [{ batchId: 'b1' }] }, capturedAt: '2026-08-05T08:00:00Z' },
        't1', 'u1',
        { insert: () => insertChain() } as unknown as DbClient,
        OWNER,
      ),
    },
    {
      name: 'handleMorningRound → water_level + abnormal',
      fieldKeys: ['water_level', 'abnormal'],
      run: () => handleMorningRound(
        { clientUuid: 'mr4', type: 'morning_round', payload: { entries: [{ batchId: 'b1', abnormal: true }] }, capturedAt: '2026-08-05T08:00:00Z' },
        't1', 'u1',
        { insert: () => insertChain() } as unknown as DbClient,
        OWNER,
      ),
    },
  ];

  it.each(paths)('$name reaches assertWritable with the right key(s)', async ({ run, fieldKeys }) => {
    await run();
    expect(assertWritableSpy).toHaveBeenCalledWith(OWNER, fieldKeys);
  });

  it('this manifest is the enumeration required by #203 — do not shrink it without updating the report', () => {
    expect(paths.map((p) => p.name)).toEqual([
      'handleFeeding → feed_quantity',
      'handleMortality → mortality_cause (cause provided)',
      'handleProduction → product.fieldKey (e.g. collect_eggs)',
      'handleMorningRound → eggs_collected',
      'handleMorningRound → feed_quantity',
      'handleMorningRound → water_level',
      'handleMorningRound → water_level + abnormal',
    ]);
  });
});

// ── 2. Real enforcement — a non-editable field actually blocks the write ───

describe('#203 assertWritable enforcement (real function, mocked worker-profile lookup)', () => {
  it('handleFeeding rejects when the worker profile marks feed_quantity read-only', async () => {
    (db.select as unknown as Mock).mockReturnValue(
      profileFields([{ fieldKey: 'feed_quantity', label: 'Feed qty', permission: 'readonly' }]),
    );
    const tx = { insert: () => insertChain() } as unknown as DbClient;
    await expect(handleFeeding(
      { clientUuid: 'c1', type: 'feeding', payload: { batchId: 'b1', quantityKg: 5 }, capturedAt: '2026-08-05T08:00:00Z' },
      't1', 'u1', tx, WORKER(),
    )).rejects.toThrow('feed_quantity');
  });

  it('handleFeeding succeeds when the worker profile marks feed_quantity editable', async () => {
    (db.select as unknown as Mock).mockReturnValue(
      profileFields([{ fieldKey: 'feed_quantity', label: 'Feed qty', permission: 'editable' }]),
    );
    const tx = { insert: () => insertChain() } as unknown as DbClient;
    await expect(handleFeeding(
      { clientUuid: 'c1', type: 'feeding', payload: { batchId: 'b1', quantityKg: 5 }, capturedAt: '2026-08-05T08:00:00Z' },
      't1', 'u1', tx, WORKER(),
    )).resolves.toEqual({ routed: true });
  });

  it('handleMortality rejects when mortality_cause is hidden and a cause is submitted', async () => {
    (db.select as unknown as Mock).mockReturnValue(
      profileFields([{ fieldKey: 'mortality_cause', label: 'Cause', permission: 'hidden' }]),
    );
    const tx = { insert: () => insertChain() } as unknown as DbClient;
    await expect(handleMortality(
      { clientUuid: 'c2', type: 'mortality', payload: { batchId: 'b1', count: 1, cause: 'Disease' }, capturedAt: '2026-08-05T08:00:00Z' },
      't1', 'u1', tx, WORKER(),
    )).rejects.toThrow('mortality_cause');
  });

  it('handleMortality is unaffected when no cause is submitted, even with the field hidden', async () => {
    (db.select as unknown as Mock).mockReturnValue(
      profileFields([{ fieldKey: 'mortality_cause', label: 'Cause', permission: 'hidden' }]),
    );
    const tx = { insert: () => insertChain() } as unknown as DbClient;
    await expect(handleMortality(
      { clientUuid: 'c2', type: 'mortality', payload: { batchId: 'b1', count: 1 }, capturedAt: '2026-08-05T08:00:00Z' },
      't1', 'u1', tx, WORKER(),
    )).resolves.toEqual({ routed: true });
  });

  it('handleProduction rejects a worker collecting a product whose collect_<x> field is hidden', async () => {
    (db.select as unknown as Mock).mockReturnValue(
      profileFields([{ fieldKey: 'collect_eggs', label: 'Collect Eggs', permission: 'hidden' }]),
    );
    const tx = {
      select: vi.fn().mockReturnValueOnce(selectOnce([{ baseUnit: 'piece', fieldKey: 'collect_eggs' }])),
    } as unknown as DbClient;
    await expect(handleProduction(
      { clientUuid: 'c3', type: 'production', payload: { batchId: 'b1', type: 'Eggs', qty: 10, productId: 'prod-eggs' }, capturedAt: '2026-08-05T08:00:00Z' },
      't1', 'u1', tx, WORKER(),
    )).rejects.toThrow('collect_eggs');
  });

  it('handleMorningRound rejects a worker whose profile hides eggs_collected', async () => {
    (db.select as unknown as Mock).mockReturnValue(
      profileFields([{ fieldKey: 'eggs_collected', label: 'Eggs', permission: 'hidden' }]),
    );
    const tx = {} as unknown as DbClient; // never reached — assertWritable throws first
    await expect(handleMorningRound(
      { clientUuid: 'mr1', type: 'morning_round', payload: { entries: [{ batchId: 'b1', eggsCollected: 6 }] }, capturedAt: '2026-08-05T08:00:00Z' },
      't1', 'u1', tx, WORKER(),
    )).rejects.toThrow('eggs_collected');
  });

  it('handleMorningRound rejects a worker whose profile marks water_level read-only', async () => {
    (db.select as unknown as Mock).mockReturnValue(
      profileFields([{ fieldKey: 'water_level', label: 'Water level', permission: 'readonly' }]),
    );
    const tx = {} as unknown as DbClient;
    await expect(handleMorningRound(
      { clientUuid: 'mr3', type: 'morning_round', payload: { entries: [{ batchId: 'b1', waterLevel: 'OK' }] }, capturedAt: '2026-08-05T08:00:00Z' },
      't1', 'u1', tx, WORKER(),
    )).rejects.toThrow('water_level');
  });

  it('handleMorningRound rejects a worker reporting an abnormality when abnormal is hidden', async () => {
    (db.select as unknown as Mock).mockReturnValue(
      profileFields([
        { fieldKey: 'water_level', label: 'Water level', permission: 'editable' },
        { fieldKey: 'abnormal', label: 'Abnormal', permission: 'hidden' },
      ]),
    );
    const tx = {} as unknown as DbClient;
    await expect(handleMorningRound(
      { clientUuid: 'mr4', type: 'morning_round', payload: { entries: [{ batchId: 'b1', abnormal: true }] }, capturedAt: '2026-08-05T08:00:00Z' },
      't1', 'u1', tx, WORKER(),
    )).rejects.toThrow('abnormal');
  });
});

// ── 3. Owner/manager bypass is preserved ────────────────────────────────────

describe('#203 owner/manager still bypass field permissions entirely', () => {
  it('owner writes a hidden-for-workers field without ever consulting a worker profile', async () => {
    const tx = { insert: () => insertChain() } as unknown as DbClient;
    await expect(handleFeeding(
      { clientUuid: 'c1', type: 'feeding', payload: { batchId: 'b1', quantityKg: 5 }, capturedAt: '2026-08-05T08:00:00Z' },
      't1', 'u1', tx, OWNER,
    )).resolves.toEqual({ routed: true });
    expect(db.select).not.toHaveBeenCalled();
  });

  it('manager writes a mortality cause without ever consulting a worker profile', async () => {
    const tx = { insert: () => insertChain() } as unknown as DbClient;
    await expect(handleMortality(
      { clientUuid: 'c2', type: 'mortality', payload: { batchId: 'b1', count: 1, cause: 'Disease' }, capturedAt: '2026-08-05T08:00:00Z' },
      't1', 'u1', tx, MANAGER,
    )).resolves.toEqual({ routed: true });
    expect(db.select).not.toHaveBeenCalled();
  });
});
