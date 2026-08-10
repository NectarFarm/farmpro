import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from '@/app/api/setup/route';
import {
  batches, products, workerProfiles, alerts,
} from '@/db/schemas';

// #26: the setup wizard inserted batches with a raw `tx.insert(batches)` and
// never called createProductsForBatch(), so a farmer who completed the entire
// wizard got batches with zero products — no collection, no sale, empty
// product lists — despite the Setup Guide promising the opposite. This test
// exercises the real exported POST handler end to end (not a copy of its
// logic), with '@/db' mocked as an in-memory, table-identity-keyed store so
// the whole transaction body actually runs against real table objects from
// '@/db/schemas' (imported here, unmocked, so `===` identity matches what
// the route/products.ts use internally).

const { mockGetSession } = vi.hoisted(() => ({ mockGetSession: vi.fn() }));
vi.mock('@/lib/server/session', () => ({ getSession: mockGetSession }));

// In-memory fake transaction: every table is keyed by its actual schema
// object identity, so selects/inserts/updates/deletes route to the right
// bucket regardless of call order — this lets the real, unmodified route
// logic run (units, stages, worker-profile, batches+products, inventory,
// employees, alert rules) without hand-sequencing dozens of mockReturnValueOnce
// calls tied to one specific implementation's call order.
function makeFakeTx() {
  const store = new Map<unknown, Record<string, unknown>[]>();
  const rowsOf = (table: unknown) => store.get(table) ?? [];
  const setRowsOf = (table: unknown, rows: Record<string, unknown>[]) => store.set(table, rows);

  function selectBuilder(table: unknown) {
    const builder: Record<string, unknown> = {
      where: () => builder,
      orderBy: () => builder,
      limit: () => builder,
      for: () => builder,
      then: (resolve: (v: unknown) => void) => resolve(rowsOf(table)),
    };
    return builder;
  }

  function insertResult(rowsArr: Record<string, unknown>[]) {
    const result: Record<string, unknown> = {
      onConflictDoNothing: () => result,
      returning: () => Promise.resolve(rowsArr.map((r) => ({ id: r.id }))),
      then: (resolve: (v: unknown) => void) => resolve(undefined),
    };
    return result;
  }

  const tx = {
    select: (_sel?: unknown) => ({ from: (table: unknown) => selectBuilder(table) }),
    insert: (table: unknown) => ({
      values: (row: Record<string, unknown> | Record<string, unknown>[]) => {
        const rowsArr = Array.isArray(row) ? row : [row];
        setRowsOf(table, [...rowsOf(table), ...rowsArr]);
        return insertResult(rowsArr);
      },
    }),
    update: (table: unknown) => ({
      set: (patch: Record<string, unknown>) => ({
        where: () => {
          // Simplification: applies the patch to every row currently in this
          // table's bucket. Fine here — every test scenario below has at most
          // one row per table by the time an update runs.
          setRowsOf(table, rowsOf(table).map((r) => ({ ...r, ...patch })));
          return Promise.resolve(undefined);
        },
      }),
    }),
    delete: (table: unknown) => ({
      where: () => { setRowsOf(table, []); return Promise.resolve(undefined); },
    }),
  };

  return { tx, store };
}

const { mockDbTransaction } = vi.hoisted(() => ({ mockDbTransaction: vi.fn() }));
vi.mock('@/db', () => ({
  db: { transaction: mockDbTransaction, select: vi.fn(), insert: vi.fn(), update: vi.fn(), delete: vi.fn() },
}));

function req(body: Record<string, unknown>) {
  return new Request('http://localhost/api/setup', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

describe('POST /api/setup', () => {
  let store: Map<unknown, Record<string, unknown>[]>;

  beforeEach(() => {
    mockGetSession.mockReset();
    mockDbTransaction.mockReset();
    mockGetSession.mockResolvedValue({ userId: 'u1', tenantId: 't1', role: 'owner', name: 'Owner', exp: 0 });
    mockDbTransaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => {
      const fake = makeFakeTx();
      store = fake.store;
      return cb(fake.tx);
    });
  });

  const body = {
    units: [{ name: 'Coop A' }],
    batches: [{ name: 'Batch 1', species: 'layers', qty: '10', cost: '5000', unitName: 'Coop A' }],
  };

  it('a completed wizard run creates products for the batch (was zero before this fix)', async () => {
    const res = await POST(req(body));
    expect(res.status).toBe(201);

    const createdBatches = store.get(batches) ?? [];
    expect(createdBatches).toHaveLength(1);
    const batchId = createdBatches[0].id as string;

    const createdProducts = (store.get(products) ?? []).filter((p) => p.batchId === batchId);
    // This is the assertion that fails against the unfixed route: it never
    // called createProductsForBatch, so createdProducts was always [].
    expect(createdProducts.length).toBeGreaterThan(0);
    expect(createdProducts.map((p) => p.name).sort()).toEqual(['Eggs', 'Manure', 'Spent hen'].sort());
  });

  it('exactly one product is the cost driver, and base/sale units come from the layers template', async () => {
    await POST(req(body));
    const createdProducts = store.get(products) ?? [];
    const costDrivers = createdProducts.filter((p) => p.isCostDriver);
    expect(costDrivers).toHaveLength(1);
    expect(costDrivers[0].name).toBe('Eggs');
    expect(costDrivers[0].baseUnit).toBe('piece');
    expect(costDrivers[0].saleUnits).toEqual([
      { name: 'Tray (30)', perBase: 30, price: 360 },
      { name: 'Piece', perBase: 1, price: 13 },
    ]);
  });

  it('persists batches.enterprise instead of leaving it null for the wizard to guess later', async () => {
    await POST(req(body));
    const createdBatches = store.get(batches) ?? [];
    expect(createdBatches[0].enterprise).toBe('layers');
  });

  it('grants the worker profile the matching collect permissions for collectible products', async () => {
    await POST(req(body));
    const profiles = store.get(workerProfiles) ?? [];
    expect(profiles).toHaveLength(1);
    const fields = profiles[0].fields as { fieldKey: string }[];
    const keys = fields.map((f) => f.fieldKey);
    // Eggs and Manure are collectible; "Spent hen" is the live animal (sold,
    // not collected) so it must NOT get a collect_ permission field.
    expect(keys).toContain('collect_eggs');
    expect(keys).toContain('collect_manure');
    expect(keys).not.toContain('collect_spent_hen');
  });

  it('raises an "assign a collector" alert for each collectible product', async () => {
    await POST(req(body));
    const createdAlerts = store.get(alerts) ?? [];
    const titles = createdAlerts.map((a) => a.title);
    expect(titles.filter((t) => t === 'Assign a collector')).toHaveLength(2); // Eggs + Manure
  });

  it('re-running the wizard with the same batch name does not duplicate products', async () => {
    await POST(req(body));
    const firstRunCount = (store.get(products) ?? []).length;
    expect(firstRunCount).toBeGreaterThan(0);

    // Second submission: the fake store's `batches` bucket already has
    // "Batch 1", so the route's idempotent-by-name check should skip both
    // the batch insert and the product creation that hangs off it.
    await POST(req(body));
    const secondRunCount = (store.get(products) ?? []).length;
    expect(secondRunCount).toBe(firstRunCount);
    expect(store.get(batches) ?? []).toHaveLength(1);
  });
});
