import { describe, it, expect, vi, beforeEach } from 'vitest';
import { evaluateAlerts } from '@/lib/server/alertEngine';

const { mockDbSelect, mockDbInsert } = vi.hoisted(() => ({
  mockDbSelect: vi.fn(),
  mockDbInsert: vi.fn(),
}));

vi.mock('@/db', () => ({
  db: {
    select: mockDbSelect,
    insert: mockDbInsert,
  },
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
  mockDbSelect.mockReset();
  mockDbInsert.mockReset();
  mockDbInsert.mockReturnValue({ values: vi.fn(() => Promise.resolve()) });
});

describe('alertEngine', () => {
  it('creates mortality alerts when rate exceeds threshold', async () => {
    mockDbSelect
      .mockReturnValueOnce(mockQuery([
        { metric: 'mortality_rate', threshold: 5, severity: 'critical', enabled: true, unit: '%', tenantId: 't1' },
      ]))
      .mockReturnValueOnce(mockQuery([
        { id: 'b1', name: 'Batch #1', initialQty: 100, currentQty: 85, tenantId: 't1' },
      ]))
      .mockReturnValueOnce(mockQuery([
        { batchId: 'b1', count: 10, tenantId: 't1' },
        { batchId: 'b1', count: 5, tenantId: 't1' },
      ]))
      .mockReturnValueOnce(mockQuery([]));

    const result = await evaluateAlerts('t1');
    expect(result.conditions).toBe(1);
    expect(mockDbInsert).toHaveBeenCalled();
  });

  it('does not create mortality alert when rate is below threshold', async () => {
    mockDbSelect
      .mockReturnValueOnce(mockQuery([
        { metric: 'mortality_rate', threshold: 10, severity: 'warning', enabled: true, unit: '%', tenantId: 't1' },
      ]))
      .mockReturnValueOnce(mockQuery([
        { id: 'b1', name: 'Batch #1', initialQty: 100, currentQty: 98, tenantId: 't1' },
      ]))
      .mockReturnValueOnce(mockQuery([
        { batchId: 'b1', count: 2, tenantId: 't1' },
      ]));

    const result = await evaluateAlerts('t1');
    expect(result.conditions).toBe(0);
    expect(mockDbInsert).not.toHaveBeenCalled();
  });

  it('creates low feed stock alerts', async () => {
    mockDbSelect
      .mockReturnValueOnce(mockQuery([
        { metric: 'feed_qty', threshold: 50, severity: 'warning', enabled: true, unit: 'kg', tenantId: 't1' },
      ]))
      .mockReturnValueOnce(mockQuery([
        { id: 'i1', name: 'Layer Mash', category: 'FEED_FINISHED', unit: 'kg', tenantId: 't1' },
      ]))
      .mockReturnValueOnce(mockQuery([
        { itemId: 'i1', qtyOnHand: 30, receivedDate: '2026-01-01', tenantId: 't1' },
      ]))
      .mockReturnValueOnce(mockQuery([]));

    const result = await evaluateAlerts('t1');
    expect(result.conditions).toBe(1);
    expect(mockDbInsert).toHaveBeenCalled();
  });

  it('does not create feed alert when stock is sufficient', async () => {
    mockDbSelect
      .mockReturnValueOnce(mockQuery([
        { metric: 'feed_qty', threshold: 50, severity: 'warning', enabled: true, unit: 'kg', tenantId: 't1' },
      ]))
      .mockReturnValueOnce(mockQuery([
        { id: 'i1', name: 'Layer Mash', category: 'FEED_FINISHED', unit: 'kg', tenantId: 't1' },
      ]))
      .mockReturnValueOnce(mockQuery([
        { itemId: 'i1', qtyOnHand: 100, receivedDate: '2026-01-01', tenantId: 't1' },
      ]));

    const result = await evaluateAlerts('t1');
    expect(result.conditions).toBe(0);
    expect(mockDbInsert).not.toHaveBeenCalled();
  });

  it('ignores non-feed items for feed alert', async () => {
    mockDbSelect
      .mockReturnValueOnce(mockQuery([
        { metric: 'feed_qty', threshold: 10, severity: 'warning', enabled: true, unit: 'kg', tenantId: 't1' },
      ]))
      .mockReturnValueOnce(mockQuery([
        { id: 'i1', name: 'Vaccine', category: 'MEDICINE', unit: 'dose', tenantId: 't1' },
        { id: 'i2', name: 'Maize', category: 'FEED_INGREDIENT', unit: 'kg', tenantId: 't1' },
      ]))
      .mockReturnValueOnce(mockQuery([
        { itemId: 'i1', qtyOnHand: 5, tenantId: 't1' },
        { itemId: 'i2', qtyOnHand: 5, tenantId: 't1' },
      ]))
      .mockReturnValueOnce(mockQuery([]));

    const result = await evaluateAlerts('t1');
    expect(result.conditions).toBe(1);
  });

  it('skips disabled rules', async () => {
    mockDbSelect.mockReturnValueOnce(mockQuery([
      { metric: 'mortality_rate', threshold: 1, severity: 'critical', enabled: false, unit: '%', tenantId: 't1' },
    ]));

    const result = await evaluateAlerts('t1');
    expect(result.conditions).toBe(0);
    expect(mockDbInsert).not.toHaveBeenCalled();
  });

  it('handles empty alertRules gracefully', async () => {
    mockDbSelect.mockReturnValueOnce(mockQuery([]));

    const result = await evaluateAlerts('t1');
    expect(result.conditions).toBe(0);
    expect(result.created).toBe(0);
  });

  it('creates overdue task alerts', async () => {
    const daysAgo = new Date(Date.now() - 48 * 3600 * 1000).toISOString();
    mockDbSelect
      .mockReturnValueOnce(mockQuery([
        { metric: 'task_overdue_hours', threshold: 24, severity: 'warning', enabled: true, unit: 'hours', tenantId: 't1' },
      ]))
      .mockReturnValueOnce(mockQuery([
        { id: 't1', title: 'Morning round', status: 'ASSIGNED', dueAt: daysAgo, tenantId: 't1' },
      ]))
      .mockReturnValueOnce(mockQuery([]));

    const result = await evaluateAlerts('t1');
    expect(result.conditions).toBe(1);
    expect(mockDbInsert).toHaveBeenCalled();
  });

  it('skips completed tasks for overdue alert', async () => {
    const daysAgo = new Date(Date.now() - 48 * 3600 * 1000).toISOString();
    mockDbSelect
      .mockReturnValueOnce(mockQuery([
        { metric: 'task_overdue_hours', threshold: 24, severity: 'warning', enabled: true, unit: 'hours', tenantId: 't1' },
      ]))
      .mockReturnValueOnce(mockQuery([
        { id: 't1', title: 'Done task', status: 'DONE', dueAt: daysAgo, tenantId: 't1' },
      ]));

    const result = await evaluateAlerts('t1');
    expect(result.conditions).toBe(0);
  });

  it('deduplicates existing alerts by id', async () => {
    mockDbSelect
      .mockReturnValueOnce(mockQuery([
        { metric: 'mortality_rate', threshold: 5, severity: 'critical', enabled: true, unit: '%', tenantId: 't1' },
      ]))
      .mockReturnValueOnce(mockQuery([
        { id: 'b1', name: 'Batch #1', initialQty: 100, currentQty: 85, tenantId: 't1' },
      ]))
      .mockReturnValueOnce(mockQuery([
        { batchId: 'b1', count: 15, tenantId: 't1' },
      ]))
      .mockReturnValueOnce(mockQuery([
        { id: 'auto:mortality:b1' },
      ]));

    const result = await evaluateAlerts('t1');
    expect(result.conditions).toBe(1);
    // The whole point of dedup: the condition fires, but because the alert id
    // already exists nothing new is written.
    expect(result.created).toBe(0);
    expect(mockDbInsert).not.toHaveBeenCalled();
  });
});
