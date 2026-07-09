import { describe, it, expect, vi, beforeEach } from 'vitest';
import { computeBatchCost, computeDashboardKPIs } from '@/lib/server/costing';

const { mockDbSelect } = vi.hoisted(() => ({ mockDbSelect: vi.fn() }));
vi.mock('@/db', () => ({
  db: { select: mockDbSelect },
}));

function makeBatch(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'b1', tenantId: 't1', unitId: 'u1', name: 'Test Batch',
    species: 'poultry_layer', breed: 'Kienyeji', source: 'PURCHASED' as const,
    acquiredDate: '2026-01-01', ageAtAcquire: 1, initialQty: 100, currentQty: 95,
    stage: 'GROWING' as const, acquisitionCost: 50000, status: 'ACTIVE' as const,
    ...overrides,
  };
}

function makeWhere(rows: unknown[]) {
  const p = Promise.resolve(rows) as Promise<unknown[]> & { limit?: ReturnType<typeof vi.fn> };
  p.limit = vi.fn((n: number) => Promise.resolve(rows.slice(0, n)));
  return p;
}

function mockChain(_tableName: string, result: unknown[]) {
  return {
    from: vi.fn(() => ({
      where: vi.fn(() => makeWhere(result)),
    })),
  };
}

beforeEach(() => {
  mockDbSelect.mockReset();
});

