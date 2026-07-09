import { describe, it, expect } from 'vitest';
import { summarizeBatchCost } from '@/lib/server/costing';

describe('summarizeBatchCost (pure)', () => {
  const batch = {
    id: 'b1',
    species: 'poultry_layer',
    acquisitionCost: 50000,
    initialQty: 100,
    currentQty: 95,
    status: 'ACTIVE',
    acquiredDate: '2026-01-01',
  };

  it('computes feed cost from lot map', () => {
    const lotCost = new Map([['l1', 50]]);
    const result = summarizeBatchCost(batch, {
      lotCost,
      feedings: [
        { quantityKg: 100, lotId: 'l1' },
        { quantityKg: 50, lotId: 'l1' },
      ],
      morts: [{ count: 3 }, { count: 2 }],
      prod: [{ type: 'eggs', qty: 500, weightKg: null }],
      salesRows: [
        { totalAmount: 30000, weightKg: null },
        { totalAmount: 15000, weightKg: null },
      ],
      healthRows: [],
      laborRows: [],
      totalOverhead: 0,
      totalActiveQty: 95,
      batchLabourCost: 0,
    });
    expect(result.feedCost).toBe(7500);
    expect(result.totalCost).toBe(57500);
    expect(result.totalRevenue).toBe(45000);
    expect(result.mortalityPct).toBe(5);
  });
});
