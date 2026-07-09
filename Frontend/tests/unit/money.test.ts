import { describe, it, expect } from 'vitest';
import { roundMoney, toCents, fromCents, sumMoney } from '@/lib/server/money';

describe('money helpers', () => {
  it('rounds to 2 dp', () => {
    expect(roundMoney(10.006)).toBe(10.01);
    expect(roundMoney(10.004)).toBe(10);
  });

  it('converts major ↔ minor without drift on common KES amounts', () => {
    expect(toCents(100.5)).toBe(10050);
    expect(fromCents(10050)).toBe(100.5);
  });

  it('sums via minor units', () => {
    expect(sumMoney([0.1, 0.2])).toBe(0.3);
  });
});