describe('computeBatchCost', () => {
  it('returns null for non-existent batch', async () => {
    mockDbSelect.mockReturnValueOnce({
      from: vi.fn(() => ({
        where: vi.fn(() => {
          const p = Promise.resolve([]) as Promise<unknown[]> & { limit?: ReturnType<typeof vi.fn> };
          p.limit = vi.fn(() => Promise.resolve([]));
          return p;
        }),
      })),
    });
    const result = await computeBatchCost('t1', 'nonexistent');
    expect(result).toBeNull();
  });

  it('computes basic cost summary correctly', async () => {
    mockDbSelect
      .mockReturnValueOnce(mockChain('batches', [makeBatch()]))
      .mockReturnValueOnce(mockChain('lots', [{ id: 'l1', unitCost: 50 }]))
      .mockReturnValueOnce(mockChain('feedings', [
        { quantityKg: 100, lotId: 'l1', batchId: 'b1', tenantId: 't1' },
        { quantityKg: 50, lotId: 'l1', batchId: 'b1', tenantId: 't1' },
      ]))
      .mockReturnValueOnce(mockChain('morts', [
        { count: 3, batchId: 'b1', tenantId: 't1' },
        { count: 2, batchId: 'b1', tenantId: 't1' },
      ]))
      .mockReturnValueOnce(mockChain('prods', [{ type: 'eggs', qty: 500, batchId: 'b1', tenantId: 't1' }]))
      .mockReturnValueOnce(mockChain('sales', [
        { totalAmount: 30000, batchId: 'b1', tenantId: 't1' },
        { totalAmount: 15000, batchId: 'b1', tenantId: 't1' },
      ]))
      .mockReturnValueOnce(mockChain('health', []))
      .mockReturnValueOnce(mockChain('labor', []))
      .mockReturnValueOnce(mockChain('overhead', []))
      .mockReturnValueOnce(mockChain('batches2', [makeBatch({ id: 'b1', currentQty: 95 })]))
      .mockReturnValueOnce(mockChain('products', []));

    const result = await computeBatchCost('t1', 'b1');
    expect(result).not.toBeNull();
    expect(result!.acquisitionCost).toBe(50000);
    expect(result!.feedCost).toBe(7500);
    expect(result!.totalCost).toBe(57500);
    expect(result!.totalRevenue).toBe(45000);
    expect(result!.grossMargin).toBe(-12500);
    expect(result!.mortalityPct).toBe(5);
  });

  it('computes costPerUnit as totalCost / eggs', async () => {
    mockDbSelect
      .mockReturnValueOnce(mockChain('batches', [makeBatch()]))
      .mockReturnValueOnce(mockChain('lots', []))
      .mockReturnValueOnce(mockChain('feedings', []))
      .mockReturnValueOnce(mockChain('morts', []))
      .mockReturnValueOnce(mockChain('prods', [{ type: 'eggs', qty: 1000, batchId: 'b1', tenantId: 't1' }]))
      .mockReturnValueOnce(mockChain('sales', []))
      .mockReturnValueOnce(mockChain('health', []))
      .mockReturnValueOnce(mockChain('labor', []))
      .mockReturnValueOnce(mockChain('overhead', []))
      .mockReturnValueOnce(mockChain('batches2', [makeBatch({ currentQty: 95 })]))
      .mockReturnValueOnce(mockChain('products', []));

    const result = await computeBatchCost('t1', 'b1');
    expect(result!.costPerUnit).toBe(50);
  });

  it('computes FCR as feed kg per dozen eggs', async () => {
    mockDbSelect
      .mockReturnValueOnce(mockChain('batches', [makeBatch()]))
      .mockReturnValueOnce(mockChain('lots', [{ id: 'l1', unitCost: 10 }]))
      .mockReturnValueOnce(mockChain('feedings', [
        { quantityKg: 200, lotId: 'l1', batchId: 'b1', tenantId: 't1' },
      ]))
      .mockReturnValueOnce(mockChain('morts', []))
      .mockReturnValueOnce(mockChain('prods', [{ type: 'eggs', qty: 500, batchId: 'b1', tenantId: 't1' }]))
      .mockReturnValueOnce(mockChain('sales', []))
      .mockReturnValueOnce(mockChain('health', []))
      .mockReturnValueOnce(mockChain('labor', []))
      .mockReturnValueOnce(mockChain('overhead', []))
      .mockReturnValueOnce(mockChain('batches2', [makeBatch({ currentQty: 95 })]))
      .mockReturnValueOnce(mockChain('products', []));

    const result = await computeBatchCost('t1', 'b1');
    expect(result!.fcr).toBe(4.8);
  });

  it('computes break-even price per remaining bird', async () => {
    mockDbSelect
      .mockReturnValueOnce(mockChain('batches', [makeBatch({ acquisitionCost: 21000, initialQty: 100, currentQty: 95 })]))
      .mockReturnValueOnce(mockChain('lots', []))
      .mockReturnValueOnce(mockChain('feedings', []))
      .mockReturnValueOnce(mockChain('morts', [{ count: 5, batchId: 'b1', tenantId: 't1' }]))
      .mockReturnValueOnce(mockChain('prods', []))
      .mockReturnValueOnce(mockChain('sales', [{ totalAmount: 17500, batchId: 'b1', tenantId: 't1' }]))
      .mockReturnValueOnce(mockChain('health', []))
      .mockReturnValueOnce(mockChain('labor', []))
      .mockReturnValueOnce(mockChain('overhead', []))
      .mockReturnValueOnce(mockChain('batches2', [makeBatch({ currentQty: 95 })]))
      .mockReturnValueOnce(mockChain('products', []));

    const result = await computeBatchCost('t1', 'b1');
    expect(result!.totalCost).toBe(21000);
    expect(result!.totalRevenue).toBe(17500);
    expect(result!.costPerBird).toBeCloseTo(221.05, 1);
    expect(result!.breakEvenPricePerRemaining).toBeCloseTo(36.84, 1);
    expect(result!.remainingQty).toBe(95);
  });

  it('costPerBird spreads total cost over SURVIVORS, not the unsold remainder', async () => {
    // initial 100, 0 died → 100 survivors; currentQty 50 means 50 were already sold.
    // cost/animal must divide by survivors (100), NOT by the 50 left on the farm —
    // otherwise selling birds would inflate each remaining one's apparent cost.
    mockDbSelect
      .mockReturnValueOnce(mockChain('batches', [makeBatch({ acquisitionCost: 100000, initialQty: 100, currentQty: 50 })]))
      .mockReturnValueOnce(mockChain('lots', []))
      .mockReturnValueOnce(mockChain('feedings', []))
      .mockReturnValueOnce(mockChain('morts', []))
      .mockReturnValueOnce(mockChain('prods', []))
      .mockReturnValueOnce(mockChain('sales', [{ totalAmount: 10000, batchId: 'b1', tenantId: 't1' }]))
      .mockReturnValueOnce(mockChain('health', []))
      .mockReturnValueOnce(mockChain('labor', []))
      .mockReturnValueOnce(mockChain('overhead', []))
      .mockReturnValueOnce(mockChain('batches2', [makeBatch({ initialQty: 100, currentQty: 50 })]));

    const result = await computeBatchCost('t1', 'b1');
    expect(result!.survivors).toBe(100);          // none died
    expect(result!.soldHead).toBe(50);            // 100 survivors − 50 on farm
    expect(result!.costPerBird).toBe(1000);       // 100000 / 100 survivors (NOT /50 = 2000)
    expect(result!.remainingQty).toBe(50);
    expect(result!.breakEvenPricePerRemaining).toBe(1800); // (100000 − 10000) / 50
  });

  it('break-even uses CURRENT position: (totalCost − revenue) ÷ unsold, after mortality AND sales', async () => {
    // The exact worked example from the spec: 100 birds @150 + 1000 vacc + 5000 feed
    // = 21,000; 5 died (95 survivors); 70 sold @250 = 17,500; 25 unsold.
    // cost/surviving bird = 21,000/95 = 221.05; break-even = 3,500/25 = 140 (NOT 840).
    mockDbSelect
      .mockReturnValueOnce(mockChain('batches', [makeBatch({ acquisitionCost: 15000, initialQty: 100, currentQty: 25 })]))
      .mockReturnValueOnce(mockChain('lots', [{ id: 'l1', unitCost: 1 }]))
      .mockReturnValueOnce(mockChain('feedings', [{ quantityKg: 5000, lotId: 'l1', batchId: 'b1', tenantId: 't1' }]))
      .mockReturnValueOnce(mockChain('morts', [{ count: 5, batchId: 'b1', tenantId: 't1' }]))
      .mockReturnValueOnce(mockChain('prods', []))
      .mockReturnValueOnce(mockChain('sales', [{ totalAmount: 17500, batchId: 'b1', tenantId: 't1' }]))
      .mockReturnValueOnce(mockChain('health', [{ quantity: 1000, productLotId: 'l1', batchId: 'b1', tenantId: 't1' }]))
      .mockReturnValueOnce(mockChain('labor', []))
      .mockReturnValueOnce(mockChain('overhead', []))
      .mockReturnValueOnce(mockChain('batches2', [makeBatch({ initialQty: 100, currentQty: 25 })]));

    const result = await computeBatchCost('t1', 'b1');
    expect(result!.totalCost).toBe(21000);            // 15000 + 5000 feed + 1000 health
    expect(result!.survivors).toBe(95);
    expect(result!.soldHead).toBe(70);                // 95 − 25
    expect(result!.costPerBird).toBeCloseTo(221.05, 1);
    expect(result!.remainingQty).toBe(25);
    expect(result!.breakEvenPricePerRemaining).toBe(140); // (21000 − 17500) / 25
  });

  it('sets breakEvenPricePerRemaining to 0 when already profitable', async () => {
    mockDbSelect
      .mockReturnValueOnce(mockChain('batches', [makeBatch({ acquisitionCost: 30000, currentQty: 50 })]))
      .mockReturnValueOnce(mockChain('lots', []))
      .mockReturnValueOnce(mockChain('feedings', []))
      .mockReturnValueOnce(mockChain('morts', []))
      .mockReturnValueOnce(mockChain('prods', []))
      .mockReturnValueOnce(mockChain('sales', [{ totalAmount: 50000, batchId: 'b1', tenantId: 't1' }]))
      .mockReturnValueOnce(mockChain('health', []))
      .mockReturnValueOnce(mockChain('labor', []))
      .mockReturnValueOnce(mockChain('overhead', []))
      .mockReturnValueOnce(mockChain('batches2', [makeBatch({ currentQty: 50 })]))
      .mockReturnValueOnce(mockChain('products', []));

    const result = await computeBatchCost('t1', 'b1');
    expect(result!.grossMargin).toBe(20000);
    expect(result!.breakEvenPricePerRemaining).toBe(0);
  });

  it('allocates overhead proportionally by population share', async () => {
    mockDbSelect
      .mockReturnValueOnce(mockChain('batches', [makeBatch({ currentQty: 50 })]))
      .mockReturnValueOnce(mockChain('lots', []))
      .mockReturnValueOnce(mockChain('feedings', []))
      .mockReturnValueOnce(mockChain('morts', []))
      .mockReturnValueOnce(mockChain('prods', []))
      .mockReturnValueOnce(mockChain('sales', []))
      .mockReturnValueOnce(mockChain('health', []))
      .mockReturnValueOnce(mockChain('labor', []))
      .mockReturnValueOnce(mockChain('overhead', [{ amount: 10000, tenantId: 't1' }]))
      .mockReturnValueOnce(mockChain('batches2', [
        { id: 'b1', qty: 50, status: 'ACTIVE' },
        { id: 'b2', qty: 150, status: 'ACTIVE' },
        { id: 'b3', qty: 0, status: 'CLOSED' },
      ]))
      .mockReturnValueOnce(mockChain('products', []));

    const result = await computeBatchCost('t1', 'b1');
    expect(result!.overheadCost).toBe(2500);
  });

  it('rounds all monetary values to 2 decimal places', async () => {
    mockDbSelect
      .mockReturnValueOnce(mockChain('batches', [makeBatch({ acquisitionCost: 100.333 })]))
      .mockReturnValueOnce(mockChain('lots', [{ id: 'l1', unitCost: 10.555 }]))
      .mockReturnValueOnce(mockChain('feedings', [{ quantityKg: 10, lotId: 'l1', batchId: 'b1', tenantId: 't1' }]))
      .mockReturnValueOnce(mockChain('morts', []))
      .mockReturnValueOnce(mockChain('prods', []))
      .mockReturnValueOnce(mockChain('sales', []))
      .mockReturnValueOnce(mockChain('health', []))
      .mockReturnValueOnce(mockChain('labor', []))
      .mockReturnValueOnce(mockChain('overhead', []))
      .mockReturnValueOnce(mockChain('batches2', [makeBatch({ currentQty: 95 })]))
      .mockReturnValueOnce(mockChain('products', []));

    const result = await computeBatchCost('t1', 'b1')!;
    const values = [
      result!.feedCost, result!.totalCost, result!.costPerBird, result!.breakEvenPricePerRemaining,
    ];
    for (const v of values) {
      if (v !== undefined) {
        const str = v.toFixed(2);
        expect(Number(str)).toBe(v);
      }
    }
  });
});

