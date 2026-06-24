import { describe, it, expect } from 'vitest';
import { stripForRead } from '@/lib/server/fieldPermissions';

describe('field-permission stripping (the security boundary)', () => {
  it('drops a feed lot unit cost when feed_unit_cost is hidden', () => {
    const lots = [{ id: 'l1', qtyOnHand: 42, unitCost: 70 }];
    const out = stripForRead('lots', lots, new Set(['feed_unit_cost']));
    expect(out[0]).not.toHaveProperty('unitCost');
    expect(out[0].qtyOnHand).toBe(42); // non-sensitive field stays
  });

  it('drops all money fields on a sale when egg_sale_price is hidden', () => {
    const sales = [{ id: 's1', productType: 'Eggs', quantity: 30, unitPrice: 13, totalAmount: 390, buyer: 'Market' }];
    const out = stripForRead('sales', sales, new Set(['egg_sale_price']));
    expect(out[0]).not.toHaveProperty('unitPrice');
    expect(out[0]).not.toHaveProperty('totalAmount');
    expect(out[0]).not.toHaveProperty('buyer');
    expect(out[0].quantity).toBe(30);
  });

  it('keeps everything when nothing is hidden', () => {
    const lots = [{ id: 'l1', unitCost: 70 }];
    const out = stripForRead('lots', lots, new Set());
    expect(out[0].unitCost).toBe(70);
  });

  it('does not mutate the original rows', () => {
    const lots = [{ id: 'l1', unitCost: 70 }];
    stripForRead('lots', lots, new Set(['feed_unit_cost']));
    expect(lots[0].unitCost).toBe(70);
  });
});
