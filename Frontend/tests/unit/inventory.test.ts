import { describe, it, expect, vi, beforeEach } from 'vitest';
import { productAvailability, feedOnHand, consumeFeedFIFO, sellableStock } from '@/lib/server/inventory';

const { mockDbSelect, mockDbUpdate } = vi.hoisted(() => ({
  mockDbSelect: vi.fn(),
  mockDbUpdate: vi.fn(),
}));
vi.mock('@/db', () => ({
  db: { select: mockDbSelect, update: mockDbUpdate },
}));

function makeWhere(rows: unknown[]) {
  const p = Promise.resolve(rows) as Promise<unknown[]> & { limit?: ReturnType<typeof vi.fn> };
  p.limit = vi.fn(() => Promise.resolve(rows.slice(0, 1)));
  return p;
}

function mockQuery(result: unknown[]) {
  return {
    from: vi.fn(() => ({
      where: vi.fn(() => makeWhere(result)),
    })),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('productAvailability', () => {
  it('calculates eggs available as produced minus sold', async () => {
    mockDbSelect
      .mockReturnValueOnce(mockQuery([
        { type: 'eggs', qty: 1000, batchId: 'b1', tenantId: 't1' },
        { type: 'eggs', qty: 500, batchId: 'b1', tenantId: 't1' },
        { type: 'manure', qty: 200, batchId: 'b1', tenantId: 't1' },
      ]))
      .mockReturnValueOnce(mockQuery([
        { productType: 'Eggs', baseQty: 300, quantity: 300, batchId: 'b1', tenantId: 't1' },
        { productType: 'Eggs', baseQty: 150, quantity: 150, batchId: 'b1', tenantId: 't1' },
        { productType: 'Manure', baseQty: 100, quantity: 100, batchId: 'b1', tenantId: 't1' },
      ]));

    const result = await productAvailability('t1', 'b1', 'Eggs');
    expect(result.produced).toBe(1500);
    expect(result.sold).toBe(450);
    expect(result.available).toBe(1050);
  });

  it('calculates manure availability', async () => {
    mockDbSelect
      .mockReturnValueOnce(mockQuery([
        { type: 'eggs', qty: 1000, batchId: 'b1', tenantId: 't1' },
        { type: 'manure', qty: 200, batchId: 'b1', tenantId: 't1' },
      ]))
      .mockReturnValueOnce(mockQuery([
        { productType: 'Manure', baseQty: 100, quantity: 100, batchId: 'b1', tenantId: 't1' },
      ]));

    const result = await productAvailability('t1', 'b1', 'Manure');
    expect(result.produced).toBe(200);
    expect(result.sold).toBe(100);
    expect(result.available).toBe(100);
  });

  it('returns zero for products with no production', async () => {
    mockDbSelect
      .mockReturnValueOnce(mockQuery([]))
      .mockReturnValueOnce(mockQuery([]));

    const result = await productAvailability('t1', 'b1', 'Fish');
    expect(result.produced).toBe(0);
    expect(result.sold).toBe(0);
    expect(result.available).toBe(0);
  });

  it('returns negative available when oversold', async () => {
    mockDbSelect
      .mockReturnValueOnce(mockQuery([{ type: 'eggs', qty: 100, batchId: 'b1', tenantId: 't1' }]))
      .mockReturnValueOnce(mockQuery([{ productType: 'Eggs', baseQty: 200, quantity: 200, batchId: 'b1', tenantId: 't1' }]));

    const result = await productAvailability('t1', 'b1', 'Eggs');
    expect(result.available).toBe(-100);
  });

  it('case-insensitively matches product name', async () => {
    mockDbSelect
      .mockReturnValueOnce(mockQuery([
        { type: 'eggs', qty: 1500, batchId: 'b1', tenantId: 't1' },
      ]))
      .mockReturnValueOnce(mockQuery([]))
      .mockReturnValueOnce(mockQuery([
        { type: 'manure', qty: 200, batchId: 'b1', tenantId: 't1' },
      ]))
      .mockReturnValueOnce(mockQuery([]));

    const upper = await productAvailability('t1', 'b1', 'EGGS');
    expect(upper.produced).toBe(1500);
    const mixed = await productAvailability('t1', 'b1', 'MaNuRe');
    expect(mixed.produced).toBe(200);
  });

  it('rounds available to 3 decimal places', async () => {
    mockDbSelect
      .mockReturnValueOnce(mockQuery([{ type: 'eggs', qty: 1000, batchId: 'b1', tenantId: 't1' }]))
      .mockReturnValueOnce(mockQuery([{ productType: 'Eggs', baseQty: 333.3333, quantity: 333.3333, batchId: 'b1', tenantId: 't1' }]));

    const result = await productAvailability('t1', 'b1', 'Eggs');
    expect(result.available.toString()).toMatch(/^\d+\.?\d{0,3}$/);
  });
});

describe('sellableStock', () => {
  it('for a live animal (per head) the stock IS the batch headcount — no collection needed', async () => {
    const result = await sellableStock(
      't1',
      { id: 'b1', currentQty: 480 },
      { name: 'Live bird', isAnimalProduct: true },
    );
    expect(result.basis).toBe('headcount');
    expect(result.available).toBe(480);
    // headcount basis must NOT touch production/sales tables
    expect(mockDbSelect).not.toHaveBeenCalled();
  });

  it('never reports negative headcount stock', async () => {
    const result = await sellableStock(
      't1',
      { id: 'b1', currentQty: -5 },
      { name: 'Piglets', isAnimalProduct: true },
    );
    expect(result.available).toBe(0);
  });

  it('for a harvested output (eggs/pork/fish/maize) stock = collected − sold', async () => {
    mockDbSelect
      .mockReturnValueOnce(mockQuery([
        { type: 'eggs', qty: 900, batchId: 'b1', tenantId: 't1' },
      ]))
      .mockReturnValueOnce(mockQuery([
        { productType: 'Eggs', baseQty: 300, quantity: 10, batchId: 'b1', tenantId: 't1' },
      ]));
    const result = await sellableStock(
      't1',
      { id: 'b1', currentQty: 480 },
      { name: 'Eggs', isAnimalProduct: false },
    );
    expect(result.basis).toBe('harvested');
    expect(result.produced).toBe(900);
    expect(result.sold).toBe(300);
    expect(result.available).toBe(600);
  });

  it('treats a missing isAnimalProduct flag as a harvested output (safe default)', async () => {
    mockDbSelect
      .mockReturnValueOnce(mockQuery([{ type: 'fish', qty: 50, batchId: 'b1', tenantId: 't1' }]))
      .mockReturnValueOnce(mockQuery([]));
    const result = await sellableStock('t1', { id: 'b1', currentQty: 200 }, { name: 'Fish' });
    expect(result.basis).toBe('harvested');
    expect(result.available).toBe(50);
  });
});

describe('feedOnHand', () => {
  it('sums all lot quantities for the given item', async () => {
    mockDbSelect.mockReturnValueOnce(mockQuery([
      { id: 'l1', itemId: 'feed1', qtyOnHand: 100, receivedDate: '2026-01-01' },
      { id: 'l2', itemId: 'feed1', qtyOnHand: 50, receivedDate: '2026-02-01' },
    ]));
    const total = await feedOnHand('t1', 'feed1');
    expect(total).toBe(150);
  });

  it('returns zero for an item with no lots', async () => {
    mockDbSelect.mockReturnValueOnce(mockQuery([]));
    const total = await feedOnHand('t1', 'nonexistent');
    expect(total).toBe(0);
  });
});

describe('consumeFeedFIFO', () => {
  it('consumes from oldest lot first (FIFO)', async () => {
    mockDbSelect.mockReturnValueOnce(mockQuery([
      { id: 'l_old', itemId: 'feed1', qtyOnHand: 100, receivedDate: '2026-01-01', unit: 'kg' },
      { id: 'l_new', itemId: 'feed1', qtyOnHand: 50, receivedDate: '2026-02-01', unit: 'kg' },
    ]));
    mockDbUpdate.mockReturnValue({ set: vi.fn(() => ({ where: vi.fn(() => Promise.resolve()) })) });

    const result = await consumeFeedFIFO('t1', 'feed1', 120);
    expect(result.consumed).toBe(120);
    expect(result.shortfall).toBe(0);
  });

  it('reports shortfall when quantity exceeds available stock', async () => {
    mockDbSelect.mockReturnValueOnce(mockQuery([
      { id: 'l1', itemId: 'feed1', qtyOnHand: 100, receivedDate: '2026-01-01', unit: 'kg' },
    ]));
    mockDbUpdate.mockReturnValue({ set: vi.fn(() => ({ where: vi.fn(() => Promise.resolve()) })) });

    const result = await consumeFeedFIFO('t1', 'feed1', 150);
    expect(result.consumed).toBe(100);
    expect(result.shortfall).toBe(50);
  });

  it('returns zero consumed for invalid inputs', async () => {
    const result = await consumeFeedFIFO('t1', '', 100);
    expect(result.consumed).toBe(0);
    expect(result.shortfall).toBe(100);
  });

  it('returns zero consumed for zero quantity', async () => {
    const result = await consumeFeedFIFO('t1', 'feed1', 0);
    expect(result.consumed).toBe(0);
    expect(result.shortfall).toBe(0);
  });

  it('handles negative quantity', async () => {
    const result = await consumeFeedFIFO('t1', 'feed1', -10);
    expect(result.consumed).toBe(0);
    expect(result.shortfall).toBe(0);
  });
});