describe('computeBatchCost — labour from actual payroll', () => {
  function run(labour: number) {
    mockDbSelect
      .mockReturnValueOnce(mockChain('batches', [makeBatch({ acquisitionCost: 10000, initialQty: 100, currentQty: 100 })]))
      .mockReturnValueOnce(mockChain('lots', []))
      .mockReturnValueOnce(mockChain('feedings', []))
      .mockReturnValueOnce(mockChain('morts', []))
      .mockReturnValueOnce(mockChain('prods', []))
      .mockReturnValueOnce(mockChain('sales', []))
      .mockReturnValueOnce(mockChain('health', []))
      .mockReturnValueOnce(mockChain('labor', []))
      .mockReturnValueOnce(mockChain('overhead', []))
      .mockReturnValueOnce(mockChain('batches2', [makeBatch({ currentQty: 100 })]));
    return computeBatchCost('t1', 'b1', labour);
  }

  it('uses the allocated payroll labour DIRECTLY (no months-active estimate)', async () => {
    const result = await run(5000); // this batch's share of disbursed payroll
    expect(result!.salaryCost).toBe(5000);
    expect(result!.totalCost).toBe(15000); // 10000 acquisition + 5000 labour
  });

  it('larger payroll → larger labour, regardless of batch age', async () => {
    const result = await run(12000);
    expect(result!.salaryCost).toBe(12000);
    expect(result!.totalCost).toBe(22000); // 10000 + 12000
  });

  it('adds nothing when no salary is allocated (default arg)', async () => {
    mockDbSelect
      .mockReturnValueOnce(mockChain('batches', [makeBatch({ acquisitionCost: 10000, currentQty: 100 })]))
      .mockReturnValueOnce(mockChain('lots', []))
      .mockReturnValueOnce(mockChain('feedings', []))
      .mockReturnValueOnce(mockChain('morts', []))
      .mockReturnValueOnce(mockChain('prods', []))
      .mockReturnValueOnce(mockChain('sales', []))
      .mockReturnValueOnce(mockChain('health', []))
      .mockReturnValueOnce(mockChain('labor', []))
      .mockReturnValueOnce(mockChain('overhead', []))
      .mockReturnValueOnce(mockChain('batches2', [makeBatch({ currentQty: 100 })]));
    const result = await computeBatchCost('t1', 'b1');
    expect(result!.salaryCost).toBe(0);
    expect(result!.totalCost).toBe(10000);
  });
});

