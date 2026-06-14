import { describe, it, expect } from 'vitest';
import {
  stripMeta,
  calcMortalityRate,
  formatCurrency,
  formatDate,
  linearRegression,
  generateId,
} from '@/lib/utils';

describe('stripMeta', () => {
  it('removes server-managed timestamp fields', () => {
    const input = {
      id: 'f1',
      name: 'Batch A',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
      lastUpdated: '2026-01-03T00:00:00.000Z',
    };
    const out = stripMeta(input) as Record<string, unknown>;
    expect(out).toEqual({ id: 'f1', name: 'Batch A' });
    expect('createdAt' in out).toBe(false);
    expect('updatedAt' in out).toBe(false);
    expect('lastUpdated' in out).toBe(false);
  });

  it('leaves a body without timestamp fields untouched', () => {
    expect(stripMeta({ id: 'x', amount: 10 })).toEqual({ id: 'x', amount: 10 });
  });
});

describe('calcMortalityRate', () => {
  it('returns a percentage of deaths over the initial count', () => {
    expect(calcMortalityRate(100, 5)).toBe(5);
    expect(calcMortalityRate(200, 50)).toBe(25);
  });

  it('returns 0 when the initial count is 0 (no divide-by-zero)', () => {
    expect(calcMortalityRate(0, 5)).toBe(0);
  });
});

describe('formatCurrency', () => {
  it('formats a number as Kenyan shillings with two decimals', () => {
    expect(formatCurrency(1500)).toBe('Ksh 1,500.00');
    expect(formatCurrency(0)).toBe('Ksh 0.00');
  });
});

describe('formatDate', () => {
  it('renders an em dash for empty input', () => {
    expect(formatDate('')).toBe('—');
  });

  it('formats an ISO date', () => {
    expect(formatDate('2026-06-14')).toMatch(/Jun.*14.*2026/);
  });
});

describe('linearRegression', () => {
  it('projects 7 future points following an increasing trend', () => {
    const out = linearRegression([1, 2, 3, 4, 5]);
    expect(out).toHaveLength(7);
    // strictly increasing series should project upward
    expect(out[6]).toBeGreaterThanOrEqual(out[0]);
    expect(out.every(n => n >= 0)).toBe(true);
  });

  it('returns the input unchanged when there are fewer than 2 points', () => {
    expect(linearRegression([42])).toEqual([42]);
  });
});

describe('generateId', () => {
  it('produces unique-ish non-empty ids', () => {
    const a = generateId();
    const b = generateId();
    expect(a).toBeTruthy();
    expect(a).not.toBe(b);
  });
});
