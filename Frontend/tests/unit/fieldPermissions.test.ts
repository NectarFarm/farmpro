import { describe, it, expect, vi } from 'vitest';
import { stripForRead, hiddenFieldKeysFor, assertWritable } from '@/lib/server/fieldPermissions';
import type { Session } from '@/lib/server/session';

vi.mock('@/db', () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(() => Promise.resolve([])),
        })),
      })),
    })),
  },
}));

describe('fieldPermissions', () => {
  describe('stripForRead', () => {
    const hidden = new Set(['batch_profit_loss', 'feed_unit_cost']);

    it('strips sensitive properties from batch rows', () => {
      const rows = [{ id: 'b1', acquisitionCost: 1000, name: 'Batch' }];
      const result = stripForRead('batches', rows, hidden);
      expect(result[0]).not.toHaveProperty('acquisitionCost');
      expect(result[0]).toHaveProperty('name');
    });

    it('strips unitCost from lot rows', () => {
      const rows = [{ id: 'l1', unitCost: 50, qtyOnHand: 100 }];
      const result = stripForRead('lots', rows, hidden);
      expect(result[0]).not.toHaveProperty('unitCost');
      expect(result[0]).toHaveProperty('qtyOnHand');
    });

    it('strips sales price fields when egg_sale_price is hidden', () => {
      const h = new Set([...hidden, 'egg_sale_price']);
      const rows = [{ id: 's1', unitPrice: 550, totalAmount: 16500, buyer: 'Mama' }];
      const result = stripForRead('sales', rows, h);
      expect(result[0]).not.toHaveProperty('unitPrice');
      expect(result[0]).not.toHaveProperty('totalAmount');
      expect(result[0]).not.toHaveProperty('buyer');
    });

    it('strips cost summary fields', () => {
      const rows = [{ batchId: 'b1', totalCost: 1000, totalRevenue: 2000, grossMargin: 1000 }];
      const result = stripForRead('cost-summary', rows, hidden);
      expect(result[0]).not.toHaveProperty('totalCost');
      expect(result[0]).not.toHaveProperty('totalRevenue');
      expect(result[0]).not.toHaveProperty('grossMargin');
    });

    it('returns rows unchanged when no hidden keys', () => {
      const rows = [{ acquisitionCost: 1000 }];
      const result = stripForRead('batches', rows, new Set());
      expect(result[0]).toHaveProperty('acquisitionCost');
    });

    it('returns rows unchanged for unknown resource', () => {
      const rows = [{ secret: 'value' }];
      const result = stripForRead('unknown', rows, new Set(['secret']));
      expect(result[0]).toHaveProperty('secret');
    });

    it('does not mutate the original rows', () => {
      const rows = [{ acquisitionCost: 1000, name: 'test' }];
      const original = { ...rows[0] };
      stripForRead('batches', rows, hidden);
      expect(rows[0]).toEqual(original);
    });

    it('handles empty rows array', () => {
      expect(stripForRead('batches', [], hidden)).toEqual([]);
    });

    it('multiple hidden keys compound correctly', () => {
      const h = new Set(['feed_unit_cost', 'egg_sale_price']);
      const rows = [{ unitCost: 50, unitPrice: 100, qtyOnHand: 10 }];
      const result = stripForRead('lots', rows, h);
      expect(result[0]).not.toHaveProperty('unitCost');
      expect(result[0]).toHaveProperty('unitPrice');  // egg_sale_price doesn't gate lots
      expect(result[0]).toHaveProperty('qtyOnHand');
    });

    it('different resources have different sensitivity maps', () => {
      const h = new Set(['batch_profit_loss']);
      const batchRows = [{ acquisitionCost: 1000 }];
      const lotRows = [{ unitCost: 50 }];
      expect(stripForRead('batches', batchRows, h)[0]).not.toHaveProperty('acquisitionCost');
      expect(stripForRead('lots', lotRows, h)[0]).toHaveProperty('unitCost');  // batch_profit_loss doesn't gate lots
    });
  });

  describe('hiddenFieldKeysFor', () => {
    it('returns empty set for owner role', async () => {
      const session = { role: 'owner' } as Session;
      const result = await hiddenFieldKeysFor(session);
      expect(result.size).toBe(0);
    });

    it('returns empty set for auditor role', async () => {
      const session = { role: 'auditor' } as Session;
      const result = await hiddenFieldKeysFor(session);
      expect(result.size).toBe(0);
    });

    it('returns all financial keys for manager without profile', async () => {
      const session = { role: 'manager' } as Session;
      const result = await hiddenFieldKeysFor(session);
      expect(result.has('feed_unit_cost')).toBe(true);
      expect(result.has('egg_sale_price')).toBe(true);
      expect(result.has('batch_profit_loss')).toBe(true);
    });

    it('returns all financial keys for vet role', async () => {
      const session = { role: 'vet' } as Session;
      const result = await hiddenFieldKeysFor(session);
      expect(result.size).toBe(3);
    });
  });

  describe('assertWritable', () => {
    it('allows owner to write anything', async () => {
      await expect(assertWritable({ role: 'owner' } as Session, ['anything'])).resolves.not.toThrow();
    });

    it('does not throw for worker with no profile (no fields to assert against)', async () => {
      const session = { role: 'worker' } as Session;
      await expect(assertWritable(session, ['feed_unit_cost'])).resolves.not.toThrow();
    });
  });
});