describe('computeDashboardKPIs', () => {
  it('computes KPIs across all batches (bulk load, not N+1)', async () => {
    // Promise.all fires many selects; mock every from() chain to return empty/safe rows.
    // batches must return the three test batches whenever queried (dashboard + batchLabour).
    const batchRows = [
      makeBatch({ id: 'b1', status: 'ACTIVE', currentQty: 100, initialQty: 100 }),
      makeBatch({ id: 'b2', status: 'ACTIVE', currentQty: 50, initialQty: 55 }),
      makeBatch({ id: 'b3', status: 'CLOSED', currentQty: 0, initialQty: 80 }),
    ];
    mockDbSelect.mockImplementation(() => ({
      from: vi.fn((table: unknown) => {
        // Heuristic: if the table object looks like batches (has name via drizzle internals
        // is hard). Always return batchRows for the first where that needs batches-shaped
        // data, empty for others — KPIs only need batch ids/qty for the totals asserted.
        const where = vi.fn(() => {
          const p = Promise.resolve([]) as Promise<unknown[]> & { limit?: ReturnType<typeof vi.fn> };
          p.limit = vi.fn(() => Promise.resolve([]));
          return p;
        });
        // Always resolve batches-shaped data when caller expects many fields — simpler:
        // return batchRows for any select that isn't filtered to empty. The dashboard
        // reduces activeBatches/totalBirds from allBatches only.
        return {
          where: vi.fn(() => {
            // batchLabour and dashboard both select from batches — return batchRows.
            // Other tables: empty. Distinguishing tables in mocks is fragile; return
            // batchRows only when result items look needed — use call count.
            return Promise.resolve(batchRows);
          }),
        };
      }),
    }));

    // More precise: alternate by call order matching Promise.all + batchLabour internals.
    mockDbSelect.mockReset();
    const empty = mockChain('empty', []);
    const batchesChain = mockChain('batches', batchRows);
    // computeDashboardKPIs's own Promise.all: batches, morts, sales, alerts, tasks,
    // then computeAllBatchCosts(tenantId) — which synchronously fires its own
    // Promise.all (batches, morts, sales, lots, feedings, prod, health, labor,
    // overhead, batchLabour(tenantId)), and batchLabour in turn fires its own
    // Promise.all (emps, batches, slips). All of these are built (and their
    // db.select() calls issued) synchronously before anything awaits, so the
    // mock call order is exactly this depth-first sequence.
    mockDbSelect
      // computeDashboardKPIs: batches, morts, sales, alerts, tasks
      .mockReturnValueOnce(batchesChain)
      .mockReturnValueOnce(empty)
      .mockReturnValueOnce(empty)
      .mockReturnValueOnce(empty)
      .mockReturnValueOnce(empty)
      // computeAllBatchCosts: batches, morts, sales, lots, feedings, prod, health, labor, overhead
      .mockReturnValueOnce(batchesChain)
      .mockReturnValueOnce(empty)
      .mockReturnValueOnce(empty)
      .mockReturnValueOnce(empty)
      .mockReturnValueOnce(empty)
      .mockReturnValueOnce(empty)
      .mockReturnValueOnce(empty)
      .mockReturnValueOnce(empty)
      .mockReturnValueOnce(empty)
      // batchLabour: emps, batches, slips
      .mockReturnValueOnce(empty)
      .mockReturnValueOnce(batchesChain)
      .mockReturnValueOnce(empty);

    const result = await computeDashboardKPIs('t1');
    expect(result.activeBatches).toBe(2);
    expect(result.totalBirds).toBe(150);
    expect(result.mortalityPct).toBe(0);
    expect(result.revenueThisMonth).toBe(0);
    for (const [k, v] of Object.entries(result)) {
      if (k === 'enterpriseBreaks') continue;
      expect(typeof v).toBe('number');
      expect(Number.isFinite(v as number)).toBe(true);
    }
  });
});
