import { describe, it, expect } from 'vitest';
import { summarizeBatchCost } from '@/lib/server/costing';
import { PRODUCT_TEMPLATES } from '@/lib/server/productTemplates';

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
      prod: [{ type: 'eggs', qty: 500, weightKg: null, productId: null, baseUnit: null }],
      salesRows: [
        { totalAmount: 30000, weightKg: null },
        { totalAmount: 15000, weightKg: null },
      ],
      healthRows: [],
      laborRows: [],
      products: [],
      totalOverhead: 0,
      totalActiveQty: 95,
      batchLabourCost: 0,
    });
    expect(result.feedCost).toBe(7500);
    expect(result.totalCost).toBe(57500);
    expect(result.totalRevenue).toBe(45000);
    expect(result.mortalityPct).toBe(5);
  });

  // ─── #23: output/costPerUnit/fcr derived from the cost-driver product ──────
  // This is the bug fix's actual proof: costPerUnit must be non-zero for every
  // one of these enterprises, not just layers (previously it was 0 for all of
  // them because the old code summed a `weightKg` field the UI never writes).

  it.each([
    ['broilers', 'Live bird', 'head'],
    ['pig_fatten', 'Pork (live weight)', 'kg'],
    ['tilapia', 'Fish', 'kg'],
    ['dairy', 'Milk', 'litre'],
    ['maize', 'Maize grain', 'kg'],
  ])('%s: costPerUnit is non-zero, derived from the %s driver (%s)', (enterprise, driverName, baseUnit) => {
    const driver = PRODUCT_TEMPLATES[enterprise].find((p) => p.name === driverName);
    expect(driver?.isCostDriver).toBe(true);

    const b = { ...batch, enterprise, species: '' };
    const result = summarizeBatchCost(b, {
      lotCost: new Map([['l1', 20]]),
      feedings: [{ quantityKg: 100, lotId: 'l1' }],
      morts: [],
      prod: [{ type: driverName, qty: 40, weightKg: null, productId: 'drv1', baseUnit }],
      salesRows: [],
      healthRows: [],
      laborRows: [],
      products: [{ id: 'drv1', baseUnit, isCostDriver: true }],
      totalOverhead: 0,
      totalActiveQty: 95,
      batchLabourCost: 0,
    });

    expect(result.outputUnit).toBe(baseUnit);
    expect(result.outputQty).toBe(40);
    // totalCost = acquisitionCost(50000) + feedCost(100*20=2000) = 52000
    expect(result.costPerUnit).toBeCloseTo(52000 / 40, 5);
    expect(result.costPerUnit).toBeGreaterThan(0);
  });

  it('maize: fcr is undefined even though feed was logged and output was recorded — a crop has no FCR concept', () => {
    const b = { ...batch, enterprise: 'maize', species: '' };
    const result = summarizeBatchCost(b, {
      lotCost: new Map([['l1', 20]]),
      feedings: [{ quantityKg: 100, lotId: 'l1' }],
      morts: [],
      prod: [{ type: 'Maize grain', qty: 900, weightKg: null, productId: 'drv1', baseUnit: 'kg' }],
      salesRows: [],
      healthRows: [],
      laborRows: [],
      products: [{ id: 'drv1', baseUnit: 'kg', isCostDriver: true }],
      totalOverhead: 0,
      totalActiveQty: 95,
      batchLabourCost: 0,
    });
    expect(result.outputQty).toBe(900);
    expect(result.costPerUnit).toBeGreaterThan(0);
    expect(result.fcrMode).toBe('NONE');
    expect(result.fcr).toBeUndefined();
  });

  it('layers: fcr is feed-kg per DOZEN eggs (PER_DOZEN mode), not a magic ×12 substring check', () => {
    const b = { ...batch, enterprise: 'layers' };
    const result = summarizeBatchCost(b, {
      lotCost: new Map([['l1', 1]]),
      feedings: [{ quantityKg: 200, lotId: 'l1' }],
      morts: [],
      prod: [{ type: 'eggs', qty: 500, weightKg: null, productId: 'drv1', baseUnit: 'piece' }],
      salesRows: [],
      healthRows: [],
      laborRows: [],
      products: [{ id: 'drv1', baseUnit: 'piece', isCostDriver: true }],
      totalOverhead: 0,
      totalActiveQty: 95,
      batchLabourCost: 0,
    });
    expect(result.fcrMode).toBe('PER_DOZEN');
    expect(result.fcr).toBe(4.8); // 200 / (500/12)
  });

  it('dairy: fcr is feed-kg per litre of milk (PER_BASE_UNIT mode)', () => {
    const b = { ...batch, enterprise: 'dairy', species: '' };
    const result = summarizeBatchCost(b, {
      lotCost: new Map([['l1', 1]]),
      feedings: [{ quantityKg: 50, lotId: 'l1' }],
      morts: [],
      prod: [{ type: 'Milk', qty: 25, weightKg: null, productId: 'drv1', baseUnit: 'litre' }],
      salesRows: [],
      healthRows: [],
      laborRows: [],
      products: [{ id: 'drv1', baseUnit: 'litre', isCostDriver: true }],
      totalOverhead: 0,
      totalActiveQty: 95,
      batchLabourCost: 0,
    });
    expect(result.fcrMode).toBe('PER_BASE_UNIT');
    expect(result.fcr).toBe(2); // 50 / 25
  });

  it.each(Object.keys(PRODUCT_TEMPLATES))(
    '%s: every enterprise has an explicit, named FCR mode (no magic numbers / substring matching)',
    (enterprise) => {
      const b = { ...batch, enterprise, species: '' };
      const result = summarizeBatchCost(b, {
        lotCost: new Map(),
        feedings: [],
        morts: [],
        prod: [],
        salesRows: [],
        healthRows: [],
        laborRows: [],
        products: [],
        totalOverhead: 0,
        totalActiveQty: 0,
        batchLabourCost: 0,
      });
      expect(['PER_KG', 'PER_BASE_UNIT', 'PER_DOZEN', 'NONE']).toContain(result.fcrMode);
    }
  );

  // ─── Mandatory: three distinguishable states ───────────────────────────────

  it('no cost driver configured → outputQty AND costPerUnit are undefined, never 0', () => {
    const b = { ...batch, enterprise: 'goats', species: '' };
    const result = summarizeBatchCost(b, {
      lotCost: new Map([['l1', 10]]),
      feedings: [{ quantityKg: 50, lotId: 'l1' }],
      morts: [],
      prod: [{ type: 'Live goat', qty: 5, weightKg: null, productId: null, baseUnit: null }],
      salesRows: [],
      healthRows: [],
      laborRows: [],
      products: [], // no products at all — batch predates #21, or products were deleted
      totalOverhead: 0,
      totalActiveQty: 95,
      batchLabourCost: 0,
    });
    expect(result.outputQty).toBeUndefined();
    expect(result.costPerUnit).toBeUndefined();
    expect(result.fcr).toBeUndefined();
  });

  it('cost driver exists but has ZERO output recorded (meat goats never milked) → outputQty is 0, distinguishable from "no driver"', () => {
    const b = { ...batch, enterprise: 'goats', species: '' };
    const result = summarizeBatchCost(b, {
      lotCost: new Map([['l1', 10]]),
      feedings: [{ quantityKg: 50, lotId: 'l1' }],
      morts: [],
      // Only the (non-driver) live goat was recorded — the batch's Milk driver
      // has no production rows at all, exactly the "meat goats" scenario in #23.
      prod: [{ type: 'Live goat', qty: 5, weightKg: null, productId: 'other-product', baseUnit: 'head' }],
      salesRows: [],
      healthRows: [],
      laborRows: [],
      products: [
        { id: 'other-product', baseUnit: 'head', isCostDriver: false },
        { id: 'milk-driver', baseUnit: 'litre', isCostDriver: true },
      ],
      totalOverhead: 0,
      totalActiveQty: 95,
      batchLabourCost: 0,
    });
    // Driver IS configured (unlike the previous test) — outputQty is a real 0,
    // not an absence. totalCost / 0 must never happen: costPerUnit and fcr stay
    // undefined rather than Infinity/NaN.
    expect(result.outputQty).toBe(0);
    expect(result.costPerUnit).toBeUndefined();
    expect(result.fcr).toBeUndefined();
  });

  // ─── Mandatory: NULL product_id rows never leak into or masquerade as output ─

  it('production rows with product_id IS NULL are excluded from the output sum entirely (not counted as 0, not summed in)', () => {
    const b = { ...batch, enterprise: 'tilapia', species: '' };
    const result = summarizeBatchCost(b, {
      lotCost: new Map(),
      feedings: [],
      morts: [],
      prod: [
        { type: 'Fish', qty: 100, weightKg: null, productId: 'drv1', baseUnit: 'kg' }, // counts
        { type: 'Fish', qty: 99999, weightKg: null, productId: null, baseUnit: null }, // legacy/unresolved — must NOT count
      ],
      salesRows: [],
      healthRows: [],
      laborRows: [],
      products: [{ id: 'drv1', baseUnit: 'kg', isCostDriver: true }],
      totalOverhead: 0,
      totalActiveQty: 95,
      batchLabourCost: 0,
    });
    expect(result.outputQty).toBe(100);
  });

  // ─── Mandatory: don't trust production_records.base_unit blindly ───────────

  it("a production row whose SNAPSHOT base_unit no longer matches the driver product's CURRENT base_unit is excluded (unit drift protection)", () => {
    const b = { ...batch, enterprise: 'maize', species: '' };
    const result = summarizeBatchCost(b, {
      lotCost: new Map(),
      feedings: [],
      morts: [],
      prod: [
        { type: 'Maize grain', qty: 50, weightKg: null, productId: 'drv1', baseUnit: 'kg' }, // matches current unit — counts
        { type: 'Maize grain', qty: 1000, weightKg: null, productId: 'drv1', baseUnit: 'bag' }, // stale snapshot from before an edit — excluded
        { type: 'Maize grain', qty: 30, weightKg: null, productId: 'drv1', baseUnit: null }, // pre-migration legacy row, no snapshot — trusted
      ],
      salesRows: [],
      healthRows: [],
      laborRows: [],
      products: [{ id: 'drv1', baseUnit: 'kg', isCostDriver: true }],
      totalOverhead: 0,
      totalActiveQty: 95,
      batchLabourCost: 0,
    });
    expect(result.outputQty).toBe(80); // 50 (matching) + 30 (legacy, no snapshot) — NOT +1000
  });
});
